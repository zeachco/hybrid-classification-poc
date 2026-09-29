from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .config import Settings, settings

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_ROOT / "public"


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    environment: str


def create_app(
    app_settings: Settings = settings,
    public_dir: Path = PUBLIC_DIR,
) -> FastAPI:
    """Create the API and static-file application."""

    app = FastAPI(title=app_settings.app_name)
    bundle_index = public_dir / "bundle" / "index.html"

    @app.get("/api/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service=app_settings.app_name,
            environment=app_settings.environment,
        )

    @app.get("/", include_in_schema=False)
    async def index() -> FileResponse:
        if not bundle_index.is_file():
            raise HTTPException(
                status_code=503,
                detail="The client bundle has not been built. Run `bun run build`.",
            )
        return FileResponse(bundle_index)

    if public_dir.is_dir():
        app.mount(
            "/",
            StaticFiles(directory=public_dir, html=True),
            name="public",
        )

    return app


app = create_app()
