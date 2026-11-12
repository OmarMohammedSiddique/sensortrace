# SensorTrace research: reference implementations, dependency licences, evaluation datasets

Research date: 2026-11-12. Everything below was checked against the primary source on that date
(repo LICENSE file, dataset README/terms page, PyPI metadata) unless marked **unverified**.
This is engineering due diligence, not legal advice; have counsel confirm before shipping.

Legend for "proprietary use": **(a)** code may be copied into the product, **(b)** usable only as an
independent test oracle in a dev-only environment (not shipped), **(c)** neither.

---

## PART 1 - Reference implementations

### 1.1 polimi-ispl/prnu-python  -> RECOMMENDED ORACLE

| | |
|---|---|
| URL | https://github.com/polimi-ispl/prnu-python |
| Language | Python (NumPy, PyWavelets, SciPy, scikit-learn, tqdm, Pillow) |
| Implements | Port of the Binghamton toolbox: `noise_extract` (db4 wavelet, 4 levels, adaptive Wiener), `extract_single`, `extract_multiple_aligned` (MLE fingerprint with intensity/saturation weighting), `zero_mean_total`, `wiener_dft`, `rgb2gray`, `crosscorr_2d`, `aligned_cc`, `pce`, `stats` (ROC/AUC), `gt` |
| Licence | **MIT**. File `LICENSE.md` (master): "The MIT License (MIT) / Copyright (c) 2018 / Permission is hereby granted, free of charge, to any person obtaining a copy of this software ... to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software". GitHub API `spdx_id: MIT`. |
| Maintenance | Not archived, but last commit 2023-02-02 (`91e1585a39287e26f9e770b71cf9124c35d9248d`). Effectively unmaintained. |
| Proprietary use | **(a) and (b)** - copying is permitted provided the copyright + permission notice is retained. Note the copyright line names no holder ("Copyright (c) 2018" with a blank owner); authors are listed in README/`__init__.py` (Bondi, Bestagini, Bonettini, Politecnico di Milano). |

Caveat on provenance: the README credits "Reference MATLAB implementation by Binghamton university". The
Binghamton code is CC BY-NC (see 1.2). The polimi repo is an independent Python port published under MIT
by its authors; whether a port of NC-licensed MATLAB code can be relicensed MIT is a question I cannot
resolve from primary sources. For that reason I recommend using it as **(b) a dev-only oracle** and writing
SensorTrace's own implementation from the published papers (Lukas/Fridrich/Goljan 2006; Chen et al. 2008;
Goljan et al. 2009), rather than copying code, even though the MIT text allows copying.

**Install (verified today on ARM64 macOS, uv-created venvs, Python 3.12 and 3.13):**

- It is **not on PyPI** and has **no `setup.py`/`pyproject.toml`**, so `pip install git+https://...` does not work.
  The PyPI name `prnu` is a *different, GPL-3.0 project* (see 1.4) - do not `pip install prnu`.
- Use a pinned clone on `PYTHONPATH` (or a git submodule under e.g. `tests/_oracle/`, excluded from the wheel/sdist):

  ```
  git clone https://github.com/polimi-ispl/prnu-python.git third_party/prnu-python
  git -C third_party/prnu-python checkout 91e1585a39287e26f9e770b71cf9124c35d9248d
  pip install numpy scipy pywavelets scikit-learn tqdm pillow      # dev extras only
  PYTHONPATH=third_party/prnu-python python -c "import prnu"
  ```
  Ignore its `requirements.txt` pin `numpy==1.23.5` (no cp312/cp313 wheels).
- Compatibility results I measured (512x512 crop of a VISION flat image):

  | Env | import | `extract_single`, `noise_extract`, `saturation`, `crosscorr_2d`, `pce` | `inten_scale` / `extract_multiple_aligned` | `gt` |
  |---|---|---|---|---|
  | Py 3.12 + NumPy 2.x + SciPy 1.18 | OK | OK | **FAIL** `OverflowError: Python integer -1 out of bounds for uint8` (functions.py line 356, NEP 50 promotion) | OK |
  | Py 3.13 + NumPy 2.x + SciPy 1.18 | OK | OK | **FAIL** (same) | OK |
  | Py 3.12 + `numpy<2` (1.26) | OK | OK | OK | **FAIL** `np.bool` removed |

  So on NumPy 2 (the only option on Python 3.13) the fingerprint aggregator needs a one-line shim in the
  test harness, e.g. monkeypatch `prnu.functions.inten_scale` with a version that casts to float first
  (`im = im.astype(np.float32)` before `np.exp(-1*(im-T)**2/v)`), or compute the MLE aggregation in the
  test from `noise_extract` outputs. With `numpy<2` on 3.12, `extract_multiple_aligned` works unmodified
  (avoid `gt`/`stats` there, or pass your own boolean ground truth).
