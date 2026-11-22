from __future__ import annotations

from tests.conftest import API, PASSWORD, Client, make_user


def test_register_login_logout_cycle(app, anon):
    email = "cycle@example.com"
    r = anon.post(f"{API}/auth/register", json={"email": email, "password": PASSWORD})
    assert r.status_code == 201
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie and "path=/" in cookie
    assert "password" not in r.text and "hash" not in r.text
    anon.csrf = r.json()["csrf_token"]
    assert anon.get(f"{API}/auth/me").json()["user"]["email"] == email
    assert anon.post(f"{API}/auth/logout").status_code == 204
    assert anon.get(f"{API}/auth/me").status_code == 401

    c2 = Client(app)
    assert c2.post(f"{API}/auth/login", json={"email": email, "password": "wrong-password-123"}).status_code == 401
    assert c2.post(f"{API}/auth/login", json={"email": "nobody@example.com", "password": PASSWORD}).json()["error"]["code"] == "invalid_credentials"
    r = c2.post(f"{API}/auth/login", json={"email": email.upper(), "password": PASSWORD})
    assert r.status_code == 200 and r.json()["auth_kind"] == "session"


def test_weak_and_duplicate_registration_rejected(app, anon, user):
    for pw in ("short", "password123", "aaaaaaaaaaaa", "weak@example.com"):
        r = anon.post(f"{API}/auth/register", json={"email": "weak@example.com", "password": pw})
        assert r.status_code == 400 and r.json()["error"]["code"] == "weak_password", pw
    r = anon.post(f"{API}/auth/register", json={"email": user.email, "password": PASSWORD})
    assert r.status_code == 409
    assert anon.post(f"{API}/auth/register", json={"email": "not-an-email", "password": PASSWORD}).status_code == 422


