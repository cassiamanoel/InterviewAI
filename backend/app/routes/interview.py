from datetime import date
from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.schemas.interview_schema import AskRequest, AskResponse
from app.core.security import get_current_user
from app.db.session import get_db
from app.db.models import User
from app.services.rag_service import RAGService
from app.services.rate_limit_service import RateLimitService

router = APIRouter(prefix="/interview", tags=["Interview"])

from sqlalchemy.ext.asyncio import AsyncSession


@router.post("/ask", response_model=AskResponse)
async def ask(
    body: AskRequest,
    stream: bool = Query(False, description="Ativar streaming via Server-Sent Events"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    question = (body.question or "").strip()
    if not question:
        raise HTTPException(status_code=400, detail="Pergunta obrigatória")

    today = date.today()

    if stream:
        # 🔎 Rate Limit para Streaming: cobra um valor fixo (ex: 300 tokens) antecipadamente.
        ok, meta = await RateLimitService.can_consume(
            db=db,
            user_id=current_user.id,
            day=today,
            req_inc=0,
            token_inc=300
        )
        if not ok:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "Limite diário de tokens atingido. Faça upgrade do plano.",
                    "rate_limit": meta
                }
            )

        # 💰 Debita os tokens antecipados
        await RateLimitService.consume(
            db=db,
            user_id=current_user.id,
            day=today,
            req_inc=0,
            token_inc=300
        )

        # Retorna o Async Generator
        result_gen = await RAGService.ask_question(
            user_id=str(current_user.id),
            question=question,
            top_k=5,
            stream=True
        )

        return StreamingResponse(result_gen, media_type="text/event-stream")

    else:
        # Executa RAG síncrono
        result = await RAGService.ask_question(
            user_id=str(current_user.id),
            question=question,
            top_k=5,
            stream=False
        )

        tokens_used = int(result.get("tokens") or 0)

        # 🔎 Verifica limite exato
        ok, meta = await RateLimitService.can_consume(
            db=db,
            user_id=current_user.id,
            day=today,
            req_inc=0,
            token_inc=tokens_used
        )

        if not ok:
            raise HTTPException(
                status_code=402,
                detail={
                    "message": "Limite diário de tokens atingido. Faça upgrade do plano.",
                    "rate_limit": meta
                }
            )

        # 💰 Debita tokens exatos
        usage = await RateLimitService.consume(
            db=db,
            user_id=current_user.id,
            day=today,
            req_inc=0,
            token_inc=tokens_used
        )

        return {
            "answer": result["answer"],
            "sources": result["sources"],
            "usage_daily": usage
        }