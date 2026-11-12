from __future__ import annotations

import uuid
from datetime import timedelta

from fastapi import APIRouter, Request, Response
from sqlalchemy import func, select, update

from .. import schemas as s
from ..audit import audit
from ..config import get_settings
from ..deps import CurrentAuth, CurrentUser, Db, client_ip, rate_limit
from ..errors import ApiError, bad_request, not_found
from ..models import ApiToken, AuthSession, User, utcnow
from ..security import (
    hash_password,
    hash_token,
    needs_rehash,
    new_token,
    password_problem,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["Authentication and accounts"])


def _start_session(db: Db, user: User, request: Request, response: Response) -> AuthSession:
    cfg = get_settings()
    raw = new_token()
    sess = AuthSession(
        user_id=user.id,
        token_hash=hash_token(raw),
        csrf_token=new_token(24),
        expires_at=utcnow() + timedelta(hours=cfg.session_hours),
        ip=client_ip(request),
        user_agent=(request.headers.get("user-agent") or "")[:300],
    )
    db.add(sess)
    response.set_cookie(
        cfg.session_cookie,
        raw,
        max_age=cfg.session_hours * 3600,
        httponly=True,
        secure=cfg.cookie_secure,
        samesite="lax",
        path="/",
    )
    return sess


def _limit_auth(request: Request, email: str = "") -> None:
    cfg = get_settings()
    rate_limit(f"auth-ip:{client_ip(request)}", cfg.rate_auth_per_15min, 900, fail_closed=True)
    if email:
        rate_limit(
            f"auth-email:{email.lower()[:200]}",
            cfg.rate_auth_per_15min,
            900,
            fail_closed=True,
        )


@router.post("/register", response_model=s.SessionInfo, status_code=201)
def register(body: s.RegisterIn, request: Request, response: Response, db: Db) -> s.SessionInfo:
    cfg = get_settings()
    if not cfg.allow_registration:
        no_accounts = (db.scalar(select(func.count()).select_from(User)) or 0) == 0
        if not (cfg.allow_first_account and no_accounts):
            raise ApiError(403, "registration_closed", "Registration is disabled on this server.")
    _limit_auth(request)
    email = body.email.strip().lower()
    problem = password_problem(body.password, email)
    if problem:
        raise bad_request("weak_password", problem)
    if db.scalar(select(User).where(User.email == email)) is not None:
        raise ApiError(
            409,
            "registration_failed",
            "Registration could not be completed with these details.",
        )
    first = (db.scalar(select(func.count()).select_from(User)) or 0) == 0
    user = User(
        email=email,
        password_hash=hash_password(body.password),
        display_name=body.display_name,
        role="admin" if first else "user",
        settings={"default_retention_days": cfg.default_retention_days},
    )
    db.add(user)
    db.flush()
    sess = _start_session(db, user, request, response)
    audit(
        db,
        user.id,
        "account.registered",
        entity_type="user",
        entity_id=user.id,
        ip=client_ip(request),
    )
    db.commit()
    return s.SessionInfo(
        user=s.UserOut.model_validate(user),
        csrf_token=sess.csrf_token,
        auth_kind="session",
    )


@router.post("/login", response_model=s.SessionInfo)
def login(body: s.LoginIn, request: Request, response: Response, db: Db) -> s.SessionInfo:
    email = body.email.replace("\x00", "").strip().lower()
    _limit_auth(request, email)
    user = db.scalar(select(User).where(User.email == email))
    ok = verify_password(user.password_hash if user else None, body.password)
    if not ok or user is None or not user.is_active:
        audit(db, user.id if user else None, "auth.login_failed", ip=client_ip(request))
        db.commit()
        raise ApiError(401, "invalid_credentials", "Email or password is incorrect.")
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(body.password)
    sess = _start_session(db, user, request, response)
    audit(db, user.id, "auth.login", ip=client_ip(request))
    db.commit()
    return s.SessionInfo(
        user=s.UserOut.model_validate(user),
        csrf_token=sess.csrf_token,
        auth_kind="session",
    )


@router.post("/logout", status_code=204)
def logout(auth: CurrentAuth, response: Response, db: Db) -> None:
    if auth.session is not None:
        auth.session.revoked_at = utcnow()
        audit(db, auth.user.id, "auth.logout")
        db.commit()
    response.delete_cookie(get_settings().session_cookie, path="/")


@router.get("/me", response_model=s.SessionInfo)
def me(auth: CurrentAuth) -> s.SessionInfo:
    return s.SessionInfo(
        user=s.UserOut.model_validate(auth.user),
        csrf_token=auth.session.csrf_token if auth.session else None,
        auth_kind=auth.kind,
    )


