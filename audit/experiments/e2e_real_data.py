"""End-to-end verification with authentic photographs, through the running product.

Drives the real web origin (the Next.js server and its API proxy), the real worker, database and
object storage. Nothing is mocked. Uses VISION images (see scripts/download_vision_subset.sh).

    cd backend && uv run python ../audit/experiments/e2e_real_data.py [BASE_URL]

Requires the Docker Compose stack to be running and `docker compose` on PATH (the script restarts
services and stops the worker mid-job to test persistence and failure handling).
Writes audit/experiments/e2e_real_data_log.json and exits non-zero if any check fails.
"""

from __future__ import annotations

import hashlib
import io
import json
import secrets
import subprocess
import sys
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[2]
BASE = (sys.argv[1] if len(sys.argv) > 1 else "http://localhost:3100").rstrip("/")
API = f"{BASE}/api/v1"
VISION = ROOT / "data/vision"
LOG: dict = {"base": BASE, "steps": [], "checks": []}
FAILED = 0


def step(name: str, **data) -> None:
    LOG["steps"].append({"step": name, **data})
    print(f"- {name}: {json.dumps(data, default=str)[:300]}", flush=True)


def check(name: str, ok: bool, detail: str = "") -> None:
    global FAILED
    LOG["checks"].append({"check": name, "passed": bool(ok), "detail": detail})
    print(f"  [{'PASS' if ok else 'FAIL'}] {name} {detail}", flush=True)
    FAILED += not ok


def compose(*args: str) -> None:
    subprocess.run(["docker", "compose", "--profile", "app", *args], cwd=ROOT, check=True, capture_output=True)


class User:
    def __init__(self) -> None:
        self.c = httpx.Client(timeout=300)
        self.email = f"e2e-{secrets.token_hex(4)}@audit-sensortrace.dev"
        self.password = secrets.token_urlsafe(18)
        r = self.c.post(f"{API}/auth/register", json={"email": self.email, "password": self.password, "display_name": "Audit"})
        r.raise_for_status()
        self.h = {"X-CSRF-Token": r.json()["csrf_token"]}

    def login(self) -> None:
        self.c = httpx.Client(timeout=300)
        r = self.c.post(f"{API}/auth/login", json={"email": self.email, "password": self.password})
        r.raise_for_status()
        self.h = {"X-CSRF-Token": r.json()["csrf_token"]}

    def get(self, path: str, **kw):
        return self.c.get(f"{API}{path}", **kw)

    def post(self, path: str, **kw):
        return self.c.post(f"{API}{path}", headers=self.h, **kw)

    def upload(self, path: str, files: list[Path], **data):
        out = []
        for i in range(0, len(files), 10):
            parts = [("files", (p.name, p.read_bytes(), "image/jpeg")) for p in files[i : i + 10]]
            r = self.c.post(f"{API}{path}", headers=self.h, files=parts, data=data)
            r.raise_for_status()
            out += r.json()["results"]
        return out

    def wait(self, job_id: str, timeout: float = 1500) -> dict:
        t0 = time.time()
        while time.time() - t0 < timeout:
            j = self.get(f"/jobs/{job_id}").json()
            if j["status"] not in ("queued", "running"):
                j["waited_seconds"] = round(time.time() - t0, 1)
                return j
            time.sleep(2)
        raise TimeoutError(job_id)


def imgs(device_dir: str, cat: str, n: int, start: int = 0) -> list[Path]:
    return sorted((VISION / device_dir / cat).glob("*.jpg"))[start : start + n]


