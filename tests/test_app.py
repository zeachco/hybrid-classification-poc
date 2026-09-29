from pathlib import Path

import httpx
import pytest

from py_decision.classification import (
    ClassificationLabel,
    ClassificationResponse,
)
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
async def test_classification_endpoint_uses_runtime(tmp_path: Path) -> None:
    class FakeRuntime:
        def evaluate(self, request):
            assert request.question == "Which team?"
            assert request.choices == ["Billing", "Support"]
            return ClassificationResponse(
                question_type="choice",
                classification="Billing",
                confidence=0.91,
                labels=[
                    ClassificationLabel(
                        label="Billing", value="Billing", probability=0.91
                    ),
                    ClassificationLabel(
                        label="Support", value="Support", probability=0.09
                    ),
                ],
            )

    app = create_app(
        public_dir=tmp_path,
        runtime_factory=lambda _settings: FakeRuntime(),
    )
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/classify",
            json={
                "question": "Which team?",
                "question_type": "choice",
                "choices": ["Billing", "Support"],
                "prompt": "I need a refund.",
            },
        )

    assert response.status_code == 200
    assert response.json()["classification"] == "Billing"
    assert response.json()["labels"][0]["probability"] == 0.91


@pytest.mark.asyncio
async def test_classification_requires_choices_for_choice_questions(
    tmp_path: Path,
) -> None:
    app = create_app(public_dir=tmp_path, runtime_factory=lambda _settings: None)
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app),
        base_url="http://test",
    ) as client:
        response = await client.post(
            "/api/classify",
            json={
                "question": "Which team?",
                "question_type": "choice",
                "choices": ["Billing"],
                "prompt": "I need a refund.",
            },
        )

    assert response.status_code == 422


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
