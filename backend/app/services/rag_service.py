import asyncio
from typing import List, Dict, Any, Tuple
import httpx

from app.core.config import settings
from app.services.embeddings import EmbeddingService
from app.services.qdrant_store import QdrantStore

# Limita o total de requisições concorrentes de chat na API da OpenAI
_chat_semaphore = asyncio.Semaphore(50)
_waiting_chats = 0
MAX_WAITING_CHATS = 100

from contextlib import asynccontextmanager
from fastapi import HTTPException
import logging
import json
from tenacity import AsyncRetrying, wait_exponential, stop_after_attempt, retry_if_exception_type, before_sleep_log

logger = logging.getLogger("rag_service")
logger.setLevel(logging.INFO)

@asynccontextmanager
async def acquire_chat_semaphore():
    global _waiting_chats
    if _chat_semaphore.locked() and _waiting_chats >= MAX_WAITING_CHATS:
        logger.error(f"Saturação de RAG (Backpressure)! Requisições na fila: {_waiting_chats}. Limite: {MAX_WAITING_CHATS}.")
        raise HTTPException(
            status_code=429, 
            detail="O serviço de I.A. está sobrecarregado no momento. Por favor aguarde alguns instantes."
        )

    _waiting_chats += 1
    try:
        await _chat_semaphore.acquire()
    finally:
        _waiting_chats -= 1
        
    try:
        yield
    finally:
        _chat_semaphore.release()


class RAGService:

    # =========================
    # OPENAI CHAT
    # =========================

    @staticmethod
    async def _chat(messages: list, stream: bool = False) -> Any:

        if not settings.OPENAI_API_KEY:
            raise RuntimeError("OPENAI_API_KEY não configurada")

        url = "https://api.openai.com/v1/chat/completions"

        headers = {
            "Authorization": f"Bearer {settings.OPENAI_API_KEY}",
            "Content-Type": "application/json",
        }

        payload = {
            "model": settings.OPENAI_CHAT_MODEL,
            "messages": messages,
            "temperature": 0.2,
        }

        retryer = AsyncRetrying(
            wait=wait_exponential(multiplier=1, min=2, max=10),
            stop=stop_after_attempt(5),
            retry=retry_if_exception_type(httpx.HTTPError),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True
        )

        if not stream:
            try:
                async for attempt in retryer:
                    with attempt:
                        async with acquire_chat_semaphore():
                            async with httpx.AsyncClient(timeout=60) as client:
                                response = await client.post(url, headers=headers, json=payload)
                                if response.status_code == 429:
                                    logger.warning("OpenAI Rate Limit 429 Atingido! Aguardando backoff...")
                                response.raise_for_status()
                                data = response.json()

                answer = data["choices"][0]["message"]["content"]
                tokens = int((data.get("usage") or {}).get("total_tokens") or 0)
                return answer, tokens
            except asyncio.CancelledError:
                logger.warning("Cliente desconectou durante requisição síncrona. Cancelando processamento OpenIA...")
                raise

        else:
            payload["stream"] = True

            async def _stream_generator():
                try:
                    async for attempt in retryer:
                        with attempt:
                            async with acquire_chat_semaphore():
                                async with httpx.AsyncClient(timeout=60) as client:
                                    async with client.stream("POST", url, headers=headers, json=payload) as response:
                                        if response.status_code == 429:
                                            logger.warning("OpenAI Rate Limit 429 Atingido em stream! Aguardando backoff...")
                                        response.raise_for_status()

                                        async for line in response.aiter_lines():
                                            if line.startswith("data: "):
                                                data_str = line[6:]
                                                if data_str == "[DONE]":
                                                    break
                                                try:
                                                    chunk = json.loads(data_str)
                                                    delta = chunk["choices"][0].get("delta", {})
                                                    content = delta.get("content")
                                                    if content:
                                                        yield content
                                                except json.JSONDecodeError:
                                                    pass
                except (asyncio.CancelledError, GeneratorExit):
                    logger.warning("Conexão fechada pelo frontend (Client Disconnect). Abortando stream ativo da OpenAI imediatamente.")
                    raise

            return _stream_generator()

    # =========================
    # MAIN RAG
    # =========================

    @staticmethod
    async def ask_question(user_id: str, question: str, top_k: int = 5, stream: bool = False) -> Any:

        store = QdrantStore()

        # 1️⃣ Embedding
        embeddings = await EmbeddingService.embed_texts([question])
        q_vec = embeddings[0]

        # 2️⃣ Search
        hits = await store.search(
            query_vector=q_vec,
            user_id=user_id,
            limit=top_k
        )

        if not hits:
            error_ans = "Não encontrei informações suficientes no seu currículo. / I couldn't find enough information in your CV. / No encontré información."
            if stream:
                async def empty_stream():
                    import json
                    yield f"data: {json.dumps({'type': 'sources', 'sources': []})}\n\n"
                    yield f"data: {json.dumps({'type': 'chunk', 'content': error_ans})}\n\n"
                    yield "data: [DONE]\n\n"
                return empty_stream()
            else:
                return {
                    "answer": error_ans,
                    "sources": [],
                    "tokens": 0
                }

        contexts: List[str] = []
        sources: List[Dict[str, Any]] = []

        for h in hits:
            payload = h.payload or {}
            text = payload.get("text", "")

            if text:
                contexts.append(text[:2000])

            sources.append({
                "score": float(h.score),
                "cv_id": payload.get("cv_id"),
                "chunk_index": payload.get("chunk_index"),
            })

        context_block = "\n\n---\n\n".join(contexts)[:6000]

        system_prompt = (
            "You are a professional technical interviewer. "
            "DETECT the language of the user's question and respond EXCLUSIVELY in that same language. "
            "Use ONLY the CV context provided to answer. "
            "If information is missing from the context, clearly state that you couldn't find it."
        )

        user_prompt = (
            f"Question:\n{question}\n\n"
            f"CV Context:\n{context_block}"
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_prompt}
        ]

        chat_result = await RAGService._chat(messages, stream=stream)

        if stream:
            import json
            async def event_stream():
                # Yield sources first so frontend has them immediately
                yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
                
                try:
                    async for token in chat_result:
                        yield f"data: {json.dumps({'type': 'chunk', 'content': token})}\n\n"
                    yield "data: [DONE]\n\n"
                except Exception as e:
                    logger.error(f"Streaming error: {e}")
                    yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            
            return event_stream()
            
        else:
            answer, tokens = chat_result
            return {
                "answer": answer,
                "sources": sources,
                "tokens": tokens
            }