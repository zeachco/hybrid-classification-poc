# Build the Vite client separately so Railway does not need to infer a
# Python/Bun monorepo build from the repository layout.
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

COPY pyproject.toml uv.lock ./
COPY src ./src
RUN uv sync --frozen --no-dev

COPY public ./public
COPY --from=client-build /app/public/bundle ./public/bundle

EXPOSE 8000
CMD ["sh", "-c", "exec uv run uvicorn py_decision.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
