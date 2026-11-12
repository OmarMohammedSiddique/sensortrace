"""End-to-end API workflow on real services: enrol, compare, report, export, delete."""

from __future__ import annotations

import io
import json
import zipfile

from pypdf import PdfReader

from app.storage import get_storage
from tests.conftest import API, PASSWORD, Client, enrol_sensor, files, jpeg, make_user, upload_evidence


def _pdf_text(c: Client, url: str) -> str:
    r = c.get(url)
    assert r.status_code == 200 and r.headers["content-type"] == "application/pdf"
    assert r.headers["content-disposition"].startswith("attachment")
    return "\n".join(p.extract_text() for p in PdfReader(io.BytesIO(r.content)).pages)


def test_fingerprint_is_created_and_reusable(lab):
    c, a, _ = lab
    assert a["job"]["status"] == "succeeded" and a["job"]["progress"] == 1.0
    fp = c.get(f"{API}/fingerprints/{a['fingerprint_id']}").json()
    assert fp["status"] == "ready" and fp["is_active"] and fp["version"] == 1 and fp["n_images"] == 20
    assert (fp["height"], fp["width"]) == (512, 640) and len(fp["digest"]) == 64
    assert fp["algorithm_version"].startswith("prnu-")
    assert fp["diagnostics"]["split_half"]["pce"] > 1000
    assert len(fp["outcomes"]) == 20 and all(o["accepted"] for o in fp["outcomes"])
    assert "not the numerical data" in fp["visualisation_notice"]
    img = c.get(fp["visual_url"])
    assert img.status_code == 200 and img.headers["content-type"] == "image/png" and img.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert c.get(fp["spectrum_url"]).status_code == 200
    blob = c.get(fp["download_url"])
    assert blob.status_code == 200 and blob.headers["content-disposition"].startswith("attachment")
    # The stored fingerprint is the engine's own format and verifies against its digest.
    from sensortrace_engine.fingerprint import Fingerprint

    assert Fingerprint.from_bytes(blob.content).digest() == fp["digest"]
    sensor = c.get(f"{API}/sensors/{a['sensor_id']}").json()
    assert sensor["active_fingerprint"]["id"] == a["fingerprint_id"] and sensor["reference_count"] == 20


