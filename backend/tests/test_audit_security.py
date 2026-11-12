"""Regression tests for the defects found in the independent security audit (audit/SECURITY_AUDIT.md).

Each test failed against the code as audited and names the finding it covers.
"""

from __future__ import annotations

import asyncio
import threading
import time
import uuid
from datetime import timedelta

import httpx
from sqlalchemy import select

from app import jobs
from app.db import session_scope
from app.models import AuditLog, DataExport, Evidence, Investigation, Job, utcnow
from app.security import make_file_token
from app.storage import get_storage
from tests.conftest import API, PASSWORD, Client, files, jpeg, make_user, upload_evidence

# ---------------------------------------------------------------- F-01 uploads block the event loop


def _record_decode_threads(monkeypatch) -> list[bool]:
    """Patch the decoder and record, per call, whether it ran on a thread that is running an event loop."""
    from app import services

    real = services.ingest_image
    on_loop: list[bool] = []

    def spy(data, limits):
        try:
            asyncio.get_running_loop()
            on_loop.append(True)
        except RuntimeError:
            on_loop.append(False)
        return real(data, limits)

    monkeypatch.setattr(services, "ingest_image", spy)
    return on_loop


def test_f01_evidence_decoding_runs_off_the_event_loop(user, monkeypatch):
    on_loop = _record_decode_threads(monkeypatch)
    upload_evidence(user, jpeg(61, 1))
    assert on_loop == [False], "image decoding ran on the event loop and blocks every other request"


def test_f01_reference_decoding_runs_off_the_event_loop(user, monkeypatch):
    on_loop = _record_decode_threads(monkeypatch)
    dev = user.post(f"{API}/devices", json={"name": "D"}).json()
    sid = user.post(f"{API}/devices/{dev['id']}/sensors", json={"name": "S"}).json()["id"]
    r = user.post(f"{API}/sensors/{sid}/references", files=files([("r0.jpg", jpeg(61, 2, True)), ("r1.jpg", jpeg(61, 3, True))]))
    assert r.json()["accepted"] == 2
    assert on_loop == [False, False]


# ------------------------------------------------- F-02 request bodies consumed before authentication


