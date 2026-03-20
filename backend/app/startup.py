import logging
from qdrant_client import QdrantClient
from qdrant_client.http.models import VectorParams, Distance
from app.core.config import settings

logger = logging.getLogger("app")

def ensure_qdrant_ready(vector_size: int):
    client = QdrantClient(url=settings.QDRANT_URL, timeout=5)

    # 1) ping básico (se falhar, sobe exception e derruba app)
    client.get_collections()

    # 2) ensure collection
    collections = client.get_collections().collections
    exists = any(c.name == settings.QDRANT_COLLECTION for c in collections)

    if not exists:
        client.create_collection(
            collection_name=settings.QDRANT_COLLECTION,
            vectors_config=VectorParams(size=vector_size, distance=Distance.COSINE),
        )
        logger.info("qdrant_collection_created", extra={"path": settings.QDRANT_COLLECTION})
    else:
        logger.info("qdrant_collection_ok", extra={"path": settings.QDRANT_COLLECTION})