def test_full_investigation_workflow(lab):
    c, a, b = lab
    inv = c.post(f"{API}/investigations", json={"title": "Case 42", "reference": "REF-42", "description": "Disputed photo"}).json()
    acq = json.dumps({"source": "Email attachment", "acquired_by": "Examiner", "method": "Downloaded original"})
    ev_a = upload_evidence(c, jpeg(1, 500), "from-a.jpg", investigation_id=inv["id"], acquisition=acq)
    ev_x = upload_evidence(c, jpeg(77, 500), "from-unknown.jpg", investigation_id=inv["id"])
    ev = c.get(f"{API}/evidence/{ev_a}").json()
    assert ev["acquisition"]["source"] == "Email attachment" and len(ev["sha256"]) == 64
    assert ev["provenance"]["original_filename"] == "from-a.jpg" and ev["width"] == 640
    # Original bytes are preserved exactly.
    assert c.get(ev["download_url"]).content == jpeg(1, 500)

    r = c.post(f"{API}/analyses", json={"evidence_ids": [ev_a, ev_x], "sensor_ids": [a["sensor_id"], b["sensor_id"]], "investigation_id": inv["id"]})
    assert r.status_code == 202, r.text
    started = r.json()
    assert len(started["analyses"]) == 2 and all(j["status"] == "succeeded" for j in started["jobs"])

    by_ev = {x["evidence_id"]: x["id"] for x in started["analyses"]}
    match = c.get(f"{API}/analyses/{by_ev[ev_a]}").json()
    assert match["status"] == "completed" and len(match["candidates"]) == 2
    top, second = match["candidates"]
    assert top["rank"] == 1 and top["sensor_id"] == a["sensor_id"] and top["verdict"] == "match_supported"
    assert top["pce"] > 1000 and top["effective_pce"] < top["pce"] and 0 < top["ncc"] <= 1
    assert second["verdict"] in ("non_match_supported", "inconclusive") and second["pce"] < 60
    assert top["decision"]["policy"]["calibrated"] is False
    assert any("not a probability" in x for x in top["decision"]["caveats"])
    assert top["measurement"]["surface_window"] and top["snapshot"]["fingerprint_digest"]
    assert match["summary"]["counts"]["match_supported"] == 1
    assert c.get(match["residual_visual_url"]).status_code == 200

    unknown = c.get(f"{API}/analyses/{by_ev[ev_x]}").json()
    assert all(x["verdict"] != "match_supported" for x in unknown["candidates"])
    assert "not enrolled" in unknown["summary"]["text"]

    # Persistence: a fresh login sees the same data.
    again = Client(c.app)
    assert again.post(f"{API}/auth/login", json={"email": c.email, "password": PASSWORD}).status_code == 200
    listing = again.get(f"{API}/analyses", params={"investigation_id": inv["id"]}).json()
    assert listing["total"] == 2 and {x["top_verdict"] for x in listing["items"]} >= {"match_supported"}
    assert again.get(f"{API}/investigations/{inv['id']}").json()["evidence_count"] == 2

    # Report for the matching analysis.
    rep = c.post(f"{API}/analyses/{by_ev[ev_a]}/reports")
    assert rep.status_code == 201, rep.text
    text = _pdf_text(c, rep.json()["download_url"])
    flat = "".join(text.split())
    assert ev["sha256"] in flat and top["snapshot"]["fingerprint_digest"] in flat
    assert "Evidence supports a match" in text and "REF-42" in text and "UNCALIBRATED" in text
    assert "Limitations" in text and "not a probability" in text and "prnu-wavelet-mle" in text
    assert "Email attachment" in text
    assert f"{top['pce']:,.3f}" in text
    stored = c.get(f"{API}/reports/{rep.json()['id']}").json()
    assert stored["sha256"] and stored["size_bytes"] > 5000

    # Investigation report, notes and history.
    assert c.post(f"{API}/investigations/{inv['id']}/notes", json={"body": "Initial review complete."}).status_code == 201
    irep = c.post(f"{API}/investigations/{inv['id']}/reports")
    itext = _pdf_text(c, irep.json()["download_url"])
    assert "Case 42" in itext and "Initial review complete." in itext and ev["sha256"] in "".join(itext.split())
    hist = c.get(f"{API}/investigations/{inv['id']}/history").json()
    actions = {h["action"] for h in hist["items"]}
    assert {"investigation.created", "evidence.uploaded", "analysis.requested", "analysis.completed", "report.generated", "note.added"} <= actions

    # Export of the investigation.
    ex = c.post(f"{API}/investigations/{inv['id']}/export")
    assert ex.status_code == 202 and ex.json()["job"]["status"] == "succeeded"
    exports = c.get(f"{API}/account/exports").json()
    z = zipfile.ZipFile(io.BytesIO(c.get(exports[0]["download_url"]).content))
    data = json.loads(z.read("data.json"))
    assert len(data["evidence"]) == 2 and len(data["analyses"]) == 2 and "devices" not in data
    assert "object_key" not in json.dumps(data) and "password" not in json.dumps(data)
    name = next(n for n in z.namelist() if ev_a in n)
    assert z.read(name) == jpeg(1, 500)


def test_reports_require_completed_analysis_and_no_candidates_is_rejected(lab):
    c, a, _ = lab
    ev = upload_evidence(c, jpeg(1, 501))
    assert c.post(f"{API}/analyses", json={"evidence_ids": [ev]}).json()["error"]["code"] == "no_candidates"
    assert (
        c.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [a["sensor_id"]], "policy_id": "nope"}).json()["error"]["code"] == "unknown_policy"
    )
    empty = c.post(f"{API}/devices", json={"name": "No fingerprint"}).json()
    s2 = c.post(f"{API}/devices/{empty['id']}/sensors", json={"name": "Main"}).json()
    assert c.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [s2["id"]]}).json()["error"]["code"] == "sensor_not_ready"
    assert c.post(f"{API}/sensors/{s2['id']}/fingerprints").json()["error"]["code"] == "insufficient_reference_images"


def test_same_model_controls_drive_the_outcome_for_computational_devices(app):
    c = make_user(app)
    a = enrol_sensor(c, 21, name="Phone A", pipeline="computational", make="Acme", model="Phone 9")
    ev = upload_evidence(c, jpeg(21, 600))
    alone = c.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [a["sensor_id"]]}).json()["analyses"][0]
    cand = c.get(f"{API}/analyses/{alone['id']}").json()["candidates"][0]
    assert cand["pce"] > 1000 and cand["verdict"] == "inconclusive" and cand["decision"]["nua"]["mitigation"] == "none"

    b = enrol_sensor(c, 22, name="Phone B", pipeline="computational", make="ACME", model="phone 9")
    both = c.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [a["sensor_id"], b["sensor_id"]]}).json()["analyses"][0]
    top = c.get(f"{API}/analyses/{both['id']}").json()["candidates"][0]
    assert top["verdict"] == "match_supported" and top["decision"]["nua"]["mitigation"] == "same_model_controls"
    assert top["experimental"]["delta_spce"] > 1000 and "not used for the decision" in top["experimental"]["note"]