def main() -> int:
    u = User()
    step("register", email_domain=u.email.split("@")[1])

    inv = u.post("/investigations", json={"title": "Audit: disputed photograph", "reference": "AUD-001"}).json()
    dev = u.post("/devices", json={"name": "iPhone 6 (VISION D06)", "make": "Apple", "model": "iPhone 6", "device_type": "smartphone", "pipeline_class": "conventional"}).json()
    sensor = u.post(f"/devices/{dev['id']}/sensors", json={"name": "Rear camera"}).json()
    step("create investigation, device, sensor", investigation=inv["id"], sensor=sensor["id"])

    refs = imgs("D06_Apple_iPhone6", "flat", 30)
    res = u.upload(f"/sensors/{sensor['id']}/references", refs)
    check("30 authentic reference photographs accepted", sum(r["accepted"] for r in res) == 30)
    local = {hashlib.sha256(p.read_bytes()).hexdigest() for p in refs}
    check("stored SHA-256 equals the SHA-256 of the files on disk", {r["sha256"] for r in res} == local)

    started = u.post(f"/sensors/{sensor['id']}/fingerprints").json()
    job = u.wait(started["job"]["id"])
    fp = u.get(f"/fingerprints/{started['fingerprint']['id']}").json()
    step("fingerprint job", status=job["status"], seconds=job["waited_seconds"], images=fp["n_images"], size=[fp["width"], fp["height"]], split_half_pce=fp["diagnostics"]["split_half"]["pce"])
    check("fingerprint created from real images", job["status"] == "succeeded" and fp["status"] == "ready" and fp["n_images"] == 30 and len(fp["digest"]) == 64)

    questioned = {
        "same_device": imgs("D06_Apple_iPhone6", "nat", 1)[0],
        "same_model_other_device": imgs("D15_Apple_iPhone6", "nat", 1)[0],
        "other_model": imgs("D11_Samsung_GalaxyS3", "nat", 1)[0],
    }
    ev = {}
    for label, path in questioned.items():
        r = u.upload("/evidence", [path], investigation_id=inv["id"], acquisition=json.dumps({"source": f"VISION dataset ({label})", "method": "Downloaded original"}))[0]
        ev[label] = r["id"]
        check(f"evidence hash preserved ({label})", r["sha256"] == hashlib.sha256(path.read_bytes()).hexdigest())

    from PIL import Image

    big = Image.open(questioned["same_device"])
    buf = io.BytesIO()
    big.resize((big.width // 2, big.height // 2)).save(buf, format="JPEG", quality=92)
    bad = [
        ("resized.jpg", buf.getvalue(), True),
        ("not-an-image.jpg", b"this is not an image", False),
        ("truncated.jpg", questioned["same_device"].read_bytes()[:5000], False),
    ]
    for name, data, should_accept in bad:
        r = u.c.post(f"{API}/evidence", headers=u.h, files=[("files", (name, data, "image/jpeg"))], data={"investigation_id": inv["id"]}).json()["results"][0]
        check(f"bad input '{name}' {'accepted for analysis' if should_accept else 'rejected with a reason'}", r["accepted"] == should_accept and (should_accept or bool(r["error"]["message"])))
        if should_accept:
            ev["resized_same_device"] = r["id"]

    a = u.post("/analyses", json={"evidence_ids": list(ev.values()), "sensor_ids": [sensor["id"]], "investigation_id": inv["id"]}).json()
    by_ev = {x["evidence_id"]: x["id"] for x in a["analyses"]}
    for j in a["jobs"]:
        u.wait(j["id"])
    results = {}
    for label, eid in ev.items():
        d = u.get(f"/analyses/{by_ev[eid]}").json()
        c = d["candidates"][0]
        results[label] = {"analysis": d["id"], "verdict": c["verdict"], "pce": c["pce"], "adjusted": c["effective_pce"], "ncc": c["ncc"], "geometry": c["measurement"]["geometry"]}
    step("comparisons", **results)
    check("same-device photograph: evidence supports a match", results["same_device"]["verdict"] == "match_supported" and results["same_device"]["pce"] > 60)
    check("other device of the same model: not a match", results["same_model_other_device"]["verdict"] != "match_supported" and results["same_model_other_device"]["pce"] < 60)
    check("other model: not a match", results["other_model"]["verdict"] != "match_supported")
    check("resized same-device photograph: not reported as a match and not as a non-match", results["resized_same_device"]["verdict"] in ("inconclusive", "insufficient_or_unsupported"))
    d = u.get(f"/analyses/{results['same_device']['analysis']}").json()
    check("result carries reasons, caveats and an uncalibrated-policy statement", bool(d["candidates"][0]["decision"]["reasons"]) and any("not a probability" in x for x in d["candidates"][0]["decision"]["caveats"]) and d["policy"]["calibrated"] is False)

    rep = u.post(f"/analyses/{results['same_device']['analysis']}/reports").json()
    pdf = u.c.get(f"{BASE}{rep['download_url']}").content
    check("report downloads as a PDF whose SHA-256 matches the stored value", pdf[:5] == b"%PDF-" and hashlib.sha256(pdf).hexdigest() == rep["sha256"])
    from pypdf import PdfReader

    text = "".join("".join(p.extract_text().split()) for p in PdfReader(io.BytesIO(pdf)).pages)
    check("report states the evidence hash and the fingerprint digest", hashlib.sha256(questioned["same_device"].read_bytes()).hexdigest() in text and fp["digest"] in text)
    check("report does not state a probability of identity", "probabilityofidentity" not in text.lower() and "%likely" not in text.lower())

    other = User()
    codes = [other.get(p).status_code for p in (f"/investigations/{inv['id']}", f"/evidence/{ev['same_device']}", f"/analyses/{results['same_device']['analysis']}", f"/fingerprints/{fp['id']}", f"/reports/{rep['id']}")]
    check("a second user cannot see any of it", set(codes) == {404}, str(codes))
    check("a second user cannot use the first user's file link", other.c.get(f"{BASE}{rep['download_url']}").status_code == 404)
    check("an anonymous client cannot use the file link", httpx.get(f"{BASE}{rep['download_url']}").status_code == 401)

    compose("restart", "db", "api", "worker", "web")
    for _ in range(90):
        try:
            if httpx.get(f"{API}/health", timeout=5).status_code == 200:
                break
        except httpx.HTTPError:
            pass
        time.sleep(2)
    u.login()
    again = u.get(f"/analyses/{results['same_device']['analysis']}").json()
    check("after restarting database, API, worker and web: results persist unchanged", again["candidates"][0]["pce"] == results["same_device"]["pce"] and again["candidates"][0]["verdict"] == "match_supported")
    check("after restart: evidence bytes still match their hash", hashlib.sha256(u.c.get(f"{BASE}{u.get('/evidence/' + ev['same_device']).json()['download_url']}").content).hexdigest() == hashlib.sha256(questioned["same_device"].read_bytes()).hexdigest())
    check("after restart: fingerprint digest unchanged", u.get(f"/fingerprints/{fp['id']}").json()["digest"] == fp["digest"])

    sensor2 = u.post(f"/devices/{dev['id']}/sensors", json={"name": "Worker failure test"}).json()
    u.upload(f"/sensors/{sensor2['id']}/references", imgs("D06_Apple_iPhone6", "flat", 12, 30))
    s2 = u.post(f"/sensors/{sensor2['id']}/fingerprints").json()
    time.sleep(6)
    compose("kill", "worker")
    running = u.get(f"/jobs/{s2['job']['id']}").json()["status"]
    compose("up", "-d", "worker")
    t0 = time.time()
    final = running
    while time.time() - t0 < 600:
        final = u.get(f"/jobs/{s2['job']['id']}").json()
        if final["status"] not in ("queued", "running"):
            break
        time.sleep(5)
    step("worker killed mid-job", status_when_killed=running, final_status=final["status"], error=final.get("error"), seconds=round(time.time() - t0))
    check("a job whose worker died does not stay 'running' for ever", final["status"] in ("failed", "succeeded"))
    if final["status"] == "failed":
        retry = u.post(f"/sensors/{sensor2['id']}/fingerprints")
        check("the fingerprint can be requested again afterwards", retry.status_code == 202)
        j = u.wait(retry.json()["job"]["id"])
        check("the retried job succeeds", j["status"] == "succeeded", j.get("error") or "")

    for user in (u, other):
        r = user.c.request("DELETE", f"{API}/account", headers=user.h, json={"password": user.password, "confirm": "DELETE MY ACCOUNT"})
        check("audit account deleted", r.status_code == 204)

    LOG["failed_checks"] = FAILED
    Path(__file__).with_name("e2e_real_data_log.json").write_text(json.dumps(LOG, indent=2, default=str) + "\n")
    print(f"\n{len(LOG['checks']) - FAILED}/{len(LOG['checks'])} checks passed")
    return 1 if FAILED else 0


if __name__ == "__main__":
    raise SystemExit(main())
