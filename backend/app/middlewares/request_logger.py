import time
import uuid
import logging
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger("app")

class RequestLoggerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        start = time.time()
        request_id = request.headers.get("x-request-id") or str(uuid.uuid4())
        request.state.request_id = request_id

        response = await call_next(request)

        duration_ms = int((time.time() - start) * 1000)
        logger.info("request", extra={
            "request_id": request_id,
            "path": str(request.url.path),
            "method": request.method,
            "status_code": response.status_code,
            "duration_ms": duration_ms,
        })
        response.headers["x-request-id"] = request_id
        return response