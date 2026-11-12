from __future__ import annotations

import hashlib
import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sqlalchemy import func, select

from .. import schemas as s
from ..audit import audit
from ..deps import CurrentUser, Db, owned
from ..errors import bad_request
from ..models import (
    Analysis,
    AuditLog,
    Evidence,
    Investigation,
    Note,
    Report,
    User,
    utcnow,
)
from ..reports import build_analysis_report, build_investigation_report
from ..services import check_quota, file_url, new_key, purge_report
from ..storage import get_storage

router = APIRouter(tags=["Reports"])


def _row(obj) -> dict:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns}


def rep_out(r: Report, user: User) -> s.ReportOut:
    o = s.ReportOut.model_validate(r)
    o.download_url = file_url(
        "results",
        r.object_key,
        user.id,
        f"sensortrace-report-{str(r.id)[:8]}.pdf",
        "application/pdf",
    )
    return o


def _store(
    db: Db,
    user: User,
    pdf: bytes,
    rid: uuid.UUID,
    title: str,
    analysis_id=None,
    investigation_id=None,
) -> Report:
    check_quota(db, user, len(pdf))
    key = new_key(user.id, "reports", ".pdf")
    get_storage().put("results", key, pdf, "application/pdf")
    rep = Report(id=rid, user_id=user.id, analysis_id=analysis_id, investigation_id=investigation_id, title=title, object_key=key,
                 sha256=hashlib.sha256(pdf).hexdigest(), size_bytes=len(pdf))  # fmt: skip
    db.add(rep)
    audit(
        db,
        user.id,
        "report.generated",
        entity_type="report",
        entity_id=rid,
        investigation_id=investigation_id,
        sha256=rep.sha256,
    )
    db.commit()
    return rep


@router.post("/analyses/{analysis_id}/reports", response_model=s.ReportOut, status_code=201)
def create_analysis_report(analysis_id: uuid.UUID, user: CurrentUser, db: Db) -> s.ReportOut:
    """Generate a PDF report for a completed comparison."""
    an = owned(db, Analysis, analysis_id, user, "Analysis")
    if an.status != "completed":
        raise bad_request(
            "analysis_not_completed",
            "A report can only be generated for a completed analysis.",
        )
    st = get_storage()
    ev = an.evidence
    inv = db.get(Investigation, an.investigation_id) if an.investigation_id else None

    def load(bucket: str, key: str | None) -> bytes | None:
        try:
            return st.get(bucket, key) if key else None
        except KeyError:
            return None

    rid = uuid.uuid4()
    pdf = build_analysis_report(
        report_id=str(rid), generated_at=utcnow(), generated_by=user.display_name or user.email, analysis=_row(an), evidence=_row(ev),
        candidates=[_row(c) for c in an.candidates], investigation=_row(inv) if inv else None,
        preview=load("derived", ev.preview_key), residual_visual=load("derived", an.residual_visual_key), demo=ev.is_demo,
    )  # fmt: skip
    rep = _store(
        db,
        user,
        pdf,
        rid,
        f"Comparison report: {ev.filename}",
        analysis_id=an.id,
        investigation_id=an.investigation_id,
    )
    return rep_out(rep, user)


@router.post(
    "/investigations/{investigation_id}/reports",
    response_model=s.ReportOut,
    status_code=201,
)
def create_investigation_report(investigation_id: uuid.UUID, user: CurrentUser, db: Db) -> s.ReportOut:
    """Generate a PDF summary of an investigation: evidence hashes, comparisons, notes and history."""
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    evidence = [_row(e) for e in db.scalars(select(Evidence).where(Evidence.investigation_id == inv.id).order_by(Evidence.created_at))]
    analyses = []
    for a in db.scalars(select(Analysis).where(Analysis.investigation_id == inv.id).order_by(Analysis.created_at)):
        d = _row(a)
        d["evidence_filename"] = a.evidence.filename
        d["candidates"] = [_row(c) for c in a.candidates]
        analyses.append(d)
    notes = [_row(n) for n in db.scalars(select(Note).where(Note.investigation_id == inv.id).order_by(Note.created_at))]
    history = [
        _row(h) for h in db.scalars(select(AuditLog).where(AuditLog.user_id == user.id, AuditLog.investigation_id == inv.id).order_by(AuditLog.id).limit(300))
    ]
    rid = uuid.uuid4()
    pdf = build_investigation_report(report_id=str(rid), generated_at=utcnow(), generated_by=user.display_name or user.email,
                                     investigation=_row(inv), evidence=evidence, analyses=analyses, notes=notes, history=history, demo=inv.is_demo)  # fmt: skip
    rep = _store(
        db,
        user,
        pdf,
        rid,
        f"Investigation report: {inv.title}",
        investigation_id=inv.id,
    )
    return rep_out(rep, user)


@router.get("/reports", response_model=s.Page[s.ReportOut])
def list_reports(user: CurrentUser, db: Db, analysis_id: uuid.UUID | None = None, investigation_id: uuid.UUID | None = None,
                 limit: Annotated[int, Query(ge=1, le=200)] = 50, offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.ReportOut]:  # fmt: skip
    stmt = select(Report).where(Report.user_id == user.id)
    if analysis_id:
        stmt = stmt.where(Report.analysis_id == analysis_id)
    if investigation_id:
        stmt = stmt.where(Report.investigation_id == investigation_id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Report.created_at.desc(), Report.id).limit(limit).offset(offset))
    return s.Page(items=[rep_out(r, user) for r in rows], total=total, limit=limit, offset=offset)


@router.get("/reports/{report_id}", response_model=s.ReportOut)
def get_report(report_id: uuid.UUID, user: CurrentUser, db: Db) -> s.ReportOut:
    return rep_out(owned(db, Report, report_id, user, "Report"), user)


@router.delete("/reports/{report_id}", status_code=204)
def delete_report(report_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    rep = owned(db, Report, report_id, user, "Report")
    audit(db, user.id, "report.deleted", entity_type="report", entity_id=rep.id)
    purge_report(db, rep)
    db.commit()
