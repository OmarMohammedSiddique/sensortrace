from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, File, Query, UploadFile
from sensortrace_engine.visualize import VISUALISATION_NOTICE
from sqlalchemy import func, select

from .. import schemas as s
from ..audit import audit
from ..config import get_settings
from ..deps import CurrentUser, Db, owned, rate_limit
from ..errors import ApiError, bad_request, conflict
from ..jobs import enqueue
from ..models import Device, Fingerprint, Job, ReferenceImage, Sensor, User
from ..services import (
    check_quota,
    file_url,
    ingest_upload,
    purge_device,
    purge_fingerprint,
    purge_reference,
    purge_sensor,
    read_upload,
    safe_filename,
    store_image,
)
from ..storage import get_storage

router = APIRouter(tags=["Cameras and sensors"])


def fp_out(fp: Fingerprint, sensor: Sensor) -> s.FingerprintOut:
    o = s.FingerprintOut.model_validate(fp)
    o.is_active = sensor.active_fingerprint_id == fp.id
    return o


def sensor_out(db: Db, sensor: Sensor) -> s.SensorOut:
    o = s.SensorOut.model_validate(sensor)
    o.reference_count = db.scalar(select(func.count()).select_from(ReferenceImage).where(ReferenceImage.sensor_id == sensor.id)) or 0
    if sensor.active_fingerprint_id:
        fp = db.get(Fingerprint, sensor.active_fingerprint_id)
        if fp is not None:
            o.active_fingerprint = fp_out(fp, sensor)
    d = sensor.device
    o.device_name, o.device_make, o.device_model = d.name, d.make, d.model
    o.pipeline_class, o.is_demo = d.pipeline_class, d.is_demo
    return o


def device_out(db: Db, d: Device) -> s.DeviceOut:
    o = s.DeviceOut.model_validate(d)
    o.sensors = [sensor_out(db, x) for x in sorted(d.sensors, key=lambda x: x.created_at)]
    return o


# ------------------------------------------------------------------ devices


@router.get("/devices", response_model=s.Page[s.DeviceOut])
def list_devices(
    user: CurrentUser,
    db: Db,
    limit: Annotated[int, Query(ge=1, le=200)] = 50,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> s.Page[s.DeviceOut]:
    q = select(Device).where(Device.user_id == user.id)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(Device.created_at.desc()).limit(limit).offset(offset))
    return s.Page(items=[device_out(db, d) for d in rows], total=total, limit=limit, offset=offset)


@router.post("/devices", response_model=s.DeviceOut, status_code=201)
def create_device(body: s.DeviceIn, user: CurrentUser, db: Db) -> s.DeviceOut:
    d = Device(user_id=user.id, **body.model_dump())
    db.add(d)
    db.flush()
    audit(db, user.id, "device.created", entity_type="device", entity_id=d.id, name=d.name)
    db.commit()
    return device_out(db, d)


@router.get("/devices/{device_id}", response_model=s.DeviceOut)
def get_device(device_id: uuid.UUID, user: CurrentUser, db: Db) -> s.DeviceOut:
    return device_out(db, owned(db, Device, device_id, user, "Device"))


@router.patch("/devices/{device_id}", response_model=s.DeviceOut)
def update_device(device_id: uuid.UUID, body: s.DevicePatch, user: CurrentUser, db: Db) -> s.DeviceOut:
    d = owned(db, Device, device_id, user, "Device")
    changes = body.model_dump(exclude_unset=True, exclude_none=True)
    for k, v in changes.items():
        setattr(d, k, v)
    audit(
        db,
        user.id,
        "device.updated",
        entity_type="device",
        entity_id=d.id,
        fields=sorted(changes),
    )
    db.commit()
    return device_out(db, d)


