# Build the Vite client in its own stage so Railway does not need to infer a
# Python/Bun monorepo build from the repository layout, and so the client is not
# rebuilt by server-only edits.
#
# The client bundles Laya's English checkpoint from the
# `@sys-one/laya-model-chunk-*` packages installed with the client dependencies.
# The server no longer evaluates the model, so the runtime image does not need
# the Hugging Face checkpoint at all: the previous `model-fetch` stage (and the
# ~843 MB it downloaded) is gone.

FROM oven/bun:1.4.2 AS client-build

WORKDIR /app
COPY client/package.json client/bun.lock ./client/
RUN bun install --cwd client --frozen-lockfile --ignore-scripts
COPY client ./client
COPY public ./public
RUN bun run --cwd client build

# uv provides the pinned Python dependency installer and Python runtime.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Dependencies first, without the project, so editing `src/` does not rebuild
# the dependency layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Independent layers from here on: the app code and the client bundle have
# their own cache keys, so a site edit only invalidates the public/ layers.
COPY src ./src
RUN uv sync --frozen --no-dev

COPY public ./public
COPY --from=client-build /app/public/bundle ./public/bundle

EXPOSE 8000
CMD ["sh", "-c", "exec uv run uvicorn py_decision.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