def test_fingerprint_versions_and_activation(app):
    c = make_user(app)
    a = enrol_sensor(c, 31, n=6)
    extra = c.post(f"{API}/sensors/{a['sensor_id']}/references", files=files([(f"more{i}.jpg", jpeg(31, 100 + i, True)) for i in range(4)]))
    assert extra.json()["accepted"] == 4
    v2 = c.post(f"{API}/sensors/{a['sensor_id']}/fingerprints").json()["fingerprint"]
    versions = c.get(f"{API}/sensors/{a['sensor_id']}/fingerprints").json()
    assert [v["version"] for v in versions] == [2, 1] and versions[0]["is_active"] and versions[0]["n_images"] == 10
    assert versions[0]["digest"] != versions[1]["digest"]
    back = c.post(f"{API}/fingerprints/{a['fingerprint_id']}/activate").json()
    assert back["is_active"] and c.get(f"{API}/sensors/{a['sensor_id']}").json()["active_fingerprint_id"] == a["fingerprint_id"]
    assert c.delete(f"{API}/fingerprints/{v2['id']}").status_code == 204
    assert len(c.get(f"{API}/sensors/{a['sensor_id']}/fingerprints").json()) == 1


def test_enrolment_rejects_mixed_and_foreign_references(app):
    c = make_user(app)
    dev = c.post(f"{API}/devices", json={"name": "Mixed", "pipeline_class": "conventional"}).json()
    sid = c.post(f"{API}/devices/{dev['id']}/sensors", json={"name": "Main"}).json()["id"]
    payload = [(f"r{i}.jpg", jpeg(41, i, True)) for i in range(8)] + [("intruder.jpg", jpeg(42, 3, True))]
    assert c.post(f"{API}/sensors/{sid}/references", files=files(payload)).json()["accepted"] == 9
    fp = c.post(f"{API}/sensors/{sid}/fingerprints").json()["fingerprint"]
    detail = c.get(f"{API}/fingerprints/{fp['id']}").json()
    rejected = [o for o in detail["outcomes"] if not o["accepted"]]
    assert detail["n_images"] == 8 and len(rejected) == 1 and "different sensor" in rejected[0]["reasons"][0]


def test_demo_data_is_labelled_and_removable(app):
    c = make_user(app)
    r = c.post(f"{API}/demo")
    assert r.status_code == 201, r.text
    d = r.json()
    assert c.post(f"{API}/demo").status_code == 409
    devices = c.get(f"{API}/devices").json()["items"]
    assert len(devices) == 2 and all(x["is_demo"] and "synthetic" in x["name"].lower() for x in devices)
    assert c.get(f"{API}/dashboard").json()["has_demo_data"] is True
    an = c.post(f"{API}/analyses", json={"evidence_ids": d["evidence_ids"], "sensor_ids": d["sensor_ids"]}).json()
    verdicts = []
    for a in an["analyses"]:
        det = c.get(f"{API}/analyses/{a['id']}").json()
        assert det["is_demo"] is True
        verdicts.append([x["verdict"] for x in det["candidates"]])
    assert verdicts[0][0] == "match_supported" and verdicts[1][0] == "match_supported"
    assert "match_supported" not in verdicts[2]
    rep = c.post(f"{API}/analyses/{an['analyses'][0]['id']}/reports").json()
    assert "SYNTHETIC DEMONSTRATION DATA" in _pdf_text(c, rep["download_url"])
    assert c.delete(f"{API}/demo").status_code == 204
    assert c.get(f"{API}/devices").json()["total"] == 0 and c.get(f"{API}/investigations").json()["total"] == 0
    assert c.get(f"{API}/account/usage").json()["storage"]["total"] == 0


