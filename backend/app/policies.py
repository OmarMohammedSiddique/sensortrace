"""Decision policies available to analyses: the uncalibrated default plus calibrated files."""

from __future__ import annotations

import json
import logging
from pathlib import Path

from sensortrace_engine.decision import LITERATURE_DEFAULT_POLICY, DecisionPolicy

from .config import get_settings

log = logging.getLogger("sensortrace")


def list_policies() -> list[DecisionPolicy]:
    out = [LITERATURE_DEFAULT_POLICY]
    d = Path(get_settings().policies_dir)
    if not d.is_absolute() and not d.is_dir():
        d = Path(__file__).resolve().parent.parent / d  # relative to the backend root, whatever the working directory
    if d.is_dir():
        for f in sorted(d.glob("*.json")):
            try:
                out.append(DecisionPolicy.from_dict(json.loads(f.read_text())))
            except Exception:
                log.exception("ignoring invalid policy file %s", f.name)
    return out


def get_policy(policy_id: str | None) -> DecisionPolicy | None:
    if not policy_id:
        return LITERATURE_DEFAULT_POLICY
    return next((p for p in list_policies() if p.policy_id == policy_id), None)
