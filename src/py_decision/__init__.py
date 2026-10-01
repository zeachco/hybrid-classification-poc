import os
import socket

_DEFAULT_PORT = 8000


def find_available_port(host: str = "127.0.0.1", start: int = _DEFAULT_PORT) -> int:
    """Return the first available TCP port at or above ``start``."""

    for port in range(start, 65536):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
            try:
                sock.bind((host, port))
            except OSError:
                continue
            return port
    raise RuntimeError("No available TCP port found")


def main() -> None:
    """Run the development server, selecting a free port when necessary."""

    import uvicorn

    configured_port = os.environ.get("PY_DECISION_PORT")
    port = int(configured_port) if configured_port else find_available_port()
    uvicorn.run("py_decision.main:app", host="127.0.0.1", port=port, reload=True)
