from __future__ import annotations

import uuid
from typing import Annotated, Any

from fastapi import APIRouter, Query, Request, Response
from sensortrace_engine.version import (
    ALGORITHM_VERSION,
    DECISION_POLICY_VERSION,
    ENGINE_VERSION,
    library_versions,
)
from sqlalchemy import func, select

from .. import demo
from .. import schemas as s
from ..audit import audit
from ..config import get_settings
from ..deps import CurrentAuth, CurrentUser, Db, client_ip, owned, rate_limit
from ..errors import ApiError
from ..jobs import enqueue
from ..models import (
    Analysis,
    AuditLog,
    DataExport,
    Device,
    Evidence,
    Fingerprint,
    Investigation,
    Job,
    Report,
    Sensor,
    User,
)
from ..security import verify_password
from ..services import file_url, purge_user, quota, storage_used
from ..storage import get_storage
from .analyses import an_out
from .investigations import inv_out

router = APIRouter(tags=["Account, data export and deletion"])
admin_router = APIRouter(prefix="/admin", tags=["Administration"])


def _counts(db: Db, user: User) -> dict[str, int]:
    def n(model: Any) -> int:
        return db.scalar(select(func.count()).select_from(model).where(model.user_id == user.id)) or 0

    return {"investigations": n(Investigation), "evidence": n(Evidence), "devices": n(Device), "sensors": n(Sensor),
            "fingerprints": n(Fingerprint), "analyses": n(Analysis), "reports": n(Report), "jobs": n(Job)}  # fmt: skip


@router.get("/dashboard", response_model=s.Dashboard)
def dashboard(user: CurrentUser, db: Db) -> s.Dashboard:
    recent_an = db.scalars(select(Analysis).where(Analysis.user_id == user.id).order_by(Analysis.created_at.desc()).limit(6))
    recent_inv = db.scalars(select(Investigation).where(Investigation.user_id == user.id).order_by(Investigation.updated_at.desc()).limit(5))
    jobs = db.scalars(select(Job).where(Job.user_id == user.id, Job.status.in_(("queued", "running"))).order_by(Job.created_at.desc()).limit(10))
    activity = db.scalars(select(AuditLog).where(AuditLog.user_id == user.id).order_by(AuditLog.id.desc()).limit(12))
    ready = db.scalar(select(func.count()).select_from(Sensor).where(Sensor.user_id == user.id, Sensor.active_fingerprint_id.is_not(None))) or 0
    return s.Dashboard(
        counts=_counts(db, user), storage=storage_used(db, user.id), quota_bytes=quota(user),
        recent_analyses=[an_out(db, a, user) for a in recent_an], recent_investigations=[inv_out(db, i) for i in recent_inv],
        active_jobs=[s.JobOut.model_validate(j) for j in jobs], recent_activity=[s.AuditOut.model_validate(a) for a in activity],
        sensors_ready=ready, onboarding_completed=user.onboarding_completed, has_demo_data=demo.has_demo(db, user),
    )  # fmt: skip


@router.get("/account/usage", response_model=s.Usage)
def usage(user: CurrentUser, db: Db) -> s.Usage:
    return s.Usage(
        storage=storage_used(db, user.id),
        quota_bytes=quota(user),
        counts=_counts(db, user),
    )


