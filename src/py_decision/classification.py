from __future__ import annotations

import threading
from typing import Any, Literal, Protocol

from pydantic import BaseModel, Field, model_validator

from .config import Settings

QuestionType = Literal["choice", "score", "noul"]


class ClassificationRequest(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    question_type: QuestionType = "choice"
    choices: list[str] = Field(default_factory=list, max_length=32)
    prompt: str = Field(min_length=1, max_length=8_000)

    @model_validator(mode="after")
    def validate_question(self) -> ClassificationRequest:
        self.question = self.question.strip()
        self.prompt = self.prompt.strip()
        self.choices = [choice.strip() for choice in self.choices]

        if not self.question or not self.prompt:
            raise ValueError("question and prompt cannot be blank")
        if self.question_type in ("choice", "score"):
            if len(self.choices) < 2:
                raise ValueError("choice and score questions need at least two choices")
            if any(not choice for choice in self.choices):
                raise ValueError("choices cannot be blank")
            if len(set(self.choices)) != len(self.choices):
                raise ValueError("choices must be unique")
        elif self.choices:
            raise ValueError("yes/no questions do not accept choices")
        return self


class ClassificationLabel(BaseModel):
    label: str
    value: str | bool | float | int
    probability: float = Field(ge=0, le=1)


class ClassificationResponse(BaseModel):
    question_type: QuestionType
    classification: str | bool | float | int
    confidence: float = Field(ge=0, le=1)
    labels: list[ClassificationLabel]


class ClassificationRuntime(Protocol):
    def evaluate(self, request: ClassificationRequest) -> ClassificationResponse: ...


class LayaRuntime:
    """Small adapter around Laya's typed decision runtime.

    The import and checkpoint load are intentionally lazy: the web server can expose
    health and the UI without loading a model, while the first classification pays
    the one-time load cost.
    """

    def __init__(self, app_settings: Settings) -> None:
        self._settings = app_settings
        self._router: Any = None
        self._load_lock = threading.Lock()
        self._predict_lock = threading.Lock()

    def _get_router(self) -> Any:
        if self._router is None:
            with self._load_lock:
                if self._router is None:
                    import laya  # type: ignore[import-untyped]

                    if self._settings.laya_model_dir:
                        self._router = laya.Router(
                            models={"english": self._settings.laya_model_dir},
                            device=self._settings.laya_device,
                            default=self._settings.laya_model,
                        )
                    else:
                        self._router = laya.Router(
                            device=self._settings.laya_device,
                            default=self._settings.laya_model,
                        )
        return self._router

    @staticmethod
    def _questions(request: ClassificationRequest) -> dict[str, dict[str, Any]]:
        if request.question_type == "choice":
            criteria = {choice: None for choice in request.choices}
            return {
                "classification": {
                    "type": "choice",
                    "instructions": request.question,
                    "criteria": criteria,
                }
            }
        if request.question_type == "score":
            return {
                "classification": {
                    "type": "score",
                    "instructions": request.question,
                    "criteria": request.choices,
                }
            }
        return {
            "classification": {
                "type": "noul",
                "instructions": request.question,
                "criteria": {
                    "true": "the prompt satisfies the question",
                    "false": "the prompt does not satisfy the question",
                },
            }
        }

    @staticmethod
    def _labels(
        request: ClassificationRequest, answer: dict[str, Any]
    ) -> tuple[str | bool | float | int, list[ClassificationLabel]]:
        probabilities = answer.get("probabilities", {})
        classification: str | bool | float | int
        if request.question_type == "choice":
            labels = [
                ClassificationLabel(
                    label=choice,
                    value=choice,
                    probability=float(probabilities.get(choice, 0)),
                )
                for choice in request.choices
            ]
            classification = str(answer["choice"])
        elif request.question_type == "score":
            labels = [
                ClassificationLabel(
                    label=choice,
                    value=choice,
                    probability=float(probabilities.get(str(index), 0)),
                )
                for index, choice in enumerate(request.choices)
            ]
            classification = str(
                request.choices[
                    max(range(len(labels)), key=lambda i: labels[i].probability)
                ]
            )
        else:
            yes_probability = float(answer["noul"])
            labels = [
                ClassificationLabel(
                    label="Yes", value=True, probability=yes_probability
                ),
                ClassificationLabel(
                    label="No", value=False, probability=1 - yes_probability
                ),
            ]
            classification = yes_probability >= 0.5
        labels.sort(key=lambda item: item.probability, reverse=True)
        return classification, labels

    def evaluate(self, request: ClassificationRequest) -> ClassificationResponse:
        router = self._get_router()
        # Router/model inference is synchronous. Keep it off FastAPI's event loop and
        # serialize calls because a lazily loaded checkpoint is not guaranteed to be
        # re-entrant.
        with self._predict_lock:
            result = router.predict(request.prompt, self._questions(request))
        answer = result["answers"]["classification"]
        classification, labels = self._labels(request, answer)
        return ClassificationResponse(
            question_type=request.question_type,
            classification=classification,
            confidence=float(
                answer.get("answer_confidence", answer.get("confidence", 0))
            ),
            labels=labels,
        )
