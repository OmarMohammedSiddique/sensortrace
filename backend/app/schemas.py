"""Request and response schemas for the public API (v1)."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Generic, Literal, TypeVar

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

T = TypeVar("T")

DeviceType = Literal[
    "smartphone",
    "tablet",
    "dedicated_camera",
    "action_camera",
    "drone",
    "webcam",
    "other",
]
PipelineClass = Literal["conventional", "computational", "unknown"]
EvidenceCategory = Literal["questioned", "reference", "context"]
InvestigationStatus = Literal["open", "closed", "archived"]


class Out(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page(BaseModel, Generic[T]):
    items: list[T]
    total: int
    limit: int
    offset: int


class ErrorBody(BaseModel):
    code: str
    message: str
    details: Any | None = None


class ErrorResponse(BaseModel):
    error: ErrorBody


def _clean(v: str) -> str:
    return "".join(ch for ch in v if ch.isprintable() or ch in "\n\t").strip()


class Str(BaseModel):
    """Base for inputs: strips control characters from every string field."""

    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def _strip(cls, v: Any) -> Any:
        return _clean(v) if isinstance(v, str) else v


# ---------------------------------------------------------------------- auth


class RegisterIn(Str):
    email: EmailStr
    password: str = Field(min_length=1, max_length=256)
    display_name: str = Field(default="", max_length=120)

    @field_validator("password", mode="before")
    @classmethod
    def _keep_password(cls, v: Any) -> Any:
        return v


class LoginIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    email: str = Field(max_length=320)
    password: str = Field(max_length=256)


class UserOut(Out):
    id: uuid.UUID
    email: str
    display_name: str
    role: str
    settings: dict[str, Any]
    onboarding_completed: bool
    created_at: datetime


class SessionInfo(BaseModel):
    user: UserOut
    csrf_token: str | None
    auth_kind: str


class ProfileIn(Str):
    display_name: str | None = Field(default=None, max_length=120)
    onboarding_completed: bool | None = None
    default_retention_days: int | None = Field(default=None, ge=0, le=3650)


class PasswordIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    current_password: str = Field(max_length=256)
    new_password: str = Field(max_length=256)


class SessionOut(Out):
    id: uuid.UUID
    created_at: datetime
    last_seen_at: datetime
    expires_at: datetime
    ip: str | None
    user_agent: str | None
    current: bool = False


class TokenIn(Str):
    name: str = Field(min_length=1, max_length=120)
    expires_in_days: int | None = Field(default=None, ge=1, le=3650)


class TokenOut(Out):
    id: uuid.UUID
    name: str
    prefix: str
    created_at: datetime
    last_used_at: datetime | None
    expires_at: datetime | None
    revoked_at: datetime | None


class TokenCreated(TokenOut):
    token: str = Field(description="Shown once. Store it securely; it cannot be retrieved again.")


# ------------------------------------------------------------------- devices


class DeviceIn(Str):
    name: str = Field(min_length=1, max_length=160)
    make: str = Field(default="", max_length=120)
    model: str = Field(default="", max_length=120)
    firmware: str = Field(default="", max_length=120)
    serial_number: str = Field(default="", max_length=120)
    device_type: DeviceType = "smartphone"
    pipeline_class: PipelineClass = "unknown"
    notes: str = Field(default="", max_length=5000)


class DevicePatch(Str):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    make: str | None = Field(default=None, max_length=120)
    model: str | None = Field(default=None, max_length=120)
    firmware: str | None = Field(default=None, max_length=120)
    serial_number: str | None = Field(default=None, max_length=120)
    device_type: DeviceType | None = None
    pipeline_class: PipelineClass | None = None
    notes: str | None = Field(default=None, max_length=5000)


class SensorIn(Str):
    name: str = Field(min_length=1, max_length=160)
    position: str = Field(default="main", max_length=40)
    notes: str = Field(default="", max_length=5000)


class SensorPatch(Str):
    name: str | None = Field(default=None, min_length=1, max_length=160)
    position: str | None = Field(default=None, max_length=40)
    notes: str | None = Field(default=None, max_length=5000)


class FingerprintOut(Out):
    id: uuid.UUID
    sensor_id: uuid.UUID
    version: int
    status: str
    digest: str | None
    width: int | None
    height: int | None
    n_images: int
    algorithm_version: str
    size_bytes: int
    error: str | None
    created_at: datetime
    is_active: bool = False


class FingerprintDetail(FingerprintOut):
    diagnostics: dict[str, Any]
    outcomes: list[Any]
    visual_url: str | None = None
    spectrum_url: str | None = None
    download_url: str | None = None
    visualisation_notice: str = ""


class SensorOut(Out):
    id: uuid.UUID
    device_id: uuid.UUID
    name: str
    position: str
    notes: str
    created_at: datetime
    active_fingerprint_id: uuid.UUID | None
    reference_count: int = 0
    active_fingerprint: FingerprintOut | None = None
    device_name: str = ""
    device_make: str = ""
    device_model: str = ""
    pipeline_class: str = "unknown"
    is_demo: bool = False


class DeviceOut(Out):
    id: uuid.UUID
    name: str
    make: str
    model: str
    firmware: str
    serial_number: str
    device_type: str
    pipeline_class: str
    notes: str
    is_demo: bool
    created_at: datetime
    sensors: list[SensorOut] = []


class ReferenceOut(Out):
    id: uuid.UUID
    sensor_id: uuid.UUID
    filename: str
    sha256: str
    size_bytes: int
    mime_type: str
    width: int
    height: int
    image_metadata: dict[str, Any]
    quality: dict[str, Any]
    created_at: datetime
    preview_url: str | None = None


class UploadResult(BaseModel):
    filename: str
    accepted: bool
    id: uuid.UUID | None = None
    sha256: str | None = None
    error: ErrorBody | None = None
    warnings: list[str] = []


class UploadResponse(BaseModel):
    results: list[UploadResult]
    accepted: int
    rejected: int


class JobOut(Out):
    id: uuid.UUID
    kind: str
    status: str
    stage: str
    progress: float
    message: str
    error: str | None
    target_type: str
    target_id: uuid.UUID | None
    attempts: int
    cancel_requested: bool
    created_at: datetime
    started_at: datetime | None
    finished_at: datetime | None


class FingerprintStarted(BaseModel):
    fingerprint: FingerprintOut
    job: JobOut


# ------------------------------------------------------------ investigations


class InvestigationIn(Str):
    title: str = Field(min_length=1, max_length=200)
    reference: str = Field(default="", max_length=120)
    description: str = Field(default="", max_length=20000)
    retention_days: int | None = Field(default=None, ge=1, le=3650)


class InvestigationPatch(Str):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    reference: str | None = Field(default=None, max_length=120)
    description: str | None = Field(default=None, max_length=20000)
    status: InvestigationStatus | None = None
    retention_days: int | None = Field(default=None, ge=0, le=3650, description="0 clears the retention date")


class InvestigationOut(Out):
    id: uuid.UUID
    title: str
    reference: str
    description: str
    status: str
    is_demo: bool
    retention_until: datetime | None
    created_at: datetime
    updated_at: datetime
    evidence_count: int = 0
    analysis_count: int = 0
    note_count: int = 0


class Acquisition(Str):
    source: str = Field(default="", max_length=300)
    acquired_at: str = Field(default="", max_length=40)
    acquired_by: str = Field(default="", max_length=200)
    method: str = Field(default="", max_length=300)
    notes: str = Field(default="", max_length=5000)


class EvidencePatch(Str):
    category: EvidenceCategory | None = None
    investigation_id: uuid.UUID | None = None
    detach: bool = False
    acquisition: Acquisition | None = None


class EvidenceOut(Out):
    id: uuid.UUID
    investigation_id: uuid.UUID | None
    filename: str
    category: str
    sha256: str
    size_bytes: int
    mime_type: str
    width: int
    height: int
    image_metadata: dict[str, Any]
    quality: dict[str, Any]
    acquisition: dict[str, Any]
    provenance: dict[str, Any]
    is_demo: bool
    created_at: datetime
    preview_url: str | None = None
    download_url: str | None = None
    duplicate_of: list[uuid.UUID] = []


class NoteIn(Str):
    body: str = Field(min_length=1, max_length=20000)


class NoteOut(Out):
    id: uuid.UUID
    investigation_id: uuid.UUID
    body: str
    created_at: datetime


class AuditOut(Out):
    id: int
    action: str
    entity_type: str
    entity_id: str
    investigation_id: uuid.UUID | None
    ip: str | None
    details: dict[str, Any]
    created_at: datetime


# ------------------------------------------------------------------ analyses


class AnalysisIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    evidence_ids: list[uuid.UUID] = Field(min_length=1, max_length=20)
    sensor_ids: list[uuid.UUID] = Field(
        default_factory=list,
        max_length=200,
        description="Uses each sensor's active fingerprint",
    )
    fingerprint_ids: list[uuid.UUID] = Field(default_factory=list, max_length=200)
    policy_id: str | None = Field(default=None, max_length=120)
    investigation_id: uuid.UUID | None = None


class AnalysisPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    investigation_id: uuid.UUID | None = None
    detach: bool = False


class CandidateOut(Out):
    id: uuid.UUID
    sensor_id: uuid.UUID | None
    fingerprint_id: uuid.UUID | None
    snapshot: dict[str, Any]
    rank: int
    verdict: str
    pce: float | None
    effective_pce: float | None
    ncc: float | None
    measurement: dict[str, Any]
    decision: dict[str, Any]
    experimental: dict[str, Any] | None


class AnalysisOut(Out):
    id: uuid.UUID
    investigation_id: uuid.UUID | None
    evidence_id: uuid.UUID
    status: str
    summary: dict[str, Any]
    error: str | None
    created_at: datetime
    completed_at: datetime | None
    evidence_filename: str = ""
    evidence_sha256: str = ""
    evidence_preview_url: str | None = None
    top_verdict: str | None = None
    top_label: str | None = None
    candidate_count: int = 0
    job_id: uuid.UUID | None = None
    is_demo: bool = False


class AnalysisDetail(AnalysisOut):
    policy: dict[str, Any]
    quality: dict[str, Any]
    provenance: dict[str, Any]
    candidates: list[CandidateOut]
    residual_visual_url: str | None = None
    visualisation_notice: str = ""
    evidence: EvidenceOut | None = None


class AnalysisStarted(BaseModel):
    analyses: list[AnalysisOut]
    jobs: list[JobOut]


class PolicyOut(BaseModel):
    policy_id: str
    match_threshold: float
    non_match_threshold: float
    calibrated: bool
    basis: str
    calibration: dict[str, Any] | None
    min_valid_pixels: int
    min_reference_images_for_non_match: int
    min_split_half_pce_for_non_match: float
    version: str


# ------------------------------------------------------------------- reports


class ReportOut(Out):
    id: uuid.UUID
    analysis_id: uuid.UUID | None
    investigation_id: uuid.UUID | None
    title: str
    sha256: str
    size_bytes: int
    created_at: datetime
    download_url: str | None = None


class ExportOut(Out):
    id: uuid.UUID
    scope: str
    investigation_id: uuid.UUID | None
    status: str
    sha256: str | None
    size_bytes: int
    expires_at: datetime | None
    created_at: datetime
    download_url: str | None = None


class ExportStarted(BaseModel):
    export: ExportOut
    job: JobOut


class DeleteAccountIn(BaseModel):
    model_config = ConfigDict(extra="forbid")
    password: str = Field(max_length=256)
    confirm: Literal["DELETE MY ACCOUNT"]


class Usage(BaseModel):
    storage: dict[str, int]
    quota_bytes: int
    counts: dict[str, int]


class Dashboard(BaseModel):
    counts: dict[str, int]
    storage: dict[str, int]
    quota_bytes: int
    recent_analyses: list[AnalysisOut]
    recent_investigations: list[InvestigationOut]
    active_jobs: list[JobOut]
    recent_activity: list[AuditOut]
    sensors_ready: int
    onboarding_completed: bool
    has_demo_data: bool


class Meta(BaseModel):
    name: str
    api_version: str
    engine_version: str
    algorithm_version: str
    decision_policy_version: str
    libraries: dict[str, str]
    limits: dict[str, Any]
    supported_formats: list[str]
    registration_open: bool
    reference_guidance: list[dict[str, str]]
    limitations: list[dict[str, str]]
