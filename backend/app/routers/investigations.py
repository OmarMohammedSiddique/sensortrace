from __future__ import annotations

import json
import uuid
from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, File, Form, Query, UploadFile
from pydantic import ValidationError
from sqlalchemy import func, or_, select

from .. import schemas as s
from ..audit import audit
from ..config import get_settings
from ..deps import CurrentUser, Db, UploadSlot, owned, rate_limit
from ..errors import ApiError, bad_request
from ..models import Analysis, AuditLog, Evidence, Investigation, Note, User, utcnow
from ..services import (
    check_quota,
    file_url,
    ingest_upload,
    purge_evidence,
    purge_investigation,
    read_upload,
    run_heavy,
    safe_filename,
    store_image,
)
from ..storage import get_storage

router = APIRouter(tags=["Investigations and evidence"])


def inv_out(db: Db, inv: Investigation) -> s.InvestigationOut:
    o = s.InvestigationOut.model_validate(inv)
    o.evidence_count = db.scalar(select(func.count()).select_from(Evidence).where(Evidence.investigation_id == inv.id)) or 0
    o.analysis_count = db.scalar(select(func.count()).select_from(Analysis).where(Analysis.investigation_id == inv.id)) or 0
    o.note_count = db.scalar(select(func.count()).select_from(Note).where(Note.investigation_id == inv.id)) or 0
    return o


def ev_out(db: Db, ev: Evidence, user: User, *, with_duplicates: bool = False) -> s.EvidenceOut:
    o = s.EvidenceOut.model_validate(ev)
    ext = ".jpg" if ev.mime_type == "image/jpeg" else ".png"
    o.preview_url = file_url("derived", ev.preview_key, user.id, "preview.jpg", "image/jpeg", inline=True)
    # Originals are always served as attachments, never rendered inline.
    o.download_url = file_url(
        "evidence",
        ev.object_key,
        user.id,
        f"evidence-{ev.sha256[:12]}{ext}",
        ev.mime_type,
    )
    if with_duplicates:
        o.duplicate_of = list(
            db.scalars(
                select(Evidence.id).where(
                    Evidence.user_id == user.id,
                    Evidence.sha256 == ev.sha256,
                    Evidence.id != ev.id,
                )
            )
        )
    return o


# ------------------------------------------------------------ investigations


@router.get("/investigations", response_model=s.Page[s.InvestigationOut])
def list_investigations(user: CurrentUser, db: Db, status: s.InvestigationStatus | None = None, q: Annotated[str | None, Query(max_length=100)] = None,
                        limit: Annotated[int, Query(ge=1, le=200)] = 50, offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.InvestigationOut]:  # fmt: skip
    stmt = select(Investigation).where(Investigation.user_id == user.id)
    if status:
        stmt = stmt.where(Investigation.status == status)
    q = (q or "").replace("\x00", "")
    if q:
        like = f"%{q.replace('%', r'\%').replace('_', r'\_')}%"
        stmt = stmt.where(or_(Investigation.title.ilike(like), Investigation.reference.ilike(like)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Investigation.updated_at.desc()).limit(limit).offset(offset))
    return s.Page(items=[inv_out(db, i) for i in rows], total=total, limit=limit, offset=offset)


def _retention(days: int | None, user: User):
    if days is None:
        days = int(user.settings.get("default_retention_days") or 0)
    return utcnow() + timedelta(days=days) if days and days > 0 else None


@router.post("/investigations", response_model=s.InvestigationOut, status_code=201)
def create_investigation(body: s.InvestigationIn, user: CurrentUser, db: Db) -> s.InvestigationOut:
    inv = Investigation(user_id=user.id, title=body.title, reference=body.reference, description=body.description,
                        retention_until=_retention(body.retention_days, user))  # fmt: skip
    db.add(inv)
    db.flush()
    audit(
        db,
        user.id,
        "investigation.created",
        entity_type="investigation",
        entity_id=inv.id,
        investigation_id=inv.id,
        title=inv.title,
    )
    db.commit()
    return inv_out(db, inv)


@router.get("/investigations/{investigation_id}", response_model=s.InvestigationOut)
def get_investigation(investigation_id: uuid.UUID, user: CurrentUser, db: Db) -> s.InvestigationOut:
    return inv_out(db, owned(db, Investigation, investigation_id, user, "Investigation"))