@router.get("/account/audit", response_model=s.Page[s.AuditOut])
def audit_history(user: CurrentUser, db: Db, action: Annotated[str | None, Query(max_length=64)] = None,
                  limit: Annotated[int, Query(ge=1, le=200)] = 50, offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.AuditOut]:  # fmt: skip
    stmt = select(AuditLog).where(AuditLog.user_id == user.id)
    if action:
        stmt = stmt.where(AuditLog.action.startswith(action, autoescape=True))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return s.Page(
        items=[s.AuditOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


def export_out(ex: DataExport, user: User) -> s.ExportOut:
    o = s.ExportOut.model_validate(ex)
    if ex.status == "ready":
        o.download_url = file_url(
            "results",
            ex.object_key,
            user.id,
            f"sensortrace-export-{str(ex.id)[:8]}.zip",
            "application/zip",
        )
    return o


def _start_export(db: Db, user: User, scope: str, investigation_id: uuid.UUID | None) -> s.ExportStarted:
    rate_limit(f"export:{user.id}", 10, 3600)
    ex = DataExport(user_id=user.id, scope=scope, investigation_id=investigation_id)
    db.add(ex)
    db.flush()
    audit(
        db,
        user.id,
        "export.requested",
        entity_type="export",
        entity_id=ex.id,
        investigation_id=investigation_id,
        scope=scope,
    )
    job = enqueue(db, user, "export", "export", ex.id)
    db.refresh(ex)
    return s.ExportStarted(export=export_out(ex, user), job=s.JobOut.model_validate(job))


@router.post("/account/export", response_model=s.ExportStarted, status_code=202)
def export_account(user: CurrentUser, db: Db) -> s.ExportStarted:
    """Start a job that packages all of your records and original files into a ZIP archive (link valid 7 days)."""
    return _start_export(db, user, "account", None)


@router.post(
    "/investigations/{investigation_id}/export",
    response_model=s.ExportStarted,
    status_code=202,
    tags=["Investigations and evidence"],
)
def export_investigation(investigation_id: uuid.UUID, user: CurrentUser, db: Db) -> s.ExportStarted:
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    return _start_export(db, user, "investigation", inv.id)


@router.get("/account/exports", response_model=list[s.ExportOut])
def list_exports(user: CurrentUser, db: Db) -> list[s.ExportOut]:
    rows = db.scalars(select(DataExport).where(DataExport.user_id == user.id).order_by(DataExport.created_at.desc()).limit(50))
    return [export_out(e, user) for e in rows]


@router.delete("/account/exports/{export_id}", status_code=204)
def delete_export(export_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    ex = owned(db, DataExport, export_id, user, "Export")
    if ex.object_key:
        get_storage().delete("results", ex.object_key)
    db.delete(ex)
    db.commit()


@router.delete("/account", status_code=204)
def delete_account(
    body: s.DeleteAccountIn,
    auth: CurrentAuth,
    request: Request,
    response: Response,
    db: Db,
) -> None:
    """Permanently delete the account and every file and record that belongs to it. This cannot be undone."""
    if auth.kind != "session":
        raise ApiError(403, "session_required", "Account deletion requires an interactive session.")
    rate_limit(
        f"auth-ip:{client_ip(request)}",
        get_settings().rate_auth_per_15min,
        900,
        fail_closed=True,
    )
    if not verify_password(auth.user.password_hash, body.password):
        raise ApiError(403, "invalid_credentials", "Password is incorrect.")
    uid = auth.user.id
    removed = purge_user(db, auth.user)
    # The audit trail keeps only the fact of deletion, detached from any personal data.
    for row in db.scalars(select(AuditLog).where(AuditLog.user_id == uid)):
        db.delete(row)
    audit(
        db,
        None,
        "account.deleted",
        entity_type="user",
        ip=None,
        objects_removed=sum(removed.values()),
    )
    db.commit()
    response.delete_cookie(get_settings().session_cookie, path="/")


# ---------------------------------------------------------------------- demo


@router.post("/demo", status_code=201, tags=["Onboarding"])
def create_demo(user: CurrentUser, db: Db) -> dict[str, Any]:
    """Create clearly labelled synthetic demo data: two simulated cameras and three questioned images."""
    if demo.has_demo(db, user):
        raise ApiError(
            409,
            "demo_exists",
            "Demo data already exists. Remove it first to create it again.",
        )
    return demo.seed_demo(db, user)


@router.delete("/demo", status_code=204, tags=["Onboarding"])
def delete_demo(user: CurrentUser, db: Db) -> None:
    demo.remove_demo(db, user)


# --------------------------------------------------------------------- admin


def _admin(user: User) -> None:
    if user.role != "admin":
        raise ApiError(403, "forbidden", "Administrator role required.")


@admin_router.get("/config")
def processing_config(user: CurrentUser) -> dict[str, Any]:
    """Effective processing configuration and limits (read-only; set through environment variables)."""
    _admin(user)
    c = get_settings()
    return {
        "environment": c.environment, "storage_backend": c.storage_backend, "registration_open": c.allow_registration,
        "versions": {"engine": ENGINE_VERSION, "algorithm": ALGORITHM_VERSION, "decision_policy": DECISION_POLICY_VERSION, "libraries": library_versions()},
        "limits": {k: getattr(c, k) for k in (
            "max_upload_bytes", "max_request_bytes", "max_image_pixels", "max_files_per_request", "max_reference_images", "max_candidates_per_analysis",
            "user_storage_quota_bytes", "max_active_jobs_per_user", "file_token_seconds", "job_timeout_seconds", "session_hours",
            "rate_auth_per_15min", "rate_api_per_minute", "rate_upload_per_hour", "worker_memory_limit_mb", "default_retention_days")},
    }  # fmt: skip


@admin_router.get("/stats")
def system_stats(user: CurrentUser, db: Db) -> dict[str, Any]:
    """Aggregate system usage. Never exposes other users' evidence, fingerprints or results."""
    _admin(user)
    by_status = dict(db.execute(select(Job.status, func.count()).group_by(Job.status)).all())
    return {
        "users": db.scalar(select(func.count()).select_from(User)) or 0,
        "jobs_by_status": by_status,
        "evidence_bytes": int(db.scalar(select(func.coalesce(func.sum(Evidence.size_bytes), 0))) or 0),
        "analyses": db.scalar(select(func.count()).select_from(Analysis)) or 0,
    }
