"""Generate the deterministic synthetic JPEG fixtures used by the browser end-to-end tests.

Run from the engine project so the simulator is importable:

    cd engine && uv run python ../scripts/make_e2e_fixtures.py

Output: frontend/e2e/fixtures/ (committed; every file is synthetic, no real camera data).
"""

from __future__ import annotations

from pathlib import Path

from sensortrace_engine.synthetic import SyntheticSensor, encode_jpeg

OUT = Path(__file__).resolve().parent.parent / "frontend" / "e2e" / "fixtures"
SHAPE = (512, 640)
PRNU_STRENGTH = 0.012
JPEG_QUALITY = 96
SENSOR_A_SEED = 9001
SENSOR_OTHER_SEED = 9002
REFERENCE_COUNT = 8
QUESTIONED_INDEX = 500


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    sensor_a = SyntheticSensor(SENSOR_A_SEED, SHAPE, prnu_strength=PRNU_STRENGTH)
    sensor_other = SyntheticSensor(SENSOR_OTHER_SEED, SHAPE, prnu_strength=PRNU_STRENGTH)

    files: dict[str, bytes] = {}
    for i in range(REFERENCE_COUNT):
        files[f"ref-a-{i + 1:02d}.jpg"] = encode_jpeg(sensor_a.capture(i, flat=True), JPEG_QUALITY)
    files["questioned-a.jpg"] = encode_jpeg(sensor_a.capture(QUESTIONED_INDEX), JPEG_QUALITY)
    files["questioned-other.jpg"] = encode_jpeg(sensor_other.capture(QUESTIONED_INDEX), JPEG_QUALITY)
    files["not-an-image.jpg"] = b"This file has a .jpg extension but contains plain text, not image data.\n"

    for name, data in files.items():
        (OUT / name).write_bytes(data)
        print(f"{name}: {len(data)} bytes")


if __name__ == "__main__":
    main()
