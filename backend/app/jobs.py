"""Background jobs: fingerprint estimation, comparisons and data exports.

Execution model
---------------
* Jobs run in RQ workers. RQ forks a fresh *work-horse* process per job, so a
  crash, memory blow-up or decoder fault in one job cannot take down the worker
  or leak state into another user's job. The worker has no HTTP surface.
* The ``jobs`` table is the source of truth for status, progress and
  cancellation; Redis only carries the queue.
* Engine errors (bad input, insufficient images) fail the job immediately with
  a user-readable message. Unexpected errors (database, storage) are retried
  with back-off, then fail with a generic message; details go to the log only.
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import time
import uuid
import zipfile
from datetime import timedelta
from typing import Any

from sensortrace_engine import visualize
from sensortrace_engine.enrol import ReferenceInput, enrol
from sensortrace_engine.errors import CancelledError, EngineError
from sensortrace_engine.fingerprint import Fingerprint as EngineFingerprint
from sensortrace_engine.pipeline import Candidate, analyse_questioned
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from . import models as m
from .audit import audit
from .config import get_settings
from .db import session_scope
from .errors import ApiError
from .policies import get_policy
from .services import limits, model_key, new_key
from .storage import get_storage

log = logging.getLogger("sensortrace.jobs")

QUEUE_NAME = "sensortrace"
MAX_ATTEMPTS = 3
ACTIVE = ("queued", "running")


# ------------------------------------------------------------------ enqueue


def enqueue(db: Session, user: m.User, kind: str, target_type: str, target_id: uuid.UUID) -> m.Job:
    """Create a job row and queue it. Commits the session."""
    s = get_settings()
    active = db.scalar(select(func.count()).select_from(m.Job).where(m.Job.user_id == user.id, m.Job.status.in_(ACTIVE)))
    if (active or 0) >= s.max_active_jobs_per_user:
        raise ApiError(
            429,
            "too_many_jobs",
            "Too many jobs are already queued or running. Wait for them to finish.",
        )
    job = m.Job(
        user_id=user.id,
        kind=kind,
        target_type=target_type,
        target_id=target_id,
        stage="queued",
    )
    db.add(job)
    db.commit()
    if s.jobs_inline:
        execute(str(job.id))
        db.refresh(job)
    else:
        from rq import Queue, Retry

        from .deps import get_redis

        Queue(QUEUE_NAME, connection=get_redis()).enqueue(
            execute,
            str(job.id),
            job_id=str(job.id),
            job_timeout=s.job_timeout_seconds,
            result_ttl=0,
            failure_ttl=86400,
            retry=Retry(max=MAX_ATTEMPTS - 1, interval=[10, 30]),
        )
    return job


def request_cancel(db: Session, job: m.Job) -> None:
    if job.status == "queued":
        job.status, job.stage, job.finished_at = "cancelled", "cancelled", m.utcnow()
        _mark_target_failed(db, job, "Cancelled before it started.", status="cancelled")
    elif job.status == "running":
        job.cancel_requested = True
    db.commit()


# ----------------------------------------------------------------- progress


class _Reporter:
    """Throttled progress writer and cancellation probe using short-lived sessions."""

    def __init__(self, job_id: uuid.UUID, stages: dict[str, tuple[float, float]]) -> None:
        self.job_id, self.stages = job_id, stages
        self._last_write = 0.0
        self._last_check = 0.0
        self._cancel = False

    def progress(self, stage: str, done: int, total: int) -> None:
        now = time.monotonic()
        if now - self._last_write < 0.5 and done < total:
            return
        self._last_write = now
        lo, hi = self.stages.get(stage, (0.0, 1.0))
        frac = lo + (hi - lo) * (done / total if total else 1.0)
        with session_scope() as db:
            job = db.get(m.Job, self.job_id)
            if job is not None:
                job.stage, job.progress = stage, round(min(frac, 0.999), 4)
                job.message = f"{done} of {total}"

    def cancelled(self) -> bool:
        now = time.monotonic()
        if self._cancel or now - self._last_check < 0.5:
            return self._cancel
        self._last_check = now
        with session_scope() as db:
            job = db.get(m.Job, self.job_id)
            self._cancel = bool(job is None or job.cancel_requested)
        return self._cancel


def _limit_memory() -> None:
    mb = get_settings().worker_memory_limit_mb
    if mb <= 0:
        return
    try:
        import resource

        resource.setrlimit(resource.RLIMIT_AS, (mb * 1024 * 1024, mb * 1024 * 1024))
    except Exception:  # not supported on this platform
        log.warning("could not apply worker memory limit")


def _mark_target_failed(db: Session, job: m.Job, message: str, status: str = "failed") -> None:
    if job.target_id is None:
        return
    model = {
        "fingerprint": m.Fingerprint,
        "analysis": m.Analysis,
        "export": m.DataExport,
    }.get(job.target_type)
    target: Any = db.get(model, job.target_id) if model else None
    if target is not None and target.status in ("pending", "running"):
        target.status = status
        if hasattr(target, "error"):
            target.error = message


# ------------------------------------------------------------------ execute


def execute(job_id: str) -> None:
    """Entry point run by the worker (or inline in tests)."""
    jid = uuid.UUID(job_id)
    with session_scope() as db:
        job = db.get(m.Job, jid)
        if job is None or job.status not in ACTIVE:
            return
        if job.cancel_requested:
            job.status, job.stage, job.finished_at = (
                "cancelled",
                "cancelled",
                m.utcnow(),
            )
            _mark_target_failed(db, job, "Cancelled.", status="cancelled")
            return
        job.status, job.stage, job.started_at = "running", "starting", m.utcnow()
        job.attempts += 1
        kind, attempts = job.kind, job.attempts
    _limit_memory()
    handler = HANDLERS[kind]
    try:
        handler(jid)
    except CancelledError:
        _finish(jid, "cancelled", "Cancelled by user.", target_status="cancelled")
    except EngineError as exc:
        _finish(jid, "failed", str(exc))
    except MemoryError:
        _finish(jid, "failed", "The job exceeded its memory limit.")
    except Exception:
        log.exception("job %s failed (attempt %d)", job_id, attempts)
        if attempts < MAX_ATTEMPTS and not get_settings().jobs_inline:
            with session_scope() as db:
                job = db.get(m.Job, jid)
                if job is not None:
                    job.status, job.stage = "queued", "retrying"
                    job.message = f"Attempt {attempts} failed; retrying."
            raise
        _finish(jid, "failed", "An internal error occurred while processing this job.")
    else:
        _finish(jid, "succeeded", "")


def _finish(jid: uuid.UUID, status: str, message: str, target_status: str = "failed") -> None:
    with session_scope() as db:
        job = db.get(m.Job, jid)
        if job is None:
            return
        job.status, job.stage, job.finished_at = status, status, m.utcnow()
        if status == "succeeded":
            job.progress, job.message = 1.0, ""
        else:
            job.error = message
            _mark_target_failed(db, job, message, status=target_status)
        audit(db, job.user_id, f"job.{status}", entity_type="job", entity_id=job.id, kind=job.kind,
              target_type=job.target_type, target_id=str(job.target_id))  # fmt: skip


# ----------------------------------------------------------------- handlers


def _run_fingerprint(jid: uuid.UUID) -> None:
    st = get_storage()
    with session_scope() as db:
        job = db.get(m.Job, jid)
        assert job is not None
        fp = db.get(m.Fingerprint, job.target_id)
        if fp is None:
            raise EngineError("The fingerprint record no longer exists.", code="target_missing")
        fp.status = "running"
        fp_id, sensor_id, user_id = fp.id, fp.sensor_id, fp.user_id
        refs = [(str(r.id), r.object_key) for r in db.scalars(
            select(m.ReferenceImage).where(m.ReferenceImage.sensor_id == sensor_id).order_by(m.ReferenceImage.created_at, m.ReferenceImage.id)
        )]  # fmt: skip

    rep = _Reporter(
        jid,
        {
            "screening": (0.0, 0.2),
            "consistency": (0.2, 0.4),
            "estimating": (0.4, 0.95),
            "finalising": (0.95, 0.98),
        },
    )
    inputs = [ReferenceInput(rid, (lambda k=key: st.get("evidence", k))) for rid, key in refs]
    result = enrol(inputs, limits=limits(), progress=rep.progress, should_cancel=rep.cancelled)
    efp = result.fingerprint
    assert efp is not None

    blob = efp.to_bytes()
    key = new_key(user_id, "fingerprints", ".npz")
    vkey = new_key(user_id, "fingerprint-visuals", ".png")
    skey = new_key(user_id, "fingerprint-visuals", ".png")
    st.put("derived", key, blob, "application/octet-stream")
    st.put("derived", vkey, visualize.render_noise(efp.k), "image/png")
    st.put("derived", skey, visualize.render_spectrum(efp.k), "image/png")
    diagnostics = dict(efp.diagnostics)
    diagnostics["spectrum"] = visualize.spectrum_diagnostics(efp.k)
    diagnostics["libraries"] = efp.libraries
    diagnostics["sigma0"] = efp.sigma0

    with session_scope() as db:
        fp = db.get(m.Fingerprint, fp_id)
        if fp is None:  # sensor deleted while the job ran
            for k in (key, vkey, skey):
                st.delete("derived", k)
            return
        fp.status, fp.object_key, fp.visual_key, fp.spectrum_key = (
            "ready",
            key,
            vkey,
            skey,
        )
        fp.size_bytes, fp.digest = len(blob), efp.digest()
        fp.height, fp.width = efp.shape
        fp.n_images, fp.algorithm_version = efp.n_images, efp.algorithm_version
        fp.diagnostics, fp.outcomes = (
            diagnostics,
            [o.to_dict() for o in result.outcomes],
        )
        sensor = db.get(m.Sensor, sensor_id)
        if sensor is not None:
            sensor.active_fingerprint_id = fp.id
        audit(db, user_id, "fingerprint.created", entity_type="fingerprint", entity_id=fp.id,
              sensor_id=str(sensor_id), version=fp.version, n_images=fp.n_images, digest=fp.digest)  # fmt: skip


def _run_analysis(jid: uuid.UUID) -> None:
    st = get_storage()
    with session_scope() as db:
        job = db.get(m.Job, jid)
        assert job is not None
        an = db.get(m.Analysis, job.target_id)
        if an is None:
            raise EngineError("The analysis record no longer exists.", code="target_missing")
        an.status = "running"
        an_id, user_id, inv_id = an.id, an.user_id, an.investigation_id
        ev_key = an.evidence.object_key
        policy = get_policy(an.policy.get("policy_id"))
        if policy is None:
            raise EngineError(
                "The selected decision policy is no longer available.",
                code="policy_missing",
            )
        specs = []
        for fid in an.requested_fingerprint_ids:
            fp = db.get(m.Fingerprint, uuid.UUID(fid))
            if fp is None or fp.user_id != user_id or fp.status != "ready" or not fp.object_key:
                continue
            sensor, device = fp.sensor, fp.sensor.device
            specs.append({
                "fingerprint_id": str(fp.id), "object_key": fp.object_key, "sensor_id": str(sensor.id),
                "device_id": str(device.id), "device_class": device.pipeline_class,
                "model_key": model_key(device.make, device.model),
                "snapshot": {
                    "sensor_name": sensor.name, "device_name": device.name, "make": device.make, "model": device.model,
                    "firmware": device.firmware, "serial_number": device.serial_number, "pipeline_class": device.pipeline_class,
                    "fingerprint_version": fp.version, "fingerprint_digest": fp.digest, "n_images": fp.n_images,
                    "fingerprint_width": fp.width, "fingerprint_height": fp.height,
                    "algorithm_version": fp.algorithm_version, "is_demo": device.is_demo,
                    "split_half_pce": (fp.diagnostics.get("split_half") or {}).get("pce"),
                },
            })  # fmt: skip
    if not specs:
        raise EngineError("None of the selected fingerprints is available.", code="no_candidates")

    rep = _Reporter(jid, {"loading": (0.0, 0.3), "comparing": (0.3, 0.95)})
    candidates = []
    for i, sp in enumerate(specs):
        if rep.cancelled():
            raise CancelledError("analysis was cancelled")
        efp = EngineFingerprint.from_bytes(st.get("derived", sp["object_key"]))
        candidates.append(Candidate(sp["fingerprint_id"], efp, label=f"{sp['snapshot']['device_name']} / {sp['snapshot']['sensor_name']}",
                                    device_id=sp["device_id"], model_key=sp["model_key"], device_class=sp["device_class"]))  # fmt: skip
        rep.progress("loading", i + 1, len(specs))
    if rep.cancelled():
        raise CancelledError("analysis was cancelled")
    rep.progress("comparing", 0, 1)
    result = analyse_questioned(st.get("evidence", ev_key), candidates, policy=policy, limits=limits())
    vkey = new_key(user_id, "residual-visuals", ".png")
    st.put("derived", vkey, visualize.render_noise(result.residual.w), "image/png")
    by_id = {sp["fingerprint_id"]: sp for sp in specs}
    full = result.to_dict()

    with session_scope() as db:
        an = db.get(m.Analysis, an_id)
        if an is None:
            st.delete("derived", vkey)
            return
        for c in result.candidates:
            sp = by_id[c.candidate_id]
            d = c.to_dict(include_surface=True)
            an.candidates.append(m.AnalysisCandidate(
                sensor_id=uuid.UUID(sp["sensor_id"]), fingerprint_id=uuid.UUID(sp["fingerprint_id"]), snapshot=sp["snapshot"],
                rank=c.rank, verdict=c.decision.verdict.value, pce=c.measurement.pce, effective_pce=c.decision.effective_pce,
                ncc=c.measurement.ncc, measurement=d["measurement"], decision=d["decision"], experimental=d["experimental"],
            ))  # fmt: skip
        an.status, an.completed_at = "completed", m.utcnow()
        an.summary, an.quality, an.provenance = (
            full["summary"],
            full["quality"],
            full["provenance"],
        )
        an.policy, an.residual_visual_key = policy.to_dict(), vkey
        audit(db, user_id, "analysis.completed", entity_type="analysis", entity_id=an.id, investigation_id=inv_id,
              candidates=len(result.candidates), verdicts=full["summary"]["counts"])  # fmt: skip


def _json_default(o: Any) -> Any:
    return str(o)


def _row(obj: Any, exclude: tuple[str, ...] = ()) -> dict[str, Any]:
    return {c.name: getattr(obj, c.name) for c in obj.__table__.columns if c.name not in exclude}


def _run_export(jid: uuid.UUID) -> None:
    """Build a ZIP with the user's records (JSON) and original files."""
    st = get_storage()
    buf = io.BytesIO()
    rep = _Reporter(jid, {"collecting": (0.0, 0.9)})
    with session_scope() as db:
        job = db.get(m.Job, jid)
        assert job is not None
        ex = db.get(m.DataExport, job.target_id)
        if ex is None:
            raise EngineError("The export record no longer exists.", code="target_missing")
        ex.status = "running"
        uid, ex_id, inv_id = ex.user_id, ex.id, ex.investigation_id
        user = db.get(m.User, uid)
        assert user is not None
        hide = (
            "object_key",
            "preview_key",
            "visual_key",
            "spectrum_key",
            "residual_visual_key",
            "password_hash",
            "token_hash",
            "csrf_token",
        )
        data: dict[str, Any] = {
            "exported_at": m.utcnow().isoformat(),
            "scope": ex.scope,
        }
        files: list[tuple[str, str, str]] = []
        inv_filter = [m.Investigation.id == inv_id] if inv_id else []
        ev_filter = [m.Evidence.investigation_id == inv_id] if inv_id else []
        an_filter = [m.Analysis.investigation_id == inv_id] if inv_id else []
        data["investigations"] = []
        for inv in db.scalars(select(m.Investigation).where(m.Investigation.user_id == uid, *inv_filter)):
            d = _row(inv)
            d["notes"] = [_row(n) for n in inv.notes]
            data["investigations"].append(d)
        data["evidence"] = []
        for ev in db.scalars(select(m.Evidence).where(m.Evidence.user_id == uid, *ev_filter)):
            data["evidence"].append(_row(ev, hide))
            files.append(
                (
                    "evidence",
                    ev.object_key,
                    f"evidence/{ev.id}_{ev.sha256[:12]}{'.jpg' if ev.mime_type == 'image/jpeg' else '.png'}",
                )
            )
        data["analyses"] = []
        for an in db.scalars(select(m.Analysis).where(m.Analysis.user_id == uid, *an_filter)):
            d = _row(an, hide)
            d["candidates"] = [_row(c) for c in an.candidates]
            data["analyses"].append(d)
        rep_filter = [m.Report.investigation_id == inv_id] if inv_id else []
        data["reports"] = []
        for r in db.scalars(select(m.Report).where(m.Report.user_id == uid, *rep_filter)):
            data["reports"].append(_row(r, hide))
            files.append(("results", r.object_key, f"reports/{r.id}.pdf"))
        if not inv_id:
            data["account"] = _row(user, hide)
            data["devices"] = []
            for dev in db.scalars(select(m.Device).where(m.Device.user_id == uid)):
                d = _row(dev)
                d["sensors"] = []
                for s in dev.sensors:
                    sd = _row(s)
                    sd["fingerprints"] = [_row(f, hide) for f in s.fingerprints]
                    sd["reference_images"] = [_row(r, hide) for r in s.references]
                    d["sensors"].append(sd)
                    for r in s.references:
                        files.append(
                            (
                                "evidence",
                                r.object_key,
                                f"reference_images/{s.id}/{r.id}_{r.sha256[:12]}{'.jpg' if r.mime_type == 'image/jpeg' else '.png'}",
                            )
                        )
                    for f in s.fingerprints:
                        if f.object_key:
                            files.append(
                                (
                                    "derived",
                                    f.object_key,
                                    f"fingerprints/{s.id}/v{f.version}_{(f.digest or '')[:12]}.npz",
                                )
                            )
                data["devices"].append(d)
            data["audit_log"] = [_row(a) for a in db.scalars(select(m.AuditLog).where(m.AuditLog.user_id == uid).order_by(m.AuditLog.id))]

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.json", json.dumps(data, indent=2, default=_json_default))
        z.writestr("README.txt", "SensorTrace data export.\n\ndata.json holds your records. Original files are stored unmodified;\n"
                   "verify them against the sha256 values in data.json.\n")  # fmt: skip
        for i, (bucket, key, name) in enumerate(files):
            if rep.cancelled():
                raise CancelledError("export was cancelled")
            try:
                z.writestr(
                    zipfile.ZipInfo(name),
                    st.get(bucket, key),
                    compress_type=zipfile.ZIP_STORED,
                )
            except KeyError:
                log.warning("export: object missing for %s", name)
            rep.progress("collecting", i + 1, len(files))
    blob = buf.getvalue()
    key = new_key(uid, "exports", ".zip")
    st.put("results", key, blob, "application/zip")
    with session_scope() as db:
        ex = db.get(m.DataExport, ex_id)
        if ex is None:
            st.delete("results", key)
            return
        ex.status, ex.object_key, ex.size_bytes = "ready", key, len(blob)
        ex.sha256 = hashlib.sha256(blob).hexdigest()
        ex.expires_at = m.utcnow() + timedelta(days=7)
        audit(
            db,
            uid,
            "export.created",
            entity_type="export",
            entity_id=ex.id,
            size_bytes=len(blob),
            scope=ex.scope,
        )