- `from scipy.ndimage import filters` (deprecated namespace) still imports on SciPy 1.18 without error; expect it to break in a future SciPy.

### 1.2 Binghamton DDE lab "Camera Fingerprint" (MATLAB + Python)

| | |
|---|---|
| URL | https://dde.binghamton.edu/download/camera_fingerprint/ (HTTP 200) |
| Language | MATLAB (v1.1) and a Python version |
| Implements | `getFingerprint.m` (MLE fingerprint), `NoiseExtractFromImage.m`, `PCE.m`, `ZeroMeanTotal.m`, `WienerInDFT.m`, saturation handling; the canonical reference used in Goljan/Fridrich/Filler 2009 |
| Licence | Page text: "The Camera Fingerprint Program is protected by U.S. copyright law. This work is licensed under a Creative Commons Attribution-NonCommercial 4.0 International License, and you may not use the program for commercial purposes without express written permission from the copyright holder. For permission, contact Scott Moser smoser@binghamton.edu." Also: "The provided code is available for research purposes." |
| Availability | **Not downloadable today.** Both MATLAB and Python entries read "download: (temporary) for code contact M. Goljan mgoljan@binghamton.edu". I did not contact anyone. Python README ("instructions and copyright in README.md") not inspected -> its exact terms **unverified** beyond the page statement. |
| Proprietary use | **(c) neither** without written permission. CC BY-NC bars use "primarily intended for or directed towards commercial advantage"; running it as a test oracle inside a commercial product's development is hard to argue as non-commercial. Do not copy, do not vendor. If it is wanted as an oracle, request a commercial permission from Binghamton first. |

### 1.3 IPOL preprint 662 - "Photo Response Non-Uniformity Extraction and Detection"

| | |
|---|---|
| URL | https://www.ipol.im/pub/pre/662/ (HTTP 200); code https://www.ipol.im/pub/pre/662/662-main.zip (HTTP 200, 18.9 kB) |
| Authors | Loison, Bammey, Grompone von Gioi, Muse, Gardella. Page states: "This is a preprint. It may change before it is accepted for publication." |
| Language | Python 3.12 (README: "This Python 3.12 implementation ..."); requirements: `numpy`, `iio`, `PyWavelets`, `scipy==1.14.0`; code also imports `skimage`, `matplotlib`, `PIL`, `tqdm`, `markdown`, and a BM3D denoiser |
| Implements | CLI `main.py` comparing two inputs: denoiser {wavelet, bm3d, mean of flat-field}; combination {basic averaging, maximum-likelihood estimator, phase-only}; post-processing {none, zero-mean, zero-mean + Wiener}; score {Pearson, PCE, sPCE}. `prnu_python/functions.py` is a vendored copy of polimi-ispl/prnu-python at commit `91e1585a` (its README says "Source: https://github.com/polimi-ispl/prnu-python/tree/91e1585a..."). |
| Licence of the code | **Unverified / not stated.** The zip contains no LICENSE/COPYING file and no licence headers (grep for licen/copyright/GPL/MIT/BSD across all .py and DDL.json: no hits). IPOL's general policy page (https://www.ipol.im/meta/copyright/) says: "The software published in IPOL articles is distributed under a free software license, usually GPL, AGPL, LGPL or BSD ... Please refer to the source code files to know which license applies" - and the source files do not say. Until the final article ships a licence, treat as all-rights-reserved-with-unknown-terms, and plan for it possibly being AGPL/GPL. |
| Licence of the manuscript | IPOL policy: "Unless otherwise stated, the manuscripts are provided under a Creative Commons CC-BY-NC-SA license ... You may not use this work for commercial purposes." Do not copy text/figures. |
| Proprietary use | **(c) for copying.** As an oracle **(b) is low-risk in practice but formally unlicensed**; since it is independent only in its aggregation/scoring layer (the denoiser *is* the polimi code), it adds little over 1.1. Reading the paper for algorithm understanding is fine. Also note its optional BM3D path depends on the PyPI `bm3d` package, whose metadata says "License :: Free for non-commercial use" / "The package is available for non-commercial use only" - avoid. |

### 1.4 Other PRNU implementations found

