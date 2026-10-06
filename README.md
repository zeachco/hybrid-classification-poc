# py-decision

A typed Python service that serves a Bun/Vite TypeScript client. The client
evaluates the Laya decision model entirely in the browser; the server only
serves the bundle, the service assets, and a health probe.

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

The Vite client is available at <http://127.0.0.1:5173/>. Both development
servers automatically choose the next available port when their default port is
already in use. To run them together, use `mise run dev` (or `mise run start`).
To run them separately, use `mise run server`, then start the client with
`PY_DECISION_PORT=<server-port> mise run client`.

## Railway deployment

Railway uses the checked-in [`Dockerfile`](./Dockerfile) instead of Railpack. The
multi-stage image builds the Bun/Vite client and runs the Python service with
Railway's `$PORT`.

Set these Railway variables:

```text
PY_DECISION_ENVIRONMENT=production
```

No volumes or model downloads are required. The client bundles Laya's English
checkpoint from the `@sys-one/laya-model-chunk-*` packages installed with the
client dependencies, and the server never evaluates the model, so the image stays
small. Give the service enough memory for the Python/uvicorn runtime; the model
itself runs in the visitor's browser.

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

## Client inference

The client runs in **Client model only** mode: Laya's WASM engine runs in a
shared browser worker, and evaluations stay in the browser. The shared worker
keeps the loaded model outside the page, so additional tabs reuse the same
runtime while it remains alive, and the model, tokenizer, config and WASM engine
are persisted in the browser's Cache Storage (a versioned cache managed in
[`client/src/laya-model-cache.ts`](./client/src/laya-model-cache.ts)). A reload
or a worker eviction therefore rehydrates from disk instead of re-downloading
~340 MB; the cache key is bumped when the model revision changes. The demo warms
the runtime once and caps interactive prompts at 1,024 tokens to keep mid-range
hardware responsive.

The shared worker is keyed by its Vite content hash instead of a fixed name, so a
new deploy starts a fresh worker rather than reusing the previous release's code.
The normal client build bundles Laya's model, tokenizer, config, WASM glue, and
binary automatically. To serve a model from another location, set
`VITE_LAYA_MODEL_DIR` (see [`client/.env.example`](./client/.env.example)).
Client inference needs about 1 GB of RAM and may crash the browser.

Bundle assets are served with an explicit `Cache-Control: public, max-age=86400`
so browsers without Web Worker support (or before the Cache Storage copy is
written) still avoid a cold re-download; `index.html` is served `no-cache` so a
deploy is picked up immediately.

## Browser extension

[`extension/`](./extension) is a Manifest V3 companion that reuses the same
client-side Laya runtime to flag unsafe terminal commands on any page: it detects
command-like elements on hover, in the current selection, and on copy, and shows
a floating tooltip with per-category risk (secret leak, reverse shell,
destructive, privilege escalation, download-and-execute, data exfiltration,
obfuscation, persistence, OS applicability). Inference runs in an offscreen
document, so nothing leaves the browser. See
[`extension/README.md`](./extension/README.md) and the design in
[`extension/PLAN.md`](./extension/PLAN.md).
