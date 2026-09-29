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
        <span class="runtime-pill"><span class="pulse"></span> Laya runtime</span>
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

      <div class="form-actions">
        <p class="form-note">Runs locally through the configured Laya model.</p>
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
  setStatus("Sending prompt to the Laya runtime…", "loading");

  try {
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
    const body = (await response.json()) as ClassificationResponse | ClassificationError;
    if (!response.ok) {
      throw new Error((body as ClassificationError).detail ?? `HTTP ${response.status}`);
    }
    showResults(body as ClassificationResponse);
    setStatus("Evaluation complete.", "ready");
  } catch (error) {
    setStatus(`Evaluation failed: ${error instanceof Error ? error.message : String(error)}`, "error");
  } finally {
    submit.disabled = false;
    submitLabel.textContent = "Evaluate prompt";
  }
}

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  void classify();
});
