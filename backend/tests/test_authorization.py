"""Object-level authorisation: one user can never read, change or delete another user's data."""

from __future__ import annotations

import pytest

from tests.conftest import API, Client, enrol_sensor, files, jpeg, make_user, upload_evidence


@pytest.fixture(scope="module")
def world(app):
    """Owner with one of every object type, plus an unrelated second user."""
    owner, intruder = make_user(app), make_user(app)
    a = enrol_sensor(owner, 71, n=3)
    inv = owner.post(f"{API}/investigations", json={"title": "Private case"}).json()
    ev = upload_evidence(owner, jpeg(71, 900), investigation_id=inv["id"])
    note = owner.post(f"{API}/investigations/{inv['id']}/notes", json={"body": "secret note"}).json()
    an = owner.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [a["sensor_id"]]}).json()
    rep = owner.post(f"{API}/analyses/{an['analyses'][0]['id']}/reports").json()
    ref = owner.get(f"{API}/sensors/{a['sensor_id']}/references").json()["items"][0]
    exp = owner.post(f"{API}/account/export").json()["export"]
    tok = owner.post(f"{API}/auth/tokens", json={"name": "t"}).json()
    sess = owner.get(f"{API}/auth/sessions").json()[0]
    ids = {
        "device": a["device_id"], "sensor": a["sensor_id"], "fingerprint": a["fingerprint_id"], "reference": ref["id"],
        "investigation": inv["id"], "evidence": ev, "note": note["id"], "analysis": an["analyses"][0]["id"],
        "job": an["jobs"][0]["id"], "report": rep["id"], "export": exp["id"], "token": tok["id"], "session": sess["id"],
    }  # fmt: skip
    return owner, intruder, ids


READS = [
    "/devices/{device}", "/sensors/{sensor}", "/sensors/{sensor}/references", "/sensors/{sensor}/fingerprints",
    "/fingerprints/{fingerprint}", "/investigations/{investigation}", "/investigations/{investigation}/notes",
    "/investigations/{investigation}/history", "/evidence/{evidence}", "/analyses/{analysis}", "/jobs/{job}", "/reports/{report}",
]  # fmt: skip

WRITES = [
    ("PATCH", "/devices/{device}", {"name": "pwned"}), ("DELETE", "/devices/{device}", None),
    ("POST", "/devices/{device}/sensors", {"name": "pwned"}), ("PATCH", "/sensors/{sensor}", {"name": "pwned"}),
    ("DELETE", "/sensors/{sensor}", None), ("POST", "/sensors/{sensor}/fingerprints", None),
    ("DELETE", "/references/{reference}", None), ("POST", "/fingerprints/{fingerprint}/activate", None),
    ("DELETE", "/fingerprints/{fingerprint}", None), ("PATCH", "/investigations/{investigation}", {"title": "pwned"}),
    ("DELETE", "/investigations/{investigation}", None), ("POST", "/investigations/{investigation}/notes", {"body": "pwned"}),
    ("POST", "/investigations/{investigation}/reports", None), ("POST", "/investigations/{investigation}/export", None),
    ("DELETE", "/notes/{note}", None), ("PATCH", "/evidence/{evidence}", {"category": "context"}),
    ("DELETE", "/evidence/{evidence}", None), ("PATCH", "/analyses/{analysis}", {"detach": True}),
    ("DELETE", "/analyses/{analysis}", None), ("POST", "/analyses/{analysis}/reports", None),
    ("POST", "/jobs/{job}/cancel", None), ("DELETE", "/reports/{report}", None), ("DELETE", "/account/exports/{export}", None),
    ("DELETE", "/auth/tokens/{token}", None), ("DELETE", "/auth/sessions/{session}", None),
]  # fmt: skip


@pytest.mark.parametrize("path", READS)
def test_foreign_objects_are_invisible(world, path):
    owner, intruder, ids = world
    url = f"{API}{path.format(**ids)}"
    assert owner.get(url).status_code == 200
    r = intruder.get(url)
    assert r.status_code == 404 and r.json()["error"]["code"] == "not_found"


@pytest.mark.parametrize("method,path,body", WRITES)
def test_foreign_objects_cannot_be_modified(world, method, path, body):
    owner, intruder, ids = world
    r = intruder.request(method, f"{API}{path.format(**ids)}", json=body)
    assert r.status_code == 404, f"{method} {path} -> {r.status_code} {r.text}"


def test_owner_data_is_intact_after_all_attempts(world):
    owner, _, ids = world
    assert owner.get(f"{API}/devices/{ids['device']}").json()["name"] == "Camera"
    assert owner.get(f"{API}/investigations/{ids['investigation']}").json()["title"] == "Private case"
    assert owner.get(f"{API}/evidence/{ids['evidence']}").json()["category"] == "questioned"
    assert len(owner.get(f"{API}/investigations/{ids['investigation']}/notes").json()) == 1
    assert owner.get(f"{API}/auth/me").status_code == 200


def test_lists_only_contain_own_rows(world):
    _, intruder, _ = world
    for path in ("/devices", "/sensors", "/investigations", "/evidence", "/analyses", "/jobs", "/reports", "/account/audit"):
        body = intruder.get(f"{API}{path}").json()
        if path == "/account/audit":
            assert all(a["action"].startswith(("account.", "auth.")) for a in body["items"]), path
        else:
            assert body["total"] == 0 and body["items"] == [], path
    assert intruder.get(f"{API}/account/exports").json() == []
    assert intruder.get(f"{API}/dashboard").json()["counts"]["evidence"] == 0


