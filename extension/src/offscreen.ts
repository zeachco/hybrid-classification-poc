import { installModelCache } from "./lib/model-cache";
import { OFFSCREEN_PORT } from "./lib/messaging";
import { logError, logInfo } from "./lib/logger";
import type {
  LayaPrediction,
  LayaQuestion,
  OffscreenRequest,
  OffscreenResponse,
} from "./lib/types";

type ClientRuntime = {
  predict(
    state: string,
    questions: Record<string, LayaQuestion>,
    options?: { maxLen?: number; headMaxLen?: number },
  ): Promise<LayaPrediction>;
};

// Same interactive token budget as the web client.
const MAX_TOKENS = 1024;

const MODEL_DIR = chrome.runtime.getURL("assets/models/laya/");
const WASM_BASE = chrome.runtime.getURL("assets/wasm-pkg/");

let runtimePromise: Promise<ClientRuntime> | null = null;

function loadRuntime(): Promise<ClientRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      logInfo("loading Laya runtime", { MODEL_DIR, WASM_BASE });
      await installModelCache({ modelDir: MODEL_DIR, wasmBase: WASM_BASE });
      const { Laya } = await import("laya-system-one");
      const loaded = await Laya.load({
        backend: "wasm",
        modelDir: MODEL_DIR,
        wasmBase: WASM_BASE,
      });
      logInfo("Laya runtime ready");
      return {
        predict(
          state: string,
          questions: Record<string, LayaQuestion>,
          options?: { maxLen?: number; headMaxLen?: number },
        ) {
          return loaded.predict(state, questions, null, options);
        },
      };
    })().catch((error: unknown) => {
      runtimePromise = null;
      logError("Laya runtime failed to load", error);
      throw error;
    });
  }
  return runtimePromise;
}

function send(port: chrome.runtime.Port, message: OffscreenResponse): void {
  try {
    port.postMessage(message);
  } catch {
    // The port dies when the service worker is torn down; the request is gone
    // with it, so there is nothing useful to do here.
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== OFFSCREEN_PORT) return;
  logInfo("background connected to the offscreen runtime");
  port.onMessage.addListener((message: OffscreenRequest) => {
    if (message.type === "load") {
      void loadRuntime()
        .then(() => send(port, { type: "loaded" }))
        .catch((error: unknown) =>
          send(port, {
            type: "error",
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      return;
    }

    if (message.type === "predict") {
      const pending = runtimePromise;
      if (!pending) {
        send(port, {
          type: "error",
          requestId: message.requestId,
          message: "The Laya runtime has not finished loading.",
        });
        return;
      }
      void pending
        .then((runtime) =>
          runtime.predict(message.state, message.questions, { maxLen: MAX_TOKENS }),
        )
        .then((prediction) =>
          send(port, { type: "prediction", requestId: message.requestId, prediction }),
        )
        .catch((error: unknown) =>
          send(port, {
            type: "error",
            requestId: message.requestId,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
    }
  });
});

logInfo("offscreen document booted", { MODEL_DIR });
