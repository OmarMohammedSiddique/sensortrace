from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Query
from sensortrace_engine.visualize import VISUALISATION_NOTICE
from sqlalchemy import func, select

from .. import schemas as s
from ..audit import audit
from ..config import get_settings
from ..deps import CurrentUser, Db, owned
from ..errors import ApiError, bad_request, conflict
from ..jobs import enqueue, request_cancel
from ..models import Analysis, Evidence, Fingerprint, Investigation, Job, Sensor, User
from ..policies import get_policy, list_policies
from ..services import file_url, purge_analysis
from .investigations import ev_out

router = APIRouter(tags=["Comparisons"])
jobs_router = APIRouter(tags=["Background jobs"])


def an_out(db: Db, an: Analysis, user: User, cls: type[s.AnalysisOut] = s.AnalysisOut) -> s.AnalysisOut:
    o = cls.model_validate(an)
    ev = an.evidence
    o.evidence_filename, o.evidence_sha256, o.is_demo = (
        ev.filename,
        ev.sha256,
        ev.is_demo,
    )
    o.evidence_preview_url = file_url("derived", ev.preview_key, user.id, "preview.jpg", "image/jpeg", inline=True)
    o.candidate_count = len(an.candidates) or len(an.requested_fingerprint_ids)
    if an.candidates:
        top = an.candidates[0]
        o.top_verdict = top.verdict
        o.top_label = f"{top.snapshot.get('device_name', '')} / {top.snapshot.get('sensor_name', '')}"
    o.job_id = db.scalar(select(Job.id).where(Job.target_id == an.id, Job.target_type == "analysis").order_by(Job.created_at.desc()).limit(1))
    return o


@router.get("/policies", response_model=list[s.PolicyOut])
def policies(user: CurrentUser) -> list[s.PolicyOut]:
    """Decision policies. Only policies marked ``calibrated`` carry measured error rates, and only within their stated scope."""
    return [s.PolicyOut(**p.to_dict()) for p in list_policies()]


@router.post("/analyses", response_model=s.AnalysisStarted, status_code=202)
def start_analyses(body: s.AnalysisIn, user: CurrentUser, db: Db) -> s.AnalysisStarted:
    """Compare each questioned image with the selected sensor fingerprints. One job is queued per image."""
    cfg = get_settings()
    policy = get_policy(body.policy_id)
    if policy is None:
        raise bad_request("unknown_policy", "Unknown decision policy.")
    inv = owned(db, Investigation, body.investigation_id, user, "Investigation") if body.investigation_id else None
    fps: dict[uuid.UUID, Fingerprint] = {}
    for sid in body.sensor_ids:
        sensor = owned(db, Sensor, sid, user, "Sensor")
        if not sensor.active_fingerprint_id:
            raise bad_request("sensor_not_ready", f"Sensor '{sensor.name}' has no fingerprint yet.")
        fp = db.get(Fingerprint, sensor.active_fingerprint_id)
        if fp is not None:
            fps[fp.id] = fp
    for fid in body.fingerprint_ids:
        fps[fid] = owned(db, Fingerprint, fid, user, "Fingerprint")
    if not fps:
        raise bad_request(
            "no_candidates",
            "Select at least one sensor or fingerprint to compare against.",
        )
    if any(f.status != "ready" for f in fps.values()):
        raise bad_request("fingerprint_not_ready", "Every selected fingerprint must be ready.")
    if len(fps) > cfg.max_candidates_per_analysis:
        raise bad_request(
            "too_many_candidates",
            f"At most {cfg.max_candidates_per_analysis} candidates per analysis.",
        )
    evidence = [owned(db, Evidence, eid, user, "Evidence") for eid in dict.fromkeys(body.evidence_ids)]

    analyses, jobs = [], []
    for ev in evidence:
        an = Analysis(
            user_id=user.id, evidence_id=ev.id, investigation_id=inv.id if inv else ev.investigation_id, status="pending",
            policy={"policy_id": policy.policy_id}, requested_fingerprint_ids=[str(i) for i in fps],
        )  # fmt: skip
        db.add(an)
        db.flush()
        audit(db, user.id, "analysis.requested", entity_type="analysis", entity_id=an.id, investigation_id=an.investigation_id,
              evidence_id=str(ev.id), candidates=len(fps), policy_id=policy.policy_id)  # fmt: skip
        try:
            job = enqueue(db, user, "analysis", "analysis", an.id)
        except ApiError:
            db.rollback()
            if not analyses:
                raise
            break
        db.refresh(an)
        analyses.append(an_out(db, an, user))
        jobs.append(s.JobOut.model_validate(job))
    return s.AnalysisStarted(analyses=analyses, jobs=jobs)


