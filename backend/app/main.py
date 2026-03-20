from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routes import auth, cv, interview, billing
from app.middlewares.rate_limit import RateLimitMiddleware
from app.middlewares.request_logger import RequestLoggerMiddleware
from app.core.logging import setup_logging
from app.middlewares.error_handler import GlobalErrorMiddleware
from app.core.config import settings
from app.services.qdrant_store import QdrantStore
from app.services.embeddings import EmbeddingService
import sentry_sdk

if settings.SENTRY_DSN:
    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        traces_sample_rate=1.0,
        profiles_sample_rate=1.0,
    )

app = FastAPI(
    title="Interview AI",
    version="1.0.0"
)

# =========================
# LOGGING
# =========================

setup_logging()
# Exception handlers removed; using GlobalErrorMiddleware instead

# =========================
# MIDDLEWARES
# =========================

app.add_middleware(GlobalErrorMiddleware)
app.add_middleware(RequestLoggerMiddleware)
app.add_middleware(RateLimitMiddleware)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# =========================
# ROUTES
# =========================

app.include_router(auth.router, tags=["Auth"])
app.include_router(cv.router, tags=["CV"])
app.include_router(interview.router, tags=["Interview"])
app.include_router(billing.router, tags=["Billing"])

# =========================
# HEALTH CHECK
# =========================

@app.get("/health")
def health():
    return {"status": "ok"}

# =========================
# STARTUP VALIDATION
# =========================

@app.on_event("startup")
async def startup():

    # 1️⃣ Valida Qdrant
    store = QdrantStore()
    await store.healthcheck()

    # 2️⃣ Garante collection apenas 1 vez
    # usa embedding dummy para descobrir vector_size
    embeddings = await EmbeddingService.embed_texts(["startup-check"])
    vec = embeddings[0]
    await store.ensure_collection(vector_size=len(vec))

    # 3️⃣ Valida Redis (Rate Limit)
    from app.services.redis_store import redis_store
    await redis_store.connect()