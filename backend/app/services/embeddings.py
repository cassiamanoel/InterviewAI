import asyncio
from typing import List
import httpx

from app.core.config import settings

# Limita concorrência disparada simultaneamente para a OpenAI (evita rate limits e gargalo de tráfego)
_embedding_semaphore = asyncio.Semaphore(50)

class EmbeddingService:

    @staticmethod
    async def embed_texts(texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY não configurada no .env")

        url = "https://api.openai.com/v1/embeddings"

        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": settings.OPENAI_EMBED_MODEL,
            "input": texts
        }

        from app.core.http_client import HttpClient
        client = await HttpClient.get_client()

        async with _embedding_semaphore:
            try:
                response = await client.post(url, headers=headers, json=payload)
                response.raise_for_status()
                data = response.json()
            except httpx.HTTPError as e:
                raise RuntimeError(f"Erro ao gerar embedding: {str(e)}")

        if "data" not in data:
            raise RuntimeError("Resposta inválida da OpenAI (embeddings)")

        return [item["embedding"] for item in data["data"]]