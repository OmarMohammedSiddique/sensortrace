from __future__ import annotations

import pytest

from sensortrace_engine.fingerprint import Fingerprint, estimate_fingerprint
from sensortrace_engine.synthetic import SyntheticSensor


@pytest.fixture(scope="session")
def sensor_a() -> SyntheticSensor:
    return SyntheticSensor(1)


@pytest.fixture(scope="session")
def sensor_b() -> SyntheticSensor:
    return SyntheticSensor(2)


@pytest.fixture(scope="session")
def fp_a(sensor_a: SyntheticSensor) -> Fingerprint:
    return estimate_fingerprint([sensor_a.capture(i, flat=True) for i in range(24)])


@pytest.fixture(scope="session")
def fp_b(sensor_b: SyntheticSensor) -> Fingerprint:
    return estimate_fingerprint([sensor_b.capture(i, flat=True) for i in range(24)])
