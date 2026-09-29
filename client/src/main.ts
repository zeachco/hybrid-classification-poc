import "./styles.css";

type HealthResponse = {
  status: "ok";
  service: string;
  environment: string;
};

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("The application root is missing.");
}

app.innerHTML = `
  <section class="shell">
    <p class="eyebrow">Python + TypeScript</p>
    <h1>py-decision</h1>
    <p class="lede">A typed FastAPI server with a Bun/Vite client.</p>
    <div class="status" data-status>Checking server status…</div>
  </section>
`;

const status = app.querySelector<HTMLDivElement>("[data-status]");

async function loadHealth(): Promise<void> {
  if (!status) return;

  try {
    const response = await fetch("/api/health");
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const health = (await response.json()) as HealthResponse;
    status.textContent = `${health.service} is ${health.status} (${health.environment})`;
    status.dataset.state = "ready";
  } catch (error) {
    status.textContent = `Server unavailable: ${String(error)}`;
    status.dataset.state = "error";
  }
}

void loadHealth();
