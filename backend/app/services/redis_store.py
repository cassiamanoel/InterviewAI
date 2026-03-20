import redis.asyncio as redis
from app.core.config import settings

class RedisStore:
    def __init__(self):
        self.redis_url = settings.REDIS_URL
        self.client = None

    async def connect(self):
        if not self.client:
            try:
                self.client = redis.from_url(self.redis_url, decode_responses=True)
                await self.client.ping()
            except Exception as e:
                import logging
                logging.getLogger("app").warning(f"Redis connect failed: {e}")
                self.client = None
            
    async def disconnect(self):
        if self.client:
            await self.client.close()

    async def check_rate_limit(self, user_id: str, limit: int = settings.FREE_DAILY_REQUESTS) -> bool:
        """
        Simple Redis-based rate limit implementation for the MVP.
        Keys expire after 24 hours.
        """
        await self.connect()
        if not self.client:
            # Fallback/bypass se Redis estiver indisponível
            return True
            
        import datetime
        day = datetime.date.today().isoformat()
        key = f"rate_limit:{user_id}:{day}"
        
        current = await self.client.get(key)
        if current and int(current) >= limit:
            return False
            
        # Increment and set expiry if it's new
        pipe = self.client.pipeline()
        pipe.incr(key)
        pipe.expire(key, 86400)
        await pipe.execute()
        return True

redis_store = RedisStore()
