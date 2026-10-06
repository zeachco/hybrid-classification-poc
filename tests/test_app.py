from pathlib import Path

import httpx
import pytest

from py_decision.config import Settings
from py_decision.main import create_app


@pytest.mark.asyncio
async def test_health_endpoint() -> None:
    app = create_app(Settings(app_name="test-service", environment="test"))

    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/api/health")

    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "service": "test-service",
        "environment": "test",
    }


@pytest.mark.asyncio
async def test_static_bundle_is_served(tmp_path: Path) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "index.html").write_text("<h1>hello</h1>", encoding="utf-8")
    (bundle / "app.js").write_text("console.log('hello')", encoding="utf-8")

    app = create_app(public_dir=tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        index = await client.get("/")
        asset = await client.get("/bundle/app.js")

    assert index.text == "<h1>hello</h1>"
    assert asset.text == "console.log('hello')"


@pytest.mark.asyncio
async def test_missing_bundle_returns_503(tmp_path: Path) -> None:
    app = create_app(public_dir=tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.get("/")

    assert response.status_code == 503


@pytest.mark.asyncio
async def test_bundle_assets_are_cacheable_while_html_revalidates(
    tmp_path: Path,
) -> None:
    bundle = tmp_path / "bundle"
    bundle.mkdir()
    (bundle / "index.html").write_text("<h1>hello</h1>", encoding="utf-8")
    (bundle / "model.onnx").write_bytes(b"weights")

    app = create_app(public_dir=tmp_path)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        asset = await client.get("/bundle/model.onnx")
        index = await client.get("/bundle/index.html")

    assert asset.headers["cache-control"] == "public, max-age=86400"
    assert index.headers["cache-control"] == "no-cache"