@router.patch("/investigations/{investigation_id}", response_model=s.InvestigationOut)
def update_investigation(investigation_id: uuid.UUID, body: s.InvestigationPatch, user: CurrentUser, db: Db) -> s.InvestigationOut:
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    data = body.model_dump(exclude_unset=True)
    if "retention_days" in data:
        days = data.pop("retention_days")
        inv.retention_until = utcnow() + timedelta(days=days) if days else None
    for k, v in data.items():
        if v is not None:
            setattr(inv, k, v)
    inv.updated_at = utcnow()
    audit(db, user.id, "investigation.updated", entity_type="investigation", entity_id=inv.id, investigation_id=inv.id,
          fields=sorted(body.model_dump(exclude_unset=True)))  # fmt: skip
    db.commit()
    return inv_out(db, inv)


@router.delete("/investigations/{investigation_id}", status_code=204)
def delete_investigation(investigation_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    """Permanently delete an investigation with its evidence, analyses, notes and reports."""
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    audit(
        db,
        user.id,
        "investigation.deleted",
        entity_type="investigation",
        entity_id=inv.id,
        title=inv.title,
    )
    purge_investigation(db, inv)
    db.commit()


@router.get("/investigations/{investigation_id}/history", response_model=s.Page[s.AuditOut])
def investigation_history(investigation_id: uuid.UUID, user: CurrentUser, db: Db, limit: Annotated[int, Query(ge=1, le=200)] = 100,
                          offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.AuditOut]:  # fmt: skip
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    stmt = select(AuditLog).where(AuditLog.user_id == user.id, AuditLog.investigation_id == inv.id)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(AuditLog.id.desc()).limit(limit).offset(offset))
    return s.Page(
        items=[s.AuditOut.model_validate(r) for r in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


# --------------------------------------------------------------------- notes


@router.get("/investigations/{investigation_id}/notes", response_model=list[s.NoteOut])
def list_notes(investigation_id: uuid.UUID, user: CurrentUser, db: Db) -> list[Note]:
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    return list(db.scalars(select(Note).where(Note.investigation_id == inv.id).order_by(Note.created_at.desc())))


@router.post(
    "/investigations/{investigation_id}/notes",
    response_model=s.NoteOut,
    status_code=201,
)
def add_note(investigation_id: uuid.UUID, body: s.NoteIn, user: CurrentUser, db: Db) -> Note:
    inv = owned(db, Investigation, investigation_id, user, "Investigation")
    note = Note(user_id=user.id, investigation_id=inv.id, body=body.body)
    db.add(note)
    inv.updated_at = utcnow()
    db.flush()
    audit(
        db,
        user.id,
        "note.added",
        entity_type="note",
        entity_id=note.id,
        investigation_id=inv.id,
    )
    db.commit()
    return note


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    note = owned(db, Note, note_id, user, "Note")
    audit(
        db,
        user.id,
        "note.deleted",
        entity_type="note",
        entity_id=note.id,
        investigation_id=note.investigation_id,
    )
    db.delete(note)
    db.commit()


# ------------------------------------------------------------------ evidence


@router.get("/evidence", response_model=s.Page[s.EvidenceOut])
def list_evidence(user: CurrentUser, db: Db, investigation_id: uuid.UUID | None = None, unassigned: bool = False,
                  category: s.EvidenceCategory | None = None, limit: Annotated[int, Query(ge=1, le=200)] = 50,
                  offset: Annotated[int, Query(ge=0)] = 0) -> s.Page[s.EvidenceOut]:  # fmt: skip
    stmt = select(Evidence).where(Evidence.user_id == user.id)
    if investigation_id:
        stmt = stmt.where(Evidence.investigation_id == investigation_id)
    if unassigned:
        stmt = stmt.where(Evidence.investigation_id.is_(None))
    if category:
        stmt = stmt.where(Evidence.category == category)
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Evidence.created_at.desc(), Evidence.id).limit(limit).offset(offset))
    return s.Page(
        items=[ev_out(db, e, user) for e in rows],
        total=total,
        limit=limit,
        offset=offset,
    )


