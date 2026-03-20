from datetime import date
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from app.core.security import decode_user_id_from_token
from app.services.redis_store import redis_store


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Aplica rate limit apenas em:
    POST /interview/ask

    Fluxo Refatorado (Redis assíncrono para evitar bloquear Event Loop):
    - Verifica JWT
    - Checa limite no Redis
    - Se falhar, retorna 402
    - Se passar, continua o fluxo (Redis já decrementa/incrementa cache internamente)
    """

    async def dispatch(self, request: Request, call_next):

        # 🔒 Aplica apenas no endpoint correto
        if not (
            request.method.upper() == "POST"
            and request.url.path == "/interview/ask"
        ):
            return await call_next(request)

        auth = request.headers.get("authorization", "")

        # Deixa o próprio endpoint tratar 401
        if not auth.lower().startswith("bearer "):
            return await call_next(request)

        token = auth.split(" ", 1)[1].strip()

        try:
            user_id = decode_user_id_from_token(token)
            # Use fixed rate limit logic using async Redis
            ok = await redis_store.check_rate_limit(str(user_id))
            
            if not ok:
                return JSONResponse(
                    status_code=402,
                    content={
                        "detail": "Limite diário atingido. Faça upgrade do plano.",
                        "rate_limit": {"status": "exceeded"}
                    },
                )
                
        except Exception:
            # Token error or Redis error, proceed to let the route handle it or fallback
            pass

        # Continua fluxo normal
        response = await call_next(request)
        return response