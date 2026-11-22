"""Two-step verification (TOTP authenticator plus single-use recovery codes)."""

from __future__ import annotations

import time

import pyotp
import pytest

from tests.conftest import API, PASSWORD, Client, make_user


def code_at(secret: str, offset_steps: int = 0) -> str:
    totp = pyotp.TOTP(secret)
    return totp.generate_otp(int(time.time()) // totp.interval + offset_steps)


@pytest.fixture(autouse=True)
def _clear_auth_limits():
    from app.deps import get_redis

    for key in get_redis().scan_iter("rl:auth-*"):
        get_redis().delete(key)


def enable(c: Client) -> tuple[str, list[str]]:
    r = c.post(f"{API}/auth/mfa/setup", json={"password": PASSWORD})
    assert r.status_code == 200, r.text
    secret = r.json()["secret"]
    assert r.json()["otpauth_uri"].startswith("otpauth://totp/SensorTrace:")
    r = c.post(f"{API}/auth/mfa/enable", json={"code": code_at(secret)})
    assert r.status_code == 200, r.text
    return secret, r.json()["codes"]


def login(app, email: str, code: str | None = None):
    body = {"email": email, "password": PASSWORD} | ({"code": code} if code else {})
    return Client(app).post(f"{API}/auth/login", json=body)


def test_enabling_requires_password_and_a_current_code(app):
    c = make_user(app)
    assert c.post(f"{API}/auth/mfa/setup", json={"password": "wrong-password"}).status_code == 403
    secret = c.post(f"{API}/auth/mfa/setup", json={"password": PASSWORD}).json()["secret"]
    r = c.post(f"{API}/auth/mfa/enable", json={"code": "000000" if code_at(secret) != "000000" else "111111"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_code"
    assert c.get(f"{API}/auth/me").json()["user"]["mfa_enabled"] is False
    codes = c.post(f"{API}/auth/mfa/enable", json={"code": code_at(secret)}).json()["codes"]
    assert len(codes) == 10 and len(set(codes)) == 10
    assert c.get(f"{API}/auth/me").json()["user"]["mfa_enabled"] is True
    assert c.post(f"{API}/auth/mfa/setup", json={"password": PASSWORD}).status_code == 409


def test_sign_in_needs_the_second_factor_once_enabled(app):
    c = make_user(app)
    secret, _ = enable(c)
    r = login(app, c.email)
    assert r.status_code == 401 and r.json()["error"]["code"] == "mfa_required"
    assert "st_session" not in r.cookies, "a session was started before the second factor"
    assert login(app, c.email, "123456" if code_at(secret, 1) != "123456" else "654321").json()["error"]["code"] == "invalid_code"
    assert login(app, c.email, code_at(secret, 1)).status_code == 200


def test_a_used_code_cannot_be_replayed(app):
    c = make_user(app)
    secret, _ = enable(c)
    code = code_at(secret, 1)
    assert login(app, c.email, code).status_code == 200
    r = login(app, c.email, code)
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_code"


def test_recovery_codes_work_once_and_can_be_replaced(app):
    c = make_user(app)
    secret, codes = enable(c)
    assert login(app, c.email, codes[0].upper()).status_code == 200
    assert login(app, c.email, codes[0]).status_code == 401, "a recovery code worked twice"
    r = c.post(f"{API}/auth/mfa/recovery-codes", json={"code": codes[1]})
    assert r.status_code == 403, "a recovery code was accepted to replace recovery codes"
    fresh = c.post(f"{API}/auth/mfa/recovery-codes", json={"code": code_at(secret, 1)}).json()["codes"]
    assert login(app, c.email, codes[2]).status_code == 401, "an old recovery code survived replacement"
    assert login(app, c.email, fresh[0]).status_code == 200
    actions = [a["action"] for a in c.get(f"{API}/account/audit").json()["items"]]
    assert "auth.recovery_code_used" in actions and "account.recovery_codes_replaced" in actions


def test_enabling_signs_out_other_sessions(app):
    c = make_user(app)
    other = Client(app)
    other.post(f"{API}/auth/login", json={"email": c.email, "password": PASSWORD})
    assert other.get(f"{API}/auth/me").status_code == 200
    enable(c)
    assert other.get(f"{API}/auth/me").status_code == 401
    assert c.get(f"{API}/auth/me").status_code == 200


def test_disabling_needs_password_and_code(app):
    c = make_user(app)
    secret, codes = enable(c)
    assert c.post(f"{API}/auth/mfa/disable", json={"password": "wrong-password", "code": codes[0]}).status_code == 403
    assert c.post(f"{API}/auth/mfa/disable", json={"password": PASSWORD, "code": "not-a-code"}).status_code == 403
    assert c.post(f"{API}/auth/mfa/disable", json={"password": PASSWORD, "code": codes[0]}).status_code == 204
    assert c.get(f"{API}/auth/me").json()["user"]["mfa_enabled"] is False
    assert login(app, c.email).status_code == 200


def test_api_tokens_cannot_manage_the_second_factor(app):
    c = make_user(app)
    token = c.post(f"{API}/auth/tokens", json={"name": "t"}).json()["token"]
    h = {"Authorization": f"Bearer {token}"}
    assert Client(app).post(f"{API}/auth/mfa/setup", json={"password": PASSWORD}, headers=h).status_code == 403


def test_secret_is_stored_encrypted(app):
    from sqlalchemy import select

    from app.db import session_scope
    from app.models import User

    c = make_user(app)
    secret, codes = enable(c)
    with session_scope() as db:
        user = db.scalar(select(User).where(User.email == c.email))
        assert secret not in (user.totp_secret or "")
        assert not any(code in user.recovery_code_hashes for code in codes)


def test_operator_can_turn_the_second_factor_off(app):
    from app.cli import disable_mfa

    c = make_user(app)
    enable(c)
    assert disable_mfa(c.email) == 0
    assert c.get(f"{API}/auth/me").status_code == 401, "sessions survived the operator reset"
    assert login(app, c.email).status_code == 200
