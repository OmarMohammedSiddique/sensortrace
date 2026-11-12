"""Upload abuse: hostile files, hostile filenames, limits and quotas."""

from __future__ import annotations

import io
import struct
import zlib

import pytest

from tests.conftest import API, files, jpeg, make_user


@pytest.fixture(scope="module")
def c(app):
    return make_user(app)


def _post(c, name: str, data: bytes, mime: str = "image/jpeg"):
    return c.post(f"{API}/evidence", files=[("files", (name, io.BytesIO(data), mime))])


def _png_header_only(width: int, height: int) -> bytes:
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(b"\x00" * 64))
        + chunk(b"IEND", b"")
    )


HOSTILE = [
    ("script.jpg", b"<script>alert(1)</script>", "unsupported_format"),
    ("shell.jpg", b"#!/bin/sh\nrm -rf /\n", "unsupported_format"),
    ("exe.png", b"MZ\x90\x00\x03" + b"\x00" * 100, "unsupported_format"),
    ("page.html", b"<!doctype html><html><body onload=alert(1)>", "unsupported_format"),
    ("vector.svg", b'<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>', "unsupported_format"),
    ("anim.gif", b"GIF89a" + b"\x00" * 50, "unsupported_format"),
    ("doc.pdf", b"%PDF-1.7\n%%EOF", "unsupported_format"),
    ("archive.zip", b"PK\x03\x04" + b"\x00" * 50, "unsupported_format"),
    ("photo.heic", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 50, "unsupported_format"),
    ("empty.jpg", b"", "corrupt_image"),
    ("truncated.jpg", None, "corrupt_image"),
    ("bomb.png", _png_header_only(50000, 50000), "image_too_large"),
    ("tiny.png", None, "image_too_small"),
]


@pytest.mark.parametrize("name,data,code", HOSTILE, ids=[h[0] for h in HOSTILE])
def test_hostile_files_are_rejected_and_nothing_is_stored(c, name, data, code):
    if name == "truncated.jpg":
        data = jpeg(81, 1)[:3000]
    if name == "tiny.png":
        from sensortrace_engine.synthetic import SyntheticSensor, encode_png

        data = encode_png(SyntheticSensor(1, (128, 128)).capture(1)[:40, :40])
    before = c.get(f"{API}/account/usage").json()
    r = _post(c, name, data)
    assert r.status_code == 200, r.text
    res = r.json()["results"][0]
    assert res["accepted"] is False and res["error"]["code"] == code, res
    assert c.get(f"{API}/account/usage").json() == before


def test_polyglot_jpeg_with_script_payload_is_stored_inert(c):
    """A valid JPEG with HTML appended is accepted as an image but can never run: it is served
    only as an attachment with a generic content type."""
    data = jpeg(81, 2) + b"<script>alert(document.cookie)</script>"
    r = _post(c, "polyglot.jpg", data, "text/html")
    res = r.json()["results"][0]
    assert res["accepted"]
    ev = c.get(f"{API}/evidence/{res['id']}").json()
    assert ev["mime_type"] == "image/jpeg"  # client-declared text/html was ignored
    d = c.get(ev["download_url"])
    assert d.headers["content-type"] == "application/octet-stream" and d.headers["content-disposition"].startswith("attachment")
    assert d.content == data  # bytes preserved for evidential integrity


@pytest.mark.parametrize(
    "name,expected",
    [
        ("../../etc/passwd", "passwd"),
        ("..\\..\\windows\\system32\\evil.jpg", "evil.jpg"),
        ("/absolute/path/photo.jpg", "photo.jpg"),
        ('<img src=x onerror="alert(1)">.jpg', None),
        ("nul\x00byte.jpg", None),
        ("a" * 600 + ".jpg", None),
        ("", "upload"),
    ],
)
def test_hostile_filenames_are_neutralised(c, name, expected):
    r = c.post(f"{API}/evidence", files=[("files", (name or "blank", io.BytesIO(jpeg(81, 3)), "image/jpeg"))])
    res = r.json()["results"][0]
    assert res["accepted"], res
    stored = c.get(f"{API}/evidence/{res['id']}").json()["filename"]
    assert "/" not in stored and "\\" not in stored and "<" not in stored and ">" not in stored and '"' not in stored
    assert "\x00" not in stored and len(stored) <= 200 and ".." not in stored.split(".jpg")[0][:2]
    if expected and name:
        assert stored == expected
    # The storage key never derives from the filename.
    from app.db import session_scope
    from app.models import Evidence

    with session_scope() as db:
        key = db.get(Evidence, res["id"]).object_key
    assert key.startswith(f"{c.user_id}/evidence/") and "passwd" not in key and "evil" not in key


