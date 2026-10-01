# py-decision

A typed Python server with a Bun/Vite TypeScript client.

## Prerequisites

The project pins its toolchain in [`mise.toml`](./mise.toml):

- Python 3.14.7
- uv 0.12.19
- Bun 1.4.2

Install and activate the tools with [mise](https://mise.jdx.dev/):

```sh
mise install
```

## Development

Install Python dependencies and build the client:

```sh
uv sync
bun install --cwd client
bun run --cwd client build
```

Run both the Python server and Vite client in watch mode with the mise task:

```sh
mise run dev
# alias:
mise run start
```

The Vite client is available at <http://127.0.0.1:5173/> and proxies `/api` to
the Python server. Both development servers automatically choose the next
available port when their default port is already in use. To run them together,
use `mise run dev` (or `mise run start`). To run them separately, use
`mise run server`, then start the client with
`PY_DECISION_PORT=<server-port> mise run client`.

## Railway deployment

Railway uses the checked-in [`Dockerfile`](./Dockerfile) instead of Railpack. The
multi-stage image builds the Bun/Vite client and runs the Python API with
Railway's `$PORT`.

Set these Railway variables:

```text
PY_DECISION_ENVIRONMENT=production
PY_DECISION_LAYA_MODEL=english
PY_DECISION_LAYA_DEVICE=cpu
HF_HOME=/data/huggingface
HF_HUB_CACHE=/data/huggingface/hub
LAYA_REVISION=reviewed
```

Attach a Railway volume mounted at `/data`. Laya downloads the public
`convaiinnovations/laya` checkpoint from Hugging Face on the first classification
request and keeps it in that volume across restarts. No `HF_TOKEN` is needed for
the public checkpoint. Give the service at least 4 GB RAM initially; PyTorch
runtime memory is larger than the checkpoint file.

The health check is `/api/health`. The first `/api/classify` request after a
fresh volume may take time while the checkpoint is downloaded and initialized.

## Checks

```sh
uv run ruff check .
uv run ruff format --check .
uv run mypy src
uv run pytest
bun run --cwd client check
```

The production client output is written to `public/bundle/`, which is served by
the Python application and ignored by Git. Hand-authored files elsewhere under
`public/` remain tracked.

The client defaults to the server model. The **Client model** toggle is opt-in:
it loads Laya's WASM engine in the browser, and subsequent evaluations stay in the
browser instead of calling `/api/classify`. The normal client build bundles
Laya's model, tokenizer, config, WASM glue, and binary automatically. To serve a
model from another location, set `VITE_LAYA_MODEL_DIR` (see
[`client/.env.example`](./client/.env.example)). Client inference needs about 1
GB of RAM and may crash the browser.

## Classification API

The app exposes `POST /api/classify` with a question, question type (`choice`,
`score`, or `noul`), optional choices, and a prompt:

```json
{
  "question": "Which team should handle this?",
  "question_type": "choice",
  "choices": ["Billing", "Support", "Other"],
  "prompt": "I was charged twice and need a refund."
}
```

The response includes the selected `classification`, overall `confidence`, and
sorted `labels` with their values and probabilities. Laya is imported lazily and
the configured checkpoint is downloaded on the first classification request.
