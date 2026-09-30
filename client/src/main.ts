import "./styles.css";

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

type ClassificationError = {
  detail?: string;
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

type ClientRuntime = {
  predict(
    state: string,
    questions: Record<string, {
      type: QuestionType;
      instructions: string;
      criteria?: Record<string, string | null> | string[];
      threshold?: number;
    }>,
  ): Promise<ClientPrediction>;
};

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
    <header class="hero">
      <p class="eyebrow">Laya / System 1</p>
      <h1>Classify anything.</h1>
      <p class="lede">
        Describe a decision, give Laya the possible outcomes, and see the model's calibrated
        probabilities in one pass.
      </p>
    </header>

    <form class="classifier" data-form>
      <div class="form-heading">
        <div>
          <p class="section-kicker">01 / Decision</p>
          <h2>Define the question</h2>
        </div>
        <div class="runtime-controls">
          <label class="runtime-switch" data-runtime-switch title="Client inference needs about 1 GB of RAM and may crash your browser.">
            <span>Server model</span>
            <input type="checkbox" data-client-model aria-describedby="client-model-warning" />
            <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
            <span>Client model</span>
          </label>
          <p class="runtime-warning" id="client-model-warning" data-client-model-warning role="note">
            Client inference loads the WASM model into your browser. Your browser will need about 1 GB of RAM and might crash.
          </p>
        </div>
      </div>

      <label class="field field-wide">
        <span>Question</span>
        <input name="question" required maxlength="500" value="Which team should handle this request?" />
        <small>Ask one clear question that can be answered from the prompt.</small>
      </label>

      <label class="field">
        <span>Question type</span>
        <select name="question_type" data-question-type>
          <option value="choice">Choice</option>
          <option value="score">Score</option>
          <option value="noul">Yes / no</option>
        </select>
      </label>

      <label class="field choices-field" data-choices-field>
        <span data-choices-label>Choices</span>
        <textarea name="choices" rows="4" data-choices required>Billing
Technical support
Sales
Other</textarea>
        <small data-choices-help>One possible answer per line.</small>
      </label>

      <label class="field field-wide prompt-field">
        <span>Prompt to evaluate</span>
        <textarea name="prompt" rows="6" required maxlength="8000" placeholder="Paste the text Laya should classify…">I was charged twice for my subscription and need a refund.</textarea>
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
        <p class="form-note" data-form-note>Requests use the server model by default.</p>
        <button type="submit" data-submit>
          <span data-submit-label>Evaluate prompt</span>
          <span class="button-arrow">→</span>
        </button>
      </div>
    </form>

    <section class="results" data-results hidden>
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
const typeSelect = app.querySelector<HTMLSelectElement>("[data-question-type]");
const choicesField = app.querySelector<HTMLElement>("[data-choices-field]");
const choicesInput = app.querySelector<HTMLTextAreaElement>("[data-choices]");
const submit = app.querySelector<HTMLButtonElement>("[data-submit]");
const submitLabel = app.querySelector<HTMLElement>("[data-submit-label]");
const status = app.querySelector<HTMLElement>("[data-status]");
const clientModelToggle = app.querySelector<HTMLInputElement>("[data-client-model]");
const runtimeSwitch = app.querySelector<HTMLElement>("[data-runtime-switch]");
const clientLoading = app.querySelector<HTMLElement>("[data-client-loading]");
const clientLoadingLabel = app.querySelector<HTMLElement>("[data-client-loading-label]");
const clientLoadingDetail = app.querySelector<HTMLElement>("[data-client-loading-detail]");
const formNote = app.querySelector<HTMLElement>("[data-form-note]");
const results = app.querySelector<HTMLElement>("[data-results]");
const classification = app.querySelector<HTMLElement>("[data-classification]");
const confidence = app.querySelector<HTMLElement>("[data-confidence]");
const probabilities = app.querySelector<HTMLElement>("[data-probabilities]");

function updateQuestionType(): void {
  const isYesNo = typeSelect?.value === "noul";
  if (!choicesField || !choicesInput) return;
  choicesField.hidden = isYesNo;
  choicesInput.required = !isYesNo;
}

typeSelect?.addEventListener("change", updateQuestionType);
updateQuestionType();

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
let clientMode = false;

function setClientLoading(loading: boolean, label = "Loading the client model…", detail = "Downloading the WASM engine and model into this browser."): void {
  clientLoading?.toggleAttribute("hidden", !loading);
  if (clientLoadingLabel) clientLoadingLabel.textContent = label;
  if (clientLoadingDetail) clientLoadingDetail.textContent = detail;
  if (runtimeSwitch) runtimeSwitch.dataset.state = loading ? "loading" : clientMode ? "client" : "server";
  if (formNote) {
    formNote.textContent = loading
      ? "The client model must finish loading before it can evaluate prompts."
      : clientMode
        ? "Requests run in this browser through Laya WASM."
        : "Requests use the server model by default.";
  }
}

async function loadClientRuntime(): Promise<ClientRuntime> {
  if (clientRuntime) return clientRuntime;
  if (!clientRuntimePromise) {
    clientRuntimePromise = (async () => {
      setClientLoading(true, "Loading the client model…", "Starting the Laya WASM runtime.");
      const { Laya } = await import("laya-system-one");
      setClientLoading(true, "Loading the client model…", "Fetching the tokenizer, model, and WASM engine.");
      const runtime = await Laya.load({
        backend: "wasm",
        modelDir: CLIENT_MODEL_DIR,
        ...(CLIENT_WASM_BASE ? { wasmBase: CLIENT_WASM_BASE } : {}),
      });
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

  submit.disabled = true;
  submitLabel.textContent = "Evaluating…";
  setStatus(clientMode ? "Evaluating in the browser…" : "Sending prompt to the server model…", "loading");

  try {
    let body: ClassificationResponse;
    if (clientMode) {
      const runtime = await loadClientRuntime();
      const prediction = await runtime.predict(
        String(data.get("prompt") ?? ""),
        makeClientQuestions(questionType, String(data.get("question") ?? ""), choices),
      );
      const answer = prediction.answers.classification;
      if (!answer) throw new Error("The client model returned no classification.");
      body = clientResponse(questionType, choices, answer);
    } else {
      const response = await fetch("/api/classify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: data.get("question"),
          question_type: questionType,
          choices: questionType === "noul" ? [] : choices,
          prompt: data.get("prompt"),
        }),
      });
      const responseBody = (await response.json()) as ClassificationResponse | ClassificationError;
      if (!response.ok) {
        throw new Error((responseBody as ClassificationError).detail ?? `HTTP ${response.status}`);
      }
      body = responseBody as ClassificationResponse;
    }
    showResults(body);
    setStatus(clientMode ? "Evaluation complete in the browser." : "Evaluation complete.", "ready");
  } catch (error) {
    setStatus(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    submit.disabled = false;
    submitLabel.textContent = "Evaluate prompt";
  }
}

clientModelToggle?.addEventListener("change", () => {
  const enabled = clientModelToggle.checked;
  if (!enabled) {
    clientMode = false;
    setClientLoading(false);
    setStatus("Using the server model.", "ready");
    return;
  }

  clientMode = true;
  clientModelToggle.disabled = true;
  setStatus("Loading the client model…", "loading");
  void loadClientRuntime()
    .then(() => {
      setClientLoading(false);
      setStatus("Client model ready. Requests stay in this browser.", "ready");
    })
    .catch((error: unknown) => {
      clientMode = false;
      clientModelToggle.checked = false;
      setClientLoading(false);
      setStatus(`Client model failed to load: ${error instanceof Error ? error.message : String(error)}`, "error");
    })
    .finally(() => {
      clientModelToggle.disabled = false;
    });
});

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void classify();
});