@router.get("/analyses", response_model=s.Page[s.AnalysisOut])
def list_analyses(user: CurrentUser, db: Db, investigation_id: uuid.UUID | None = None, evidence_id: uuid.UUID | None = None,
                  unassigned: bool = False, limit: Annotated[int, Query(ge=1, le=200)] = 50,
                  offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.AnalysisOut]:  # fmt: skip
    stmt = select(Analysis).where(Analysis.user_id == user.id)
    if investigation_id:
        stmt = stmt.where(Analysis.investigation_id == investigation_id)
    if evidence_id:
        stmt = stmt.where(Analysis.evidence_id == evidence_id)
    if unassigned:
        stmt = stmt.where(Analysis.investigation_id.is_(None))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Analysis.created_at.desc(), Analysis.id).limit(limit).offset(offset))
    return s.Page(
        items=[an_out(db, a, user) for a in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.get("/analyses/{analysis_id}", response_model=s.AnalysisDetail)
def get_analysis(analysis_id: uuid.UUID, user: CurrentUser, db: Db) -> s.AnalysisOut:
    an = owned(db, Analysis, analysis_id, user, "Analysis")
    o = an_out(db, an, user, s.AnalysisDetail)
    assert isinstance(o, s.AnalysisDetail)
    o.residual_visual_url = file_url(
        "derived",
        an.residual_visual_key,
        user.id,
        "residual.png",
        "image/png",
        inline=True,
    )
    o.visualisation_notice = VISUALISATION_NOTICE
    o.evidence = ev_out(db, an.evidence, user)
    return o


@router.patch("/analyses/{analysis_id}", response_model=s.AnalysisOut)
def update_analysis(analysis_id: uuid.UUID, body: s.AnalysisPatch, user: CurrentUser, db: Db) -> s.AnalysisOut:
    """Save an analysis (and its evidence) into an investigation, or detach it."""
    an = owned(db, Analysis, analysis_id, user, "Analysis")
    if body.detach:
        an.investigation_id = None
    elif body.investigation_id:
        inv = owned(db, Investigation, body.investigation_id, user, "Investigation")
        an.investigation_id = inv.id
        if an.evidence.investigation_id is None:
            an.evidence.investigation_id = inv.id
        audit(
            db,
            user.id,
            "analysis.saved_to_investigation",
            entity_type="analysis",
            entity_id=an.id,
            investigation_id=inv.id,
        )
    db.commit()
    return an_out(db, an, user)


@router.delete("/analyses/{analysis_id}", status_code=204)
def delete_analysis(analysis_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    an = owned(db, Analysis, analysis_id, user, "Analysis")
    if an.status in ("pending", "running") and db.scalar(select(Job.id).where(Job.target_id == an.id, Job.status.in_(("queued", "running")))):
        raise conflict(
            "analysis_in_progress",
            "Cancel the running job before deleting this analysis.",
        )
    audit(
        db,
        user.id,
        "analysis.deleted",
        entity_type="analysis",
        entity_id=an.id,
        investigation_id=an.investigation_id,
    )
    purge_analysis(db, an)
    db.commit()


# ---------------------------------------------------------------------- jobs


@jobs_router.get("/jobs", response_model=s.Page[s.JobOut])
def list_jobs(user: CurrentUser, db: Db, active: bool | None = None, limit: Annotated[int, Query(ge=1, le=200)] = 50,
              offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.JobOut]:  # fmt: skip
    stmt = select(Job).where(Job.user_id == user.id)
    if active is True:
        stmt = stmt.where(Job.status.in_(("queued", "running")))
    elif active is False:
        stmt = stmt.where(Job.status.not_in(("queued", "running")))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Job.created_at.desc(), Job.id).limit(limit).offset(offset))
    return s.Page(
        items=[s.JobOut.model_validate(j) for j in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@jobs_router.get("/jobs/{job_id}", response_model=s.JobOut)
def get_job(job_id: uuid.UUID, user: CurrentUser, db: Db) -> Job:
    return owned(db, Job, job_id, user, "Job")


@jobs_router.post("/jobs/{job_id}/cancel", response_model=s.JobOut)
def cancel_job(job_id: uuid.UUID, user: CurrentUser, db: Db) -> Job:
    """Request cancellation. Queued jobs stop immediately; running jobs stop at the next checkpoint."""
    job = owned(db, Job, job_id, user, "Job")
    if job.status not in ("queued", "running"):
        raise conflict("job_finished", "This job has already finished.")
    request_cancel(db, job)
    audit(db, user.id, "job.cancel_requested", entity_type="job", entity_id=job.id)
    db.commit()
    db.refresh(job)
    return job
