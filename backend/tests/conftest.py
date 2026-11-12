"""Integration test fixtures: a real PostgreSQL database, real Redis, local-disk object storage.

Start dependencies with ``docker compose up -d db redis objectstore`` from the repository root.
"""

from __future__ import annotations

import io
import os
import tempfile
import uuid
from functools import cache

import psycopg
import pytest

_TMP = tempfile.mkdtemp(prefix="sensortrace-test-")
BASE_DB = os.environ.get("ST_TEST_DATABASE_BASE", "postgresql://sensortrace:sensortrace@localhost:54329")
TEST_DB = "sensortrace_test"
os.environ.update(
    ST_ENVIRONMENT="test",
    ST_DATABASE_URL=f"{BASE_DB.replace('postgresql://', 'postgresql+psycopg://')}/{TEST_DB}",
    ST_REDIS_URL=os.environ.get("ST_TEST_REDIS_URL", "redis://localhost:63799/15"),
    ST_STORAGE_BACKEND="local",
    ST_STORAGE_LOCAL_PATH=_TMP,
    ST_JOBS_INLINE="true",
    ST_RATE_AUTH_PER_15MIN="100000",
    ST_RATE_API_PER_MINUTE="100000",
    ST_RATE_UPLOAD_PER_HOUR="100000",
    ST_POLICIES_DIR=os.path.join(_TMP, "no-policies"),
)

from alembic.config import Config  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sensortrace_engine.synthetic import SyntheticSensor, encode_jpeg  # noqa: E402

from alembic import command  # noqa: E402
from app.config import get_settings  # noqa: E402
from app.deps import get_redis  # noqa: E402
from app.main import create_app  # noqa: E402

API = "/api/v1"
SHAPE = (512, 640)
PASSWORD = "correct-horse-battery-staple"


def alembic_config() -> Config:
    here = os.path.dirname(os.path.dirname(__file__))
    cfg = Config(os.path.join(here, "alembic.ini"))
    cfg.set_main_option("script_location", os.path.join(here, "alembic"))
    return cfg


@pytest.fixture(scope="session", autouse=True)
def _database():
    with psycopg.connect(f"{BASE_DB}/postgres", autocommit=True) as conn:
        conn.execute(f"DROP DATABASE IF EXISTS {TEST_DB} WITH (FORCE)")
        conn.execute(f"CREATE DATABASE {TEST_DB}")
    command.upgrade(alembic_config(), "head")
    get_redis().flushdb()
    yield


@pytest.fixture(scope="session")
def app():
    return create_app()


class Client(TestClient):
    """Test client that sends the CSRF token the way the browser application does."""

    csrf: str | None = None

    def request(self, method, url, **kw):  # type: ignore[override]
        if self.csrf and method.upper() not in ("GET", "HEAD", "OPTIONS"):
            headers = dict(kw.pop("headers", None) or {})
            headers.setdefault("X-CSRF-Token", self.csrf)
            kw["headers"] = headers
        return super().request(method, url, **kw)


@pytest.fixture
def anon(app) -> Client:
    return Client(app)


def make_user(app, email: str | None = None) -> Client:
    c = Client(app)
    email = email or f"user-{uuid.uuid4().hex[:10]}@example.com"
    r = c.post(f"{API}/auth/register", json={"email": email, "password": PASSWORD, "display_name": "Test User"})
    assert r.status_code == 201, r.text
    c.csrf = r.json()["csrf_token"]
    c.email = email  # type: ignore[attr-defined]
    c.user_id = r.json()["user"]["id"]  # type: ignore[attr-defined]
    return c


@pytest.fixture
def user(app) -> Client:
    return make_user(app)


@pytest.fixture
def other(app) -> Client:
    return make_user(app)


@cache
def sensor(seed: int) -> SyntheticSensor:
    return SyntheticSensor(seed, SHAPE, prnu_strength=0.012)


@cache
def jpeg(seed: int, index: int, flat: bool = False, quality: int = 96) -> bytes:
    return encode_jpeg(sensor(seed).capture(index, flat=flat), quality)


def files(payloads: list[tuple[str, bytes]], field: str = "files"):
    return [(field, (name, io.BytesIO(data), "image/jpeg")) for name, data in payloads]


def enrol_sensor(c: Client, seed: int, *, n: int = 20, name: str = "Camera", pipeline: str = "conventional", make="Acme", model="X1") -> dict:
    """Create a device and sensor, upload ``n`` synthetic flat references and build a fingerprint."""
    dev = c.post(f"{API}/devices", json={"name": name, "make": make, "model": model, "pipeline_class": pipeline, "device_type": "dedicated_camera"})
    assert dev.status_code == 201, dev.text
    sen = c.post(f"{API}/devices/{dev.json()['id']}/sensors", json={"name": "Main"})
    assert sen.status_code == 201, sen.text
    sid = sen.json()["id"]
    up = c.post(f"{API}/sensors/{sid}/references", files=files([(f"ref{i}.jpg", jpeg(seed, i, True)) for i in range(n)]))
    assert up.status_code == 200 and up.json()["accepted"] == n, up.text
    fp = c.post(f"{API}/sensors/{sid}/fingerprints")
    assert fp.status_code == 202, fp.text
    return {"device_id": dev.json()["id"], "sensor_id": sid, "fingerprint_id": fp.json()["fingerprint"]["id"], "job": fp.json()["job"]}


def upload_evidence(c: Client, data: bytes, name: str = "questioned.jpg", **form) -> str:
    r = c.post(f"{API}/evidence", files=files([(name, data)]), data=form)
    assert r.status_code == 200 and r.json()["accepted"] == 1, r.text
    return r.json()["results"][0]["id"]


@pytest.fixture(scope="session")
def lab(app):
    """A user with two enrolled synthetic cameras (seeds 1 and 2). Shared, read-mostly."""
    c = make_user(app)
    a = enrol_sensor(c, 1, name="Camera A")
    b = enrol_sensor(c, 2, name="Camera B")
    return c, a, b


@pytest.fixture
def settings():
    """Mutable settings; restored after the test."""
    s = get_settings()
    saved = s.model_dump()
    yield s
    for k, v in saved.items():
        setattr(s, k, v)
