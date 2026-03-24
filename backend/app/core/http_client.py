import httpx
import asyncio
from typing import Optional

class HttpClient:
    _instance: Optional[httpx.AsyncClient] = None

    @classmethod
    async def get_client(cls) -> httpx.AsyncClient:
        if cls._instance is None or cls._instance.is_closed:
            cls._instance = httpx.AsyncClient(
                timeout=60.0,
                limits=httpx.Limits(max_connections=100, max_keepalive_connections=20)
            )
        return cls._instance

    @classmethod
    async def close_client(cls):
        if cls._instance and not cls._instance.is_closed:
            await cls._instance.aclose()
            cls._instance = None
