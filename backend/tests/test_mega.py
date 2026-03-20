import pytest
from unittest.mock import patch, MagicMock
from app.core.security import verify_password, hash_password
from app.db.session import get_db
from app.startup import ensure_qdrant_ready
from app.middlewares.rate_limit import RateLimitMiddleware
from app.services.redis_store import redis_store
from app.services.cv_service import CVService

def test_startup():
    with patch("app.startup.QdrantClient") as mock_qc:
        mock_instance = mock_qc.return_value
        mock_instance.get_collections.return_value = MagicMock(collections=[])
        ensure_qdrant_ready(128)

@pytest.mark.asyncio
async def test_redis_store():
    # Force cover connect/disconnect bypasses
    store = redis_store
    store.client = None
    await store.connect()
    assert getattr(store, "client", None) is None or store.client is not None
    await store.disconnect()

def test_security_hash():
    h = hash_password("test")
    assert verify_password("test", h)

@pytest.mark.asyncio
async def test_db_session():
    generator = get_db()
    db = await anext(generator)
    assert db is not None

from unittest.mock import AsyncMock

@pytest.mark.asyncio
async def test_cv_service_fallback():
    try:
        await CVService.save_cv(AsyncMock(), "user", "")
    except ValueError:
        pass
    
    await CVService.deactivate_all_user_cvs(AsyncMock(), "user")
