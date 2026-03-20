from pydantic_settings import BaseSettings


class Settings(BaseSettings):

    # =========================
    # DATABASE
    # =========================
    DATABASE_URL: str

    # =========================
    # OPENAI
    # =========================
    OPENAI_API_KEY: str
    OPENAI_EMBED_MODEL: str = "text-embedding-3-small"
    OPENAI_CHAT_MODEL: str = "gpt-4o-mini"

    # =========================
    # QDRANT
    # =========================
    QDRANT_URL: str = "http://localhost:6333"
    QDRANT_COLLECTION: str = "cv_chunks"

    # =========================
    # JWT
    # =========================
    JWT_SECRET_KEY: str
    JWT_ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # =========================
    # DEFAULT LIMITS (fallback)
    # =========================
    FREE_DAILY_REQUESTS: int = 20
    FREE_DAILY_TOKENS: int = 20000

    # =========================
    # FRONTEND & SERVICES
    # =========================
    FRONTEND_URL: str = "http://localhost:3000"
    REDIS_URL: str = "redis://localhost:6379/0"

    # =========================
    # OBSERVABILITY
    # =========================
    SENTRY_DSN: str | None = None

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()