| Project | URL | What | Licence (source) | Last push | Proprietary use |
|---|---|---|---|---|---|
| `prnu` on PyPI (Pixel-Master/prnu) | https://pypi.org/project/prnu/ , https://github.com/Pixel-Master/prnu | "A toolkit for PRNU noise extraction, sensor fingerprint comparison, and AI image detection"; deps include torch, torchvision, opencv-python | **GPL-3.0-only** (PyPI `license: GPL-3.0-only`; repo LICENSE begins "GNU GENERAL PUBLIC LICENSE Version 3, 29 June 2007") | 2026-10-28 (v0.1.2; first release 2026-10-06; 1 star) | **(b) only** - never copy, never import from shipped code. Very new and unproven; heavyweight (torch). Not recommended. |
| sim-pez/prnu | https://github.com/sim-pez/prnu | Student project: fingerprint extraction with several denoisers + PCE | GitHub API `spdx_id: MIT` (LICENSE file path not fetched directly - treat exact text as **unverified**) | 2022-06-16 | (a)/(b) nominally; script-style, unmaintained |
| ocrim1996/prnu-python | https://github.com/ocrim1996/prnu-python | polimi derivative with neural denoiser | API `spdx_id: MIT` (text unverified) | 2021-11-30 | not needed |
| samuelebortolotti/prnu-python | fork of polimi | fork | API `MIT` | 2021-12-08 | not needed |
| samuelebortolotti/neural-prnu-extractor | https://github.com/samuelebortolotti/neural-prnu-extractor | FFDNet-based PRNU extractor | API `GPL-3.0` | 2022-02-09 | (b) only |
| grip-unina/noiseprint | https://github.com/grip-unina/noiseprint | CNN camera-*model* fingerprint (not PRNU) | API `NOASSERTION` (custom licence; **unverified**, historically research-only) | 2026-03-27 | (c) until read |

No actively maintained, permissively licensed, pip-installable classical PRNU library exists as of today.

**Best oracle candidate: polimi-ispl/prnu-python @ 91e1585a (MIT)**, pinned clone, dev-only, with the NumPy-2 shim described above.
For a second, truly independent cross-check, write a small MATLAB-free oracle in the tests from the paper equations rather than adopting GPL/NC code.

### 1.5 Dependency candidates - licence summary

Source = PyPI JSON metadata fetched today (latest release shown) plus upstream files where noted. All have macOS ARM64 wheels for cp312 and cp313 or are pure-Python.

| Package (latest) | Licence | Notes for a proprietary product |
|---|---|---|
| NumPy 2.5.4 | PyPI `license_expression`: "BSD-3-Clause AND 0BSD AND MIT AND Zlib AND CC0-1.0" | OK. Requires Python >=3.12. Wheels bundle OpenBLAS/libgfortran-style runtime components; ship the wheel's licence files. |
| SciPy 1.18.1 | Classifier "License :: OSI Approved :: BSD License" (BSD-3-Clause; licence text begins "Copyright (c) 2001-2002 Enthought, Inc. 2003, SciPy Developers. All rights reserved.") | OK. Wheels bundle OpenBLAS + GCC runtime libs (GPL-with-runtime-exception) - redistribution allowed; keep notices. |
| PyWavelets 1.10.0 | `license_expression`: "MIT AND BSD-3-Clause"; upstream LICENSE is the MIT text ("Copyright (c) 2006-2012 Filip Wasilewski / Copyright (c) 2012- The PyWavelets Developers") | OK. |
| opencv-python-headless 5.0.0.93 | PyPI `license: Apache 2.0`. Upstream README: "Opencv-python package (scripts in this repository) is available under MIT license. OpenCV itself is available under Apache 2 license." and "**All wheels ship with FFmpeg licensed under the LGPLv2.1.**" | OK with care: LGPL-2.1 FFmpeg is dynamically bundled in the wheel - comply with LGPL (notice, allow relinking/replacement, do not statically fuse into a single binary without thought e.g. PyInstaller one-file). Full list in `LICENSE-3RD-PARTY.txt`. Single abi3 wheel `macosx_13_0_arm64` covers 3.12/3.13. |
| Pillow 13.0.0 | `license_expression`: "MIT-CMU" (HPND-style) | OK. Wheels bundle libjpeg-turbo, zlib, libtiff, libwebp, openjpeg, etc. (permissive). |
| pillow-heif 1.8.1 | PyPI `license: BSD-3-Clause` for the source, **but** upstream `LICENSES_bundled.txt`: "License for "pillow-heif" binary wheels: **GPLv2**, due to base library licenses." Bundles libheif (LGPLv3), libde265 (LGPLv3), **x265 (GPLv2)**. | **RED FLAG.** Shipping the PyPI wheel inside a proprietary product pulls in GPLv2 (x265 encoder). Options: (1) build pillow-heif/libheif yourself *without x265* (decode-only via libde265 -> LGPLv3 obligations only); (2) decode HEIC out-of-process with an OS facility (macOS ImageIO/`sips`); (3) do not bundle - make it an optional user-installed plugin. Also HEVC patent-pool exposure is separate from copyright licence. Fine as a dev/test-only dependency. |
| libheif | LGPLv3 (per pillow-heif `LICENSES_bundled.txt`, libheif v1.23.7 COPYING) | Dynamic linking only; LGPLv3 anti-tivoization terms apply. |
| scikit-image 0.26.0 | Classifier "BSD License"; licence text "Files: * / Copyright: 2009-2022 the scikit-image team / License: BSD-3-Clause" (some files under other permissive licences) | OK. |
| ReportLab 5.1.0 | PyPI: "BSD license (see license.txt for details), Copyright (c) 2000-2025, ReportLab Inc." | OK (open-source edition; ReportLab PLUS is separate/commercial). Pure-Python wheel. |
| WeasyPrint 70.0 | Upstream LICENSE: "BSD 3-Clause License / Copyright (c) 2011-2021, Simon Sapin and contributors." | Python code OK. Runtime needs system **Pango/HarfBuzz/GLib (LGPL)** via `brew install pango` - if you bundle those dylibs you take on LGPL obligations. ReportLab is the lower-friction choice for a shipped product. |
| ExifRead 3.5.1 | PyPI licence text begins "Copyright (c) 2002-2007 Gene Cash / Copyright (c) 2007-2025 Ianare Sevi and contributors" (BSD-3-Clause; full text not re-read today -> clause wording **unverified**) | OK. Pure Python, read-only EXIF. |
| piexif 1.1.3 | PyPI `license: MIT`, classifier "MIT License" | OK but unmaintained (last release 2019). |
| bm3d 4.0.3 (appears via IPOL code) | Classifier "License :: Free for non-commercial use"; description: "The package is available for non-commercial use only." | **Do not use** in a commercial project, including in dev. |

