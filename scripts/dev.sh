#!/usr/bin/env bash
set -euo pipefail

port="${PY_DECISION_PORT:-$(uv run python -c 'from py_decision import find_available_port; print(find_available_port())')}"
export PY_DECISION_PORT="$port"

echo "Starting API on http://127.0.0.1:${PY_DECISION_PORT}"

uv run uvicorn py_decision.main:app --host 127.0.0.1 --port "$PY_DECISION_PORT" --reload &
server_pid=$!

(
  cd client
  bun run dev
) &
client_pid=$!

cleanup() {
  trap - EXIT INT TERM
  kill "$server_pid" "$client_pid" 2>/dev/null || true
  wait "$server_pid" "$client_pid" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

wait -n "$server_pid" "$client_pid"
