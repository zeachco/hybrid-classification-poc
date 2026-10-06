import "./styles.css";
import { installModelCache } from "./laya-model-cache";

type QuestionType = "choice" | "score" | "noul";

type ClassificationLabel = {
  label: string;
  value: string | boolean | number;
  probability: number;
};

type ClassificationResponse = {
  question_type: QuestionType;
  classification: string | boolean | number;
  confidence: number;
  labels: ClassificationLabel[];
};

type ClientAnswer = {
  type: QuestionType;
  choice?: string;
  score?: number;
  noul?: number;
  confidence?: number;
  answer_confidence?: number;
  probabilities?: Record<string, number>;
};

type ClientPrediction = {
  answers: Record<string, ClientAnswer>;
};

type ClientPredictOptions = {
  maxLen?: number;
};

type ClientRuntime = {
  predict(
    state: string,
    questions: Record<string, {
      type: QuestionType;
      instructions: string;
      criteria?: Record<string, string | null> | string[];
      threshold?: number;
    }>,
    options?: ClientPredictOptions,
  ): Promise<ClientPrediction>;
};

// Keep the browser demo predictable on mid-range machines. Laya still uses
// shorter internal buckets for short prompts, but never builds a plan beyond
// this token budget for an interactive showcase request.
const CLIENT_MAX_TOKENS = 1024;

const CLIENT_MODEL_DIR = new URL(
  import.meta.env.VITE_LAYA_MODEL_DIR ?? `${import.meta.env.BASE_URL}models/laya/`,
  document.baseURI,
).href;
const CLIENT_WASM_BASE = import.meta.env.VITE_LAYA_WASM_BASE
  ?? `${import.meta.env.BASE_URL}assets/wasm-pkg/`;

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <main class="shell">
    <form class="classifier" data-form>
      <div class="form-heading">
        <div>
          <p class="section-kicker">01 / Decision</p>
          <h2>Define the question</h2>
        </div>
        <div class="runtime-controls">
          <p class="runtime-warning" role="note">
            Inference runs entirely in your browser and needs about 1 GB of RAM; it may crash the tab.
          </p>
        </div>
      </div>

      <label class="field field-wide">
        <span>Question</span>
        <input name="question" required maxlength="500" value="Which team should handle this request?" />
        <small>Ask one clear question that can be answered from the prompt.</small>
      </label>

      <div class="field field-wide type-field">
        <span id="question-type-label">Question type</span>
        <div class="segmented" role="radiogroup" aria-labelledby="question-type-label" data-question-type>
          <label class="segment">
            <input type="radio" name="question_type" value="choice" checked />
            <span class="segment-copy">
              <strong>Choice</strong>
              <small>Pick one of the choices</small>
            </span>
          </label>
          <label class="segment">
            <input type="radio" name="question_type" value="score" />
            <span class="segment-copy">
              <strong>Score</strong>
              <small>Weigh every choice</small>
            </span>
          </label>
          <label class="segment">
            <input type="radio" name="question_type" value="noul" />
            <span class="segment-copy">
              <strong>Yes / no</strong>
              <small>Binary answer</small>
            </span>
          </label>
        </div>
      </div>

      <label class="field field-wide choices-field" data-choices-field>
        <span class="field-label">
          <span data-choices-label>Choices</span>
          <span class="field-count" data-choices-count>4 listed</span>
        </span>
        <textarea name="choices" rows="5" data-choices required spellcheck="false">Billing
Technical support
Sales
Other</textarea>
        <small data-choices-help>One possible answer per line. Keep the list short for faster local inference.</small>
      </label>

      <label class="field field-wide prompt-field">
        <span class="field-label">
          <span>Prompt to evaluate</span>
          <span class="field-count" data-prompt-count>0 / 6000</span>
        </span>
        <textarea name="prompt" rows="7" required maxlength="6000" data-prompt placeholder="Paste the text Laya should classify…">I was charged twice for my subscription and need a refund.</textarea>
        <small>Press <kbd>Ctrl</kbd> + <kbd>Enter</kbd> to evaluate.</small>
      </label>

      <div class="client-loading" data-client-loading hidden aria-live="polite">
        <div class="loading-heading">
          <span class="spinner" aria-hidden="true"></span>
          <span data-client-loading-label>Loading the client model…</span>
        </div>
        <div class="loading-track" aria-hidden="true"><div class="loading-fill"></div></div>
        <small data-client-loading-detail>Downloading the WASM engine and model into this browser.</small>
      </div>

      <div class="form-actions">
        <p class="form-note" data-form-note>One shared WASM runtime stays in this browser.</p>
        <button type="submit" data-submit aria-busy="false">
          <span class="spinner button-spinner" data-submit-spinner aria-hidden="true" hidden></span>
          <span data-submit-label>Evaluate prompt</span>
          <span class="button-arrow">→</span>
        </button>
      </div>
    </form>

    <section class="results" data-results>
      <div class="results-heading">
        <div>
          <p class="section-kicker">02 / Classification</p>
          <h2>Model readout</h2>
        </div>
        <div class="confidence" data-confidence></div>
      </div>
      <div class="classification-card">
        <span class="result-label">Top classification</span>
        <strong data-classification>—</strong>
      </div>
      <div class="probabilities" data-probabilities></div>
    </section>

    <p class="status" data-status role="status" aria-live="polite"></p>
  </main>
