import json
import logging
import asyncio
import re
from typing import List, Dict, Any, Optional

import httpx
from lingua import Language, LanguageDetectorBuilder
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

# ============================
# LINGUA DETECTOR (Singleton)
# ============================
# Lingua é superior ao langdetect para textos curtos.
# Carrega apenas os idiomas que nos interessam → rápido e preciso.
_lingua_detector = LanguageDetectorBuilder.from_languages(
    Language.PORTUGUESE, Language.ENGLISH, Language.SPANISH,
    Language.FRENCH, Language.GERMAN, Language.ITALIAN
).with_preloaded_language_models().build()

# Semáforo para controlar concorrência na OpenAI
_chat_semaphore = asyncio.Semaphore(20)

def acquire_chat_semaphore():
    return _chat_semaphore


class RAGService:

    # =========================
    # DETECÇÃO DE IDIOMA (PRO)
    # =========================

    @staticmethod
    def _normalize_input(text: str) -> str:
        return text.lower().strip()

    @staticmethod
    def _is_portuguese(text: str) -> bool:
        """Heurística PT: resolve frases curtas e sem acento."""
        pt_keywords = [
            "você", "vc", "seu", "sua", "cor", "hobby", "hobbies",
            "trabalho", "experiência", "experiencia", "forte", "fraco",
            "fala", "sobre", "empresa", "gosta", "faz", "atualmente",
            "cargo", "salário", "salario", "pontos", "fortes", "fracos",
            "qual", "quais", "como", "onde", "quando", "porque", "porquê",
            "meu", "minha", "nosso", "nossa", "dele", "dela",
            "projeto", "equipe", "time", "líder", "lider",
            "favorita", "favorito", "prefere", "preferido",
            "maior", "melhor", "pior", "dificuldade",
            "conte", "descreva", "explique", "poderia",
            "já", "nunca", "sempre", "também", "tambem"
        ]
        text = text.lower()
        return any(word in text for word in pt_keywords)

    @staticmethod
    def _detect_language(text: str) -> str:
        """Pipeline de detecção: Heurística PT → Lingua (PRO) → Fallback EN."""
        normalized = text.lower().strip()

        # 1. Prioridade absoluta: Português (resolve frases curtas)
        if RAGService._is_portuguese(normalized):
            return "pt"

        # 2. Lingua detector (superior ao langdetect para textos curtos)
        try:
            detected = _lingua_detector.detect_language_of(text)
            if detected:
                lang_map = {
                    Language.PORTUGUESE: "pt",
                    Language.ENGLISH: "en",
                    Language.SPANISH: "es",
                    Language.FRENCH: "fr",
                    Language.GERMAN: "de",
                    Language.ITALIAN: "it",
                }
                return lang_map.get(detected, "en")
        except Exception:
            pass

        # 3. Fallback seguro
        return "en"

    # =========================
    # TOM CULTURAL (BR/US/ES)
    # =========================

    @staticmethod
    def _map_culture(lang: str) -> str:
        if lang == "pt":
            return "BR"
        if lang == "es":
            return "ES"
        return "US"

    @staticmethod
    def _get_language_name(lang_code: str) -> str:
        names = {
            "pt": "Portuguese", "es": "Spanish", "en": "English",
            "fr": "French", "de": "German", "it": "Italian"
        }
        return names.get(lang_code, "English")

    @staticmethod
    def _build_system_prompt(language_code: str) -> str:
        lang_name = RAGService._get_language_name(language_code)
        culture = RAGService._map_culture(language_code)

        culture_block = ""
        if culture == "BR":
            culture_block = (
                "- Tom natural, próximo e conversacional.\n"
                "- Pode usar leve emoção e foco em relacionamento + entrega.\n"
                "- Menos formal, mais empático e humano."
            )
        elif culture == "US":
            culture_block = (
                "- Tom direto, objetivo e estruturado.\n"
                "- Foco em resultado e impacto mensurável.\n"
                "- Segurança, clareza e concisão."
            )
        elif culture == "ES":
            culture_block = (
                "- Tom profissional e respeitoso.\n"
                "- Formal moderado, levemente mais explicativo.\n"
                "- Profissionalismo clássico e colaborativo."
            )

        return f"""
PAPEL: Você é um CANDIDATO em uma entrevista de emprego (Entrevistado).

IDIOMA (REGRA DE OURO):
- Responda SEMPRE em: {lang_name}.
- Português é idioma prioritário. Mesmo com erro, gíria ou frase curta, trate como português se houver indícios.
- Exemplos válidos de PT: "cor favorita", "seus hobbies", "pontos fortes", "fala sobre vc".
- Nunca classifique português como inválido. Sempre responda normalmente.
- Se o recrutador mudar de idioma, mude junto instantaneamente sem avisar.

TOM CULTURAL ({culture}):
{culture_block}

REGRAS CRÍTICAS:
- NUNCA faça perguntas de volta.
- NUNCA peça reformulação ou diga que não entendeu.
- Sempre infira a intenção e responda diretamente.
- Termine a resposta de forma fechada e segura.
"""

    # =========================
    # CHAT CORE
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
    async def _chat_direct_persona(question: str, language_code: str, stream: bool) -> Any:
        system_prompt = RAGService._build_system_prompt(language_code)
        
        if len(question.split()) <= 3:
            system_prompt += "\nESTILO: Resposta curta e objetiva."

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
    async def ask_question(user_id: str, question: str, language: str = "auto", top_k: int = 5, stream: bool = False) -> Any:
        # 1. Pipeline de Detecção PRO
        normalized = RAGService._normalize_input(question)
        lang_detected = RAGService._detect_language(normalized) if language == "auto" else language

        # 2. Atalho de Persona (Inferência + Performance)
        persona_keywords = [
            "color", "favorite", "hobby", "like", "do you", "você", "gosta", "favorit", "quem", "cor", 
            "lazer", "café", "tempo livre", "what do you do", "fala", "sobre", "vc", "hobbies"
        ]
        if any(kw in normalized for kw in persona_keywords) or len(normalized.split()) <= 2:
            return await RAGService._chat_direct_persona(question, lang_detected, stream)

        # 3. Embedding & Search
        try:
            embeddings = await EmbeddingService.embed_texts([question])
            q_vec = embeddings[0]
            store = QdrantStore()
            hits = await store.search(query_vector=q_vec, user_id=user_id, limit=top_k)
        except Exception as e:
            logger.error(f"RAG Search failed: {e}")
            return await RAGService._chat_direct_persona(question, lang_detected, stream)

        # 4. Contexto
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
        system_prompt = RAGService._build_system_prompt(lang_detected)

        messages = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": f"RECRUTADOR: {question}\n\nCONTEXTO DO SEU CV:\n{context_block}"}
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