import fitz
import uuid
from sqlalchemy.orm import Session
from sqlalchemy import update

from app.db.models import CV
from app.services.chunker import chunk_text
from app.services.embeddings import EmbeddingService
from app.services.qdrant_store import QdrantStore


class CVService:

    # =========================
    # EXTRACT TEXT
    # =========================

    @staticmethod
    def extract_text_from_pdf(file_bytes: bytes) -> str:
        text = ""

        with fitz.open(stream=file_bytes, filetype="pdf") as doc:
            for page in doc:
                text += page.get_text()

        return text.strip()

    # =========================
    # SAVE CV (ONLY ONE ACTIVE)
    # =========================

    @staticmethod
    async def save_cv(db: AsyncSession, user_id: uuid.UUID, raw_text: str) -> CV:

        if not raw_text or not raw_text.strip():
            raise ValueError("CV vazio ou inválido")

        # Desativa CVs antigos
        await db.execute(
            update(CV)
            .where(CV.user_id == user_id)
            .values(is_active=False)
        )

        cv = CV(
            user_id=user_id,
            raw_text=raw_text,
            is_active=True
        )

        db.add(cv)
        await db.commit()
        await db.refresh(cv)

        return cv

    # =========================
    # INDEX TO QDRANT
    # =========================

    @staticmethod
    async def index_cv_to_qdrant(user_id: str, cv_id: str, raw_text: str):

        chunks = chunk_text(raw_text, chunk_size=1200, overlap=200)

        if not chunks:
            return {"chunks": 0}

        vectors = await EmbeddingService.embed_texts(chunks)

        if not vectors:
            return {"chunks": 0}

        store = QdrantStore()

        payloads = [
            {
                "user_id": str(user_id),
                "cv_id": str(cv_id),
                "chunk_index": i,
                "text": chunk
            }
            for i, chunk in enumerate(chunks)
        ]

        await store.upsert_chunks(
            vectors=vectors,
            payloads=payloads
        )

        return {"chunks": len(chunks)}
    
    @staticmethod
    async def deactivate_all_user_cvs(db: AsyncSession, user_id: str) -> None:
        await db.execute(update(CV).where(CV.user_id == user_id).values(is_active=False))

    @staticmethod
    async def create_cv(db: AsyncSession, user_id: str, raw_text: str) -> CV:
        cv = CV(user_id=user_id, raw_text=raw_text, is_active=True)
        db.add(cv)
        await db.flush()
        return cv