@router.patch("/me", response_model=s.UserOut)
def update_me(body: s.ProfileIn, user: CurrentUser, db: Db) -> User:
    if body.display_name is not None:
        user.display_name = body.display_name
    if body.onboarding_completed is not None:
        user.onboarding_completed = body.onboarding_completed
    if body.default_retention_days is not None:
        user.settings = {
            **user.settings,
            "default_retention_days": body.default_retention_days,
        }
    audit(db, user.id, "account.updated", entity_type="user", entity_id=user.id)
    db.commit()
    return user


@router.post("/password", status_code=204)
def change_password(body: s.PasswordIn, auth: CurrentAuth, request: Request, db: Db) -> None:
    if auth.kind != "session":
        raise ApiError(403, "session_required", "This action requires an interactive session.")
    _limit_auth(request, auth.user.email)
    if not verify_password(auth.user.password_hash, body.current_password):
        raise ApiError(403, "invalid_credentials", "Current password is incorrect.")
    problem = password_problem(body.new_password, auth.user.email)
    if problem:
        raise bad_request("weak_password", problem)
    auth.user.password_hash = hash_password(body.new_password)
    # Every other session is revoked so a stolen session does not survive a password change.
    db.execute(
        update(AuthSession)
        .where(
            AuthSession.user_id == auth.user.id,
            AuthSession.id != auth.session.id,
            AuthSession.revoked_at.is_(None),
        )  # type: ignore[union-attr]
        .values(revoked_at=utcnow())
    )
    audit(db, auth.user.id, "account.password_changed", ip=client_ip(request))
    db.commit()


@router.get("/sessions", response_model=list[s.SessionOut])
def list_sessions(auth: CurrentAuth, db: Db) -> list[s.SessionOut]:
    rows = db.scalars(
        select(AuthSession)
        .where(
            AuthSession.user_id == auth.user.id,
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > utcnow(),
        )
        .order_by(AuthSession.last_seen_at.desc())
    )
    out = []
    for r in rows:
        o = s.SessionOut.model_validate(r)
        o.current = auth.session is not None and r.id == auth.session.id
        out.append(o)
    return out


@router.delete("/sessions/{session_id}", status_code=204)
def revoke_session(session_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    sess = db.get(AuthSession, session_id)
    if sess is None or sess.user_id != user.id:
        raise not_found("Session")
    sess.revoked_at = utcnow()
    audit(db, user.id, "auth.session_revoked", entity_type="session", entity_id=sess.id)
    db.commit()


@router.get("/tokens", response_model=list[s.TokenOut])
def list_tokens(user: CurrentUser, db: Db) -> list[ApiToken]:
    return list(db.scalars(select(ApiToken).where(ApiToken.user_id == user.id).order_by(ApiToken.created_at.desc())))


@router.post("/tokens", response_model=s.TokenCreated, status_code=201)
def create_token(body: s.TokenIn, auth: CurrentAuth, db: Db) -> s.TokenCreated:
    if auth.kind != "session":
        raise ApiError(
            403,
            "session_required",
            "API tokens can only be created from an interactive session.",
        )
    active = db.scalar(select(func.count()).select_from(ApiToken).where(ApiToken.user_id == auth.user.id, ApiToken.revoked_at.is_(None)))
    if (active or 0) >= 20:
        raise bad_request("too_many_tokens", "Revoke an existing token before creating another.")
    raw = "st_" + new_token(32)
    tok = ApiToken(
        user_id=auth.user.id,
        name=body.name,
        prefix=raw[:10],
        token_hash=hash_token(raw),
        expires_at=utcnow() + timedelta(days=body.expires_in_days) if body.expires_in_days else None,
    )
    db.add(tok)
    audit(
        db,
        auth.user.id,
        "token.created",
        entity_type="api_token",
        entity_id=tok.id,
        name=body.name,
    )
    db.commit()
    out = s.TokenCreated.model_validate({**s.TokenOut.model_validate(tok).model_dump(), "token": raw})
    return out


@router.delete("/tokens/{token_id}", status_code=204)
def revoke_token(token_id: uuid.UUID, user: CurrentUser, db: Db) -> None:
    tok = db.get(ApiToken, token_id)
    if tok is None or tok.user_id != user.id:
        raise not_found("Token")
    tok.revoked_at = utcnow()
    audit(db, user.id, "token.revoked", entity_type="api_token", entity_id=tok.id)
    db.commit()
