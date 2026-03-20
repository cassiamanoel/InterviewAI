from typing import List, Dict, Any, Optional
import uuid
import httpx

from qdrant_client import AsyncQdrantClient
from qdrant_client.http.models import (
    VectorParams,
    Distance,
    PointStruct,
    Filter,
    FieldCondition,
    MatchValue
)

from app.core.config import settings

class QdrantStore:

    def __init__(self):
        self.client = AsyncQdrantClient(url=settings.QDRANT_URL)
        self.collection_name = settings.QDRANT_COLLECTION

    # =========================
    # HEALTHCHECK
    # =========================

    async def healthcheck(self):
        try:
            async with httpx.AsyncClient(timeout=3) as c:
                r = await c.get(f"{settings.QDRANT_URL}/readyz")
                r.raise_for_status()
        except Exception as e:
            raise RuntimeError(f"Qdrant indisponível: {str(e)}")

    # =========================
    # CREATE COLLECTION IF NEEDED
    # =========================

    async def ensure_collection(self, vector_size: int):
        collections_response = await self.client.get_collections()
        collections = collections_response.collections
        exists = any(c.name == self.collection_name for c in collections)

        if not exists:
            await self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(
                    size=vector_size,
                    distance=Distance.COSINE
                )
            )

    # =========================
    # UPSERT CHUNKS
    # =========================

    async def upsert_chunks(
        self,
        vectors: List[List[float]],
        payloads: List[Dict[str, Any]]
    ):
        if not vectors:
            return

        points = [
            PointStruct(
                id=str(uuid.uuid4()),
                vector=vec,
                payload=payload
            )
            for vec, payload in zip(vectors, payloads)
        ]

        await self.client.upsert(
            collection_name=self.collection_name,
            points=points
        )

    # =========================
    # SEARCH (MULTI-TENANT SAFE)
    # =========================

    async def search(
        self,
        query_vector: List[float],
        user_id: Optional[str] = None,
        limit: int = 5,
    ):
        filter_ = None

        if user_id:
            filter_ = Filter(
                must=[
                    FieldCondition(
                        key="user_id",
                        match=MatchValue(value=user_id)
                    )
                ]
            )

        response = await self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            limit=limit,
            query_filter=filter_,
            with_payload=True
        )

        return response