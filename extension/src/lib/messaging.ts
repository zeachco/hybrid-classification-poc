import type {
  ContentToBackground,
  EvaluateRequest,
  EvaluateResponse,
  StatusResponse,
} from "./types";

export const OFFSCREEN_PORT = "laya-offscreen";

/** Fire-and-forget message to the service worker, tolerant of a dead worker. */
export function sendToBackground(message: ContentToBackground): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message));
          return;
        }
        resolve(response);
      });
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
    }
  });
}

export async function requestEvaluation(
  request: EvaluateRequest,
): Promise<EvaluateResponse> {
  const response = (await sendToBackground(request)) as EvaluateResponse | undefined;
  if (!response || typeof response !== "object") {
    throw new Error("The background worker did not answer the evaluation request.");
  }
  return response;
}

export async function requestStatus(): Promise<StatusResponse> {
  const response = (await sendToBackground({ type: "status" })) as StatusResponse | undefined;
  if (!response || !response.ok) {
    throw new Error("The background worker did not answer the status request.");
  }
  return response;
}
