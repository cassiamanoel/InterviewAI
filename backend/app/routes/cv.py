from fastapi import APIRouter, UploadFile, File, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.services.cv_service import CVService
from app.core.security import get_current_user
from app.db.models import User

router = APIRouter(prefix="/cv", tags=["CV"])

MAX_FILE_SIZE = 5 * 1024 * 1024  # 5MB


from sqlalchemy.ext.asyncio import AsyncSession

# =========================
# ... earlier imports
# =========================

@router.post("/upload")
async def upload_cv(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    # =========================
    # VALIDATE TYPE
    # =========================
    if file.content_type != "application/pdf":
        raise HTTPException(status_code=400, detail="Apenas PDF é permitido")

    file_bytes = await file.read()

    # =========================
    # VALIDATE SIZE
    # =========================
    if len(file_bytes) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="Arquivo excede tamanho máximo permitido (5MB)")

    # =========================
    # EXTRACT TEXT
    # =========================
    extracted_text = CVService.extract_text_from_pdf(file_bytes)

    if not extracted_text:
        raise HTTPException(status_code=400, detail="Não foi possível extrair texto do PDF")

    try:
        # =========================
        # SAVE CV
        # =========================
        cv = await CVService.save_cv(db, current_user.id, extracted_text)

        # =========================
        # INDEX CV
        # =========================
        indexed = await CVService.index_cv_to_qdrant(
            user_id=str(current_user.id),
            cv_id=str(cv.id),
            raw_text=extracted_text
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Erro ao processar CV: {str(e)}")

    return {
        "message": "CV salvo e indexado com sucesso",
        "cv_id": str(cv.id),
        "characters": len(extracted_text),
        "chunks_indexed": indexed["chunks"]
    }