HANDLERS = {
    "fingerprint": _run_fingerprint,
    "analysis": _run_analysis,
    "export": _run_export,
}


# ------------------------------------------------------------- maintenance


def purge_expired() -> dict[str, int]:
    """Delete investigations past their retention date, expired exports and expired sessions."""
    from .services import purge_investigation

    st = get_storage()
    out = {"investigations": 0, "exports": 0, "sessions": 0}
    now = m.utcnow()
    with session_scope() as db:
        for inv in db.scalars(
            select(m.Investigation).where(
                m.Investigation.retention_until.is_not(None),
                m.Investigation.retention_until < now,
            )
        ):
            audit(
                db,
                inv.user_id,
                "investigation.retention_purged",
                entity_type="investigation",
                entity_id=inv.id,
            )
            purge_investigation(db, inv)
            out["investigations"] += 1
        for ex in db.scalars(select(m.DataExport).where(m.DataExport.expires_at.is_not(None), m.DataExport.expires_at < now)):
            if ex.object_key:
                st.delete("results", ex.object_key)
            db.delete(ex)
            out["exports"] += 1
        for s in db.scalars(select(m.AuthSession).where(m.AuthSession.expires_at < now - timedelta(days=1))):
            db.delete(s)
            out["sessions"] += 1
    return out