def test_permanent_deletion_removes_stored_objects(app):
    from sqlalchemy import select

    from app.db import session_scope
    from app.models import Evidence, Fingerprint, ReferenceImage, Report

    c = make_user(app)
    a = enrol_sensor(c, 51, n=4)
    inv = c.post(f"{API}/investigations", json={"title": "To delete"}).json()
    ev = upload_evidence(c, jpeg(51, 700), investigation_id=inv["id"])
    an = c.post(f"{API}/analyses", json={"evidence_ids": [ev], "sensor_ids": [a["sensor_id"]]}).json()["analyses"][0]
    rep = c.post(f"{API}/analyses/{an['id']}/reports").json()
    st = get_storage()
    with session_scope() as db:
        e = db.get(Evidence, ev)
        keys = [("evidence", e.object_key), ("derived", e.preview_key), ("results", db.get(Report, rep["id"]).object_key)]
        fp = db.get(Fingerprint, a["fingerprint_id"])
        dkeys = [("derived", fp.object_key), ("derived", fp.visual_key)]
        dkeys += [("evidence", r.object_key) for r in db.scalars(select(ReferenceImage).where(ReferenceImage.sensor_id == fp.sensor_id))]
    assert all(st.exists(b, k) for b, k in keys + dkeys)

    assert c.delete(f"{API}/investigations/{inv['id']}").status_code == 204
    assert not any(st.exists(b, k) for b, k in keys)
    assert c.get(f"{API}/evidence/{ev}").status_code == 404 and c.get(f"{API}/analyses/{an['id']}").status_code == 404
    assert c.get(f"{API}/reports/{rep['id']}").status_code == 404

    assert c.delete(f"{API}/devices/{a['device_id']}").status_code == 204
    assert not any(st.exists(b, k) for b, k in dkeys)
    assert c.get(f"{API}/account/usage").json()["storage"]["total"] == 0


def test_account_export_and_deletion(app):
    import os

    from app.config import get_settings

    c = make_user(app)
    enrol_sensor(c, 61, n=3)
    upload_evidence(c, jpeg(61, 800))
    ex = c.post(f"{API}/account/export").json()
    assert ex["job"]["status"] == "succeeded"
    z = zipfile.ZipFile(io.BytesIO(c.get(c.get(f"{API}/account/exports").json()[0]["download_url"]).content))
    data = json.loads(z.read("data.json"))
    assert data["account"]["email"] == c.email and "password_hash" not in data["account"]
    assert len(data["devices"]) == 1 and len(data["devices"][0]["sensors"][0]["reference_images"]) == 3
    assert sum(n.startswith("reference_images/") for n in z.namelist()) == 3 and any(n.startswith("fingerprints/") for n in z.namelist())

    root = get_settings().storage_local_path
    user_dirs = [os.path.join(root, b, c.user_id) for b in ("evidence", "derived", "results")]
    assert all(os.path.isdir(d) for d in user_dirs)
    assert c.request("DELETE", f"{API}/account", json={"password": "wrong", "confirm": "DELETE MY ACCOUNT"}).status_code == 403
    assert c.request("DELETE", f"{API}/account", json={"password": PASSWORD, "confirm": "yes"}).status_code == 422
    assert c.request("DELETE", f"{API}/account", json={"password": PASSWORD, "confirm": "DELETE MY ACCOUNT"}).status_code == 204
    assert not any(os.path.exists(d) for d in user_dirs)
    assert c.get(f"{API}/auth/me").status_code == 401
    assert Client(app).post(f"{API}/auth/login", json={"email": c.email, "password": PASSWORD}).status_code == 401

    from sqlalchemy import func, select

    from app.db import session_scope
    from app.models import AuditLog, Device, Evidence, Job, User

    with session_scope() as db:
        for model in (Device, Evidence, Job, AuditLog):
            assert db.scalar(select(func.count()).select_from(model).where(model.user_id == c.user_id)) == 0
        assert db.scalar(select(func.count()).select_from(User).where(User.email == c.email)) == 0


def test_dashboard_and_usage(lab):
    c, _, _ = lab
    d = c.get(f"{API}/dashboard").json()
    assert d["counts"]["sensors"] >= 2 and d["sensors_ready"] >= 2 and d["storage"]["total"] > 0 and d["quota_bytes"] > d["storage"]["total"]
    assert d["recent_activity"] and all("password" not in json.dumps(a) for a in d["recent_activity"])
    u = c.get(f"{API}/account/usage").json()
    assert u["storage"]["reference_images"] > 0 and u["storage"]["fingerprints"] > 0
    audit = c.get(f"{API}/account/audit", params={"action": "fingerprint", "limit": 5}).json()
    assert audit["items"] and all(a["action"].startswith("fingerprint") for a in audit["items"])
