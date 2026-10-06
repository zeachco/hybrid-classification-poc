import { appendAttempt, readAttempts, logError, logInfo, setVerbose } from "./lib/logger";
import { loadConfig } from "./lib/config";
import { OFFSCREEN_PORT } from "./lib/messaging";
import { buildQuestions } from "./lib/questions";
import { platformLabel, shellFor } from "./lib/platform";
import { scoreCommand } from "./lib/scoring";
import type {
  AttemptLogEntry,
  ContentToBackground,
  EvaluateResponse,
  LayaPrediction,
  LayaQuestion,
  ModelState,
  OffscreenRequest,
  OffscreenResponse,
  PlatformId,
  ProductPlatform,
  StatusResponse,
} from "./lib/types";

let modelState: ModelState = "cold";
let lastError: string | null = null;
let runtimeReady: Promise<void> | null = null;
let port: chrome.runtime.Port | null = null;
let nextRequestId = 0;
let loadedResolve: (() => void) | null = null;
let loadedReject: ((error: Error) => void) | null = null;

const pending = new Map<
  number,
  { resolve: (prediction: LayaPrediction) => void; reject: (error: Error) => void }
>();

// ---------------------------------------------------------------------------
// Offscreen runtime lifecycle
// ---------------------------------------------------------------------------

async function offscreenExists(): Promise<boolean> {
  const offscreen = chrome.offscreen as typeof chrome.offscreen & {
    hasDocument?: () => Promise<boolean>;
  };
  if (offscreen.hasDocument) return offscreen.hasDocument();

  const runtime = chrome.runtime as typeof chrome.runtime & {
    getContexts?: (filter: { contextTypes?: string[] }) => Promise<unknown[]>;
  };
  if (runtime.getContexts) {
    const contexts = await runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
    return contexts.length > 0;
  }
  return false;
}

async function ensureOffscreenDocument(): Promise<void> {
  if (await offscreenExists()) return;
  try {
    await chrome.offscreen.createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Host the local Laya WASM model used to score terminal commands.",
    });
  } catch (error) {
    // Another request may have created it in the meantime.
    if (!(await offscreenExists())) throw error;
  }
}

function handlePortMessage(message: OffscreenResponse): void {
  switch (message.type) {
    case "progress":
      logInfo("offscreen progress", message.phase);
      return;
    case "loaded":
      modelState = "ready";
      loadedResolve?.();
      loadedResolve = null;
      loadedReject = null;
      logInfo("model is ready");
      return;
    case "prediction": {
      const request = pending.get(message.requestId);
      if (!request) return;
      pending.delete(message.requestId);
      request.resolve(message.prediction);
      return;
    }
    case "error": {
      const failure = new Error(message.message);
      if (message.requestId !== undefined) {
        const request = pending.get(message.requestId);
        if (!request) return;
        pending.delete(message.requestId);
        request.reject(failure);
        return;
      }
      modelState = "error";
      logError("offscreen runtime error", message.message);
      loadedReject?.(failure);
      loadedResolve = null;
      loadedReject = null;
      runtimeReady = null;
    }
  }
}

function connectPort(): chrome.runtime.Port {
  if (port) return port;
  const connected = chrome.runtime.connect({ name: OFFSCREEN_PORT });
  connected.onMessage.addListener(handlePortMessage);
  connected.onDisconnect.addListener(() => {
    port = null;
    runtimeReady = null;
    for (const request of pending.values()) {
      request.reject(new Error("The offscreen runtime disconnected."));
    }
    pending.clear();
  });
  port = connected;
  return connected;
}

function ensureRuntime(): Promise<void> {
  if (!runtimeReady) {
    modelState = "loading";
    runtimeReady = (async () => {
      await ensureOffscreenDocument();
      const connected = connectPort();
      await new Promise<void>((resolve, reject) => {
        loadedResolve = resolve;
        loadedReject = reject;
        connected.postMessage({ type: "load" } satisfies OffscreenRequest);
      });
      lastError = null;
    })().catch((error: unknown) => {
      modelState = "error";
      runtimeReady = null;
      const failure = error instanceof Error ? error : new Error(String(error));
      lastError = failure.message;
      logError("warm-up failed", failure.message);
      throw failure;
    });
  }
  return runtimeReady;
}

function predict(
  state: string,
  questions: Record<string, LayaQuestion>,
): Promise<LayaPrediction> {
  return ensureRuntime().then(
    () =>
      new Promise<LayaPrediction>((resolve, reject) => {
        const requestId = ++nextRequestId;
        pending.set(requestId, { resolve, reject });
        try {
          connectPort().postMessage({
            type: "predict",
            requestId,
            state,
            questions,
          } satisfies OffscreenRequest);
        } catch (error) {
          pending.delete(requestId);
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      }),
  );
}

function toProductPlatform(id: PlatformId): ProductPlatform {
  return { id, label: platformLabel(id), shell: shellFor(id), raw: `content:${id}` };
}

// ---------------------------------------------------------------------------
// Message handling
// ---------------------------------------------------------------------------

async function handleEvaluate(
  message: Extract<ContentToBackground, { type: "evaluate" }>,
): Promise<EvaluateResponse> {
  const platform = toProductPlatform(message.platform);
  const questions = buildQuestions(platform);
  logInfo(`evaluating attempt from ${message.source}`, {
    platform: platform.id,
    length: message.command.length,
    command: message.command,
  });

  const startedAt = performance.now();
  try {
    const prediction = await predict(message.command, questions);
    const verdict = scoreCommand({
      command: message.command,
      platform: platform.id,
      heuristicMs: 0,
      modelMs: Math.round(performance.now() - startedAt),
      prediction,
    });
    logInfo("final verdict", {
      level: verdict.level,
      score: verdict.score,
      engine: verdict.engine,
      findings: verdict.findings.map((finding) => finding.id),
    });
    return { ok: true, verdict, modelPending: false };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    logError("evaluation failed", messageText);
    return { ok: false, error: messageText };
  }
}

async function handleStatus(): Promise<StatusResponse> {
  const config = await loadConfig();
  return {
    ok: true,
    modelState,
    attempts: await readAttempts(),
    enabled: config.enabled,
    lastError,
  };
}

async function handleMessage(
  message: ContentToBackground,
): Promise<EvaluateResponse | StatusResponse | { ok: true; modelState?: ModelState }> {
  switch (message.type) {
    case "evaluate":
      return handleEvaluate(message);
    case "status":
      return handleStatus();
    case "warm":
      // Do not await the load: it takes tens of seconds (340 MB model), and a
      // long pending sendResponse can be cut off when the MV3 service worker
      // is torn down. Kick it off and let the popup poll status instead.
      void ensureRuntime().catch(() => undefined);
      return { ok: true, modelState };
    case "log":
      await appendAttempt(message.entry as AttemptLogEntry);
      return { ok: true };
  }
}

chrome.runtime.onMessage.addListener((message: ContentToBackground, _sender, sendResponse) => {
  void handleMessage(message)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      const text = error instanceof Error ? error.message : String(error);
      lastError = text;
      logError("message handling failed", text);
      sendResponse({ ok: false, error: text });
    });
  // Keep the message channel open for the async response.
  return true;
});

// Keep the logger's verbosity in sync with the stored config.
void loadConfig().then((config) => {
  setVerbose(config.verbose);
  logInfo("service worker started", { enabled: config.enabled });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync" || !changes["layaGuard.config"]) return;
  void loadConfig().then((config) => setVerbose(config.verbose));
});
