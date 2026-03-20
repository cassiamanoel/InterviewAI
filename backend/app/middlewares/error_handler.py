import uuid
import logging
from fastapi import Request
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("app")

class GlobalErrorMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id

        try:
            return await call_next(request)
        except Exception as e:
            import traceback
            traceback.print_exc()
            logger.exception("unhandled_error", extra={
                "request_id": request_id,
                "path": str(request.url.path),
                "method": request.method,
            })
            return JSONResponse(
                status_code=500,
                content={
                    "detail": "Internal Server Error",
                    "request_id": request_id
                }
            )