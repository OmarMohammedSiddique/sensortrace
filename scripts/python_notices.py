"""Write third-party notices for every distribution installed in the running Python environment.

Run it with the interpreter of the environment that ships, for example inside the API image build:

    /srv/backend/.venv/bin/python scripts/python_notices.py > THIRD_PARTY_NOTICES.txt

Each entry gives the package, version, declared licence and the full text of every licence or notice
file the distribution ships (wheels keep these under ``*.dist-info/licenses/`` or at the top of
``*.dist-info``). First-party SensorTrace packages are skipped.
"""

from __future__ import annotations

import sys
from importlib import metadata

FIRST_PARTY = {"sensortrace-engine", "sensortrace-api"}
LICENCE_HINTS = ("license", "licence", "copying", "notice", "authors")

#: Components bundled inside a wheel that its metadata does not declare.
EXTRA = {
    "opencv-python-headless": (
        "The OpenCV wheel bundles FFmpeg libraries under the GNU LGPL 2.1 or later. SensorTrace calls only "
        "image functions (imdecode, resize, cvtColor, Laplacian), never video code. The libraries are "
        "unmodified and may be replaced. FFmpeg source: https://ffmpeg.org/download.html"
    ),
    "psycopg-binary": (
        "psycopg is used unmodified as a separate, dynamically imported package under the GNU LGPL 3.0, "
        "so it may be replaced. The binary wheel bundles libpq (PostgreSQL licence). Source: "
        "https://github.com/psycopg/psycopg"
    ),
}


def licence_name(dist: metadata.Distribution) -> str:
    meta = dist.metadata
    expr = meta.get("License-Expression")
    if expr:
        return expr
    declared = meta.get("License") or ""
    if declared and len(declared) < 120 and "\n" not in declared:
        return declared
    classifiers = [c.split(" :: ")[-1] for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    return ", ".join(classifiers) or "See licence text"


def licence_texts(dist: metadata.Distribution) -> list[tuple[str, str]]:
    out = []
    for f in sorted(dist.files or [], key=str):
        parts = str(f).split("/")
        in_meta = parts[0].endswith(".dist-info")
        if not in_meta or not any(h in parts[-1].lower() for h in LICENCE_HINTS):
            continue
        try:
            with open(f.locate(), encoding="utf-8", errors="replace") as fh:
                text = fh.read().strip()
        except (OSError, ValueError):
            continue
        if text:
            out.append(("/".join(parts[1:]), text))
    return out


def main() -> int:
    dists = {}
    for d in metadata.distributions():
        name = (d.metadata["Name"] or "").lower().replace("_", "-")
        if name and name not in FIRST_PARTY and name not in ("pip", "setuptools", "wheel"):
            dists[name] = d
    w = sys.stdout.write
    w("THIRD-PARTY SOFTWARE NOTICES: SensorTrace API image\n")
    w("Generated from the installed Python packages when the image was built.\n")
    w(f"{len(dists)} packages.\n\n")
    for name in sorted(dists):
        d = dists[name]
        w("=" * 78 + "\n")
        w(f"{d.metadata['Name']} {d.version}\nLicence: {licence_name(d)}\n")
        home = d.metadata.get("Home-page") or next(
            (u.split(", ", 1)[-1] for u in d.metadata.get_all("Project-URL") or [] if "source" in u.lower() or "home" in u.lower()), ""
        )
        if home:
            w(f"Source: {home}\n")
        if name in EXTRA:
            w(f"Note: {EXTRA[name]}\n")
        texts = licence_texts(d)
        if not texts:
            w("(The distribution ships no separate licence file; the declared licence above applies.)\n")
        for path, text in texts:
            w(f"\n--- {path} ---\n{text}\n")
        w("\n")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
