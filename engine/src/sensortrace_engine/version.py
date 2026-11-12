"""Version identifiers recorded in every derived artefact.

``ALGORITHM_VERSION`` must be bumped whenever a change alters numerical output
(denoiser, estimator, post-processing, statistic). Fingerprints and results
store it so that an old result can be traced to the exact method that made it.
"""

from __future__ import annotations

import platform
from importlib import metadata

ENGINE_VERSION = "0.1.0"

#: Version of the numerical pipeline. Format: ``<family>-<major>.<minor>``.
ALGORITHM_VERSION = "prnu-wavelet-mle-1.0"

#: Version of the decision policy logic (not of any particular thresholds).
DECISION_POLICY_VERSION = "policy-1.1"


def library_versions() -> dict[str, str]:
    """Versions of numerical libraries that can affect decoded pixels or results."""
    out: dict[str, str] = {"python": platform.python_version()}
    for pkg in ("numpy", "scipy", "PyWavelets", "pillow", "opencv-python-headless"):
        try:
            out[pkg] = metadata.version(pkg)
        except metadata.PackageNotFoundError:  # pragma: no cover - defensive
            out[pkg] = "unknown"
    return out