def test_breached_and_guessable_passwords_rejected(anon):
    """F-18: passwords from breach lists and simple patterns are refused, not only an 11-entry blocklist."""
    for pw in ("Password1234", "1234567890ab", "qwertyuiop12", "iloveyou1234", "Sensortrace2026!"):
        r = anon.post(f"{API}/auth/register", json={"email": "guessable@example.com", "password": pw})
        assert r.status_code == 400 and r.json()["error"]["code"] == "weak_password", pw
    r = anon.post(f"{API}/auth/register", json={"email": "mk@example.com", "display_name": "Margaret Kestrelford", "password": "MargaretKestrelford1"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "weak_password"


def test_registration_can_be_closed(anon, settings):
    settings.allow_registration = False
    r = anon.post(f"{API}/auth/register", json={"email": "closed@example.com", "password": PASSWORD})
    assert r.status_code == 403 and r.json()["error"]["code"] == "registration_closed"


def test_unauthenticated_requests_are_refused(anon):
    for path in (
        "/devices",
        "/investigations",
        "/evidence",
        "/analyses",
        "/jobs",
        "/reports",
        "/dashboard",
        "/account/usage",
        "/account/audit",
        "/sensors",
        "/policies",
    ):
        r = anon.get(f"{API}{path}")
        assert r.status_code == 401 and r.json()["error"]["code"] == "not_authenticated", path


def test_csrf_token_required_for_cookie_sessions(app, user):
    raw = Client(app)
    raw.cookies = user.cookies  # same session cookie, but no CSRF header
    assert raw.get(f"{API}/devices").status_code == 200
    r = raw.post(f"{API}/devices", json={"name": "x"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    r = raw.post(f"{API}/devices", json={"name": "x"}, headers={"X-CSRF-Token": "forged"})
    assert r.status_code == 403
    assert raw.delete(f"{API}/demo").status_code == 403
    assert user.post(f"{API}/devices", json={"name": "x"}).status_code == 201


def test_password_change_revokes_other_sessions(app, user):
    second = Client(app)
    r = second.post(f"{API}/auth/login", json={"email": user.email, "password": PASSWORD})
    second.csrf = r.json()["csrf_token"]
    assert len(user.get(f"{API}/auth/sessions").json()) == 2
    assert user.post(f"{API}/auth/password", json={"current_password": "wrong", "new_password": "another-long-passphrase"}).status_code == 403
    assert user.post(f"{API}/auth/password", json={"current_password": PASSWORD, "new_password": "short"}).status_code == 400
    assert user.post(f"{API}/auth/password", json={"current_password": PASSWORD, "new_password": "another-long-passphrase"}).status_code == 204
    assert second.get(f"{API}/auth/me").status_code == 401
    assert user.get(f"{API}/auth/me").status_code == 200
    fresh = Client(app)
    assert fresh.post(f"{API}/auth/login", json={"email": user.email, "password": PASSWORD}).status_code == 401
    assert fresh.post(f"{API}/auth/login", json={"email": user.email, "password": "another-long-passphrase"}).status_code == 200


def test_session_revocation(app, user):
    second = Client(app)
    second.post(f"{API}/auth/login", json={"email": user.email, "password": PASSWORD})
    sessions = user.get(f"{API}/auth/sessions").json()
    target = next(s for s in sessions if not s["current"])
    assert user.delete(f"{API}/auth/sessions/{target['id']}").status_code == 204
    assert second.get(f"{API}/auth/me").status_code == 401


def test_api_tokens(app, user):
    r = user.post(f"{API}/auth/tokens", json={"name": "ci"})
    assert r.status_code == 201
    token = r.json()["token"]
    assert token.startswith("st_")
    listing = user.get(f"{API}/auth/tokens").json()
    assert listing[0]["prefix"] == token[:10] and "token" not in listing[0]

    api = Client(app)
    h = {"Authorization": f"Bearer {token}"}
    assert api.get(f"{API}/auth/me", headers=h).json()["auth_kind"] == "token"
    # Token clients need no CSRF header but cannot perform session-only actions.
    assert api.post(f"{API}/devices", json={"name": "from token"}, headers=h).status_code == 201
    assert api.post(f"{API}/auth/tokens", json={"name": "nested"}, headers=h).status_code == 403
    assert api.request("DELETE", f"{API}/account", json={"password": PASSWORD, "confirm": "DELETE MY ACCOUNT"}, headers=h).status_code == 403
    assert api.get(f"{API}/auth/me", headers={"Authorization": "Bearer st_invalid"}).status_code == 401

    assert user.delete(f"{API}/auth/tokens/{r.json()['id']}").status_code == 204
    assert api.get(f"{API}/auth/me", headers=h).status_code == 401


def test_login_rate_limit(app, settings):
    from app.deps import get_redis

    for key in get_redis().scan_iter("rl:auth-*"):
        get_redis().delete(key)
    settings.rate_auth_per_15min = 5
    c = Client(app)
    email = "ratelimit@example.com"
    codes = [c.post(f"{API}/auth/login", json={"email": email, "password": "wrong-password-xx"}).status_code for _ in range(8)]
    assert codes[:5] == [401] * 5 and set(codes[5:]) == {429}
    r = c.post(f"{API}/auth/login", json={"email": email, "password": "wrong-password-xx"})
    assert r.json()["error"]["code"] == "rate_limited" and int(r.headers["retry-after"]) > 0


def test_first_user_is_admin_and_admin_endpoints_are_restricted(app, user):
    from sqlalchemy import select

    from app.db import session_scope
    from app.models import User

    with session_scope() as db:
        roles = [u.role for u in db.scalars(select(User).order_by(User.created_at))]
    assert roles[0] == "admin" and set(roles[1:]) <= {"user"}
    if user.get(f"{API}/auth/me").json()["user"]["role"] != "admin":
        assert user.get(f"{API}/admin/config").status_code == 403
        assert user.get(f"{API}/admin/stats").status_code == 403


def test_profile_update_and_security_headers(user):
    r = user.patch(f"{API}/auth/me", json={"display_name": "New <b>Name</b>", "default_retention_days": 30, "onboarding_completed": True})
    assert r.status_code == 200 and r.json()["settings"]["default_retention_days"] == 30 and r.json()["onboarding_completed"] is True
    assert user.patch(f"{API}/auth/me", json={"role": "admin"}).status_code == 422  # unknown fields are refused
    h = user.get(f"{API}/auth/me").headers
    assert h["x-content-type-options"] == "nosniff" and h["x-frame-options"] == "DENY"
    assert "default-src 'none'" in h["content-security-policy"] and h["cache-control"] == "no-store"


def test_make_user_helper_isolated(app):
    a, b = make_user(app), make_user(app)
    assert a.user_id != b.user_id
