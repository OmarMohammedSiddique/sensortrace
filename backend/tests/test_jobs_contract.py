"""Background jobs (queueing, cancellation, retry), migrations, API contract and storage."""

from __future__ import annotations

import os
import uuid

import pytest
from sqlalchemy import select

from app import jobs
from app.db import session_scope
from app.models import Fingerprint, Job
from tests.conftest import API, alembic_config, files, jpeg, make_user


def _sensor_with_refs(c, seed: int, n: int = 4) -> str:
    dev = c.post(f"{API}/devices", json={"name": "D", "pipeline_class": "conventional"}).json()
    sid = c.post(f"{API}/devices/{dev['id']}/sensors", json={"name": "S"}).json()["id"]
    assert c.post(f"{API}/sensors/{sid}/references", files=files([(f"r{i}.jpg", jpeg(seed, i, True)) for i in range(n)])).json()["accepted"] == n
    return sid


def _burst_worker():
    from rq import Queue, SimpleWorker

    from app.deps import get_redis

    conn = get_redis()
    SimpleWorker([Queue(jobs.QUEUE_NAME, connection=conn)], connection=conn).work(burst=True)


def test_job_runs_through_the_real_redis_queue(app, settings):
    settings.jobs_inline = False
    c = make_user(app)
    sid = _sensor_with_refs(c, 91)
    started = c.post(f"{API}/sensors/{sid}/fingerprints").json()
    assert started["job"]["status"] == "queued" and started["fingerprint"]["status"] == "pending"
    assert c.post(f"{API}/sensors/{sid}/fingerprints").json()["error"]["code"] == "fingerprint_in_progress"
    assert c.get(f"{API}/jobs", params={"active": True}).json()["total"] == 1
    _burst_worker()
    job = c.get(f"{API}/jobs/{started['job']['id']}").json()
    assert job["status"] == "succeeded" and job["progress"] == 1.0 and job["attempts"] == 1 and job["finished_at"]
    assert c.get(f"{API}/fingerprints/{started['fingerprint']['id']}").json()["status"] == "ready"
    assert c.get(f"{API}/jobs", params={"active": True}).json()["total"] == 0


def test_queued_job_can_be_cancelled_and_is_then_skipped(app, settings):
    settings.jobs_inline = False
    c = make_user(app)
    sid = _sensor_with_refs(c, 92)
    started = c.post(f"{API}/sensors/{sid}/fingerprints").json()
    r = c.post(f"{API}/jobs/{started['job']['id']}/cancel")
    assert r.status_code == 200 and r.json()["status"] == "cancelled"
    assert c.post(f"{API}/jobs/{started['job']['id']}/cancel").json()["error"]["code"] == "job_finished"
    _burst_worker()  # the worker picks the message up and must do nothing
    fp = c.get(f"{API}/fingerprints/{started['fingerprint']['id']}").json()
    assert fp["status"] == "cancelled" and fp["digest"] is None
    assert c.get(f"{API}/sensors/{sid}").json()["active_fingerprint_id"] is None
    # A new fingerprint can be requested afterwards.
    settings.jobs_inline = True
    assert c.post(f"{API}/sensors/{sid}/fingerprints").json()["job"]["status"] == "succeeded"


def test_running_job_stops_at_next_checkpoint_when_cancelled(app, monkeypatch):
    c = make_user(app)
    sid = _sensor_with_refs(c, 93, n=6)
    real = jobs._Reporter.progress
    state = {"n": 0}

    def progress(self, stage, done, total):
        state["n"] += 1
        if state["n"] == 3:  # user presses cancel while the job is running
            with session_scope() as db:
                db.get(Job, self.job_id).cancel_requested = True
            self._last_check = 0.0
        return real(self, stage, done, total)

    monkeypatch.setattr(jobs._Reporter, "progress", progress)
    started = c.post(f"{API}/sensors/{sid}/fingerprints").json()
    job = c.get(f"{API}/jobs/{started['job']['id']}").json()
    assert job["status"] == "cancelled" and job["error"] == "Cancelled by user."
    assert c.get(f"{API}/fingerprints/{started['fingerprint']['id']}").json()["status"] == "cancelled"


