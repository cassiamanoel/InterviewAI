import pytest
from app.services.redis_store import redis_store

@pytest.mark.asyncio
async def test_redis_rate_limit_stub():
    """
    Testa diretamente a interface assíncrona do Store mockado via conftest.
    Em um cenário real, você apontaria para um redis db isolado e enviaria incr.
    Aqui apenas testamos a resposta do stub.
    """
    ok = await redis_store.check_rate_limit("test-user", limit=20)
    assert ok is True
