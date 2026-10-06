import { loadConfig, saveConfig, type ExtensionConfig } from "./lib/config";
import { clearAttempts, readAttempts } from "./lib/logger";
import { requestStatus, sendToBackground } from "./lib/messaging";
import type { AttemptLogEntry, ModelState } from "./lib/types";

const stateEl = document.querySelector<HTMLParagraphElement>("#model-state");
const errorEl = document.querySelector<HTMLParagraphElement>("#error-detail");
const attemptsEl = document.querySelector<HTMLOListElement>("#attempts");
const countEl = document.querySelector<HTMLElement>("#attempt-count");
const enabledEl = document.querySelector<HTMLInputElement>("#enabled");
const verboseEl = document.querySelector<HTMLInputElement>("#verbose");
const warmEl = document.querySelector<HTMLButtonElement>("#warm");
const clearEl = document.querySelector<HTMLButtonElement>("#clear");

let pollTimer: number | undefined;

function renderState(state: ModelState): void {
  if (!stateEl) return;
  stateEl.textContent = state;
  stateEl.className = `state state--${state}`;
}

function renderError(message: string | null | undefined): void {
  if (!errorEl) return;
  const text = (message ?? "").trim();
  errorEl.textContent = text;
  errorEl.hidden = text.length === 0;
}

function renderAttempts(attempts: AttemptLogEntry[]): void {
  if (!attemptsEl || !countEl) return;
  countEl.textContent = attempts.length > 0 ? `(${attempts.length})` : "";
  attemptsEl.replaceChildren();

  if (attempts.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty";
    empty.textContent = "No commands evaluated yet.";
    attemptsEl.append(empty);
    return;
  }

  for (const attempt of [...attempts].reverse().slice(0, 50)) {
    const item = document.createElement("li");
    item.className = "attempt";

    const head = document.createElement("div");
    head.className = "attempt-head";

    const level = document.createElement("span");
    level.className = `level level--${attempt.level}`;
    level.textContent = attempt.level;

    const score = document.createElement("span");
    score.textContent = `${attempt.score}/100`;

    const meta = document.createElement("span");
    meta.className = "attempt-meta";
    const time = new Date(attempt.at).toLocaleTimeString();
    meta.textContent = `${attempt.source} · ${attempt.engine} · ${time}`;

    head.append(level, score, meta);

    const command = document.createElement("div");
    command.className = "attempt-command";
    command.textContent = attempt.commandPreview;

    item.append(head, command);
    attemptsEl.append(item);
  }
}

async function refresh(): Promise<void> {
  try {
    const status = await requestStatus();
    renderState(status.modelState);
    renderError(status.lastError);
    renderAttempts(status.attempts);
  } catch {
    renderState("cold");
    renderAttempts(await readAttempts());
  }
}

function stopPolling(): void {
  if (pollTimer !== undefined) {
    window.clearInterval(pollTimer);
    pollTimer = undefined;
  }
}

/** Poll status until the model settles, so the popup reflects a background load. */
function pollUntilSettled(): void {
  stopPolling();
  const startedAt = Date.now();
  pollTimer = window.setInterval(() => {
    if (Date.now() - startedAt > 5 * 60 * 1000) {
      stopPolling();
      renderState("error");
      renderError("The model did not finish loading within 5 minutes.");
      return;
    }
    void refresh().then(() => {
      const state = stateEl?.textContent;
      if (state !== "loading") stopPolling();
    });
  }, 1500);
}

async function applyConfig(config: ExtensionConfig): Promise<void> {
  if (enabledEl) enabledEl.checked = config.enabled;
  if (verboseEl) verboseEl.checked = config.verbose;
}

void loadConfig().then(applyConfig);
void refresh();

enabledEl?.addEventListener("change", () => {
  void saveConfig({
    enabled: enabledEl.checked,
    verbose: verboseEl?.checked ?? false,
  });
});

verboseEl?.addEventListener("change", () => {
  void saveConfig({
    enabled: enabledEl?.checked ?? true,
    verbose: verboseEl.checked,
  });
});

warmEl?.addEventListener("click", () => {
  if (!warmEl) return;
  warmEl.disabled = true;
  renderState("loading");
  renderError(null);
  void sendToBackground({ type: "warm" })
    .then((response) => {
      const result = response as { ok?: boolean; error?: string } | undefined;
      if (result && result.ok === false) {
        renderState("error");
        renderError(result.error ?? "Warm-up failed.");
        return;
      }
      return refresh().then(pollUntilSettled);
    })
    .catch((error: unknown) => {
      renderState("error");
      renderError(error instanceof Error ? error.message : String(error));
    })
    .finally(() => {
      warmEl.disabled = false;
    });
});

clearEl?.addEventListener("click", () => {
  void clearAttempts().then(refresh);
});
