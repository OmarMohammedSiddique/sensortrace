from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Response
from sensortrace_engine.version import (
    ALGORITHM_VERSION,
    DECISION_POLICY_VERSION,
    ENGINE_VERSION,
    library_versions,
)
from sqlalchemy import text

from .. import schemas as s
from ..config import get_settings
from ..db import get_engine
from ..deps import get_redis
from ..storage import get_storage

router = APIRouter(tags=["Service"])

REFERENCE_GUIDANCE = [
    {
        "title": "Use one camera, one lens, one mode",
        "body": "Take every reference image with the same lens at its native 1x setting, the same resolution and aspect ratio, and the standard photo mode. Each lens of a multi-camera phone is a different sensor and needs its own entry.",
    },
    {
        "title": "Photograph something bright, even and featureless",
        "body": "An out-of-focus overcast sky, a white wall or a sheet of paper under even light works best. Scene detail leaks into the fingerprint; flat scenes need roughly half as many images as natural photos.",
    },
    {
        "title": "Expose brightly, but do not clip",
        "body": "The sensor pattern scales with brightness, so dark images contain little of it and clipped (pure white) areas contain none. Aim for a light grey image with no blown-out regions.",
    },
    {
        "title": "Collect 30 or more images",
        "body": "More images average away random noise. At least 30 flat images are recommended; 50 or more if they are ordinary photographs. Two is the technical minimum and produces a weak fingerprint.",
    },
    {
        "title": "Turn off zoom, HDR, portrait, night and filter modes",
        "body": "Digital zoom resamples the image. HDR, night, portrait and beauty modes merge or alter frames and can weaken or displace the pattern. Do not use burst frames of the same scene only; move the camera between shots.",
    },
    {
        "title": "Keep one orientation and upload originals",
        "body": "Hold the camera the same way for every reference image. Upload the files exactly as the camera wrote them: images sent through messaging apps or social networks are resized and recompressed.",
    },
]

LIMITATIONS = [
    {
        "title": "A statistical indication, not proof",
        "body": "Results indicate whether an image is consistent with an enrolled sensor's noise pattern. They are not proof of origin and not a probability that the image came from the sensor.",
    },
    {
        "title": "Reference evidence is required",
        "body": "The method links an image to a sensor you have enrolled. It cannot name an unknown camera from a single photograph.",
    },
    {
        "title": "Camera model is not the same as sensor",
        "body": "Many cameras share a model. Device-level attribution needs the individual sensor's fingerprint, and devices of the same model can share processing artefacts that mimic a match.",
    },
    {
        "title": "Modern smartphones are hard",
        "body": "Multi-frame fusion, HDR, lens correction, stabilisation and synthetic blur can weaken the pattern or add artefacts common to a model. For such devices a match is supported only with same-model control devices or a calibration for that model.",
    },
    {
        "title": "Processing can hide a match",
        "body": "Resizing, cropping, zoom, recompression, screenshots, editing and AI modification can remove or displace the pattern. A low statistic does not exclude a sensor.",
    },
    {
        "title": "Thresholds may be uncalibrated",
        "body": "Unless a calibrated policy applies to the device model and image conditions, thresholds are literature reference lines with no measured error rate.",
    },
]


def _registration_open(c) -> bool:
    if c.allow_registration:
        return True
    if not c.allow_first_account:
        return False
    from sqlalchemy import func, select
    from sqlalchemy.orm import Session

    from ..models import User

    try:
        with Session(get_engine()) as db:
            return (db.scalar(select(func.count()).select_from(User)) or 0) == 0
    except Exception:
        return False


@router.get("/health")
def health(response: Response) -> dict[str, Any]:
    """Liveness and dependency checks."""
    checks: dict[str, bool] = {}
    try:
        with get_engine().connect() as c:
            c.execute(text("select 1"))
        checks["database"] = True
    except Exception:
        checks["database"] = False
    try:
        checks["redis"] = bool(get_redis().ping())
    except Exception:
        checks["redis"] = False
    try:
        checks["storage"] = get_storage().ready()
    except Exception:
        checks["storage"] = False
    ok = all(checks.values())
    if not ok:
        response.status_code = 503
    return {"status": "ok" if ok else "degraded", "checks": checks}


@router.get("/meta", response_model=s.Meta)
def meta() -> s.Meta:
    """Versions, limits and guidance text. Public."""
    c = get_settings()
    return s.Meta(
        name="SensorTrace", api_version="v1", engine_version=ENGINE_VERSION, algorithm_version=ALGORITHM_VERSION,
        decision_policy_version=DECISION_POLICY_VERSION, libraries=library_versions(),
        limits={"max_upload_bytes": c.max_upload_bytes, "max_image_pixels": c.max_image_pixels, "max_files_per_request": c.max_files_per_request, "max_request_bytes": c.max_request_bytes,
                "max_reference_images": c.max_reference_images, "max_candidates_per_analysis": c.max_candidates_per_analysis,
                "recommended_reference_images": 30, "min_reference_images": 2},
        supported_formats=["image/jpeg", "image/png"], registration_open=_registration_open(c),
        reference_guidance=REFERENCE_GUIDANCE, limitations=LIMITATIONS,
    )  # fmt: skip