def test_cross_tenant_references_are_refused(world):
    """A user cannot attach their own objects to, or run analyses against, another user's objects."""
    owner, intruder, ids = world
    mine = upload_evidence(intruder, jpeg(72, 1))
    my_sensor = enrol_sensor(intruder, 72, n=3)
    assert intruder.post(f"{API}/analyses", json={"evidence_ids": [ids["evidence"]], "sensor_ids": [my_sensor["sensor_id"]]}).status_code == 404
    assert intruder.post(f"{API}/analyses", json={"evidence_ids": [mine], "sensor_ids": [ids["sensor"]]}).status_code == 404
    assert intruder.post(f"{API}/analyses", json={"evidence_ids": [mine], "fingerprint_ids": [ids["fingerprint"]]}).status_code == 404
    assert (
        intruder.post(
            f"{API}/analyses", json={"evidence_ids": [mine], "sensor_ids": [my_sensor["sensor_id"]], "investigation_id": ids["investigation"]}
        ).status_code
        == 404
    )
    assert intruder.patch(f"{API}/evidence/{mine}", json={"investigation_id": ids["investigation"]}).status_code == 404
    assert intruder.post(f"{API}/evidence", files=files([("x.jpg", jpeg(72, 2))]), data={"investigation_id": ids["investigation"]}).status_code == 404
    assert intruder.post(f"{API}/sensors/{ids['sensor']}/references", files=files([("x.jpg", jpeg(72, 3, True))])).status_code == 404
    assert intruder.get(f"{API}/evidence", params={"investigation_id": ids["investigation"]}).json()["total"] == 0
    assert intruder.get(f"{API}/analyses", params={"evidence_id": ids["evidence"]}).json()["total"] == 0
    assert intruder.get(f"{API}/reports", params={"analysis_id": ids["analysis"]}).json()["total"] == 0


def test_signed_file_urls_are_user_bound_expiring_and_tamper_proof(world, app, settings):
    owner, intruder, ids = world
    ev = owner.get(f"{API}/evidence/{ids['evidence']}").json()
    url = ev["download_url"]
    assert owner.get(url).status_code == 200
    # Another authenticated user holding the link gets nothing; neither does an anonymous client.
    assert intruder.get(url).status_code == 404
    assert Client(app).get(url).status_code == 401
    # Tampering with the payload or signature invalidates the token.
    body, sig = url.rsplit("/", 1)[1].split(".")
    flipped = "A" if body[5] != "A" else "B"
    assert owner.get(f"{API}/files/{body[:5]}{flipped}{body[6:]}.{sig}").status_code == 404
    assert owner.get(f"{API}/files/{body}.{sig[:-2]}xx").status_code == 404
    assert owner.get(f"{API}/files/not-a-token").status_code == 404
    # A token forged with a different key is rejected.
    from app.security import make_file_token

    good = make_file_token(bucket="evidence", key="x/y", user_id=owner.user_id, filename="f", content_type="image/jpeg")
    settings.secret_key = "another-secret-key-another-secret-key-0000"
    forged = make_file_token(bucket="evidence", key="x/y", user_id=owner.user_id, filename="f", content_type="image/jpeg")
    assert forged != good
    settings.secret_key = "dev-only-secret-change-me-dev-only-secret-change-me"
    assert owner.get(f"{API}/files/{forged}").status_code == 404
    # Expiry.
    settings.file_token_seconds = -1
    expired = owner.get(f"{API}/evidence/{ids['evidence']}").json()["download_url"]
    assert owner.get(expired).status_code == 404


def test_originals_are_never_served_inline(world):
    owner, _, ids = world
    ev = owner.get(f"{API}/evidence/{ids['evidence']}").json()
    r = owner.get(ev["download_url"])
    assert r.headers["content-disposition"].startswith("attachment") and r.headers["content-type"] == "application/octet-stream"
    assert r.headers["x-content-type-options"] == "nosniff" and "sandbox" in r.headers["content-security-policy"]
    p = owner.get(ev["preview_url"])
    assert p.headers["content-disposition"].startswith("inline") and p.headers["content-type"] == "image/jpeg"
    assert "key" not in ev and "object_key" not in ev


def test_admin_stats_expose_no_user_content(app):
    from sqlalchemy import select

    from app.db import session_scope
    from app.models import AuthSession, User
    from app.security import hash_token, new_token

    with session_scope() as db:
        admin = db.scalar(select(User).where(User.role == "admin"))
        raw = new_token()
        from datetime import timedelta

        from app.models import utcnow

        db.add(AuthSession(user_id=admin.id, token_hash=hash_token(raw), csrf_token="x", expires_at=utcnow() + timedelta(hours=1)))
    c = Client(app)
    c.cookies.set("st_session", raw)
    stats = c.get(f"{API}/admin/stats").json()
    assert set(stats) == {"users", "jobs_by_status", "evidence_bytes", "analyses"}
    cfg = c.get(f"{API}/admin/config").json()
    assert "secret" not in str(cfg).lower() and "password" not in str(cfg).lower() and cfg["limits"]["max_upload_bytes"] > 0
