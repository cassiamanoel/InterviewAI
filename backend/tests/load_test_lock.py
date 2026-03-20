import asyncio
from datetime import date
import uuid
import sys
import os

# Ensure backend root is in PYTHONPATH
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from app.core.config import settings
from app.services.rate_limit_service import RateLimitService
from app.db.models import User

db_url = settings.DATABASE_URL.replace("postgresql://", "postgresql+asyncpg://")
engine = create_async_engine(db_url, pool_size=60, max_overflow=20)
SessionLocal = async_sessionmaker(bind=engine, class_=AsyncSession)

async def worker(user_id, day):
    async with SessionLocal() as db:
        ok, meta = await RateLimitService.can_consume(db, user_id, day, 1, 10)
        if ok:
            await RateLimitService.consume(db, user_id, day, 1, 10)
        return ok

async def run_load_test():
    test_user_id = uuid.uuid4()
    
    async with SessionLocal() as db:
        user = User(id=test_user_id, email=f"loadtest_{test_user_id}@test.com", password="pwd")
        db.add(user)
        await db.commit()

    day = date.today()
    print(f"Starting concurrency load test for user {test_user_id}")
    
    # Simulate 50 simultaneous requests hitting the rate limit
    tasks = [worker(test_user_id, day) for _ in range(50)]
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    successes = sum(1 for r in results if r is True)
    failures = sum(1 for r in results if r is False)
    errors = [r for r in results if isinstance(r, Exception)]
    
    print(f"Results: {successes} passed limit check, {failures} blocked by limit check,"
          f" {len(errors)} lock/db exceptions")

    if errors:
        print("Sample exception:", errors[0])
    
    # Check final counters
    async with SessionLocal() as db:
        usage = await RateLimitService.get_or_create_today(db, str(test_user_id))
        print(f"Final Usage Counters: {usage.requests_used} requests, {usage.tokens_used} tokens")

    # Cleanup
    async with SessionLocal() as db:
        user_to_delete = await db.get(User, test_user_id)
        await db.delete(user_to_delete)
        await db.commit()

if __name__ == "__main__":
    asyncio.run(run_load_test())