def test_transient_failures_are_retried_then_reported_without_leaking_details(app, settings, monkeypatch):
    settings.jobs_inline = False
    c = make_user(app)
    sid = _sensor_with_refs(c, 94)
    started = c.post(f"{API}/sensors/{sid}/fingerprints").json()
    jid = started["job"]["id"]
    calls = {"n": 0}
    real = jobs.HANDLERS["fingerprint"]

    def flaky(job_id):
        calls["n"] += 1
        if calls["n"] < 3:
            raise ConnectionError("storage backend at 10.0.0.5:9000 refused connection (secret detail)")
        return real(job_id)

    monkeypatch.setitem(jobs.HANDLERS, "fingerprint", flaky)
    for attempt in (1, 2):
        with pytest.raises(ConnectionError):  # re-raised so the queue schedules a retry
            jobs.execute(jid)
        j = c.get(f"{API}/jobs/{jid}").json()
        assert j["status"] == "queued" and j["stage"] == "retrying" and j["attempts"] == attempt
    jobs.execute(jid)
    j = c.get(f"{API}/jobs/{jid}").json()
    assert j["status"] == "succeeded" and j["attempts"] == 3

    # A job that keeps failing ends as failed with a generic message.
    sid2 = _sensor_with_refs(c, 95)
    started2 = c.post(f"{API}/sensors/{sid2}/fingerprints").json()
    monkeypatch.setitem(jobs.HANDLERS, "fingerprint", lambda job_id: (_ for _ in ()).throw(ConnectionError("10.0.0.5 secret detail")))
    for _ in range(jobs.MAX_ATTEMPTS - 1):
        with pytest.raises(ConnectionError):
            jobs.execute(started2["job"]["id"])
    jobs.execute(started2["job"]["id"])
    j2 = c.get(f"{API}/jobs/{started2['job']['id']}").json()
    assert j2["status"] == "failed" and "secret" not in j2["error"] and "10.0.0.5" not in j2["error"]
    fp2 = c.get(f"{API}/fingerprints/{started2['fingerprint']['id']}").json()
    assert fp2["status"] == "failed" and "internal error" in fp2["error"].lower()
    # Executing a finished job again is a no-op.
    jobs.execute(started2["job"]["id"])
    assert c.get(f"{API}/jobs/{started2['job']['id']}").json()["attempts"] == jobs.MAX_ATTEMPTS


def test_engine_errors_fail_immediately_with_a_readable_message(app):
    c = make_user(app)
    dev = c.post(f"{API}/devices", json={"name": "D"}).json()
    sid = c.post(f"{API}/devices/{dev['id']}/sensors", json={"name": "S"}).json()["id"]
    # Two references that are exact pixel duplicates in different containers leave one usable image.
    from sensortrace_engine.synthetic import SyntheticSensor, encode_png

    img = SyntheticSensor(96, (512, 640)).capture(1, flat=True)
    small = SyntheticSensor(96, (256, 256)).capture(2, flat=True)
    c.post(f"{API}/sensors/{sid}/references", files=files([("a.png", encode_png(img)), ("b.png", encode_png(small))]))
    started = c.post(f"{API}/sensors/{sid}/fingerprints").json()
    job = c.get(f"{API}/jobs/{started['job']['id']}").json()
    assert job["status"] == "failed" and job["attempts"] == 1 and "usable reference image" in job["error"]


def test_active_job_limit(app, settings):
    settings.jobs_inline = False
    settings.max_active_jobs_per_user = 1
    c = make_user(app)
    s1, s2 = _sensor_with_refs(c, 97), _sensor_with_refs(c, 98)
    first = c.post(f"{API}/sensors/{s1}/fingerprints")
    assert first.status_code == 202
    r = c.post(f"{API}/sensors/{s2}/fingerprints")
    assert r.status_code == 429 and r.json()["error"]["code"] == "too_many_jobs"
    with session_scope() as db:  # the refused request left no orphan fingerprint row
        assert db.scalar(select(Fingerprint).where(Fingerprint.sensor_id == uuid.UUID(s2))) is None
    c.post(f"{API}/jobs/{first.json()['job']['id']}/cancel")
    _burst_worker()


def test_retention_purge(app):
    from datetime import timedelta

    from app.models import Investigation, utcnow

    c = make_user(app)
    keep = c.post(f"{API}/investigations", json={"title": "keep", "retention_days": 30}).json()
    gone = c.post(f"{API}/investigations", json={"title": "expired", "retention_days": 1}).json()
    assert keep["retention_until"] and gone["retention_until"]
    ev = c.post(f"{API}/evidence", files=files([("e.jpg", jpeg(99, 1))]), data={"investigation_id": gone["id"]}).json()["results"][0]["id"]
    with session_scope() as db:
        db.get(Investigation, gone["id"]).retention_until = utcnow() - timedelta(hours=1)
    out = jobs.purge_expired()
    assert out["investigations"] == 1
    assert c.get(f"{API}/investigations/{gone['id']}").status_code == 404 and c.get(f"{API}/evidence/{ev}").status_code == 404
    assert c.get(f"{API}/investigations/{keep['id']}").status_code == 200
    assert c.patch(f"{API}/investigations/{keep['id']}", json={"retention_days": 0}).json()["retention_until"] is None


