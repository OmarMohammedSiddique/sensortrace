"""Persistent data model. Every user-owned row carries ``user_id`` for object-level authorisation."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .db import Base


def utcnow() -> datetime:
    return datetime.now(UTC)


def _uuid() -> uuid.UUID:
    return uuid.uuid4()


PK = UUID(as_uuid=True)
TS = DateTime(timezone=True)


class User(Base):
    __tablename__ = "users"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(320), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    display_name: Mapped[str] = mapped_column(String(120), default="")
    role: Mapped[str] = mapped_column(String(16), default="user")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    settings: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    storage_quota_bytes: Mapped[int | None] = mapped_column(BigInteger, nullable=True)
    onboarding_completed: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class AuthSession(Base):
    __tablename__ = "sessions"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    csrf_token: Mapped[str] = mapped_column(String(64))
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    last_seen_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    expires_at: Mapped[datetime] = mapped_column(TS)
    revoked_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    user_agent: Mapped[str | None] = mapped_column(String(300), nullable=True)


class ApiToken(Base):
    __tablename__ = "api_tokens"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120))
    prefix: Mapped[str] = mapped_column(String(16))
    token_hash: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    last_used_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    expires_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    revoked_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class Device(Base):
    """A physical camera or phone. It owns one or more sensors."""

    __tablename__ = "devices"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    make: Mapped[str] = mapped_column(String(120), default="")
    model: Mapped[str] = mapped_column(String(120), default="")
    firmware: Mapped[str] = mapped_column(String(120), default="")
    serial_number: Mapped[str] = mapped_column(String(120), default="")
    device_type: Mapped[str] = mapped_column(String(24), default="smartphone")
    #: conventional | computational | unknown  (drives same-model artefact handling)
    pipeline_class: Mapped[str] = mapped_column(String(24), default="unknown")
    notes: Mapped[str] = mapped_column(Text, default="")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    sensors: Mapped[list[Sensor]] = relationship(back_populates="device", cascade="all, delete-orphan")


class Sensor(Base):
    """One imaging sensor (and capture configuration) of a device."""

    __tablename__ = "sensors"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    device_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("devices.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(160))
    position: Mapped[str] = mapped_column(String(40), default="main")
    notes: Mapped[str] = mapped_column(Text, default="")
    active_fingerprint_id: Mapped[uuid.UUID | None] = mapped_column(PK, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    device: Mapped[Device] = relationship(back_populates="sensors")
    references: Mapped[list[ReferenceImage]] = relationship(back_populates="sensor", cascade="all, delete-orphan")
    fingerprints: Mapped[list[Fingerprint]] = relationship(back_populates="sensor", cascade="all, delete-orphan")


class ReferenceImage(Base):
    __tablename__ = "reference_images"
    __table_args__ = (UniqueConstraint("sensor_id", "sha256", name="uq_reference_sensor_sha"),)
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    sensor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    mime_type: Mapped[str] = mapped_column(String(40))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    image_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    quality: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    object_key: Mapped[str] = mapped_column(String(300))
    preview_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    sensor: Mapped[Sensor] = relationship(back_populates="references")


class Fingerprint(Base):
    __tablename__ = "fingerprints"
    __table_args__ = (UniqueConstraint("sensor_id", "version", name="uq_fingerprint_sensor_version"),)
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    sensor_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sensors.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    object_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    visual_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    spectrum_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    digest: Mapped[str | None] = mapped_column(String(64), nullable=True)
    width: Mapped[int | None] = mapped_column(Integer, nullable=True)
    height: Mapped[int | None] = mapped_column(Integer, nullable=True)
    n_images: Mapped[int] = mapped_column(Integer, default=0)
    algorithm_version: Mapped[str] = mapped_column(String(64), default="")
    diagnostics: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    outcomes: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    sensor: Mapped[Sensor] = relationship(back_populates="fingerprints")


class Investigation(Base):
    __tablename__ = "investigations"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(200))
    reference: Mapped[str] = mapped_column(String(120), default="")
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(String(16), default="open")
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    retention_until: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(TS, default=utcnow, onupdate=utcnow)
    evidence: Mapped[list[Evidence]] = relationship(back_populates="investigation")
    notes: Mapped[list[Note]] = relationship(back_populates="investigation", cascade="all, delete-orphan")


class Evidence(Base):
    __tablename__ = "evidence"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="SET NULL"), index=True, nullable=True)
    filename: Mapped[str] = mapped_column(String(255))
    category: Mapped[str] = mapped_column(String(24), default="questioned")
    sha256: Mapped[str] = mapped_column(String(64), index=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    mime_type: Mapped[str] = mapped_column(String(40))
    width: Mapped[int] = mapped_column(Integer)
    height: Mapped[int] = mapped_column(Integer)
    dhash: Mapped[str] = mapped_column(String(16), default="")
    image_metadata: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    quality: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    acquisition: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    object_key: Mapped[str] = mapped_column(String(300))
    preview_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    investigation: Mapped[Investigation | None] = relationship(back_populates="evidence")


class Note(Base):
    __tablename__ = "notes"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    investigation_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), index=True)
    body: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    investigation: Mapped[Investigation] = relationship(back_populates="notes")


class Analysis(Base):
    """A comparison of one questioned image against one or more sensor fingerprints."""

    __tablename__ = "analyses"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="SET NULL"), index=True, nullable=True)
    evidence_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("evidence.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    policy: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    summary: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    quality: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    provenance: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    residual_visual_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    requested_fingerprint_ids: Mapped[list[Any]] = mapped_column(JSONB, default=list)
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    completed_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    evidence: Mapped[Evidence] = relationship()
    candidates: Mapped[list[AnalysisCandidate]] = relationship(
        back_populates="analysis",
        cascade="all, delete-orphan",
        order_by="AnalysisCandidate.rank",
    )


class AnalysisCandidate(Base):
    __tablename__ = "analysis_candidates"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    analysis_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), index=True)
    #: Sensor and fingerprint may later be deleted; the snapshot keeps the result interpretable.
    sensor_id: Mapped[uuid.UUID | None] = mapped_column(PK, nullable=True)
    fingerprint_id: Mapped[uuid.UUID | None] = mapped_column(PK, nullable=True)
    snapshot: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    rank: Mapped[int] = mapped_column(Integer, default=0)
    verdict: Mapped[str] = mapped_column(String(40))
    pce: Mapped[float | None] = mapped_column(Float, nullable=True)
    effective_pce: Mapped[float | None] = mapped_column(Float, nullable=True)
    ncc: Mapped[float | None] = mapped_column(Float, nullable=True)
    measurement: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    decision: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    experimental: Mapped[dict[str, Any] | None] = mapped_column(JSONB, nullable=True)
    analysis: Mapped[Analysis] = relationship(back_populates="candidates")


class Job(Base):
    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_user_status", "user_id", "status"),)
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    status: Mapped[str] = mapped_column(String(16), default="queued")
    stage: Mapped[str] = mapped_column(String(40), default="")
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    message: Mapped[str] = mapped_column(Text, default="")
    error: Mapped[str | None] = mapped_column(Text, nullable=True)
    target_type: Mapped[str] = mapped_column(String(24), default="")
    target_id: Mapped[uuid.UUID | None] = mapped_column(PK, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    cancel_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)
    started_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    finished_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)


class Report(Base):
    __tablename__ = "reports"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    analysis_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("analyses.id", ondelete="CASCADE"), nullable=True)
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("investigations.id", ondelete="CASCADE"), nullable=True)
    title: Mapped[str] = mapped_column(String(240))
    object_key: Mapped[str] = mapped_column(String(300))
    sha256: Mapped[str] = mapped_column(String(64))
    size_bytes: Mapped[int] = mapped_column(BigInteger)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class DataExport(Base):
    __tablename__ = "data_exports"
    id: Mapped[uuid.UUID] = mapped_column(PK, primary_key=True, default=_uuid)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    scope: Mapped[str] = mapped_column(String(24), default="account")
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(PK, nullable=True)
    status: Mapped[str] = mapped_column(String(16), default="pending")
    object_key: Mapped[str | None] = mapped_column(String(300), nullable=True)
    sha256: Mapped[str | None] = mapped_column(String(64), nullable=True)
    size_bytes: Mapped[int] = mapped_column(BigInteger, default=0)
    expires_at: Mapped[datetime | None] = mapped_column(TS, nullable=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow)


class AuditLog(Base):
    """Append-only activity record. ``user_id`` is kept (not a foreign key) after account deletion."""

    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(BigInteger, primary_key=True, autoincrement=True)
    user_id: Mapped[uuid.UUID | None] = mapped_column(PK, index=True, nullable=True)
    action: Mapped[str] = mapped_column(String(64), index=True)
    entity_type: Mapped[str] = mapped_column(String(32), default="")
    entity_id: Mapped[str] = mapped_column(String(64), default="")
    investigation_id: Mapped[uuid.UUID | None] = mapped_column(PK, index=True, nullable=True)
    ip: Mapped[str | None] = mapped_column(String(64), nullable=True)
    details: Mapped[dict[str, Any]] = mapped_column(JSONB, default=dict)
    created_at: Mapped[datetime] = mapped_column(TS, default=utcnow, index=True)