---

## PART 2 - Datasets with known source DEVICE

Summary table (details and quotes below).

| Dataset | Devices | Same-model multiples | Flat-field | Licence | Commercial internal eval | Scriptable without registration (tested today) |
|---|---|---|---|---|---|---|
| **VISION** (UniFI) | 35 | Yes (5 groups) | Yes (60-176/device) | **CC BY-SA 4.0** | **Permitted** (attribution; share-alike on redistributed adaptations) | **YES - HTTP 200 per file** |
| **FloreView** (UniFI) | 46 | Yes (5+ groups) | Yes (~35/device) | **CC BY-SA 4.0** | **Permitted** | **YES - HTTP 200 per file** |
| PrnuModernDevices (UniFI) | 22 | not documented | 5/device only | CC BY-SA 4.0 | Permitted | YES (listing 200) - too few flats |
| HDR dataset (Shaya et al.) | 23 | unverified | yes per paper (unverified) | **unverified** | unknown | No - Google Drive folder |
| Forchheim FODB | 27 | Yes (`_1`/`_2` suffix) | No (143 matched scenes) | Custom research-only | **Not permitted** | Technically yes (3 zips, 21.3 GB, range requests OK) |
| RAISE | 3 cameras | No | D7000 only (5.4 GB zip) | Custom non-commercial | **Not permitted** | No - form with name/affiliation/email + terms tick |
| SOCRatES | 103 | Yes | per paper (unverified) | Signed agreement | unknown (agreement not read) | No - encrypted zips, password after signed licence |
| Dresden Image Database | 73 (literature) | Yes | Yes (flat + dark) | **unverified** | unknown | **No - host unreachable (timeout)** |
| Daxing | 90 | Yes (up to 23/model) | No dedicated flats (sky/white-wall scenes) | **unverified** (repo API says GPL-3.0; no dataset terms) | unknown | No - Baidu Pan |
| Warwick WIFD | 14 cameras | Yes (3 pairs) | "reference" images | Custom permissive "for subsequent research" | ambiguous | No - JPEG URL 404; RAW by email |
| IEEE SP Cup 2018 (Kaggle) | 10 **models** | n/a - **model-level only** | No | Kaggle competition rules (**unverified**) | unknown | No - Kaggle API 401 without login |
| SCIMD-6 / SCIMD-17 (Zenodo) | 6 / 17 | No - **model-level** | No | CC BY 4.0 | Permitted | Yes, but ~10 kB/image -> downscaled, useless for PRNU |

### 2.1 VISION  -> RECOMMENDED

- URL: https://lesc.dinfo.unifi.it/VISION/ (nginx auto-index, HTTP 200). Paper: Shullani et al., EURASIP J. Inf. Security 2017, doi:10.1186/s13635-017-0067-2.
- Contents (counted from `VISION_files.txt`, 36,343 URLs): 35 devices, 11 brands. Images: `flat` 4,167; `nat` 7,565; `natFBH` 7,565; `natFBL` 7,565; `natWA` 7,565; plus videos (`flat`, `indoor`, `outdoor`, each also `WA`/`YT`). Per device: 60-176 flat, 132-350 nat. Full size is of the order of 100+ GB (not measured); images only are far smaller.
- Same-model device groups: Galaxy S3 Mini D01/D26; iPhone 4s D02/D10; iPhone 5c D05/D14/D18; iPhone 6 D06/D15; iPhone 5 D29/D34.
  Observation from the probe files: D01 EXIF model is `GT-I8190N`, D26 is `GT-I8190` - same marketing model, different hardware variant. Prefer the iPhone pairs as "true" same-model pairs.
