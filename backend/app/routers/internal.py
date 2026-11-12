"""Endpoints the deployment calls on itself. Not part of the public API (hidden from OpenAPI)."""

from __future__ import annotations

import os
import uuid

from fastapi import APIRouter, Request, Response

from .. import jobs
from ..deps import same_secret
from ..errors import not_found

router = APIRouter(prefix="/internal", include_in_schema=False)


@router.post("/jobs/{job_id}/run", status_code=204)
def run_job(job_id: uuid.UUID, request: Request) -> Response:
    """Run one queued job in this invocation. Authorised by a per-job HMAC, not by a user session."""
    sent = request.headers.get("x-st-internal", "")
    if not sent or not same_secret(sent, jobs.internal_signature(job_id)):
        raise not_found()
    jobs.execute(str(job_id))
    return Response(status_code=204)


@router.get("/maintenance")
def maintenance(request: Request) -> dict:
    """Retention purge. Called by the platform scheduler with its bearer secret."""
    secret = os.environ.get("CRON_SECRET", "")
    sent = request.headers.get("authorization", "")
    if not secret or not same_secret(sent, f"Bearer {secret}"):
        raise not_found()
    return jobs.purge_expired()
