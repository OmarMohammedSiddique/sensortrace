"""SensorTrace forensic engine: PRNU sensor fingerprinting for still images.

The engine is independent of the web application. Public entry points:

* :func:`ingest.ingest_image` - validate and decode evidence
* :func:`enrol.enrol` - screen reference images and estimate a fingerprint
* :func:`pipeline.analyse_questioned` - compare a questioned image with candidates
* :mod:`stats` - evaluation statistics
"""

from .decision import LITERATURE_DEFAULT_POLICY, Decision, DecisionPolicy, Verdict, decide, effective_pce
from .enrol import EnrolConfig, EnrolmentResult, ReferenceInput, enrol
from .errors import EngineError
from .fingerprint import Fingerprint, FingerprintAccumulator, estimate_fingerprint
from .ingest import IngestedImage, IngestLimits, ingest_image
from .matching import ComparisonMeasurement, compare
from .pipeline import AnalysisResult, Candidate, analyse_questioned
from .quality import QualityReport, assess_quality
from .residual import Residual, extract_residual
from .version import ALGORITHM_VERSION, DECISION_POLICY_VERSION, ENGINE_VERSION

__all__ = [
    "ALGORITHM_VERSION", "DECISION_POLICY_VERSION", "ENGINE_VERSION", "LITERATURE_DEFAULT_POLICY",
    "AnalysisResult", "Candidate", "ComparisonMeasurement", "Decision", "DecisionPolicy",
    "EngineError", "EnrolConfig", "EnrolmentResult", "Fingerprint", "FingerprintAccumulator",
    "IngestLimits", "IngestedImage", "QualityReport", "ReferenceInput", "Residual", "Verdict",
    "analyse_questioned", "assess_quality", "compare", "decide", "effective_pce", "enrol",
    "estimate_fingerprint", "extract_residual", "ingest_image",
]  # fmt: skip
