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
the Python server on port 8000. To run them separately, use `mise run server`
and `mise run client`.

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