def test_f02_json_bodies_are_capped_far_below_the_upload_limit(anon, user):
    big = b'{"email":"a@example.com","password":"' + b"A" * (2 * 1024 * 1024) + b'"}'
    r = anon.post(f"{API}/auth/login", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "request_too_large"
    # DELETE carries a body on /account and had no limit at all.
    r = anon.request("DELETE", f"{API}/account", content=big, headers={"Content-Type": "application/json"})
    assert r.status_code == 413
    r = user.request("DELETE", f"{API}/account", content=b"x", headers={"Content-Type": "application/json", "Content-Length": str(10**12)})
    assert r.status_code == 413
    # Ordinary JSON requests are unaffected.
    assert user.post(f"{API}/investigations", json={"title": "T", "description": "d" * 20000}).status_code == 201


def _raw_multipart_post(app, path: str, headers: list[tuple[bytes, bytes]]) -> tuple[int, int]:
    """Send a multipart POST straight to the ASGI app. Returns (status, number of body reads)."""
    reads = 0
    status = 0
    scope = {
        "type": "http",
        "asgi": {"version": "3.0"},
        "http_version": "1.1",
        "method": "POST",
        "scheme": "http",
        "path": path,
        "raw_path": path.encode(),
        "query_string": b"",
        "root_path": "",
        "server": ("testserver", 80),
        "client": ("203.0.113.9", 4000),
        "headers": [(b"host", b"testserver"), (b"content-type", b"multipart/form-data; boundary=XB"), (b"content-length", b"400000000"), *headers],
    }

    async def receive():
        nonlocal reads
        reads += 1
        return {"type": "http.request", "body": b"--XB\r\n", "more_body": True} if reads < 50 else {"type": "http.disconnect"}

    async def send(message):
        nonlocal status
        if message["type"] == "http.response.start":
            status = message["status"]

    asyncio.run(app(scope, receive, send))
    return status, reads


def test_f02_anonymous_upload_is_refused_before_the_body_is_read(app, user):
    for path in (f"{API}/evidence", f"{API}/sensors/{uuid.uuid4()}/references"):
        status, reads = _raw_multipart_post(app, path, [])
        assert (status, reads) == (401, 0), f"{path}: the body of an unauthenticated upload was read ({reads} chunks)"
    # An invalid session and a valid session without its CSRF token are refused just as early.
    assert _raw_multipart_post(app, f"{API}/evidence", [(b"cookie", b"st_session=not-a-session")]) == (401, 0)
    cookie = f"st_session={user.cookies.get('st_session')}".encode()
    assert _raw_multipart_post(app, f"{API}/evidence", [(b"cookie", cookie)]) == (403, 0)
    # An authenticated upload still works.
    upload_evidence(user, jpeg(61, 4))


# --------------------------------------------- F-03 connection pool / thread pool deadlock under load


def test_f03_concurrent_requests_do_not_deadlock_the_connection_pool(app):
    u = make_user(app)
    cookies = {"st_session": u.cookies.get("st_session")}

    async def run() -> tuple[list[int], float]:
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://testserver", cookies=cookies, timeout=120) as c:
            t0 = time.perf_counter()
            rs = await asyncio.gather(*[c.get(f"{API}/dashboard") for _ in range(120)])
            return [r.status_code for r in rs], time.perf_counter() - t0

    codes, seconds = asyncio.run(run())
    assert set(codes) == {200}, {c: codes.count(c) for c in set(codes)}
    assert seconds < 25, f"requests stalled for {seconds:.0f}s"


# --------------------------------------------------- F-04 exports keep copies of deleted evidence


def _export_objects(user_id: str) -> int:
    d = get_storage().root / "results" / user_id / "exports"  # type: ignore[attr-defined]
    return sum(1 for p in d.rglob("*") if p.is_file()) if d.is_dir() else 0


def test_f04_deleting_an_investigation_removes_archives_that_contain_it(app):
    u = make_user(app)
    inv = u.post(f"{API}/investigations", json={"title": "Case"}).json()["id"]
    upload_evidence(u, jpeg(62, 1), investigation_id=inv)
    assert u.post(f"{API}/investigations/{inv}/export").status_code == 202
    assert u.post(f"{API}/account/export").status_code == 202
    assert [e["status"] for e in u.get(f"{API}/account/exports").json()] == ["ready", "ready"]
    assert _export_objects(u.user_id) == 2
    assert u.delete(f"{API}/investigations/{inv}").status_code == 204
    assert u.get(f"{API}/account/exports").json() == []
    assert _export_objects(u.user_id) == 0, "export archives still hold the deleted evidence"


def test_f04_deleting_evidence_and_retention_purge_remove_archives(app):
    u = make_user(app)
    inv = u.post(f"{API}/investigations", json={"title": "Case"}).json()["id"]
    eid = upload_evidence(u, jpeg(62, 2), investigation_id=inv)
    upload_evidence(u, jpeg(62, 3), investigation_id=inv)
    u.post(f"{API}/account/export")
    assert u.delete(f"{API}/evidence/{eid}").status_code == 204
    assert u.get(f"{API}/account/exports").json() == [] and _export_objects(u.user_id) == 0

    u.post(f"{API}/investigations/{inv}/export")
    assert _export_objects(u.user_id) == 1
    with session_scope() as db:
        db.get(Investigation, uuid.UUID(inv)).retention_until = utcnow() - timedelta(minutes=1)
    assert jobs.purge_expired()["investigations"] >= 1
    assert _export_objects(u.user_id) == 0, "the retention purge left the investigation's export archive behind"
    with session_scope() as db:
        assert db.scalar(select(DataExport.id).where(DataExport.user_id == uuid.UUID(u.user_id))) is None


def test_f04_an_expired_export_has_no_download_link(app):
    u = make_user(app)
    u.post(f"{API}/account/export")
    assert u.get(f"{API}/account/exports").json()[0]["download_url"]
    with session_scope() as db:
        db.scalar(select(DataExport).where(DataExport.user_id == uuid.UUID(u.user_id))).expires_at = utcnow() - timedelta(seconds=5)
    assert u.get(f"{API}/account/exports").json()[0]["download_url"] is None


# ------------------------------------------------------------- F-08 NUL bytes cause internal errors


def test_f08_nul_bytes_are_handled_as_ordinary_bad_input(anon, user):
    r = anon.post(f"{API}/auth/login", json={"email": "a\x00@example.com", "password": PASSWORD})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    r = user.get(f"{API}/investigations", params={"q": "a\x00b"})
    assert r.status_code == 200 and r.json()["total"] == 0
    r = user.get(f"{API}/account/audit", params={"action": "auth\x00"})
    assert r.status_code == 200


# ----------------------------------------- F-09 non-ASCII secrets in headers cause internal errors


def test_f09_non_ascii_csrf_and_internal_headers_fail_closed_without_error(app, user, monkeypatch):
    raw = Client(app)
    raw.cookies = user.cookies
    r = raw.patch(f"{API}/auth/me", json={"display_name": "x"}, headers={"X-CSRF-Token": b"\xff\xfe-token"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "csrf_failed"
    r = raw.post(f"{API}/internal/jobs/{uuid.uuid4()}/run", headers={"X-ST-Internal": b"\xff\xfe"})
    assert r.status_code == 404
    monkeypatch.setenv("CRON_SECRET", "cron-secret-for-test")
    assert raw.get(f"{API}/internal/maintenance", headers={"Authorization": b"Bearer \xff"}).status_code == 404
    assert raw.get(f"{API}/internal/maintenance", headers={"Authorization": "Bearer cron-secret-for-test"}).status_code == 200


# ------------------------------------------------- F-10 file tokens are not bound to the owner's keys


def test_f10_a_token_for_another_accounts_object_is_refused_even_when_validly_signed(user, other):
    eid = upload_evidence(user, jpeg(63, 1))
    with session_scope() as db:
        key = db.get(Evidence, uuid.UUID(eid)).object_key
    assert key.startswith(f"{user.user_id}/")
    # Signed with the real key, as an attacker could do with a leaked or default ST_SECRET_KEY.
    forged = make_file_token(bucket="evidence", key=key, user_id=other.user_id, filename="x.jpg", content_type="image/jpeg")
    assert other.get(f"{API}/files/{forged}").status_code == 404
    own = make_file_token(bucket="evidence", key=key, user_id=user.user_id, filename="x.jpg", content_type="image/jpeg")
    assert user.get(f"{API}/files/{own}").status_code == 200


# ------------------------------------------------------ F-11 http dispatch runs a job twice on replay


def test_f11_replayed_internal_call_does_not_run_a_job_twice(app, settings, monkeypatch):
    u = make_user(app)
    ran: list[uuid.UUID] = []
    monkeypatch.setitem(jobs.HANDLERS, "export", lambda jid: ran.append(jid))
    settings.jobs_inline = False
    settings.job_dispatch = "http"

    def new_job(status: str) -> str:
        with session_scope() as db:
            job = Job(user_id=uuid.UUID(u.user_id), kind="export", target_type="export", target_id=uuid.uuid4(), status=status)
            db.add(job)
            db.flush()
            return str(job.id)

    running = new_job("running")  # an invocation is already executing this job
    jobs.execute(running)
    assert ran == [], "a second invocation re-ran a job that was already running"

    queued = new_job("queued")
    threads = [threading.Thread(target=jobs.execute, args=(queued,)) for _ in range(4)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert ran == [uuid.UUID(queued)], f"concurrent invocations ran the job {len(ran)} times"

    # The queue worker may still re-run a job whose previous attempt died without updating its row.
    settings.job_dispatch = "rq"
    jobs.execute(new_job("running"))
    assert len(ran) == 2


# ----------------------------------------------------------------------- F-12 audit trail details


def test_f12_export_deletion_is_audited_and_account_deletion_keeps_no_address(app):
    u = make_user(app)
    ex = u.post(f"{API}/account/export").json()["export"]["id"]
    assert u.delete(f"{API}/account/exports/{ex}").status_code == 204
    actions = [a["action"] for a in u.get(f"{API}/account/audit").json()["items"]]
    assert "export.deleted" in actions
    r = u.request("DELETE", f"{API}/account", json={"password": PASSWORD, "confirm": "DELETE MY ACCOUNT"})
    assert r.status_code == 204
    with session_scope() as db:
        last = db.scalar(select(AuditLog).where(AuditLog.action == "account.deleted").order_by(AuditLog.id.desc()).limit(1))
        assert last.user_id is None and last.ip is None, "the anonymous deletion record still carries the source address"


def test_f01_parallel_uploads_per_account_are_bounded(user, other):
    from app import deps

    uid = uuid.UUID(user.user_id)
    deps._uploading[uid] = deps.MAX_PARALLEL_UPLOADS  # as if that many uploads were being decoded
    try:
        r = user.post(f"{API}/evidence", files=files([("a.jpg", jpeg(61, 5))]))
        assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_uploads"
        upload_evidence(other, jpeg(61, 6))  # other accounts are unaffected
    finally:
        deps._uploading.pop(uid, None)
    upload_evidence(user, jpeg(61, 5))
    assert uid not in deps._uploading, "the slot was not released"


# ---------------------------------------------------------------- decisions taken after the audit


def test_one_client_cannot_lock_everyone_out_of_sign_in(app, settings):
    """F-13: without real client addresses, bad sign-ins for one account must not block another."""
    from app.deps import get_redis
    from tests.conftest import API, PASSWORD, Client, make_user

    victim = make_user(app)
    for key in get_redis().scan_iter("rl:auth-*"):
        get_redis().delete(key)
    settings.rate_auth_per_15min = 5
    settings.trust_forwarded_for = False
    attacker = Client(app)
    codes = [attacker.post(f"{API}/auth/login", json={"email": "target@audit-sensortrace.dev", "password": "wrong-password-xx"}).status_code for _ in range(12)]
    assert codes[:5] == [401] * 5 and set(codes[5:]) == {429}  # the attacked account is throttled
    fresh = Client(app)
    assert fresh.post(f"{API}/auth/login", json={"email": victim.email, "password": PASSWORD}).status_code == 200


def test_password_change_revokes_api_tokens_and_tokens_cannot_manage_sessions(app):
    """F-17."""
    from tests.conftest import API, PASSWORD, Client, make_user

    c = make_user(app)
    token = c.post(f"{API}/auth/tokens", json={"name": "t"}).json()["token"]
    api = Client(app)
    h = {"Authorization": f"Bearer {token}"}
    sid = c.get(f"{API}/auth/sessions").json()[0]["id"]
    assert api.delete(f"{API}/auth/sessions/{sid}", headers=h).status_code == 403
    assert c.get(f"{API}/auth/me").status_code == 200
    assert c.post(f"{API}/auth/password", json={"current_password": PASSWORD, "new_password": "a-different-long-passphrase"}).status_code == 204
    assert api.get(f"{API}/auth/me", headers=h).status_code == 401


def test_reports_survive_very_long_text(app):
    """F-16: long acquisition notes, descriptions and notes must not break report generation."""
    import io

    from pypdf import PdfReader

    from tests.conftest import API, enrol_sensor, jpeg, make_user, upload_evidence

    c = make_user(app)
    a = enrol_sensor(c, 301, n=3)
    inv = c.post(f"{API}/investigations", json={"title": "Long", "description": "d" * 3700}).json()
    ev = upload_evidence(c, jpeg(301, 50), investigation_id=inv["id"])
    assert c.patch(f"{API}/evidence/{ev}", json={"acquisition": {"notes": "n" * 4100, "source": "s" * 290}}).status_code == 200
    assert c.post(f"{API}/investigations/{inv['id']}/notes", json={"body": "x" * 15000}).status_code == 201
    an = c.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [a["sensor_id"]], "investigation_id": inv["id"]}).json()["analyses"][0]
    r = c.post(f"{API}/analyses/{an['id']}/reports")
    assert r.status_code == 201, r.text
    text = "".join(p.extract_text() for p in PdfReader(io.BytesIO(c.get(r.json()["download_url"]).content)).pages)
    assert "shortened in this report" in text and "Idealised" not in text and "p-value" not in text.lower()
    assert c.post(f"{API}/investigations/{inv['id']}/reports").status_code == 201