- Layout: `dataset/D{NN}_{Brand}_{Model}/images/{flat,nat,natFBH,natFBL,natWA}/D{NN}_I_{cat}_{NNNN}.jpg` and `.../videos/{flat,flatWA,flatYT,indoor,...}/`.
- Licence (https://lesc.dinfo.unifi.it/VISION/README.txt): "If you download and use contents of the 'VISION dataset' you agree to the following license agreement." ... "Copyright (c) CSP Lab. (Communications & Signal Processing Laboratory), Dept Information Engineering, University of Florence, 2017 / This work is licensed under the Creative Commons Attribution-ShareAlike 4.0 International License."
  - Commercial use: allowed by CC BY-SA 4.0 (no NC term).
  - Redistribution: allowed with attribution; adapted *material* (e.g. cropped/re-encoded images, arguably fingerprints derived from them if you publish them) must be shared under BY-SA. Do not commit the images to a proprietary repo you later distribute without honouring BY-SA; keep them as downloaded-at-test-time data.
  - Internal evaluation + publishing metrics: permitted; metrics are not adaptations of the images. Give attribution (cite the paper, name the licence) wherever results are published. README also says "please consider citing our paper".
  - Errata: two misplaced *videos* (D03, D19) - irrelevant for images.
- Download mechanics (README): `wget -i VISION_files.txt` (all), `VISION_base_files.txt` (16,414 URLs, native content only), plus statistics lists. No registration, no click-through.

### 2.2 FloreView (same lab; modern devices)  -> RECOMMENDED SECOND SET

- URL: https://lesc.dinfo.unifi.it/FloreView/ ; listing `FloreView_Dataset.txt` (955 kB, HTTP 200). Paper: Baracchi et al., IEEE Access 2023.
- 46 smartphones, 11 brands, 2022-era devices; README: "Dataset (126 GB)", 6,637 images + 1,831 videos (+403 extra).
- Same-model groups (from directory names): iPhone X D02/D22; Redmi Note 8T D04/D10; Moto G D06/D28; Moto G5 D15/D39; Pixel 3a D19/D23.
- Layout: `Dataset/D{NN}_{Brand}_{Model}/Flat/{jpeg-h264|heic-h265}/D{NN}_I{NNN}.jpg` (~35-41 flats per device) and `.../Nat/{jpeg-h264|heic-h265}/L{1-7}/S{1-6}/...` (~3 images per location/scene, ~105 nat per device; all devices shot the same scenes). Some Apple devices are HEIC-only (e.g. D22 has only `heic-h265`) - useful for testing the HEIF path.
- Licence (`readme.md`): identical wording to VISION - "This work is licensed under the Creative Commons Attribution-ShareAlike 4.0 International License." Same commercial/redistribution analysis as 2.1.

### 2.3 PrnuModernDevices (UniFI)

- https://lesc.dinfo.unifi.it/PrnuModernDevices/ ; 22 smartphones, 550 images; each `C{NN}/` has `bokeh/` (10), `flat/` (5), `nat/` (10). CC BY-SA 4.0 (README.txt, same wording). Scriptable (`wget -nH -x -i dataset_download.txt`; file names contain spaces/parentheses, URL-encoded in the list). Only 5 flats per device, device models not listed in the README -> useful only as a hard-case supplement (portrait/bokeh mode).

### 2.4 HDR dataset (Shaya, Yang, Ni, Shi - Sensors 2018)

- Listed at https://lesc.dinfo.unifi.it/materials/datasets/ : "more than 5000 Standard Dynamic Range (SDR) and High Dynamic Range (HDR) images captured using 23 different mobile devices of 7 major brands." Link is a Google Drive folder -> not reliably scriptable (needs `gdown`, quota limits). Licence/terms: **unverified** (no terms on the page; Drive not opened). Same-model multiples and flat images: **unverified** today.

### 2.5 Forchheim Image Database (FODB)

- URL: https://faui1-files.cs.fau.de/public/mmsec/datasets/fodb/ (HTTP 200): `README.md`, `part01.zip` 5.4 G, `part02.zip` 7.0 G, `part03.zip` 8.9 G. `Accept-Ranges: bytes` (so a single device folder could be pulled with a remote-zip reader instead of 21 GB).
- 23,106 JPEGs, 143 scenes x 27 smartphone cameras, each in 6 versions (`orig`, `facebook`, `instagram`, `telegram`, `twitter`, `whatsapp`). Dirs `D[ID]_[Brand]_[Model]_[i]`, "i in {1, 2} enumerates the devices of a model" -> same-model pairs exist. No flat-field images.
- Licence (README): "Use in Research: The database may be freely used for research purposes." / "Modification and Commercial Use: This database, in whole or in part, may not be modified, used for commercial purposes, or redistributed without a formal agreement with the authors of [2]."
- Verdict: **not usable for a commercial product's evaluation** without a formal agreement with Hadwiger/Riess (FAU). Not downloaded.

### 2.6 RAISE

- URL: http://loki.disi.unitn.it/RAISE/ (HTTP 200, plain HTTP). 8,156 RAW images, 3 cameras (Nikon D40, D90, D7000), one unit each -> no same-model test. Flat-field set for the D7000 only: http://loki.disi.unitn.it/RAISE/Flat-field/Flat-field.zip (HEAD 200, 5,381,509,030 bytes, direct link).
- Licence (http://loki.disi.unitn.it/RAISE/data/RAISE_License.pdf): "All data provided in the 'RAISE' are made freely available for scientific, non-commercial purposes such as academic research, teaching, or personal experimentation." and "3. You may not use or distribute the data or any derivative work for commercial purposes as, for example, licensing or selling the data, or using the data with a purpose to procure a commercial gain without written permission."
- Download mechanics: package pages (`confirm.php?package=1k|2k|4k|6k|all`) require a form (Full Name, Affiliation, Email, "Agree to the term of use") -> **not scripted, not attempted**.
- Verdict: non-commercial; 3 devices; not suitable.

### 2.7 SOCRatES (EURECOM)

- URL: https://socrates.eurecom.fr/ (HTTP 200). "about 9.700 images and 1000 videos captured with 103 different smartphones of 15 different makes and about 60 different models" -> multiple devices per model.
- Terms: "A password for decrypting the compressed SOCRatES ZIP files will be provided after receiving the duly signed license agreement. Please fill in the license agreement and send a scanned copy by e-mail at socrates@eurecom.fr." Agreement text not read -> commercial terms **unverified** (EURECOM agreements are typically research-only).
- Verdict: not scriptable; requires signed agreement. Not attempted.

### 2.8 Dresden Image Database

- URL: http://forensics.inf.tu-dresden.de/ddimgdb/ - **connection timed out** today on both http and https (curl exit 28, two attempts of 20 s and 25 s). Last Wayback capture found: 2020-08-08 (site had Register/Login and a "License" page; the archived licence page did not render text, so terms are **unverified**).
- From the literature (Gloe & Boehme 2010; not re-verified today): ~73 devices of 25 models, multiple units per model, flat-field and dark frames - historically the ideal PRNU benchmark. No verified open mirror found on Zenodo/Hugging Face; Kaggle mirrors need login and would be third-party re-uploads of unclear licence.
- Verdict: currently not downloadable from the primary source; do not rely on it.

### 2.9 Daxing smartphone identification dataset

- URL: https://github.com/xyhcn/Daxing (README only; data on Baidu Pan `pan.baidu.com/s/1bXfgR1bX7qQvD5LcXyTjfA`). "43,400 images and 1,400 videos captured by 90 smartphones of 22 models belonging to five brands ... 23 smartphone devices for iPhone 6S (Plus)". Scenes include sky and white wall (usable as quasi-flat).
- Licence: GitHub API reports `GPL-3.0` for the repo (a software licence; applicability to images unclear); README says only "shared as an open source for scientific researchers and criminal investigators". Dataset terms **unverified**.
- Verdict: Baidu Pan needs a client/account -> not scriptable. Not attempted.

### 2.10 Warwick Image Forensics Dataset (WIFD)

- URLs: https://github.com/YijunQuan/WIFD (original), https://github.com/CSCRC-SCREED/WIFD (2024 re-host; API `MIT` for that repo). 14 cameras (DSLR/mirrorless/compact), incl. same-model pairs Fujifilm X-A10 x2, Panasonic DC-TZ90 x2, Sony RX100 x2; >6,000 images with controlled ISO/exposure; `reference/` folders for fingerprints.
- Licence (YijunQuan/WIFD `LICENSE`): "Permission is hereby granted, free of charge, to any person obtaining a copy of this dataset ... for subsequent research without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, subject to the following conditions: 1. Citing the following paper ..." -> permissive but scoped to "research"; commercial R&D is arguably research, but this is ambiguous.
- Download: README pointer `https://www.dcs.warwick.ac.uk/dfdata/` returns **HTTP 404** today; RAW "please contact Yijun Quan". Whether the CSCRC-SCREED repo actually hosts image files was not confirmed -> **unverified**.

### 2.11 Kaggle IEEE Signal Processing Cup 2018 (camera model identification)

- https://www.kaggle.com/c/sp-society-camera-model-identification (page 200; data API `.../competitions/data/list/...` returns **401** without credentials). 10 camera **models**; training images come from one device per model and the labels are model-level -> **not a device-level dataset**; no flat fields. Requires Kaggle account + acceptance of competition rules (not done; rules **unverified**). Not suitable for PRNU device evaluation.

### 2.12 Mirrors and other finds (Hugging Face / Zenodo)

- Zenodo 16663245 **SCIMD-6** (CC BY 4.0, open; `BECSCIMD-6.zip` 64.5 MB for 6,315 images) and 17317613 **SCIMD-17** (CC BY 4.0; 174 MB for ~17,000 images): one phone per model, ~10 kB per image -> heavily downscaled; **unsuitable for PRNU**.
- Zenodo 23267477 "Smartphone panorama dataset for PRNU-based source camera attribution" (CC BY 4.0 metadata but `access_right: restricted`) - not accessible.
- Hugging Face `unibuc-cs/PRNU` (`license: cc-by-sa-4.0`, not gated; `camera_N/view_N/capture_*.png`): README is empty, provenance/devices undocumented -> **unverified**, not recommended.
- No official HF/Zenodo mirror of VISION, Dresden, FODB or Daxing was found.

---

## PART 3 - Download probes actually performed (2026-11-12)

All saved under `/Users/omarsiddique/sensortrace/data/_probe/` (total 16 MB):

| URL | Result | Saved as |
|---|---|---|
| `https://lesc.dinfo.unifi.it/VISION/VISION_files.txt` | **200**, 3,521,636 B, 36,343 lines | `VISION_files.txt` |
| `https://lesc.dinfo.unifi.it/VISION/VISION_base_files.txt` | **200**, 1,588,134 B, 16,414 lines | `VISION_base_files.txt` |
| `https://lesc.dinfo.unifi.it/VISION/dataset/D01_Samsung_GalaxyS3Mini/images/flat/D01_I_flat_0001.jpg` | **200**, image/jpeg, 2,644,699 B, 5.9 s; JPEG 2560x1920, EXIF SAMSUNG GT-I8190N | `D01_I_flat_0001.jpg` |
| `https://lesc.dinfo.unifi.it/VISION/dataset/D26_Samsung_GalaxyS3Mini/images/nat/D26_I_nat_0001.jpg` | **200**, image/jpeg, 3,769,045 B, 8.0 s; JPEG 2560x1920, EXIF SAMSUNG GT-I8190 | `D26_I_nat_0001.jpg` |
| `https://lesc.dinfo.unifi.it/FloreView/FloreView_Dataset.txt` | **200**, 955,483 B | `FloreView_Dataset.txt` |
| `https://lesc.dinfo.unifi.it/FloreView/Dataset/D19_Google_Pixel3a/Flat/jpeg-h264/D19_I001.jpg` | **200**, image/jpeg, 1,269,409 B; EXIF Google Pixel 3a | `FV_D19_flat_probe.jpg` |

Other status codes observed (nothing saved in the project): VISION directory indexes 200 (`/VISION/`, `/VISION/dataset/`, `/VISION/dataset/D01_.../images/`); VISION file HEAD requests 200 with `accept-ranges: bytes` (~80 HEADs for size sampling); FODB index 200 and `part01.zip` HEAD 200 (5,843,764,041 B, ranges OK); RAISE pages 200, `Flat-field.zip` HEAD 200; SOCRatES 200 (encrypted zips); Dresden **timeout (000)**; Warwick `dfdata` **404**; Kaggle data API **401**; PrnuModernDevices index + list 200.
Throughput from lesc.dinfo.unifi.it was only ~0.45 MB/s per connection in these probes -> use 4-8 parallel connections and resume support.

VISION working URL pattern:

```
https://lesc.dinfo.unifi.it/VISION/dataset/D{NN}_{Brand}_{Model}/images/{flat|nat|natWA|natFBH|natFBL}/D{NN}_I_{flat|nat|natWA|natFBH|natFBL}_{NNNN}.jpg
```
Do not synthesise numbers - indices are not guaranteed contiguous; always filter `VISION_files.txt`.

---

## PART 4 - Recommended evaluation subset

**VISION, 8 devices, 3 same-model pairs, 40 flat reference + 40 native natural test images each (640 files, ~1.3 GB).**

| Device dir | Model | Role | flat avail | nat avail | sampled avg flat / nat MB |
|---|---|---|---|---|---|
| `D06_Apple_iPhone6` | iPhone 6 | pair A | 149 | 132 | 1.32 / 3.63 |
| `D15_Apple_iPhone6` | iPhone 6 | pair A | 110 | 227 | 1.40 / 3.22 |
| `D29_Apple_iPhone5` | iPhone 5 | pair B | 100 | 224 | 1.96 / 1.12 |
| `D34_Apple_iPhone5` | iPhone 5 | pair B | 106 | 204 | 1.17 / 3.74 |
| `D05_Apple_iPhone5c` | iPhone 5c | pair C | 113 | 350 | 2.28 / 1.67 |
| `D14_Apple_iPhone5c` | iPhone 5c | pair C | 130 | 209 | 1.85 / 2.03 |
| `D03_Huawei_P9` | Huawei P9 | singleton | 118 | 237 | 1.41 / 3.67 |
| `D11_Samsung_GalaxyS3` | Galaxy S3 | singleton | 102 | 207 | 0.99 / 1.17 |

Size estimate (from 6 HEAD samples per cell): flats 40 x 12.4 MB = ~495 MB; nat 40 x 20.3 MB = ~810 MB; **total ~1.3 GB** (30+30 variant: ~1.0 GB). Optional robustness tier: add the matching 40 `natWA` (WhatsApp) images per device, ~0.2-0.8 MB each, ~+150 MB.
Optional extras: `D18_Apple_iPhone5c` (third unit of pair C), `D01`/`D26` Galaxy S3 Mini (note the GT-I8190N vs GT-I8190 variant difference).

Listing method (deterministic; first N of the sorted list per device/category):

```
curl -fsS -o VISION_files.txt https://lesc.dinfo.unifi.it/VISION/VISION_files.txt
for d in D06 D15 D29 D34 D05 D14 D03 D11; do
  for c in flat nat; do
    grep -E "/${d}_[^/]+/images/${c}/" VISION_files.txt | sort | head -40
  done
done > subset_urls.txt                      # 640 lines
# download preserving the dataset layout, resumable, 6 parallel connections:
xargs -P 6 -n 1 curl -fsS --retry 3 -C - --create-dirs \
      --output-dir data/vision -O --remote-name-all < subset_urls.txt   # or: wget -x -nH --cut-dirs=2 -c -i subset_urls.txt
```
(With plain `curl -O` all files land in one directory, which is fine because names embed device and category; use `wget -x` if the tree is wanted.) Record a SHA-256 manifest after the first download so later runs are reproducible.

Evaluation notes specific to this subset:
- Scoring every test image against all 8 fingerprints gives 8 x 40 = 320 genuine and 7 x 320 = 2,240 impostor scores, of which 3 x 2 x 40 = 240 are same-model impostors (the hard case).
- Orientation: the two probe files carry different EXIF orientation tags (D01 flat "lower-left", D26 nat "upper-left"), so handle orientation explicitly (keep pixels in stored/sensor order and, if needed, test the 180-degree rotation). Per-device behaviour beyond the two probes was not checked.
- Attribution to carry in any published metrics/report: "VISION dataset (Shullani et al., EURASIP JIS 2017), (c) CSP Lab, University of Florence, CC BY-SA 4.0."
- Keep the images out of the product repo and out of shipped artefacts; download at test time.

Second-stage (modern sensors, HEIC): FloreView pairs Pixel 3a D19/D23, Redmi Note 8T D04/D10, iPhone X D02/D22 (D22 HEIC-only) + D14 iPhone 13 mini; ~35 flats and ~105 nat per device; same host, same licence, same listing approach via `FloreView_Dataset.txt`.

---

## Licence red flags (summary)

1. **pillow-heif binary wheels are GPLv2** (bundled x265) even though the Python source is BSD-3 - do not bundle the stock wheel in a proprietary product.
2. **Binghamton Camera Fingerprint code is CC BY-NC 4.0** and currently distributed only by email request - no commercial use, including as an oracle, without written permission.
3. **PyPI `prnu` is GPL-3.0-only** and is *not* the polimi code - never add it to runtime dependencies.
4. **IPOL 662 code has no licence statement** (preprint); its manuscript is CC BY-NC-SA; its BM3D dependency is non-commercial.
5. **polimi-ispl/prnu-python is MIT but is a port of the NC-licensed Binghamton code** and unmaintained (breaks on NumPy 2 in `inten_scale`) - use as dev-only oracle, do not paste into the product.
6. **FODB and RAISE prohibit commercial use**; SOCRatES needs a signed agreement; Dresden is offline; Daxing/HDR/WIFD terms unverified or ambiguous.
7. **VISION/FloreView are CC BY-SA 4.0**: commercial evaluation is fine, but any redistributed adapted material inherits BY-SA and attribution is mandatory.
8. opencv-python wheels bundle **LGPL-2.1 FFmpeg**; WeasyPrint needs **LGPL Pango** - manageable, but plan the packaging (dynamic linking, notices).