# ---------------------------------------------------------------- migrations


def test_migrations_downgrade_and_upgrade_cleanly_and_match_models():
    import psycopg
    from alembic.autogenerate import compare_metadata
    from alembic.migration import MigrationContext
    from sqlalchemy import create_engine, inspect

    from alembic import command
    from app.config import get_settings
    from app.db import Base
    from tests.conftest import BASE_DB

    name = "sensortrace_migration_test"
    with psycopg.connect(f"{BASE_DB}/postgres", autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {name}")
    s = get_settings()
    original = s.database_url
    s.database_url = original.rsplit("/", 1)[0] + f"/{name}"
    try:
        cfg = alembic_config()
        command.upgrade(cfg, "head")
        eng = create_engine(s.database_url)
        tables = set(inspect(eng).get_table_names())
        assert {"users", "sessions", "devices", "sensors", "fingerprints", "evidence", "analyses", "jobs", "audit_log", "reports"} <= tables
        with eng.connect() as conn:
            diff = compare_metadata(MigrationContext.configure(conn), Base.metadata)
        assert diff == [], f"models and migrations have drifted: {diff}"
        command.downgrade(cfg, "base")
        assert set(inspect(eng).get_table_names()) <= {"alembic_version"}
        command.upgrade(cfg, "head")
        assert "users" in inspect(eng).get_table_names()
        eng.dispose()
    finally:
        s.database_url = original
        with psycopg.connect(f"{BASE_DB}/postgres", autocommit=True) as conn:
            conn.execute(f"DROP DATABASE IF EXISTS {name} WITH (FORCE)")


# ------------------------------------------------------------- API contract


def test_openapi_document_covers_the_public_surface(app, anon):
    spec = anon.get(f"{API}/openapi.json").json()
    paths = spec["paths"]
    required = [
        ("post", "/auth/register"), ("post", "/auth/login"), ("post", "/auth/logout"), ("get", "/auth/me"), ("post", "/auth/tokens"),
        ("get", "/devices"), ("post", "/devices"), ("post", "/devices/{device_id}/sensors"), ("get", "/sensors"),
        ("post", "/sensors/{sensor_id}/references"), ("post", "/sensors/{sensor_id}/fingerprints"), ("get", "/fingerprints/{fingerprint_id}"),
        ("get", "/investigations"), ("post", "/investigations"), ("post", "/evidence"), ("get", "/evidence/{evidence_id}"),
        ("post", "/analyses"), ("get", "/analyses/{analysis_id}"), ("get", "/policies"), ("get", "/jobs"), ("post", "/jobs/{job_id}/cancel"),
        ("post", "/analyses/{analysis_id}/reports"), ("get", "/reports"), ("post", "/account/export"), ("delete", "/account"),
        ("get", "/account/audit"), ("get", "/dashboard"), ("get", "/health"), ("get", "/meta"), ("get", "/files/{token}"),
    ]  # fmt: skip
    for method, path in required:
        assert method in paths[f"{API}{path}"], f"{method.upper()} {path} missing from OpenAPI"
    for path, ops in paths.items():
        for method, op in ops.items():
            assert op.get("tags"), f"{method} {path} has no tag"
            assert op.get("summary") or op.get("description"), f"{method} {path} undocumented"
    assert "ErrorResponse" in spec["components"]["schemas"] and spec["info"]["version"]
    assert anon.get(f"{API}/docs").status_code == 200


def test_error_and_pagination_shapes(user, anon):
    r = user.get(f"{API}/devices/{uuid.uuid4()}")
    assert r.status_code == 404 and set(r.json()) == {"error"} and set(r.json()["error"]) == {"code", "message", "details"}
    r = user.get(f"{API}/devices/not-a-uuid")
    assert r.status_code == 422 and r.json()["error"]["code"] == "validation_error" and r.json()["error"]["details"][0]["field"]
    r = user.post(f"{API}/devices", json={"name": ""})
    assert r.status_code == 422
    assert anon.get(f"{API}/nope").json()["error"]["code"] == "not_found"
    assert user.put(f"{API}/devices").json()["error"]["code"] == "method_not_allowed"
    for i in range(3):
        user.post(f"{API}/investigations", json={"title": f"Inv {i}"})
    page = user.get(f"{API}/investigations", params={"limit": 2, "offset": 1}).json()
    assert set(page) == {"items", "total", "limit", "offset"} and page["total"] == 3 and len(page["items"]) == 2 and page["limit"] == 2
    assert user.get(f"{API}/investigations", params={"limit": 0}).status_code == 422
    assert user.get(f"{API}/investigations", params={"limit": 100000}).status_code == 422


def test_health_and_meta_are_public_and_complete(anon):
    h = anon.get(f"{API}/health")
    assert h.status_code == 200 and h.json() == {"status": "ok", "checks": {"database": True, "redis": True, "storage": True}}
    m = anon.get(f"{API}/meta").json()
    assert m["algorithm_version"].startswith("prnu-") and m["supported_formats"] == ["image/jpeg", "image/png"]
    assert len(m["reference_guidance"]) >= 5 and len(m["limitations"]) >= 5 and m["limits"]["max_upload_bytes"] > 0


def test_policies_endpoint_marks_default_as_uncalibrated(user):
    pols = user.get(f"{API}/policies").json()
    assert pols[0]["policy_id"] == "literature-reference-uncalibrated" and pols[0]["calibrated"] is False
    assert "No error rate" in pols[0]["basis"]


# ------------------------------------------------------------------ storage


def test_local_storage_rejects_traversal(tmp_path):
    from app.storage import LocalStorage

    st = LocalStorage(str(tmp_path))
    st.put("evidence", "u1/a/file.bin", b"data")
    assert st.get("evidence", "u1/a/file.bin") == b"data" and st.exists("evidence", "u1/a/file.bin")
    for bad in ("../x", "u1/../../x", "/etc/passwd", "u1//x", "u1/./x", "u1\\x", "", "u1/x\x00"):
        with pytest.raises(ValueError):
            st.put("evidence", bad, b"x")
    with pytest.raises(ValueError):
        st.put("public", "u1/x", b"x")
    with pytest.raises(KeyError):
        st.get("evidence", "u1/missing")
    st.put("evidence", "u1/b/2.bin", b"2")
    st.put("evidence", "u2/a/1.bin", b"1")
    assert st.delete_prefix("evidence", "u1") == 2 and not st.exists("evidence", "u1/a/file.bin") and st.exists("evidence", "u2/a/1.bin")


def test_s3_storage_roundtrip_against_local_object_store():
    """Runs against the compose object store; skipped when it is not reachable."""
    import socket

    from app.config import Settings
    from app.storage import S3Storage

    port = int(os.environ.get("ST_TEST_S3_PORT", "9100"))
    try:
        socket.create_connection(("127.0.0.1", port), timeout=1).close()
    except OSError:
        pytest.skip("object store not running")
    prefix = f"test-{uuid.uuid4().hex[:8]}"
    st = S3Storage(Settings(storage_backend="s3", s3_endpoint_url=f"http://127.0.0.1:{port}", s3_access_key=os.environ.get("ST_TEST_S3_ACCESS_KEY", "sensortrace"),
                            s3_secret_key=os.environ.get("ST_TEST_S3_SECRET_KEY", "sensortrace-dev-secret"), s3_bucket_evidence=f"{prefix}-evidence",
                            s3_bucket_derived=f"{prefix}-derived", s3_bucket_results=f"{prefix}-results"))  # fmt: skip
    st.ensure_buckets()
    assert st.ready()
    st.put("evidence", "u1/a/x.bin", b"\x00\x01payload", "application/octet-stream")
    st.put("evidence", "u1/b/y.bin", b"y")
    assert st.get("evidence", "u1/a/x.bin") == b"\x00\x01payload" and st.exists("evidence", "u1/a/x.bin")
    with pytest.raises(KeyError):
        st.get("evidence", "u1/missing")
    with pytest.raises(ValueError):
        st.get("evidence", "../escape")
    st.delete("evidence", "u1/a/x.bin")
    assert not st.exists("evidence", "u1/a/x.bin")
    assert st.delete_prefix("evidence", "u1") == 1
    # Buckets are private: an unauthenticated request is refused.
    import urllib.error
    import urllib.request

    st.put("evidence", "u1/private.bin", b"secret")
    with pytest.raises(urllib.error.HTTPError) as exc:
        urllib.request.urlopen(f"http://127.0.0.1:{port}/{prefix}-evidence/u1/private.bin", timeout=3)
    assert exc.value.code in (401, 403)
    st.delete_prefix("evidence", "u1")