@router.delete("/devices/{device_id}", status_code=204)
def delete_device(device_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    d = owned(db, Device, device_id, user, "Device")
    audit(db, user.id, "device.deleted", entity_type="device", entity_id=d.id, name=d.name)
    purge_device(db, d)
    db.commit()


# ------------------------------------------------------------------ sensors


@router.post("/devices/{device_id}/sensors", response_model=s.SensorOut, status_code=201)
def create_sensor(device_id: uuid.UUID, body: s.SensorIn, user: CurrentUser, db: Db) -> s.SensorOut:
    d = owned(db, Device, device_id, user, "Device")
    sensor = Sensor(user_id=user.id, device_id=d.id, **body.model_dump())
    db.add(sensor)
    db.flush()
    audit(
        db,
        user.id,
        "sensor.created",
        entity_type="sensor",
        entity_id=sensor.id,
        device_id=str(d.id),
        name=sensor.name,
    )
    db.commit()
    return sensor_out(db, sensor)


@router.get("/sensors", response_model=s.Page[s.SensorOut])
def list_sensors(
    user: CurrentUser,
    db: Db,
    ready: bool | None = None,
    limit: Annotated[int, Query(ge=1, le=500)] = 200,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> s.Page[s.SensorOut]:
    q = select(Sensor).where(Sensor.user_id == user.id)
    if ready is True:
        q = q.where(Sensor.active_fingerprint_id.is_not(None))
    elif ready is False:
        q = q.where(Sensor.active_fingerprint_id.is_(None))
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(Sensor.created_at.desc()).limit(limit).offset(offset))
    return s.Page(items=[sensor_out(db, x) for x in rows], total=total, limit=limit, offset=offset)


@router.get("/sensors/{sensor_id}", response_model=s.SensorOut)
def get_sensor(sensor_id: uuid.UUID, user: CurrentUser, db: Db) -> s.SensorOut:
    return sensor_out(db, owned(db, Sensor, sensor_id, user, "Sensor"))


@router.patch("/sensors/{sensor_id}", response_model=s.SensorOut)
def update_sensor(sensor_id: uuid.UUID, body: s.SensorPatch, user: CurrentUser, db: Db) -> s.SensorOut:
    sensor = owned(db, Sensor, sensor_id, user, "Sensor")
    for k, v in body.model_dump(exclude_unset=True, exclude_none=True).items():
        setattr(sensor, k, v)
    audit(db, user.id, "sensor.updated", entity_type="sensor", entity_id=sensor.id)
    db.commit()
    return sensor_out(db, sensor)


@router.delete("/sensors/{sensor_id}", status_code=204)
def delete_sensor(sensor_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    sensor = owned(db, Sensor, sensor_id, user, "Sensor")
    audit(
        db,
        user.id,
        "sensor.deleted",
        entity_type="sensor",
        entity_id=sensor.id,
        name=sensor.name,
    )
    purge_sensor(db, sensor)
    db.commit()


# --------------------------------------------------------- reference images


def ref_out(r: ReferenceImage, user: User) -> s.ReferenceOut:
    o = s.ReferenceOut.model_validate(r)
    o.preview_url = file_url("derived", r.preview_key, user.id, "preview.jpg", "image/jpeg", inline=True)
    return o


@router.get("/sensors/{sensor_id}/references", response_model=s.Page[s.ReferenceOut])
def list_references(
    sensor_id: uuid.UUID,
    user: CurrentUser,
    db: Db,
    limit: Annotated[int, Query(ge=1, le=500)] = 100,
    offset: Annotated[int, Query(ge=0)] = 0,
) -> s.Page[s.ReferenceOut]:
    sensor = owned(db, Sensor, sensor_id, user, "Sensor")
    q = select(ReferenceImage).where(ReferenceImage.sensor_id == sensor.id)
    total = db.scalar(select(func.count()).select_from(q.subquery())) or 0
    rows = db.scalars(q.order_by(ReferenceImage.created_at, ReferenceImage.id).limit(limit).offset(offset))
    return s.Page(items=[ref_out(r, user) for r in rows], total=total, limit=limit, offset=offset)


@router.post("/sensors/{sensor_id}/references", response_model=s.UploadResponse)
async def upload_references(
    sensor_id: uuid.UUID,
    user: CurrentUser,
    db: Db,
    files: Annotated[list[UploadFile], File(description="JPEG or PNG reference images")],
) -> s.UploadResponse:
    """Upload reference images for a sensor. Each file is validated independently."""
    cfg = get_settings()
    sensor = owned(db, Sensor, sensor_id, user, "Sensor")
    if len(files) > cfg.max_files_per_request:
        raise bad_request("too_many_files", f"At most {cfg.max_files_per_request} files per request.")
    rate_limit(f"upload:{user.id}", cfg.rate_upload_per_hour, 3600)
    existing = db.scalar(select(func.count()).select_from(ReferenceImage).where(ReferenceImage.sensor_id == sensor.id)) or 0
    st = get_storage()
    results: list[s.UploadResult] = []
    for f in files:
        name = safe_filename(f.filename)
        try:
            if existing >= cfg.max_reference_images:
                raise ApiError(
                    400,
                    "too_many_references",
                    f"A sensor can hold at most {cfg.max_reference_images} reference images.",
                )
            data = await read_upload(f)
            img, q = ingest_upload(data, "reference")
            if db.scalar(
                select(ReferenceImage.id).where(
                    ReferenceImage.sensor_id == sensor.id,
                    ReferenceImage.sha256 == img.sha256,
                )
            ):
                raise ApiError(
                    409,
                    "duplicate",
                    "This file is already a reference image for this sensor.",
                )
            check_quota(db, user, len(data))
            key, pkey = store_image(st, user.id, data, img, "references")
            ref = ReferenceImage(
                user_id=user.id, sensor_id=sensor.id, filename=name, sha256=img.sha256, size_bytes=img.size_bytes,
                mime_type=img.mime_type, width=img.width, height=img.height, image_metadata=img.metadata,
                quality=q.to_dict(), object_key=key, preview_key=pkey,
            )  # fmt: skip
            db.add(ref)
            db.flush()
            audit(
                db,
                user.id,
                "reference.uploaded",
                entity_type="reference_image",
                entity_id=ref.id,
                sensor_id=str(sensor.id),
                sha256=img.sha256,
            )
            db.commit()
            existing += 1
            results.append(s.UploadResult(filename=name, accepted=True, id=ref.id, sha256=img.sha256,
                                          warnings=[fl.message for fl in q.flags if fl.severity != "info"]))  # fmt: skip
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


@router.delete("/references/{reference_id}", status_code=204)
def delete_reference(reference_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    ref = owned(db, ReferenceImage, reference_id, user, "Reference image")
    audit(
        db,
        user.id,
        "reference.deleted",
        entity_type="reference_image",
        entity_id=ref.id,
        sha256=ref.sha256,
    )
    purge_reference(db, ref)
    db.commit()


# ------------------------------------------------------------- fingerprints


def fp_detail(fp: Fingerprint, sensor: Sensor, user: User) -> s.FingerprintDetail:
    o = s.FingerprintDetail.model_validate(fp)
    o.is_active = sensor.active_fingerprint_id == fp.id
    o.visual_url = file_url("derived", fp.visual_key, user.id, "fingerprint.png", "image/png", inline=True)
    o.spectrum_url = file_url("derived", fp.spectrum_key, user.id, "spectrum.png", "image/png", inline=True)
    o.download_url = file_url(
        "derived",
        fp.object_key,
        user.id,
        f"fingerprint-v{fp.version}.npz",
        "application/octet-stream",
    )
    o.visualisation_notice = VISUALISATION_NOTICE
    return o


@router.post(
    "/sensors/{sensor_id}/fingerprints",
    response_model=s.FingerprintStarted,
    status_code=202,
)
def start_fingerprint(sensor_id: uuid.UUID, user: CurrentUser, db: Db) -> s.FingerprintStarted:
    """Start a background job that estimates a new fingerprint version from the sensor's reference images."""
    sensor = owned(db, Sensor, sensor_id, user, "Sensor")
    n = db.scalar(select(func.count()).select_from(ReferenceImage).where(ReferenceImage.sensor_id == sensor.id)) or 0
    if n < 2:
        raise bad_request(
            "insufficient_reference_images",
            "Upload at least 2 reference images first (30 or more are recommended).",
        )
    if db.scalar(
        select(Fingerprint.id).where(
            Fingerprint.sensor_id == sensor.id,
            Fingerprint.status.in_(("pending", "running")),
        )
    ):
        raise conflict(
            "fingerprint_in_progress",
            "A fingerprint is already being created for this sensor.",
        )
    version = (db.scalar(select(func.max(Fingerprint.version)).where(Fingerprint.sensor_id == sensor.id)) or 0) + 1
    fp = Fingerprint(user_id=user.id, sensor_id=sensor.id, version=version, status="pending")
    db.add(fp)
    db.flush()
    audit(
        db,
        user.id,
        "fingerprint.requested",
        entity_type="fingerprint",
        entity_id=fp.id,
        sensor_id=str(sensor.id),
        version=version,
        references=n,
    )
    try:
        job = enqueue(db, user, "fingerprint", "fingerprint", fp.id)
    except ApiError:
        db.rollback()
        raise
    db.refresh(fp)
    return s.FingerprintStarted(fingerprint=fp_out(fp, sensor), job=s.JobOut.model_validate(job))


@router.get("/sensors/{sensor_id}/fingerprints", response_model=list[s.FingerprintOut])
def list_fingerprints(sensor_id: uuid.UUID, user: CurrentUser, db: Db) -> list[s.FingerprintOut]:
    sensor = owned(db, Sensor, sensor_id, user, "Sensor")
    rows = db.scalars(select(Fingerprint).where(Fingerprint.sensor_id == sensor.id).order_by(Fingerprint.version.desc()))
    return [fp_out(f, sensor) for f in rows]


@router.get("/fingerprints/{fingerprint_id}", response_model=s.FingerprintDetail)
def get_fingerprint(fingerprint_id: uuid.UUID, user: CurrentUser, db: Db) -> s.FingerprintDetail:
    fp = owned(db, Fingerprint, fingerprint_id, user, "Fingerprint")
    return fp_detail(fp, fp.sensor, user)


@router.post("/fingerprints/{fingerprint_id}/activate", response_model=s.FingerprintDetail)
def activate_fingerprint(fingerprint_id: uuid.UUID, user: CurrentUser, db: Db) -> s.FingerprintDetail:
    fp = owned(db, Fingerprint, fingerprint_id, user, "Fingerprint")
    if fp.status != "ready":
        raise bad_request("fingerprint_not_ready", "Only a completed fingerprint can be made active.")
    fp.sensor.active_fingerprint_id = fp.id
    audit(
        db,
        user.id,
        "fingerprint.activated",
        entity_type="fingerprint",
        entity_id=fp.id,
        version=fp.version,
    )
    db.commit()
    return fp_detail(fp, fp.sensor, user)


@router.delete("/fingerprints/{fingerprint_id}", status_code=204)
def delete_fingerprint(fingerprint_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    fp = owned(db, Fingerprint, fingerprint_id, user, "Fingerprint")
    if fp.status in ("pending", "running"):
        job = db.scalar(select(Job).where(Job.target_id == fp.id, Job.status.in_(("queued", "running"))))
        if job is not None:
            raise conflict(
                "fingerprint_in_progress",
                "Cancel the running job before deleting this fingerprint.",
            )
    sensor = fp.sensor
    if sensor.active_fingerprint_id == fp.id:
        sensor.active_fingerprint_id = None
    audit(
        db,
        user.id,
        "fingerprint.deleted",
        entity_type="fingerprint",
        entity_id=fp.id,
        version=fp.version,
    )
    purge_fingerprint(db, fp)
    db.commit()
