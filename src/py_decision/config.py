from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables or `.env`."""

    model_config = SettingsConfigDict(
        env_prefix="PY_DECISION_",
        env_file=".env",
        extra="ignore",
    )

    app_name: str = "py-decision"
    environment: str = "development"


settings = Settings()
