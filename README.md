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
```

No additional volumes or storage are required. The public English checkpoint
requires no `HF_TOKEN`. The build fetches it in its own `model-fetch` stage and
the runtime image copies it to `/app/models/laya`, so a client or `src/` change
never re-downloads the ~843 MB checkpoint or re-pushes its layer. Timestamps are
normalised in that stage so the layer stays byte-identical across rebuilds and
the registry can deduplicate it. To use a different checkpoint, update the
`LAYA_MODEL_REVISION` build ARG in the Dockerfile and rebuild the image. Give the
service at least 4 GB of RAM because PyTorch runtime memory is larger than the
checkpoint file.

The server model is currently disabled, so `/app/models/laya` is only used by
`POST /api/classify` if it is re-enabled; the browser gets its own copy from the
client bundle (`public/bundle/models/laya/`). If the server path stays off, the
`model-fetch` stage and its `COPY` can be deleted to drop ~843 MB from the image.
To avoid the build-time Hugging Face download entirely, build that stage once and
publish it, then reference the published image as the `model-fetch` base:

```sh
docker build --target model-fetch \
  -t ghcr.io/zeachco/py-decision-model:55cf4c4 .
docker push ghcr.io/zeachco/py-decision-model:55cf4c4
```

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

The client currently runs in **Client model only** mode. The server model option is
disabled for now — I won't pay for this publicly. Laya's WASM engine runs in a
shared browser worker, and evaluations stay in the browser instead of calling
`/api/classify`. The shared worker keeps the loaded model outside the page, so
additional tabs reuse the same runtime while it remains alive, and the model,
tokenizer, config and WASM engine are persisted in the browser's Cache Storage
(a versioned cache managed in
[`client/src/laya-model-cache.ts`](./client/src/laya-model-cache.ts)). A reload
or a worker eviction therefore rehydrates from disk instead of re-downloading
~340 MB; the cache key is bumped when the model revision changes. The demo warms
the runtime once and caps interactive prompts at 1,024 tokens to keep mid-range
hardware responsive. The normal client build bundles Laya's model, tokenizer,
config, WASM glue, and binary automatically. To serve a model from another
location, set `VITE_LAYA_MODEL_DIR` (see
[`client/.env.example`](./client/.env.example)). Client inference needs about 1
GB of RAM and may crash the browser.

Bundle assets are served with an explicit `Cache-Control: public, max-age=86400`
so browsers without Web Worker support (or before the Cache Storage copy is
written) still avoid a cold re-download; `index.html` is served `no-cache` so a
deploy is picked up immediately.

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
the configured checkpoint is loaded on the first classification request.
