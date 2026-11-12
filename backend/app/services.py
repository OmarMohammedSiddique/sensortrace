"""Shared operations: uploads, quotas, signed URLs and permanent deletion."""

from __future__ import annotations

import re
import unicodedata
import uuid
from typing import Any

from fastapi import UploadFile
from sensortrace_engine.errors import EngineError
from sensortrace_engine.ingest import (
    IngestedImage,
    IngestLimits,
    ingest_image,
    make_preview,
)
from sensortrace_engine.quality import QualityReport, assess_quality
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .config import get_settings
from .errors import ApiError
from .models import (
    Analysis,
    DataExport,
    Device,
    Evidence,
    Fingerprint,
    Investigation,
    ReferenceImage,
    Report,
    Sensor,
    User,
)
from .security import make_file_token
from .storage import Storage, get_storage


def safe_filename(name: str | None) -> str:
    """Display-only filename: no path components, control characters or markup-significant characters."""
    n = unicodedata.normalize("NFKC", name or "").replace("\\", "/").split("/")[-1]
    n = "".join(ch for ch in n if ch.isprintable())
    n = re.sub(r'[<>:"|?*\x00-\x1f]', "_", n).strip(" .")
    return (n or "upload")[:200]


def model_key(make: str, model: str) -> str | None:
    key = " ".join(f"{make} {model}".lower().split())
    return key or None


def limits() -> IngestLimits:
    s = get_settings()
    return IngestLimits(max_bytes=s.max_upload_bytes, max_pixels=s.max_image_pixels)


async def read_upload(file: UploadFile) -> bytes:
    """Read an upload, refusing anything over the size limit without buffering it all."""
    limit = get_settings().max_upload_bytes
    chunks, total = [], 0
    while chunk := await file.read(1024 * 1024):
        total += len(chunk)
        if total > limit:
            raise ApiError(
                413,
                "file_too_large",
                f"File exceeds the limit of {limit // (1024 * 1024)} MB.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


def ingest_upload(data: bytes, role: str) -> tuple[IngestedImage, QualityReport]:
    try:
        img = ingest_image(data, limits())
    except EngineError as exc:
        raise ApiError(422, exc.code, str(exc)) from None
    return img, assess_quality(img, role="reference" if role == "reference" else "questioned")


def storage_used(db: Session, user_id: uuid.UUID) -> dict[str, int]:
    def total(col: Any, model: Any) -> int:
        return int(db.scalar(select(func.coalesce(func.sum(col), 0)).where(model.user_id == user_id)) or 0)

    parts = {
        "evidence": total(Evidence.size_bytes, Evidence),
        "reference_images": total(ReferenceImage.size_bytes, ReferenceImage),
        "fingerprints": total(Fingerprint.size_bytes, Fingerprint),
        "reports": total(Report.size_bytes, Report),
        "exports": total(DataExport.size_bytes, DataExport),
    }
    parts["total"] = sum(parts.values())
    return parts


def quota(user: User) -> int:
    return user.storage_quota_bytes or get_settings().user_storage_quota_bytes


def check_quota(db: Session, user: User, add_bytes: int) -> None:
    if storage_used(db, user.id)["total"] + add_bytes > quota(user):
        raise ApiError(
            413,
            "quota_exceeded",
            "Storage quota exceeded. Delete data or contact an administrator.",
        )


def file_url(
    bucket: str,
    key: str | None,
    user_id: uuid.UUID,
    filename: str,
    content_type: str,
    *,
    inline: bool = False,
) -> str | None:
    if not key:
        return None
    tok = make_file_token(
        bucket=bucket,
        key=key,
        user_id=str(user_id),
        filename=filename,
        content_type=content_type,
        inline=inline,
    )
    return f"/api/v1/files/{tok}"


def new_key(user_id: uuid.UUID, kind: str, ext: str = "") -> str:
    return f"{user_id}/{kind}/{uuid.uuid4().hex}{ext}"


def store_image(st: Storage, user_id: uuid.UUID, data: bytes, img: IngestedImage, kind: str) -> tuple[str, str]:
    """Store original bytes (evidence bucket) and a metadata-free preview (derived bucket)."""
    key = new_key(user_id, kind, ".jpg" if img.format == "jpeg" else ".png")
    st.put("evidence", key, data, img.mime_type)
    pkey = new_key(user_id, "previews", ".jpg")
    st.put(
        "derived",
        pkey,
        make_preview(img.pixels, img.exif_orientation, 640),
        "image/jpeg",
    )
    return key, pkey


# ----------------------------------------------------------- permanent deletion


def _rm(st: Storage, bucket: str, key: str | None) -> None:
    if key:
        st.delete(bucket, key)


def _drop_fingerprint_objects(fp: Fingerprint) -> None:
    st = get_storage()
    for k in (fp.object_key, fp.visual_key, fp.spectrum_key):
        _rm(st, "derived", k)


def _drop_reference_objects(ref: ReferenceImage) -> None:
    st = get_storage()
    _rm(st, "evidence", ref.object_key)
    _rm(st, "derived", ref.preview_key)


def purge_fingerprint(db: Session, fp: Fingerprint) -> None:
    _drop_fingerprint_objects(fp)
    db.delete(fp)


def purge_reference(db: Session, ref: ReferenceImage) -> None:
    _drop_reference_objects(ref)
    db.delete(ref)


def purge_sensor(db: Session, sensor: Sensor) -> None:
    # Rows are removed by the ORM cascade from the sensor; only stored objects need explicit removal.
    for fp in sensor.fingerprints:
        _drop_fingerprint_objects(fp)
    for ref in sensor.references:
        _drop_reference_objects(ref)
    db.delete(sensor)


def purge_device(db: Session, device: Device) -> None:
    for s in device.sensors:
        for fp in s.fingerprints:
            _drop_fingerprint_objects(fp)
        for ref in s.references:
            _drop_reference_objects(ref)
    db.delete(device)


def purge_report(db: Session, rep: Report) -> None:
    _rm(get_storage(), "results", rep.object_key)
    db.delete(rep)


def purge_analysis(db: Session, an: Analysis) -> None:
    _rm(get_storage(), "derived", an.residual_visual_key)
    for rep in db.scalars(select(Report).where(Report.analysis_id == an.id)):
        purge_report(db, rep)
    db.delete(an)


def purge_evidence(db: Session, ev: Evidence) -> None:
    st = get_storage()
    for an in db.scalars(select(Analysis).where(Analysis.evidence_id == ev.id)):
        purge_analysis(db, an)
    _rm(st, "evidence", ev.object_key)
    _rm(st, "derived", ev.preview_key)
    db.delete(ev)


def purge_investigation(db: Session, inv: Investigation) -> None:
    """Delete an investigation with all its evidence, analyses, notes and reports."""
    for ev in db.scalars(select(Evidence).where(Evidence.investigation_id == inv.id)):
        purge_evidence(db, ev)
    for an in db.scalars(select(Analysis).where(Analysis.investigation_id == inv.id)):
        purge_analysis(db, an)
    for rep in db.scalars(select(Report).where(Report.investigation_id == inv.id)):
        purge_report(db, rep)
    db.delete(inv)


def purge_user(db: Session, user: User) -> dict[str, int]:
    """Remove every stored object and row belonging to ``user``. Irreversible."""
    st = get_storage()
    uid = str(user.id)
    removed = {b: st.delete_prefix(b, uid) for b in ("evidence", "derived", "results")}
    db.delete(user)  # rows cascade via foreign keys
    return removed
