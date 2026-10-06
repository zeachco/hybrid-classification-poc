import asyncio
from collections.abc import Awaitable, Callable
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .classification import (
    ClassificationRequest,
    ClassificationResponse,
    ClassificationRuntime,
    LayaRuntime,
)
from .config import Settings, settings

PROJECT_ROOT = Path(__file__).resolve().parents[2]
PUBLIC_DIR = PROJECT_ROOT / "public"

# The bundle's fixed-path assets (the ~324 MB model, tokenizer, config and wasm
# engine) carry no content hash, so without an explicit directive the browser
# only heuristically caches them and tends to re-fetch. Hashed Vite assets are
# unaffected by this and keep their own long-lived caching. HTML stays
# revalidating so a new deploy is picked up immediately.
BUNDLE_ASSET_CACHE_CONTROL = "public, max-age=86400"
BUNDLE_HTML_CACHE_CONTROL = "no-cache"


class HealthResponse(BaseModel):
    status: Literal["ok"]
    service: str
    environment: str


def create_app(
    app_settings: Settings = settings,
    public_dir: Path = PUBLIC_DIR,
    runtime_factory: Callable[[Settings], ClassificationRuntime] = LayaRuntime,
) -> FastAPI:
    """Create the API and static-file application."""

    app = FastAPI(title=app_settings.app_name)
    bundle_index = public_dir / "bundle" / "index.html"
    runtime = runtime_factory(app_settings)

    @app.middleware("http")
    async def cache_bundle_assets(
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        response = await call_next(request)
        path = request.url.path
        if (
            request.method == "GET"
            and path.startswith("/bundle/")
            and response.status_code == 200
        ):
            response.headers["Cache-Control"] = (
                BUNDLE_HTML_CACHE_CONTROL
                if path.endswith(".html")
                else BUNDLE_ASSET_CACHE_CONTROL
            )
        return response

    @app.get("/api/health", response_model=HealthResponse, tags=["system"])
    async def health() -> HealthResponse:
        return HealthResponse(
            status="ok",
            service=app_settings.app_name,
            environment=app_settings.environment,
        )

    @app.post(
        "/api/classify",
        response_model=ClassificationResponse,
        tags=["classification"],
    )
    async def classify(request: ClassificationRequest) -> ClassificationResponse:
        try:
            return await asyncio.to_thread(runtime.evaluate, request)
        except ImportError as error:
            raise HTTPException(
                status_code=503,
                detail=(
                    "The Laya runtime is not installed. Install the project "
                    "dependencies."
                ),
            ) from error
        except Exception as error:
            raise HTTPException(
                status_code=502,
                detail=f"Laya evaluation failed: {error}",
            ) from error

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
