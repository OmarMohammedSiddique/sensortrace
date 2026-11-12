"""Environment-based configuration. No secrets have defaults usable in production."""

from __future__ import annotations

from functools import lru_cache
from typing import Literal

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEV_SECRET = "dev-only-secret-change-me-dev-only-secret-change-me"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="ST_", env_file=".env", extra="ignore")

    environment: Literal["development", "test", "production"] = "development"
    secret_key: str = DEV_SECRET
    database_url: str = "postgresql+psycopg://sensortrace:sensortrace@localhost:54329/sensortrace"
    redis_url: str = "redis://localhost:63799/0"

    # Storage
    storage_backend: Literal["local", "s3"] = "local"
    storage_local_path: str = "../storage"
    s3_endpoint_url: str | None = None
    s3_region: str = "us-east-1"
    s3_access_key: str | None = None
    s3_secret_key: str | None = None
    s3_bucket_evidence: str = "sensortrace-evidence"
    s3_bucket_derived: str = "sensortrace-derived"
    s3_bucket_results: str = "sensortrace-results"

    # Sessions / cookies
    session_cookie: str = "st_session"
    session_hours: int = 12
    cookie_secure: bool = False
    allowed_origins: list[str] = Field(default_factory=lambda: ["http://localhost:3100"])
    allow_registration: bool = True
    trust_forwarded_for: bool = False  # enable only behind a trusted reverse proxy

    # Limits and quotas
    max_upload_bytes: int = 64 * 1024 * 1024
    max_image_pixels: int = 80_000_000
    max_files_per_request: int = 60
    max_reference_images: int = 300
    max_candidates_per_analysis: int = 50
    user_storage_quota_bytes: int = 5 * 1024**3
    max_active_jobs_per_user: int = 8
    file_token_seconds: int = 300
    job_timeout_seconds: int = 3600
    default_retention_days: int = 0  # 0 = keep until deleted

    # Rate limits (requests per window)
    rate_auth_per_15min: int = 20
    rate_api_per_minute: int = 600
    rate_upload_per_hour: int = 2000

    worker_memory_limit_mb: int = 0  # address-space cap per job on Linux; 0 disables
    policies_dir: str = "policies"
    jobs_inline: bool = False  # run jobs synchronously (tests only)

    @model_validator(mode="after")
    def _production_guards(self) -> Settings:
        if self.environment == "production":
            if self.secret_key == DEV_SECRET or len(self.secret_key) < 32:
                raise ValueError("ST_SECRET_KEY must be set to a random value of at least 32 characters")
            if not self.cookie_secure:
                raise ValueError("ST_COOKIE_SECURE must be true in production")
            if self.jobs_inline:
                raise ValueError("ST_JOBS_INLINE is for tests only")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()
