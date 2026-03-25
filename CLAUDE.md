# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Interview AI is a full-stack technical interview preparation app. Users upload a CV (PDF), and an AI interviewer asks contextual questions using RAG (Retrieval-Augmented Generation) with real-time audio transcription and multilingual support.

- **Backend**: Python FastAPI (async), PostgreSQL, Qdrant (vector DB), Redis
- **Frontend**: Next.js 16 with React 19, TypeScript, Tailwind CSS 4
- **AI**: OpenAI GPT-4o-mini (chat), text-embedding-3-small (embeddings), Whisper (transcription)
- **Language detection**: Lingua library with Portuguese heuristics fallback

## Common Commands

### Backend

```bash
cd backend

# Start infrastructure (Postgres via PGBouncer, Qdrant, Redis)
docker compose up -d

# Install dependencies
pip install -r requirements.txt

# Run database migrations
alembic upgrade head

# Start dev server
uvicorn app.main:app --reload --port 8000

# Run all tests
pytest

# Run a single test file
pytest tests/services/test_rag.py

# Run tests with coverage
pytest --cov=app --cov-report=term-missing

# Create a new migration
alembic revision --autogenerate -m "description"
```

### Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev        # runs on port 3000

# Build for production
npm run build

# Lint
npm run lint
```

## Architecture

### Backend Request Flow

```
Request → GlobalErrorMiddleware → RequestLoggerMiddleware → RateLimitMiddleware → CORS → Router
```

**Interview `/interview/ask` flow** (the core endpoint):
1. Auth middleware extracts user from JWT
2. RateLimitMiddleware checks daily usage (UsageDaily table)
3. RAGService detects language (Portuguese heuristics → Lingua → fallback English)
4. "Persona keywords" bypass RAG → direct chat; otherwise:
5. Question embedded via OpenAI → Qdrant semantic search (filtered by user_id) → top-k CV chunks
6. System prompt built with cultural tone (BR/US/ES) + CV context
7. OpenAI chat completion (streaming via SSE or non-streaming)

**CV upload `/cv/upload` flow**:
PDF → PyMuPDF text extraction → chunking (1200 chars, 200 overlap) → OpenAI embeddings → Qdrant indexing with user_id metadata

### Frontend Audio Interview Flow

`useAudioInterview` orchestrates two modes:
- **Auto mode**: `useWhisperRecognition` runs Web Speech API (live preview) + MediaRecorder (actual audio). Silence detection → sends blob to `/api/transcribe` (Whisper) → detected language forwarded to `/interview/ask`
- **Fixed language mode**: Web Speech API with a set language code, no Whisper needed

Responses stream via fetch ReadableStream (SSE).

### Key Services (backend/app/services/)

| Service | Purpose |
|---------|---------|
| `rag_service.py` | Language detection, RAG pipeline, OpenAI chat with retry/semaphore |
| `cv_service.py` | PDF extraction, chunking, embedding, Qdrant indexing |
| `qdrant_store.py` | Async Qdrant client wrapper, multi-tenant search |
| `embeddings.py` | OpenAI embeddings with semaphore (max 50 concurrent) |
| `rate_limit_service.py` | Per-user/day DB-backed usage tracking, plan-aware limits |
| `billing_service.py` | Stripe/LemonSqueezy webhook subscription management |

### Database

PostgreSQL with SQLAlchemy async ORM. Models in `backend/app/db/models.py`:
- **User** → has many CVs, InterviewSessions, Subscription, UsageDaily
- **CV** → has raw_text, one active per user
- **InterviewSession** → has many InterviewMessages, tracks language/role/level
- **Subscription** → plan (free/pro), Stripe IDs
- **UsageDaily** → unique (user_id, day), atomic upsert via `on_conflict_do_update`

Migrations managed by Alembic in `backend/alembic/versions/`.

### Auth

JWT tokens (60-min expiry) with Argon2 password hashing. Security utilities in `backend/app/core/security.py`. Frontend stores token in localStorage, sends via `Authorization: Bearer` header.

## Testing

Backend tests use pytest-asyncio with mock fixtures defined in `backend/tests/conftest.py`:
- `FakeSession` mocks AsyncSession
- `FakeRedisStore` mocks Redis
- Dependency injection overrides via `app.dependency_overrides`

Test categories: `tests/api/` (route tests), `tests/services/` (unit tests), `load_test_*.py` (performance).

CI runs on GitHub Actions with PostgreSQL and Redis service containers (`.github/workflows/ci.yml`).

## Environment Variables

Backend config via Pydantic BaseSettings (`backend/app/core/config.py`), loaded from `backend/.env`:
- `DATABASE_URL`, `OPENAI_API_KEY`, `JWT_SECRET_KEY` (required)
- `QDRANT_URL` (default: `http://localhost:6333`), `REDIS_URL` (default: `redis://localhost:6379/0`)
- `OPENAI_CHAT_MODEL` (default: `gpt-4o-mini`), `OPENAI_EMBED_MODEL` (default: `text-embedding-3-small`)
- `FREE_DAILY_REQUESTS` (default: 20), `FREE_DAILY_TOKENS` (default: 20000)

Frontend config in `frontend/src/lib/config.ts` reads `NEXT_PUBLIC_API_URL`.
