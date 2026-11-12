# Reproducibility

How to regenerate every number in the audit. Baseline commit `651b83e`; audit branch
`audit/independent-review`.

## Environment used

| Item | Value |
|---|---|
| Machine | Apple M4, 10 cores, 24 GB, macOS (ARM64) |
| Python | 3.12.16 (uv 0.13.7) |
| Numerical libraries | NumPy 2.5.4, SciPy 1.18.1, PyWavelets 1.10.0, Pillow 13.0.0, opencv-python-headless 5.0.0.93 |
| Algorithm / decision logic | `prnu-wavelet-mle-1.0` / `policy-1.1` |
| Engine parameters | sigma0 = 3 (0–255 scale), `db4` wavelet, 4 levels, windows 3/5/7/9, 11×11 PCE exclusion, luminance weights 0.299/0.587/0.114 |
| Reference line | PCE 60 (fixed a priori), non-match line 10 |
| Random seeds | None in the engine or the main evaluations (image selection is "first N in sorted order"). Crop offsets in `robustness_vision.py` use seed 20261112. Bootstrap for AUC intervals uses seed 0 |
| Continuous integration | GitHub Actions, Ubuntu x86-64: engine regression fixture and reference cross-check pass there within tolerance |

Exact dependency versions are pinned in `engine/uv.lock`, `backend/uv.lock` and
`frontend/package-lock.json`; the resolved set is listed in `audit/SBOM.json`.

## Data

Both datasets are public, CC BY-SA 4.0, and are downloaded by script; they are not in the repository.
The file selection is deterministic: the first N files of each category in sorted order.

```bash
scripts/download_vision_subset.sh data/vision 40
```

```bash
scripts/download_floreview_subset.sh data/floreview 30
```

Sizes: 1,040 files (2.8 GB) and 720 files (3.0 GB). The device lists and the calibration/test split are
in `engine/evaluation/vision_subset_v1.json` and `engine/evaluation/floreview_subset_v1.json`.

## Commands and outputs

| Result | Command (from the repository root) | Output | Time on the machine above |
|---|---|---|---|
| VISION baseline, recompression, cross-resolution negatives | `cd engine && uv run sensortrace evaluate evaluation/vision_subset_v1.json --out ../data/eval/vision_subset_v1 --workers 6` | `report.md`, `results.json`, `scores.csv`, `evaluation.png`, `fingerprints/` | 1–3 h (machine was loaded) |
| FloreView baseline | `cd engine && uv run sensortrace evaluate evaluation/floreview_subset_v1.json --out ../data/eval/floreview_subset_v1 --workers 5` | same | about 45 min |
| Open-set galleries, real crops, transforms, reference sets | `cd engine && uv run python ../audit/experiments/robustness_vision.py` (needs the VISION run) | `audit/experiments/robustness_vision_results.json` | about 25 min |
| End-to-end run with authentic photographs | `cd backend && uv run python ../audit/experiments/e2e_real_data.py` (stack running) | `audit/experiments/e2e_real_data_log.json` | about 10 min |
| Engine tests incl. independent audit tests and reference cross-check | `scripts/fetch_reference_implementation.sh && cd engine && uv run pytest -q` | console | 1–3 min |
| Backend tests incl. security audit tests | `docker compose up -d --wait db redis objectstore && cd backend && uv run pytest -q` | console | 1–5 min |
| Browser end-to-end tests | `docker compose --profile app up --build -d --wait && cd frontend && npx playwright test` | console, `playwright-report/` | 2 min |
| Software bill of materials | `python3 scripts/generate_sbom.py` | `audit/SBOM.json` | seconds |
| Dependency audits | `make audit` | console | 1 min |

Both evaluations are resumable: finished images are appended to `scores.partial.jsonl` and fingerprints
are cached, so re-running the command continues. Delete the output directory to start again.

Committed copies of the evaluation outputs (reports, result summaries, plots) are in
`docs/validation/`. Per-trial `scores.csv` files and fingerprints are not committed (they are derived
from CC BY-SA images and are large).

## Determinism

- Enrolment is deterministic: re-enrolling one device during the audit reproduced the stored fingerprint
  digest exactly (scientific audit, section 7).
- Scores are deterministic on one machine and library set. Across platforms, FFT and wavelet rounding
  can differ in the last digits; the regression fixture (`engine/tests/fixtures/regression_v1.json`)
  passes on macOS ARM64 and Linux x86-64 with relative tolerances of 0.1–1%.
- JPEG decoding depends on the Pillow/libjpeg-turbo version, which is why library versions are stored
  with every fingerprint and result.

## Not reproduced

- The VISION scoring run was not repeated end to end during the audit. Five scores were recomputed from
  the image files, one fingerprint was re-enrolled to an identical digest, and every headline figure was
  recomputed from `scores.csv` by an independent reviewer.
- No second machine or library set was used for the evaluations.
