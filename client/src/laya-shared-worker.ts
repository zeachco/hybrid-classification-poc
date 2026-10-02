type QuestionType = "choice" | "score" | "noul";

type ClientQuestion = {
  type: QuestionType;
  instructions: string;
  criteria?: Record<string, string | null> | string[];
  threshold?: number;
};

type ClientPrediction = {
  answers: Record<string, {
    type: QuestionType;
    choice?: string;
    score?: number;
    noul?: number;
    confidence?: number;
    answer_confidence?: number;
    probabilities?: Record<string, number>;
  }>;
};

type PredictOptions = {
  maxLen?: number;
  headMaxLen?: number;
};

type WorkerRequest =
  | {
      type: "load";
      modelDir: string;
      wasmBase: string;
    }
  | {
      type: "predict";
      requestId: number;
      state: string;
      questions: Record<string, ClientQuestion>;
      options?: PredictOptions;
    };

type WorkerResponse =
  | { type: "loaded" }
  | { type: "prediction"; requestId: number; prediction: ClientPrediction }
  | { type: "error"; requestId?: number; message: string };

type ClientRuntime = {
  predict(
    state: string,
    questions: Record<string, ClientQuestion>,
    options?: PredictOptions,
  ): Promise<ClientPrediction>;
};

type LayaModule = typeof import("laya-system-one");

// laya-system-one detects browser support through window/document. A
// SharedWorker has neither, even though it provides the fetch and WebAssembly
// APIs that the browser backend needs.
const browserGlobals = globalThis as unknown as {
  window?: typeof globalThis;
  document?: {
    querySelector: () => null;
    querySelectorAll: () => never[];
    getElementsByTagName: () => never[];
  };
};
browserGlobals.window ??= globalThis;
browserGlobals.document ??= {
  // Some browser module runtimes use these DOM probes even when running in a
  // worker. Laya only needs browser detection and fetch, so keep the probes
  // harmless instead of letting them abort model inference.
  querySelector: () => null,
  querySelectorAll: () => [],
  getElementsByTagName: () => [],
};

const scope = globalThis as typeof globalThis & {
  onconnect?: (event: { ports: MessagePort[] }) => void;
};

let runtimePromise: Promise<ClientRuntime> | null = null;

function loadRuntime(modelDir: string, wasmBase: string): Promise<ClientRuntime> {
  if (!runtimePromise) {
    runtimePromise = (async () => {
      const { Laya }: LayaModule = await import("laya-system-one");
      const loadedRuntime = await Laya.load({
        backend: "wasm",
        modelDir,
        wasmBase,
      });
      return {
        predict(state: string, questions: Record<string, ClientQuestion>, options?: PredictOptions) {
          return loadedRuntime.predict(state, questions, null, options);
        },
      };
    })().catch((error: unknown) => {
      runtimePromise = null;
      throw error;
    });
  }
  return runtimePromise!;
}

function send(port: MessagePort, message: WorkerResponse): void {
  port.postMessage(message);
}

scope.onconnect = (event) => {
  const port = event.ports[0];
  port.onmessage = (messageEvent: MessageEvent<WorkerRequest>) => {
    const message = messageEvent.data;
    if (message.type === "load") {
      void loadRuntime(message.modelDir, message.wasmBase)
        .then(() => send(port, { type: "loaded" }))
        .catch((error: unknown) => send(port, {
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        }));
      return;
    }

    const currentRuntime = runtimePromise;
    if (!currentRuntime) {
      send(port, {
        type: "error",
        requestId: message.requestId,
        message: "The client model has not finished loading.",
      });
      return;
    }
    void currentRuntime
      .then((runtime) => runtime.predict(message.state, message.questions, message.options))
      .then((prediction) => send(port, {
        type: "prediction",
        requestId: message.requestId,
        prediction,
      }))
      .catch((error: unknown) => send(port, {
        type: "error",
        requestId: message.requestId,
        message: error instanceof Error ? error.message : String(error),
      }));
  };
  port.start();
};
