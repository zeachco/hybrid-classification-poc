import { loadConfig, DEFAULT_CONFIG, type ExtensionConfig } from "./lib/config";
import { hashCommand } from "./lib/hash";
import {
  commandFromSelection,
  extractCommandCandidate,
  findCommandElement,
} from "./lib/detection";
import { evaluateHeuristics } from "./lib/heuristics";
import { buildAttemptEntry, logInfo, logWarn, setVerbose } from "./lib/logger";
import { requestEvaluation, sendToBackground } from "./lib/messaging";
import { detectPlatform } from "./lib/platform";
import { scoreCommand } from "./lib/scoring";
import { CommandTooltip } from "./lib/tooltip";
import type { AttemptSource, PlatformId, Verdict } from "./lib/types";

const HOVER_DELAY_MS = 150;
const SELECTION_DELAY_MS = 250;
// Do not re-render the tooltip for the same command within this window.
const DISPLAY_DEDUPE_MS = 2500;
// Hide an untouched tooltip after this long.
const IDLE_HIDE_MS = 8000;

type PendingItem = {
  key: string;
  command: string;
  source: AttemptSource;
  rect: DOMRect;
};

let config: ExtensionConfig = { ...DEFAULT_CONFIG };
let attemptId = 0;

// Page-lifetime cache of settled verdicts, keyed by command hash. Hovering the
// same command a second time is answered from here instead of re-running Laya.
const verdictCache = new Map<string, Verdict>();

// Laya classifies one command at a time: at most one in flight, and the newest
// hovered command waits in `queued` behind it.
let inflight: PendingItem | null = null;
let queued: PendingItem | null = null;

let displayKey = "";
let displayAt = 0;
let hoverTimer: number | undefined;
let selectionTimer: number | undefined;
let hideTimer: number | undefined;

const tooltip = new CommandTooltip();

function fallbackRect(): DOMRect {
  return new DOMRect(window.innerWidth / 2, window.innerHeight / 2, 0, 0);
}

function scheduleHide(): void {
  window.clearTimeout(hideTimer);
  hideTimer = window.setTimeout(() => tooltip.hide(), IDLE_HIDE_MS);
}

function heuristicVerdict(command: string, platform: PlatformId): Verdict {
  const started = performance.now();
  const heuristic = evaluateHeuristics(command, platform);
  return scoreCommand({
    command,
    platform,
    heuristicMs: Math.round(performance.now() - started),
    heuristic,
  });
}

function finalize(item: PendingItem, verdict: Verdict): void {
  const entry = buildAttemptEntry({
    id: ++attemptId,
    source: item.source,
    url: location.href,
    command: item.command,
    verdict,
  });
  logInfo(
    `verdict level=${verdict.level} score=${verdict.score} engine=${verdict.engine} findings=${entry.findingIds.join(",") || "none"}`,
  );
  void sendToBackground({ type: "log", entry }).catch(() => undefined);
}

function startItem(item: PendingItem, platform: PlatformId): void {
  inflight = item;
  displayKey = item.key;
  displayAt = Date.now();
  const heuristic = heuristicVerdict(item.command, platform);
  tooltip.show(heuristic, { rect: item.rect }, true);
  scheduleHide();
  logInfo(
    `attempt #${attemptId + 1} source=${item.source} platform=${platform} chars=${item.command.length}`,
    item.command,
  );
  void runModel(item, platform, heuristic);
}

