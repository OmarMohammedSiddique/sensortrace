"""SensorTrace API application."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from .config import get_settings
from .errors import ApiError
from .routers import (
    account,
    analyses,
    auth,
    devices,
    files,
    internal,
    investigations,
    meta,
    reports,
)
from .schemas import ErrorResponse

log = logging.getLogger("sensortrace")

DESCRIPTION = """
Programmatic access to SensorTrace: camera sensor fingerprinting (PRNU) and image source comparison.

**Authentication.** Browser sessions use an HttpOnly cookie plus an `X-CSRF-Token` header on
state-changing requests. Programmatic clients send `Authorization: Bearer <api token>`; create
tokens under *Authentication and accounts*.

**Errors.** Every error has the shape `{"error": {"code", "message", "details"}}`.

**Interpretation.** Outcomes are statistical indications under a stated decision policy. They are
never probabilities of origin. See `/api/v1/meta` for limitations.
"""


@asynccontextmanager
async def lifespan(app: FastAPI):
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    yield


def _err(status: int, code: str, message: str, details=None, headers=None) -> JSONResponse:
    return JSONResponse(
        {"error": {"code": code, "message": message, "details": details}},
        status_code=status,
        headers=headers,
    )


def create_app() -> FastAPI:
    cfg = get_settings()
    docs = cfg.environment != "production"
    app = FastAPI(
        title="SensorTrace API", version="1.0.0", description=DESCRIPTION, lifespan=lifespan,
        openapi_url="/api/v1/openapi.json", docs_url="/api/v1/docs" if docs else None, redoc_url=None,
        responses={400: {"model": ErrorResponse}, 401: {"model": ErrorResponse}, 404: {"model": ErrorResponse}, 422: {"model": ErrorResponse}},
    )  # fmt: skip
    app.add_middleware(CORSMiddleware, allow_origins=cfg.allowed_origins, allow_credentials=True,
                       allow_methods=["GET", "POST", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token", "Authorization"])  # fmt: skip

    @app.middleware("http")
    async def guard(request: Request, call_next):
        if request.method in ("POST", "PUT", "PATCH"):
            # Bodies must declare their length so the limit is enforced before anything is buffered.
            length = request.headers.get("content-length")
            if length is None and request.headers.get("transfer-encoding"):
                return _err(411, "length_required", "Requests must declare a Content-Length.")
            if length and (not length.isdigit() or int(length) > cfg.max_request_bytes):
                return _err(413, "request_too_large", f"Request body exceeds the limit of {cfg.max_request_bytes // (1024 * 1024)} MB.")
        response = await call_next(request)
        h = response.headers
        h.setdefault("X-Content-Type-Options", "nosniff")
        h.setdefault("X-Frame-Options", "DENY")
        h.setdefault("Referrer-Policy", "no-referrer")
        h.setdefault("Cross-Origin-Resource-Policy", "same-site")
        h.setdefault("Cache-Control", "no-store")
        if not request.url.path.startswith("/api/v1/docs"):
            h.setdefault("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'")
        if cfg.cookie_secure:
            h.setdefault("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
        return response

    @app.exception_handler(ApiError)
    async def api_error(_: Request, exc: ApiError):
        headers = {"Retry-After": str(exc.details["retry_after"])} if exc.status == 429 and isinstance(exc.details, dict) else None
        return _err(exc.status, exc.code, exc.message, exc.details, headers)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_: Request, exc: RequestValidationError):
        details = [{"field": ".".join(str(p) for p in e["loc"][1:]), "message": e["msg"]} for e in exc.errors()]
        return _err(422, "validation_error", "The request is invalid.", details)

    @app.exception_handler(StarletteHTTPException)
    async def http_error(_: Request, exc: StarletteHTTPException):
        codes = {404: "not_found", 405: "method_not_allowed"}
        return _err(exc.status_code, codes.get(exc.status_code, "http_error"), str(exc.detail))

    @app.exception_handler(Exception)
    async def unhandled(_: Request, exc: Exception):
        log.exception("unhandled error")
        return _err(500, "internal_error", "An internal error occurred.")

    for r in (meta.router, auth.router, account.router, account.admin_router, devices.router, investigations.router,
              analyses.router, analyses.jobs_router, reports.router, files.router, internal.router):  # fmt: skip
        app.include_router(r, prefix="/api/v1")
    return app


app = create_app()
