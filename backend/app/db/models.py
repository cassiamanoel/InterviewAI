import uuid
from datetime import date
from sqlalchemy import (
    Column, String, Text, ForeignKey,
    DateTime, Boolean, Integer, Date,
    UniqueConstraint
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship
from app.db.session import Base


# =========================
# USERS
# =========================

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email = Column(String, unique=True, index=True, nullable=False)
    password = Column(String, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    cvs = relationship("CV", back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    sessions = relationship("InterviewSession", back_populates="user", cascade="all, delete-orphan", lazy="selectin")
    subscription = relationship("Subscription", back_populates="user", uselist=False, cascade="all, delete-orphan", lazy="selectin")
    usage = relationship("UsageDaily", back_populates="user", cascade="all, delete-orphan", lazy="selectin")


# =========================
# CVS
# =========================

class CV(Base):
    __tablename__ = "cvs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    raw_text = Column(Text, nullable=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", back_populates="cvs", lazy="selectin")
    sessions = relationship("InterviewSession", back_populates="cv", lazy="selectin")


# =========================
# INTERVIEW SESSION
# =========================

class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    cv_id = Column(UUID(as_uuid=True), ForeignKey("cvs.id", ondelete="SET NULL"), nullable=True, index=True)

    language = Column(String(10), default="pt")
    role = Column(String(80))
    level = Column(String(30))
    status = Column(String(20), default="active")

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    closed_at = Column(DateTime(timezone=True))

    user = relationship("User", back_populates="sessions", lazy="selectin")
    cv = relationship("CV", back_populates="sessions", lazy="selectin")
    messages = relationship("InterviewMessage", back_populates="session", cascade="all, delete-orphan", lazy="selectin")


# =========================
# INTERVIEW MESSAGE
# =========================

class InterviewMessage(Base):
    __tablename__ = "interview_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    session_id = Column(UUID(as_uuid=True), ForeignKey("interview_sessions.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    role = Column(String(10), nullable=False)  # user | assistant | system
    content = Column(Text, nullable=False)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)

    session = relationship("InterviewSession", back_populates="messages", lazy="selectin")


# =========================
# SUBSCRIPTION
# =========================

class Subscription(Base):
    __tablename__ = "subscriptions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)

    plan = Column(String(20), default="free")  # free | pro
    status = Column(String(20), default="active")

    stripe_customer_id = Column(String(120))
    stripe_subscription_id = Column(String(120))
    current_period_end = Column(DateTime(timezone=True))

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    user = relationship("User", back_populates="subscription", lazy="selectin")


# =========================
# USAGE DAILY (Rate Limit)
# =========================

class UsageDaily(Base):
    __tablename__ = "usage_daily"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)

    day = Column(Date, nullable=False, default=date.today)

    requests_used = Column(Integer, nullable=False, default=0)
    tokens_used = Column(Integer, nullable=False, default=0)

    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())

    __table_args__ = (
        UniqueConstraint("user_id", "day", name="uq_usage_daily_user_day"),
    )

    user = relationship("User", back_populates="usage", lazy="selectin")