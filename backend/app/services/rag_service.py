import json
import logging
import asyncio
from typing import List, Dict, Any, Optional

import httpx
from tenacity import (
    stop_after_attempt,
    wait_exponential,
    retry_if_exception_type,
    AsyncRetrying,
    before_sleep_log
)

from app.core.config import settings
from app.services.qdrant_store import QdrantStore
from app.services.embeddings import EmbeddingService

logger = logging.getLogger("app")

# Semáforo para controlar concorrência na OpenAI
_chat_semaphore = asyncio.Semaphore(20)

def acquire_chat_semaphore():
    return _chat_semaphore

class RAGService:

    # =========================
    # CHAT CORE (REUSABLE)
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
            "temperature": 0.5,
        }

        retryer = AsyncRetrying(
            wait=wait_exponential(multiplier=1, min=2, max=10),
            stop=stop_after_attempt(5),
            retry=retry_if_exception_type(httpx.HTTPError),
            before_sleep=before_sleep_log(logger, logging.WARNING),
            reraise=True
        )

        from app.core.http_client import HttpClient
        client = await HttpClient.get_client()

        if not stream:
            try:
                async for attempt in retryer:
                    with attempt:
                        async with acquire_chat_semaphore():
                            response = await client.post(url, headers=headers, json=payload)
                            if response.status_code == 429:
                                logger.warning("OpenAI Rate Limit 429. Aguardando backoff...")
                            response.raise_for_status()
                            data = response.json()

                answer = data["choices"][0]["message"]["content"]
                tokens = int((data.get("usage") or {}).get("total_tokens") or 0)
                return answer, tokens
            except Exception as e:
                logger.error(f"Chat error: {e}")
                raise
        else:
            payload["stream"] = True
            async def _stream_generator():
                try:
                    async for attempt in retryer:
                        with attempt:
                            async with acquire_chat_semaphore():
                                async with client.stream("POST", url, headers=headers, json=payload) as response:
                                    response.raise_for_status()
                                    async for line in response.aiter_lines():
                                        if line.startswith("data: "):
                                            data_str = line[6:].strip()
                                            if data_str == "[DONE]":
                                                break
                                            try:
                                                chunk = json.loads(data_str)
                                                content = chunk["choices"][0].get("delta", {}).get("content")
                                                if content:
                                                    yield content
                                            except:
                                                continue
                except Exception as e:
                    logger.error(f"Stream error: {e}")
                    raise
            return _stream_generator()

    @staticmethod
    async def _chat_direct_persona(question: str, language: str, stream: bool) -> Any:
        # 🚀 REGRAS DE PERSONA (Atalho de Performance)
        system_prompt = (
            "PAPEL: CANDIDATO (Entrevistado). Você NÃO é o recrutador.\n"
            f"IDIOMA: Responda obrigatoriamente no idioma {language.upper()}.\n\n"
            "ESTILO PARA PERGUNTAS PESSOAIS (Hobbies, Cores, Lazer):\n"
            "- Respostas CURTAS, OBJETIVAS, HUMANAS e GENTIS.\n"
            "- Seja direto, sem rodeios ou excesso de texto.\n"
            "- NUNCA faça perguntas de volta.\n"
            "- Infira a intenção de palavras-chave curtas automaticamente e responda normalmente."
        )
        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": question}
        ]
        
        chat_result = await RAGService._chat(messages, stream=stream)
        
        if stream:
            async def event_stream():
                yield f"data: {json.dumps({'type': 'sources', 'sources': []})}\n\n"
                async for token in chat_result:
                    yield f"data: {json.dumps({'type': 'chunk', 'content': token})}\n\n"
                yield "data: [DONE]\n\n"
            return event_stream()
        else:
            answer, tokens = chat_result
            return {"answer": answer, "sources": [], "tokens": tokens}

    # =========================
    # MAIN RAG
    # =========================

    @staticmethod
    async def ask_question(user_id: str, question: str, language: str = "pt", top_k: int = 5, stream: bool = False) -> Any:
        persona_keywords = ["color", "favorite", "hobby", "like", "do you", "você", "gosta", "favorit", "quem", "cor", "hobby", "lazer", "café", "tempo livre"]
        if any(kw in question.lower() for kw in persona_keywords):
            return await RAGService._chat_direct_persona(question, language, stream)

        try:
            embeddings = await EmbeddingService.embed_texts([question])
            q_vec = embeddings[0]
            store = QdrantStore()
            hits = await store.search(query_vector=q_vec, user_id=user_id, limit=top_k)
        except Exception as e:
            logger.error(f"RAG Search failed: {e}")
            return await RAGService._chat_direct_persona(question, language, stream)

        # Build Context
        contexts, sources = [], []
        if hits:
            for h in hits:
                payload = h.payload or {}
                if payload.get("text"):
                    contexts.append(payload["text"][:2000])
                sources.append({
                    "score": float(h.score),
                    "cv_id": payload.get("cv_id"),
                    "chunk_index": payload.get("chunk_index"),
                })
        
        context_block = "\n\n---\n\n".join(contexts)[:6000]

        # REGRAS DE RESPOSTA COMPLETA PARA TÉCNICO/PROFISSIONAL
        system_prompt = (
            "PAPEL: CANDIDATO (Entrevistado). Você NÃO é o recrutador.\n"
            f"IDIOMA: Responda obrigatoriamente no idioma {language.upper()}.\n\n"
            "DIRETRIZES PROFISSIONAIS:\n"
            "- Respostas diretas e completas para temas profissionais baseadas no CV.\n"
            "- NUNCA devolva perguntas.\n"
            "- Se for um tema pessoal que escapou do atalho, seja CURTO, OBJETIVO e GENTIL.\n"
            "- Jamais peça para reformular. Nunca diga 'não entendi'."
        )

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"RECUTADOR: {question}\n\nSEU CURRÍCULO (CONTEXTO):\n{context_block}"}
        ]

        chat_result = await RAGService._chat(messages, stream=stream)

        if stream:
            async def event_stream():
                yield f"data: {json.dumps({'type': 'sources', 'sources': sources})}\n\n"
                async for token in chat_result:
                    yield f"data: {json.dumps({'type': 'chunk', 'content': token})}\n\n"
                yield "data: [DONE]\n\n"
            return event_stream()
        else:
            answer, tokens = chat_result
            return {"answer": answer, "sources": sources, "tokens": tokens}