async function runModel(
  item: PendingItem,
  platform: PlatformId,
  heuristic: Verdict,
): Promise<void> {
  let verdict = heuristic;
  try {
    const response = await requestEvaluation({
      type: "evaluate",
      command: item.command,
      source: item.source,
      url: location.href,
      platform,
    });
    if (response.ok) {
      verdict = response.verdict;
    } else {
      logWarn("model evaluation failed; keeping the heuristic verdict", response.error);
    }
  } catch (error) {
    logWarn("background model unavailable; keeping the heuristic verdict", error);
  }

  verdictCache.set(item.key, verdict);

  // Only replace the tooltip if the user has not moved on to another command.
  if (displayKey === item.key) {
    tooltip.show(verdict, { rect: item.rect }, false);
    scheduleHide();
  }
  finalize(item, verdict);

  inflight = null;
  if (queued && config.enabled) {
    const next = queued;
    queued = null;
    const nextPlatform = detectPlatform().id;
    const cachedNext = verdictCache.get(next.key);
    if (cachedNext) {
      if (displayKey === next.key) {
        tooltip.show(cachedNext, { rect: next.rect }, false);
        scheduleHide();
      }
    } else {
      startItem(next, nextPlatform);
    }
  } else {
    queued = null;
  }
}

function handleCandidate(command: string, source: AttemptSource, element: Element | null): void {
  if (!config.enabled) return;
  const cleaned = command.trim();
  if (!cleaned) return;

  const key = hashCommand(cleaned);
  const now = Date.now();
  // Ignore the same command while its tooltip is already up.
  if (key === displayKey && now - displayAt < DISPLAY_DEDUPE_MS) return;

  const rect = element?.getBoundingClientRect() ?? fallbackRect();

  const cached = verdictCache.get(key);
  if (cached) {
    displayKey = key;
    displayAt = now;
    tooltip.show(cached, { rect }, false);
    scheduleHide();
    logInfo(`cache hit #${key} level=${cached.level} score=${cached.score}`);
    return;
  }

  const platform = detectPlatform().id;

  if (inflight) {
    const same = inflight.key === key;
    if (!same && queued?.key !== key) {
      queued = { key, command: cleaned, source, rect };
    }
    displayKey = key;
    displayAt = now;
    tooltip.showBusy(
      { rect },
      {
        message: same
          ? "Laya is already classifying this command"
          : queued?.key === key
            ? "This command is next in line"
            : "Laya is busy with another command",
        inFlight: { label: inflight.command },
        verdict: heuristicVerdict(cleaned, platform),
      },
    );
    scheduleHide();
    logInfo(`busy/queued #${key} behind in-flight #${inflight.key}`);
    return;
  }

  startItem({ key, command: cleaned, source, rect }, platform);
}

// --- hover ----------------------------------------------------------------

document.addEventListener(
  "mouseover",
  (event) => {
    if (!config.enabled) return;
    const target = event.target;
    window.clearTimeout(hoverTimer);
    hoverTimer = window.setTimeout(() => {
      const found = findCommandElement(target);
      if (!found) return;
      const command = extractCommandCandidate(found.text);
      if (!command) return;
      handleCandidate(command, "hover", found.element);
    }, HOVER_DELAY_MS);
  },
  true,
);

// --- selection ------------------------------------------------------------

document.addEventListener("selectionchange", () => {
  if (!config.enabled) return;
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(() => {
    const command = commandFromSelection(window.getSelection());
    if (!command) return;
    handleCandidate(command, "selection", null);
  }, SELECTION_DELAY_MS);
});

// --- clipboard ------------------------------------------------------------

document.addEventListener(
  "copy",
  () => {
    if (!config.enabled) return;
    const command = commandFromSelection(window.getSelection());
    if (!command) return;
    handleCandidate(command, "copy", null);
  },
  true,
);

// --- dismissal ------------------------------------------------------------

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") tooltip.hide();
});

// --- config ---------------------------------------------------------------

void loadConfig().then((loaded) => {
  config = loaded;
  setVerbose(loaded.verbose);
  logInfo("content script active", {
    enabled: loaded.enabled,
    verbose: loaded.verbose,
    platform: detectPlatform().id,
    url: location.href,
  });
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes["layaGuard.config"]) return;
  void loadConfig().then((loaded) => {
    config = loaded;
    setVerbose(loaded.verbose);
    if (!loaded.enabled) {
      queued = null;
      tooltip.hide();
    }
    logInfo("config changed", { enabled: loaded.enabled, verbose: loaded.verbose });
  });
});
