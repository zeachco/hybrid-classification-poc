# Build the Vite client and the Laya checkpoint in their own stages so
# Railway does not need to infer a Python/Bun monorepo build from the
# repository layout, and so neither artifact is rebuilt by unrelated edits.
#
# Each stage has an independent cache key:
#   client-build  <- client/ + public/ + package.json
#   model-fetch   <- its base image + scripts/download_laya_model.py + LAYA_MODEL_REVISION
# The runtime stage then pulls them in with `COPY --from=...`. Those layers are
# content-addressed, so when the inputs do not change the registry dedupes them
# instead of re-uploading the ~850 MB model blob on every push. Previously the
# download ran near the end of the runtime stage, so any `src/` edit re-ran
# `uv sync`, changed the parent layer, and pulled the checkpoint from Hugging
# Face again.
ARG LAYA_MODEL_REVISION=55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851

FROM oven/bun:1.4.2 AS client-build

WORKDIR /app
COPY client/package.json client/bun.lock ./client/
RUN bun install --cwd client --frozen-lockfile --ignore-scripts
COPY client ./client
COPY public ./public
RUN bun run --cwd client build

# Fetch the English checkpoint once per LAYA_MODEL_REVISION. Reuses the same uv
# base image as the runtime stage (no extra base pull) and installs only the one
# build-time dependency. Timestamps are normalised afterwards, otherwise the
# freshly downloaded files would give the layer a new digest on every rebuild
# and re-push ~850 MB even when the bytes are identical.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim AS model-fetch
ARG LAYA_MODEL_REVISION
ENV UV_LINK_MODE=copy
RUN uv pip install --system --no-cache "huggingface-hub>=0.34,<1.0"
COPY scripts/download_laya_model.py /tmp/download_laya_model.py
RUN HF_HOME=/tmp/huggingface python /tmp/download_laya_model.py \
        --output /models/laya --revision "${LAYA_MODEL_REVISION}" \
    && rm -rf /tmp/huggingface \
    && find /models -exec touch -h -d @0 {} +

# uv provides the pinned Python dependency installer and Python runtime.
FROM ghcr.io/astral-sh/uv:python3.14-bookworm-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy

# Dependencies first, without the project, so editing `src/` does not rebuild
# the multi-gigabyte PyTorch dependency layer.
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project

# Independent layers from here on: the model (and the app code) have their own
# cache keys, so a site edit only invalidates the public/ and bundle layers.
COPY --from=model-fetch /models/laya ./models/laya
COPY src ./src
RUN uv sync --frozen --no-dev

COPY public ./public
COPY --from=client-build /app/public/bundle ./public/bundle

ENV PY_DECISION_LAYA_MODEL_DIR=/app/models/laya

EXPOSE 8000
CMD ["sh", "-c", "exec uv run uvicorn py_decision.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