def test_size_count_and_quota_limits(app, settings):
    u = make_user(app)
    settings.max_upload_bytes = 20_000
    r = _post(u, "big.jpg", jpeg(81, 4))
    assert r.status_code == 200 and r.json()["results"][0]["error"]["code"] == "file_too_large"
    settings.max_upload_bytes = 64 * 1024 * 1024

    settings.max_files_per_request = 2
    r = u.post(f"{API}/evidence", files=files([(f"f{i}.jpg", jpeg(81, 5)) for i in range(3)]))
    assert r.status_code == 400 and r.json()["error"]["code"] == "too_many_files"
    settings.max_files_per_request = 60

    settings.user_storage_quota_bytes = len(jpeg(81, 6)) + 10
    assert _post(u, "one.jpg", jpeg(81, 6)).json()["accepted"] == 1
    over = _post(u, "two.jpg", jpeg(81, 7)).json()["results"][0]
    assert over["accepted"] is False and over["error"]["code"] == "quota_exceeded"
    assert u.get(f"{API}/evidence").json()["total"] == 1


def test_oversized_request_body_is_refused_before_reading(c, settings):
    r = c.post(f"{API}/evidence", content=b"x", headers={"Content-Length": str(10**13), "Content-Type": "multipart/form-data; boundary=x"})
    assert r.status_code == 413 and r.json()["error"]["code"] == "request_too_large"
    settings.max_request_bytes = 50_000
    r = c.post(f"{API}/evidence", files=files([("a.jpg", jpeg(81, 9)), ("b.jpg", jpeg(81, 10))]))
    assert r.status_code == 413
    # A body without a declared length is not accepted.

    def gen():
        yield b"x" * 10

    r = c.post(f"{API}/evidence", content=gen(), headers={"Content-Type": "multipart/form-data; boundary=x"})
    assert r.status_code == 411 and r.json()["error"]["code"] == "length_required"


def test_reference_upload_rules(app, settings):
    u = make_user(app)
    dev = u.post(f"{API}/devices", json={"name": "D"}).json()
    sid = u.post(f"{API}/devices/{dev['id']}/sensors", json={"name": "S"}).json()["id"]
    r = u.post(f"{API}/sensors/{sid}/references", files=files([("a.jpg", jpeg(82, 1, True)), ("a-copy.jpg", jpeg(82, 1, True)), ("junk.jpg", b"nope")]))
    res = r.json()["results"]
    assert [x["accepted"] for x in res] == [True, False, False]
    assert res[1]["error"]["code"] == "duplicate" and res[2]["error"]["code"] == "unsupported_format"
    settings.max_reference_images = 2
    r = u.post(f"{API}/sensors/{sid}/references", files=files([("b.jpg", jpeg(82, 2, True)), ("c.jpg", jpeg(82, 3, True))]))
    assert [x["accepted"] for x in r.json()["results"]] == [True, False]
    assert r.json()["results"][1]["error"]["code"] == "too_many_references"


def test_duplicate_evidence_is_flagged_not_blocked(app):
    u = make_user(app)
    first = _post(u, "a.jpg", jpeg(83, 1)).json()["results"][0]
    second = _post(u, "b.jpg", jpeg(83, 1)).json()["results"][0]
    assert second["accepted"] and any("Identical file content" in w for w in second["warnings"])
    assert u.get(f"{API}/evidence/{second['id']}").json()["duplicate_of"] == [first["id"]]


def test_invalid_form_fields(c):
    r = c.post(f"{API}/evidence", files=files([("a.jpg", jpeg(81, 8))]), data={"acquisition": "{not json"})
    assert r.status_code == 400 and r.json()["error"]["code"] == "invalid_acquisition"
    r = c.post(f"{API}/evidence", files=files([("a.jpg", jpeg(81, 8))]), data={"category": "evil"})
    assert r.status_code == 422
    assert c.post(f"{API}/evidence").status_code == 422


def test_sql_injection_strings_are_treated_as_data(c):
    payload = "'; DROP TABLE users; --"
    inv = c.post(f"{API}/investigations", json={"title": payload, "reference": "x' OR '1'='1"}).json()
    assert inv["title"] == payload
    found = c.get(f"{API}/investigations", params={"q": payload}).json()
    assert found["total"] == 1 and found["items"][0]["id"] == inv["id"]
    assert c.get(f"{API}/investigations", params={"q": "%"}).json()["total"] == 0
    assert c.get(f"{API}/investigations", params={"q": "' OR 1=1 --"}).json()["total"] == 0
    assert c.get(f"{API}/account/audit", params={"action": "%"}).json()["total"] == 0
    assert c.get(f"{API}/auth/me").status_code == 200  # users table still exists
