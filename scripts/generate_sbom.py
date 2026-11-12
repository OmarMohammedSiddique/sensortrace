#!/usr/bin/env python3
"""Generate audit/SBOM.json: every runtime and development component with version and licence.

Reads what is actually installed (the engine and backend virtual environments, the frontend
node_modules) and the lock files, so it reflects the resolved dependency set rather than declared
ranges. Output follows the CycloneDX 1.5 JSON layout with a few extra properties.

Usage (from the repository root, after `make install`):

    python3 scripts/generate_sbom.py
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tomllib
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

METADATA_SNIPPET = r"""
import json, sys
from importlib import metadata
out = {}
for d in metadata.distributions():
    m = d.metadata
    name = (m.get("Name") or "").lower().replace("_", "-")
    lic = m.get("License-Expression") or ""
    if not lic:
        raw = (m.get("License") or "").strip()
        lic = raw.splitlines()[0][:120] if raw and len(raw.splitlines()[0]) < 120 else ""
    classifiers = [c.split("::")[-1].strip() for c in (m.get_all("Classifier") or []) if c.startswith("License ::")]
    out[name] = {"version": d.version, "license": lic, "classifiers": classifiers,
                 "home": m.get("Home-page") or next((u.split(",",1)[1].strip() for u in (m.get_all("Project-URL") or []) if u.lower().startswith(("homepage","source","repository"))), "")}
json.dump(out, sys.stdout)
"""


def norm(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def python_project(directory: str) -> list[dict]:
    proj = ROOT / directory
    declared = tomllib.loads((proj / "pyproject.toml").read_text())
    direct = {norm(re.split(r"[<>=!~\[; ]", d, maxsplit=1)[0]) for d in declared["project"].get("dependencies", [])}
    dev_direct = {norm(re.split(r"[<>=!~\[; ]", d, maxsplit=1)[0]) for g in declared.get("dependency-groups", {}).values() for d in g}

    def exported(*flags: str) -> set[str]:
        txt = subprocess.run(["uv", "export", "--no-hashes", "--no-emit-project", "--format", "requirements-txt", *flags],
                             cwd=proj, capture_output=True, text=True, check=True).stdout  # fmt: skip
        return {norm(line.split("==")[0]) for line in txt.splitlines() if "==" in line and not line.startswith(("#", " ", "-e"))}

    runtime = exported("--no-dev")
    everything = exported()
    meta = json.loads(subprocess.run(["uv", "run", "python", "-c", METADATA_SNIPPET], cwd=proj, capture_output=True, text=True, check=True).stdout)
    comps = []
    for name in sorted(everything | runtime):
        m = meta.get(name)
        if m is None or name.startswith("sensortrace"):
            continue
        lic = m["license"] or "; ".join(m["classifiers"]) or "UNKNOWN"
        comps.append({
            "type": "library", "name": name, "version": m["version"], "purl": f"pkg:pypi/{name}@{m['version']}",
            "licenses": [{"license": {"name": lic}}],
            "properties": [
                {"name": "sensortrace:project", "value": directory},
                {"name": "sensortrace:scope", "value": "runtime" if name in runtime else "development"},
                {"name": "sensortrace:relationship", "value": "direct" if name in direct | dev_direct else "transitive"},
                {"name": "sensortrace:origin", "value": m["home"] or "https://pypi.org/project/" + name},
            ],
        })  # fmt: skip
    return comps


def node_project(directory: str) -> list[dict]:
    proj = ROOT / directory
    pkg = json.loads((proj / "package.json").read_text())
    lock = json.loads((proj / "package-lock.json").read_text())
    direct = set(pkg.get("dependencies", {})) | set(pkg.get("devDependencies", {}))
    comps = []
    for path, info in sorted(lock["packages"].items()):
        if not path.startswith("node_modules/"):
            continue
        name = path.split("node_modules/")[-1]
        lic = info.get("license")
        if not lic:
            pj = proj / path / "package.json"
            if pj.exists():
                data = json.loads(pj.read_text())
                lic = data.get("license") or (data.get("licenses") or [{}])[0].get("type")
        comps.append({
            "type": "library", "name": name, "version": info.get("version", ""), "purl": f"pkg:npm/{name}@{info.get('version', '')}",
            "licenses": [{"license": {"name": lic if isinstance(lic, str) else (lic or {}).get("type", "UNKNOWN") if lic else "UNKNOWN"}}],
            "properties": [
                {"name": "sensortrace:project", "value": directory},
                {"name": "sensortrace:scope", "value": "development" if info.get("dev") else "runtime"},
                {"name": "sensortrace:relationship", "value": "direct" if name in direct and path.count("node_modules/") == 1 else "transitive"},
                {"name": "sensortrace:origin", "value": info.get("resolved", "")},
            ],
        })  # fmt: skip
    return comps


SERVICES = [
    ("postgres", "17-alpine", "PostgreSQL", "container image, separate service"),
    ("redis", "7-alpine", "RSALv2 OR SSPL-1.0 (Redis 7.4+); BSD-3-Clause before 7.4", "container image, separate service"),
    ("chrislusf/seaweedfs", "4.07", "Apache-2.0", "container image, separate service (local object storage)"),
    ("python", "3.12-slim", "PSF-2.0 (image also contains Debian packages under their own licences)", "base image of the backend container"),
]


def main() -> int:
    components = python_project("engine") + python_project("backend") + node_project("frontend")
    for name, version, lic, note in SERVICES:
        components.append({"type": "container", "name": name, "version": version, "purl": f"pkg:docker/{name}@{version}",
                           "licenses": [{"license": {"name": lic}}],
                           "properties": [{"name": "sensortrace:project", "value": "infrastructure"}, {"name": "sensortrace:scope", "value": "runtime"},
                                          {"name": "sensortrace:relationship", "value": "service"}, {"name": "sensortrace:origin", "value": note}]})  # fmt: skip
    head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True, text=True).stdout.strip()
    sbom = {
        "bomFormat": "CycloneDX", "specVersion": "1.5", "version": 1,
        "metadata": {"component": {"type": "application", "name": "sensortrace", "version": "0.1.0"},
                     "properties": [{"name": "sensortrace:commit", "value": head},
                                    {"name": "sensortrace:generator", "value": "scripts/generate_sbom.py"}]},
        "components": components,
    }  # fmt: skip
    out = ROOT / "audit" / "SBOM.json"
    out.parent.mkdir(exist_ok=True)
    out.write_text(json.dumps(sbom, indent=1) + "\n")
    print(f"{len(components)} components -> {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
