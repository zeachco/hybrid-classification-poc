def main() -> None:
    """Run the development server from the installed project script."""

    import uvicorn

    uvicorn.run("py_decision.main:app", host="127.0.0.1", port=8000, reload=True)
