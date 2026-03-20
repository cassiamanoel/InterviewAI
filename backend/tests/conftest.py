import pytest
from fastapi.testclient import TestClient
from typing import Generator

from app.main import app
from app.db.session import get_db
from app.core.security import get_current_user
from app.db.models import User

# --- Fake DB ---
class FakeSession:
    async def commit(self): pass
    async def refresh(self, obj): pass
    async def close(self): pass
    def add(self, obj): pass
    async def execute(self, stmt): return self
    async def scalars(self, stmt): return self
    async def flush(self): pass
    def first(self): return None
    def query(self, model): return self
    def filter(self, *args): return self
    def with_for_update(self): return self

async def override_get_db():
    try:
        db = FakeSession()
        yield db
    finally:
        pass

def override_get_current_user() -> User:
    # Dummy user
    from uuid import UUID
    user = User(id=UUID("123e4567-e89b-12d3-a456-426614174000"), email="test@test.com")
    # if you want to mock subscription:
    # user.subscription = Subscription(plan="pro")
    return user

app.dependency_overrides[get_db] = override_get_db
app.dependency_overrides[get_current_user] = override_get_current_user

@pytest.fixture(scope="module")
def client() -> Generator[TestClient, None, None]:
    with TestClient(app, raise_server_exceptions=True) as c:
        yield c

@pytest.fixture(autouse=True)
def mock_redis_store(monkeypatch):
    class MockRedisStore:
        async def connect(self): pass
        async def disconnect(self): pass
        async def check_rate_limit(self, user_id: str, limit: int = 20) -> bool:
            return True
            
    monkeypatch.setattr("app.services.redis_store.redis_store", MockRedisStore())
    monkeypatch.setattr("app.middlewares.rate_limit.redis_store", MockRedisStore())