@router.post("/evidence", response_model=s.UploadResponse)
async def upload_evidence(user: CurrentUser, db: Db, _slot: UploadSlot, files: Annotated[list[UploadFile], File(description="JPEG or PNG images")],
                          investigation_id: Annotated[uuid.UUID | None, Form()] = None,
                          category: Annotated[s.EvidenceCategory, Form()] = "questioned",
                          acquisition: Annotated[str | None, Form(description="JSON object matching the Acquisition schema", max_length=8000)] = None,
                          ) -> s.UploadResponse:  # fmt: skip
    """Upload evidence images. Original bytes are stored unmodified and hashed with SHA-256."""
    cfg = get_settings()
    if len(files) > cfg.max_files_per_request:
        raise bad_request("too_many_files", f"At most {cfg.max_files_per_request} files per request.")
    rate_limit(f"upload:{user.id}", cfg.rate_upload_per_hour, 3600)
    inv = owned(db, Investigation, investigation_id, user, "Investigation") if investigation_id else None
    acq: dict = {}
    if acquisition:
        try:
            acq = s.Acquisition.model_validate(json.loads(acquisition)).model_dump()
        except (ValueError, ValidationError):
            raise bad_request(
                "invalid_acquisition",
                "The acquisition field must be a valid JSON object.",
            ) from None
    st = get_storage()
    results: list[s.UploadResult] = []
    for f in files:
        name = safe_filename(f.filename)
        try:
            data = await read_upload(f)
            img, q = await run_heavy(ingest_upload, data, "questioned")
            check_quota(db, user, len(data))
            key, pkey = await run_heavy(store_image, st, user.id, data, img, "evidence")
            ev = Evidence(
                user_id=user.id, investigation_id=inv.id if inv else None, filename=name, category=category, sha256=img.sha256,
                size_bytes=img.size_bytes, mime_type=img.mime_type, width=img.width, height=img.height, dhash=img.dhash,
                image_metadata=img.metadata, quality=q.to_dict(), acquisition=acq, object_key=key, preview_key=pkey,
                provenance={**img.provenance, "received_at": utcnow().isoformat(), "original_filename": name,
                            "exif_orientation": img.exif_orientation, "decode_notes": img.decode_notes},
            )  # fmt: skip
            db.add(ev)
            db.flush()
            dup = (
                db.scalar(
                    select(func.count())
                    .select_from(Evidence)
                    .where(
                        Evidence.user_id == user.id,
                        Evidence.sha256 == img.sha256,
                        Evidence.id != ev.id,
                    )
                )
                or 0
            )
            audit(db, user.id, "evidence.uploaded", entity_type="evidence", entity_id=ev.id, investigation_id=inv.id if inv else None,
                  sha256=img.sha256, size_bytes=img.size_bytes, filename=name)  # fmt: skip
            if inv:
                inv.updated_at = utcnow()
            db.commit()
            warnings = [fl.message for fl in q.flags if fl.severity != "info"]
            if dup:
                warnings.insert(
                    0,
                    f"Identical file content already exists in {dup} other evidence item(s).",
                )
            results.append(
                s.UploadResult(
                    filename=name,
                    accepted=True,
                    id=ev.id,
                    sha256=img.sha256,
                    warnings=warnings,
                )
            )
        except ApiError as exc:
            db.rollback()
            results.append(
                s.UploadResult(
                    filename=name,
                    accepted=False,
                    error=s.ErrorBody(code=exc.code, message=exc.message),
                )
            )
    ok = sum(1 for r in results if r.accepted)
    return s.UploadResponse(results=results, accepted=ok, rejected=len(results) - ok)


@router.get("/evidence/{evidence_id}", response_model=s.EvidenceOut)
def get_evidence(evidence_id: uuid.UUID, user: CurrentUser, db: Db) -> s.EvidenceOut:
    return ev_out(
        db,
        owned(db, Evidence, evidence_id, user, "Evidence"),
        user,
        with_duplicates=True,
    )


@router.patch("/evidence/{evidence_id}", response_model=s.EvidenceOut)
def update_evidence(evidence_id: uuid.UUID, body: s.EvidencePatch, user: CurrentUser, db: Db) -> s.EvidenceOut:
    ev = owned(db, Evidence, evidence_id, user, "Evidence")
    if body.category:
        ev.category = body.category
    if body.acquisition is not None:
        ev.acquisition = body.acquisition.model_dump()
    if body.detach:
        ev.investigation_id = None
    elif body.investigation_id:
        ev.investigation_id = owned(db, Investigation, body.investigation_id, user, "Investigation").id
    audit(db, user.id, "evidence.updated", entity_type="evidence", entity_id=ev.id, investigation_id=ev.investigation_id,
          fields=sorted(body.model_dump(exclude_unset=True)))  # fmt: skip
    db.commit()
    return ev_out(db, ev, user, with_duplicates=True)


@router.delete("/evidence/{evidence_id}", status_code=204)
def delete_evidence(evidence_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    """Permanently delete an evidence item, its stored bytes and every analysis of it."""
    ev = owned(db, Evidence, evidence_id, user, "Evidence")
    audit(
        db,
        user.id,
        "evidence.deleted",
        entity_type="evidence",
        entity_id=ev.id,
        investigation_id=ev.investigation_id,
        sha256=ev.sha256,
    )
    purge_evidence(db, ev)
    db.commit()
