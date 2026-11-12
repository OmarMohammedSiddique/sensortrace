"""Request dependencies: authentication, CSRF protection, rate limiting, ownership checks."""

from __future__ import annotations

import hmac
import logging
import uuid
from collections.abc import AsyncIterator
from dataclasses import dataclass
from datetime import timedelta
from typing import Annotated, Any, TypeVar

import redis
from fastapi import Depends, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from .config import Settings, get_settings
from .db import get_db
from .errors import ApiError, not_found
from .models import ApiToken, AuthSession, User, utcnow
from .security import hash_token

log = logging.getLogger("sensortrace")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}

_redis: redis.Redis | None = None


def get_redis() -> redis.Redis:
    global _redis
    if _redis is None:
        _redis = redis.Redis.from_url(get_settings().redis_url, socket_timeout=3, socket_connect_timeout=3)
    return _redis


def reset_redis() -> None:
    global _redis
    _redis = None


def client_ip(request: Request) -> str:
    if get_settings().trust_forwarded_for:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()[:64]
    return (request.client.host if request.client else "unknown")[:64]


def rate_limit(key: str, limit: int, window_seconds: int, *, fail_closed: bool = False) -> None:
    """Fixed-window counter in Redis. Raises 429 when ``limit`` is exceeded."""
    try:
        r = get_redis()
        k = f"rl:{key}"
        n = r.incr(k)
        if n == 1:
            r.expire(k, window_seconds)
        if n > limit:
            ttl = max(int(r.ttl(k)), 1)
            raise ApiError(
                429,
                "rate_limited",
                "Too many requests. Please try again later.",
                {"retry_after": ttl},
            )
    except redis.RedisError:
        log.warning("rate limiter unavailable for %s", key.split(":")[0])
        if fail_closed:
            raise ApiError(503, "service_unavailable", "Service temporarily unavailable.") from None


@dataclass
class Auth:
    user: User
    kind: str  # "session" | "token"
    session: AuthSession | None = None


def same_secret(sent: str, expected: str) -> bool:
    """Constant-time comparison that also accepts (and rejects) non-ASCII input instead of raising."""
    return hmac.compare_digest(sent.encode("utf-8", "surrogateescape"), expected.encode("utf-8", "surrogateescape"))


def authenticate(request: Request, db: Session, s: Settings) -> Auth | None:
    header = request.headers.get("authorization", "")
    if header.lower().startswith("bearer "):
        raw = header[7:].strip()
        tok = db.scalar(select(ApiToken).where(ApiToken.token_hash == hash_token(raw)))
        now = utcnow()
        if tok is None or tok.revoked_at is not None or (tok.expires_at and tok.expires_at < now):
            raise ApiError(401, "invalid_token", "API token is invalid, expired or revoked.")
        user = db.get(User, tok.user_id)
        if user is None or not user.is_active:
            raise ApiError(401, "invalid_token", "API token is invalid, expired or revoked.")
        if tok.last_used_at is None or now - tok.last_used_at > timedelta(minutes=5):
            tok.last_used_at = now
            db.commit()
        return Auth(user, "token")
    raw = request.cookies.get(s.session_cookie)
    if not raw:
        return None
    sess = db.scalar(select(AuthSession).where(AuthSession.token_hash == hash_token(raw)))
    now = utcnow()
    if sess is None or sess.revoked_at is not None or sess.expires_at < now:
        return None
    user = db.get(User, sess.user_id)
    if user is None or not user.is_active:
        return None
    if request.method not in SAFE_METHODS:
        sent = request.headers.get("x-csrf-token", "")
        if not sent or not same_secret(sent, sess.csrf_token):
            raise ApiError(403, "csrf_failed", "Missing or invalid CSRF token.")
    if now - sess.last_seen_at > timedelta(minutes=5):
        sess.last_seen_at = now
        db.commit()
    return Auth(user, "session", sess)


def get_auth(request: Request, db: Annotated[Session, Depends(get_db)]) -> Auth:
    s = get_settings()
    db.info["client_ip"] = client_ip(request)
    auth = authenticate(request, db, s)
    if auth is None:
        raise ApiError(401, "not_authenticated", "Authentication is required.")
    rate_limit(f"api:{auth.user.id}", s.rate_api_per_minute, 60)
    request.state.user_id = auth.user.id
    return auth


def get_user(auth: Annotated[Auth, Depends(get_auth)]) -> User:
    return auth.user


CurrentUser = Annotated[User, Depends(get_user)]
CurrentAuth = Annotated[Auth, Depends(get_auth)]
Db = Annotated[Session, Depends(get_db)]

#: Upload requests one account may have in progress at once. Each one holds a database slot while its
#: images are decoded, so without a bound a single account could occupy all of them.
MAX_PARALLEL_UPLOADS = 3
_uploading: dict[uuid.UUID, int] = {}


async def upload_slot(user: CurrentUser) -> AsyncIterator[None]:
    # Runs on the event loop (an async dependency), so the counter needs no lock.
    n = _uploading.get(user.id, 0)
    if n >= MAX_PARALLEL_UPLOADS:
        raise ApiError(429, "too_many_uploads", "Too many uploads are in progress for this account. Wait for one to finish.")
    _uploading[user.id] = n + 1
    try:
        yield
    finally:
        if _uploading.get(user.id, 0) <= 1:
            _uploading.pop(user.id, None)
        else:
            _uploading[user.id] -= 1


UploadSlot = Annotated[None, Depends(upload_slot)]

T = TypeVar("T")


def owned(db: Session, model: type[T], obj_id: uuid.UUID, user: User, what: str = "Resource") -> T:
    """Load a row only if it belongs to ``user``. A foreign or missing id gives the same 404."""
    obj: Any = db.get(model, obj_id)
    if obj is None or obj.user_id != user.id:
        raise not_found(what)
    return obj
