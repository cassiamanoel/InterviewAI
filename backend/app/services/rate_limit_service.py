from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert

from app.core.config import settings
from app.db.models import Subscription, UsageDaily


@dataclass
class Limits:
    daily_requests: int
    daily_tokens: int


from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

class RateLimitService:

    # =========================
    # GET LIMITS BASED ON PLAN
    # =========================

    @staticmethod
    async def _get_limits_for_user(db: AsyncSession, user_id) -> Limits:
        stmt = select(Subscription).where(
            Subscription.user_id == user_id,
            Subscription.status == "active"
        )
        sub = (await db.scalars(stmt)).first()

        # Usuário sem subscription = FREE
        if not sub:
            return Limits(
                settings.FREE_DAILY_REQUESTS,
                settings.FREE_DAILY_TOKENS
            )

        # Plano PRO
        if sub.plan == "pro":
            return Limits(
                settings.PRO_DAILY_REQUESTS,
                settings.PRO_DAILY_TOKENS
            )

        # Default FREE
        return Limits(
            settings.FREE_DAILY_REQUESTS,
            settings.FREE_DAILY_TOKENS
        )

    # =========================
    # ENSURE ROW EXISTS
    # =========================

    @staticmethod
    async def ensure_usage_row(db: AsyncSession, user_id, day: date) -> None:
        stmt = insert(UsageDaily).values(
            user_id=user_id,
            day=day,
            requests_used=0,
            tokens_used=0,
        ).on_conflict_do_nothing(
            index_elements=["user_id", "day"]
        )

        await db.execute(stmt)
        await db.commit()

    # =========================
    # CHECK LIMIT
    # =========================

    @staticmethod
    async def can_consume(
        db: AsyncSession,
        user_id,
        day: date,
        req_inc: int,
        token_inc: int
    ) -> tuple[bool, dict]:

        limits = await RateLimitService._get_limits_for_user(db, user_id)

        stmt = select(UsageDaily).where(
            UsageDaily.user_id == user_id,
            UsageDaily.day == day
        ).with_for_update()
        row = (await db.scalars(stmt)).first()

        if not row:
            await RateLimitService.ensure_usage_row(db, user_id, day)
            stmt = select(UsageDaily).where(
                UsageDaily.user_id == user_id,
                UsageDaily.day == day
            ).with_for_update()
            row = (await db.scalars(stmt)).first()

        current_requests = row.requests_used or 0
        current_tokens = row.tokens_used or 0

        next_requests = current_requests + req_inc
        next_tokens = current_tokens + token_inc

        ok = (
            next_requests <= limits.daily_requests and
            next_tokens <= limits.daily_tokens
        )

        meta = {
            "day": str(day),
            "requests_used": current_requests,
            "tokens_used": current_tokens,
            "daily_requests": limits.daily_requests,
            "daily_tokens": limits.daily_tokens,
            "next_requests_used": next_requests,
            "next_tokens_used": next_tokens,
        }

        return ok, meta

    # =========================
    # CONSUME (ATOMIC UPSERT)
    # =========================

    @staticmethod
    async def consume(
        db: AsyncSession,
        user_id,
        day: date,
        req_inc: int,
        token_inc: int
    ) -> dict:

        stmt = insert(UsageDaily).values(
            user_id=user_id,
            day=day,
            requests_used=req_inc,
            tokens_used=token_inc,
        ).on_conflict_do_update(
            index_elements=["user_id", "day"],
            set_={
                "requests_used": UsageDaily.requests_used + req_inc,
                "tokens_used": UsageDaily.tokens_used + token_inc,
            },
        ).returning(
            UsageDaily.requests_used,
            UsageDaily.tokens_used,
            UsageDaily.day,
        )

        result = (await db.execute(stmt)).first()
        await db.commit()

        return {
            "day": str(result.day),
            "requests_used": int(result.requests_used),
            "tokens_used": int(result.tokens_used),
        }
    
    @staticmethod
    async def get_or_create_today(db: AsyncSession, user_id: str) -> UsageDaily:
        today = date.today()
        stmt = select(UsageDaily).where(
            UsageDaily.user_id == user_id,
            UsageDaily.day == today
        )
        usage = (await db.scalars(stmt)).first()

        if not usage:
            usage = UsageDaily(user_id=user_id, day=today, requests_used=0, tokens_used=0)
            db.add(usage)
            await db.flush()

        return usage