`;

const form = app.querySelector<HTMLFormElement>("[data-form]");
const typeGroup = app.querySelector<HTMLElement>("[data-question-type]");
const choicesField = app.querySelector<HTMLElement>("[data-choices-field]");
const choicesInput = app.querySelector<HTMLTextAreaElement>("[data-choices]");
const choicesCount = app.querySelector<HTMLElement>("[data-choices-count]");
const promptInput = app.querySelector<HTMLTextAreaElement>("[data-prompt]");
const promptCount = app.querySelector<HTMLElement>("[data-prompt-count]");
const submit = app.querySelector<HTMLButtonElement>("[data-submit]");
const submitSpinner = app.querySelector<HTMLElement>("[data-submit-spinner]");
const submitLabel = app.querySelector<HTMLElement>("[data-submit-label]");
const status = app.querySelector<HTMLElement>("[data-status]");
const clientLoading = app.querySelector<HTMLElement>("[data-client-loading]");
const clientLoadingLabel = app.querySelector<HTMLElement>("[data-client-loading-label]");
const clientLoadingDetail = app.querySelector<HTMLElement>("[data-client-loading-detail]");
const formNote = app.querySelector<HTMLElement>("[data-form-note]");
const results = app.querySelector<HTMLElement>("[data-results]");
const classification = app.querySelector<HTMLElement>("[data-classification]");
const confidence = app.querySelector<HTMLElement>("[data-confidence]");
const probabilities = app.querySelector<HTMLElement>("[data-probabilities]");

function selectedQuestionType(): QuestionType {
  const checked = form?.querySelector<HTMLInputElement>("input[name='question_type']:checked");
  return (checked?.value ?? "choice") as QuestionType;
}

function updateChoicesCount(): void {
  if (!choicesCount || !choicesInput) return;
  const count = choicesInput.value
    .split("\n")
    .map((choice) => choice.trim())
    .filter(Boolean).length;
  choicesCount.textContent = count === 1 ? "1 listed" : `${count} listed`;
}

function updatePromptCount(): void {
  if (!promptCount || !promptInput) return;
  promptCount.textContent = `${promptInput.value.length} / ${promptInput.maxLength}`;
}

function updateQuestionType(): void {
  const isYesNo = selectedQuestionType() === "noul";
  if (choicesField && choicesInput) {
    choicesField.hidden = isYesNo;
    choicesInput.required = !isYesNo;
  }
  updateChoicesCount();
}

typeGroup?.addEventListener("change", updateQuestionType);
choicesInput?.addEventListener("input", updateChoicesCount);
promptInput?.addEventListener("input", updatePromptCount);
form?.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    event.preventDefault();
    form?.requestSubmit();
  }
});
updateQuestionType();
updatePromptCount();

function setStatus(message: string, state: "ready" | "error" | "loading" | "") {
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function formatValue(value: string | boolean | number): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

let clientRuntime: ClientRuntime | null = null;
let clientRuntimePromise: Promise<ClientRuntime> | null = null;

type SharedWorkerRequest = {
  type: "predict";
  requestId: number;
  state: string;
  questions: Parameters<ClientRuntime["predict"]>[1];
  options?: ClientPredictOptions;
};

type SharedWorkerResponse =
  | { type: "loaded" }
  | { type: "prediction"; requestId: number; prediction: ClientPrediction }
  | { type: "error"; requestId?: number; message: string };

function setClientLoading(loading: boolean, label = "Loading the client model…", detail = "Starting the shared WASM worker."): void {
  clientLoading?.toggleAttribute("hidden", !loading);
  if (clientLoadingLabel) clientLoadingLabel.textContent = label;
  if (clientLoadingDetail) clientLoadingDetail.textContent = detail;
  if (formNote) {
    formNote.textContent = loading
      ? "The client model must finish loading before it can evaluate prompts."
      : "One shared WASM runtime stays in this browser.";
  }
}

async function warmClientRuntime(runtime: ClientRuntime): Promise<void> {
  setClientLoading(true, "Warming up the client model…", "Running one small local inference so the first example is faster.");
  await runtime.predict(
    "A short local warm-up example.",
    {
      classification: {
        type: "choice",
        instructions: "Which category best fits this text?",
        criteria: { Example: null, Other: null },
      },
    },
    { maxLen: CLIENT_MAX_TOKENS },
  );
}

async function loadClientRuntime(): Promise<ClientRuntime> {
  if (clientRuntime) return clientRuntime;
  if (!clientRuntimePromise) {
    clientRuntimePromise = (async () => {
      setClientLoading(true, "Loading the client model…", "Connecting to the shared WASM worker.");

      if (typeof SharedWorker === "undefined") {
        setClientLoading(true, "Loading the client model…", "Fetching the tokenizer, model, and WASM engine.");
        await installModelCache({ modelDir: CLIENT_MODEL_DIR, wasmBase: CLIENT_WASM_BASE });
        const { Laya } = await import("laya-system-one");
        const loadedRuntime = await Laya.load({
          backend: "wasm",
          modelDir: CLIENT_MODEL_DIR,
          ...(CLIENT_WASM_BASE ? { wasmBase: CLIENT_WASM_BASE } : {}),
        });
        const runtime: ClientRuntime = {
          predict(state, questions, options) {
            return loadedRuntime.predict(state, questions, null, options);
          },
        };
        await warmClientRuntime(runtime);
        clientRuntime = runtime;
        return runtime;
      }

      const runtime = await new Promise<ClientRuntime>((resolve, reject) => {
        const worker = new SharedWorker(
          new URL("./laya-shared-worker.ts", import.meta.url),
          { type: "module" },
        );
        const port = worker.port;
        const pending = new Map<number, {
          resolve: (prediction: ClientPrediction) => void;
          reject: (error: Error) => void;
        }>();
        let nextRequestId = 0;
        let settled = false;

        const fail = (error: unknown): void => {
          const failure = error instanceof Error ? error : new Error(String(error));
          for (const request of pending.values()) request.reject(failure);
          pending.clear();
          if (!settled) {
            reject(failure);
          } else {
            clientRuntime = null;
            clientRuntimePromise = null;
          }
        };

        const runtime: ClientRuntime = {
          predict(state, questions, options) {
            const requestId = ++nextRequestId;
            return new Promise<ClientPrediction>((resolvePrediction, rejectPrediction) => {
              pending.set(requestId, { resolve: resolvePrediction, reject: rejectPrediction });
              const message: SharedWorkerRequest = { type: "predict", requestId, state, questions, options };
              try {
                port.postMessage(message);
              } catch (error: unknown) {
                pending.delete(requestId);
                rejectPrediction(error instanceof Error ? error : new Error(String(error)));
              }
            });
          },
        };

        port.onmessage = (event: MessageEvent<SharedWorkerResponse>) => {
          const message = event.data;
          if (message.type === "loaded") {
            settled = true;
            clientRuntime = runtime;
            resolve(runtime);
            return;
          }
          if (message.type === "prediction") {
            const request = pending.get(message.requestId);
            if (!request) return;
            pending.delete(message.requestId);
            request.resolve(message.prediction);
            return;
          }
          const error = new Error(message.message);
          if (message.requestId === undefined) {
            fail(error);
            return;
          }
          const request = pending.get(message.requestId);
          if (!request) return;
          pending.delete(message.requestId);
          request.reject(error);
        };
        port.onmessageerror = () => fail(new Error("The client model worker could not read a message."));
        worker.onerror = (event) => fail(event.error ?? new Error(event.message));
        port.start();
        port.postMessage({
          type: "load",
          modelDir: CLIENT_MODEL_DIR,
          wasmBase: CLIENT_WASM_BASE,
        });
      });
      await warmClientRuntime(runtime);
      clientRuntime = runtime;
      return runtime;
    })().catch((error: unknown) => {
      clientRuntimePromise = null;
      clientRuntime = null;
      throw error;
    });
  }
  return clientRuntimePromise;
}

function makeClientQuestions(
  questionType: QuestionType,
  question: string,
  choices: string[],
): Record<string, { type: QuestionType; instructions: string; criteria?: Record<string, string | null> | string[] }> {
  if (questionType === "choice") {
    return {
      classification: {
        type: questionType,
        instructions: question,
        criteria: Object.fromEntries(choices.map((choice) => [choice, null])),
      },
    };
  }
  if (questionType === "score") {
    return { classification: { type: questionType, instructions: question, criteria: choices } };
  }
  return {
    classification: {
      type: questionType,
      instructions: question,
      criteria: {
        true: "the prompt satisfies the question",
        false: "the prompt does not satisfy the question",
      },
    },
  };
}

function clientResponse(
  questionType: QuestionType,
  choices: string[],
  answer: ClientAnswer,
): ClassificationResponse {
  const probabilities = answer.probabilities ?? {};
  let classification: string | boolean | number;
  let labels: ClassificationLabel[];

  if (questionType === "choice") {
    classification = answer.choice ?? "";
    labels = choices.map((choice) => ({
      label: choice,
      value: choice,
      probability: Number(probabilities[choice] ?? 0),
    }));
  } else if (questionType === "score") {
    labels = choices.map((choice, index) => ({
      label: choice,
      value: choice,
      probability: Number(probabilities[String(index)] ?? 0),
    }));
    const top = labels.length > 0
      ? labels.reduce((best, item) => item.probability > best.probability ? item : best)
      : undefined;
    classification = top?.value ?? answer.score ?? 0;
  } else {
    const yesProbability = Number(answer.noul ?? probabilities.true ?? 0);
    classification = yesProbability >= 0.5;
    labels = [
      { label: "Yes", value: true, probability: yesProbability },
      { label: "No", value: false, probability: 1 - yesProbability },
    ];
  }

  labels.sort((left, right) => right.probability - left.probability);
  return {
    question_type: questionType,
    classification,
    confidence: Number(answer.answer_confidence ?? answer.confidence ?? 0),
    labels,
  };
}

function clearResults(): void {
  if (!results || !classification || !confidence || !probabilities) return;
  classification.textContent = "—";
  confidence.textContent = "";
  probabilities.replaceChildren();
}

function showResults(response: ClassificationResponse): void {
  if (!results || !classification || !confidence || !probabilities) return;
  results.hidden = false;
  classification.textContent = formatValue(response.classification);
  confidence.textContent = `${Math.round(response.confidence * 100)}% confidence`;
  probabilities.replaceChildren();

  for (const item of response.labels) {
    const row = document.createElement("div");
    row.className = "probability-row";

    const heading = document.createElement("div");
    heading.className = "probability-heading";
    const label = document.createElement("span");
    label.textContent = item.label;
    const value = document.createElement("span");
    value.className = "probability-value";
    value.textContent = `${Math.round(item.probability * 100)}%`;
    heading.append(label, value);

    const track = document.createElement("div");
    track.className = "meter-track";
    const meter = document.createElement("div");
    meter.className = "meter-fill";
    meter.style.width = `${Math.max(0, Math.min(100, item.probability * 100))}%`;
    track.append(meter);

    const detail = document.createElement("small");
    detail.textContent = `value: ${formatValue(item.value)}`;
    row.append(heading, track, detail);
    probabilities.append(row);
  }
}

async function classify(): Promise<void> {
  if (!form || !submit || !submitLabel) return;
  const data = new FormData(form);
  const questionType = String(data.get("question_type")) as QuestionType;
  const choices = String(data.get("choices") ?? "")
    .split("\n")
    .map((choice) => choice.trim())
    .filter(Boolean);

  clearResults();
  submit.disabled = true;
  submit.dataset.state = "loading";
  submit.setAttribute("aria-busy", "true");
  submitSpinner?.removeAttribute("hidden");
  submitLabel.textContent = "Evaluating…";
  setStatus("Evaluating in the browser…", "loading");

  // Let the browser paint the loading state before client-side inference can block the tab.
  await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

  try {
    const runtime = await loadClientRuntime();
    const startedAt = performance.now();
    const prediction = await runtime.predict(
      String(data.get("prompt") ?? ""),
      makeClientQuestions(questionType, String(data.get("question") ?? ""), choices),
      { maxLen: CLIENT_MAX_TOKENS },
    );
    const elapsedMs = Math.round(performance.now() - startedAt);
    const answer = prediction.answers.classification;
    if (!answer) throw new Error("The client model returned no classification.");
    showResults(clientResponse(questionType, choices, answer));
    setStatus(
      `Evaluation complete in the browser (${elapsedMs} ms warm inference).`,
      "ready",
    );
  } catch (error) {
    setStatus(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    submit.disabled = false;
    delete submit.dataset.state;
    submit.setAttribute("aria-busy", "false");
    submitSpinner?.setAttribute("hidden", "");
    submitLabel.textContent = "Evaluate prompt";
  }
}

setStatus("Loading the client model…", "loading");
void loadClientRuntime()
  .then(() => {
    setClientLoading(false);
    setStatus("Client model ready. Requests stay in this browser.", "ready");
  })
  .catch((error: unknown) => {
    setClientLoading(false);
    setStatus(`Client model failed to load: ${error instanceof Error ? error.message : String(error)}.`, "error");
  });

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void classify();
});
