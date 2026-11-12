"""Image quality and processing-history assessment.

Flags describe conditions known from the literature to weaken or invalidate
PRNU analysis. They are heuristics that inform the examiner and gate the
decision policy; they are not forensic findings in themselves.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Literal

import cv2
import numpy as np

from .ingest import IngestedImage
from .residual import as_float_image, saturation_mask, to_gray

Severity = Literal["info", "warning", "severe"]

_EDITORS = (
    "photoshop", "lightroom", "gimp", "snapseed", "picsart", "affinity", "pixelmator",
    "capture one", "darktable", "rawtherapee", "luminar", "facetune", "vsco", "canva",
    "paint.net", "imagemagick", "instagram", "whatsapp", "firefly", "midjourney",
    "dall", "stable diffusion", "topaz", "remini",
)  # fmt: skip


@dataclass(frozen=True)
class QualityFlag:
    code: str
    severity: Severity
    message: str


@dataclass
class QualityReport:
    metrics: dict[str, Any]
    flags: list[QualityFlag] = field(default_factory=list)

    @property
    def worst(self) -> Severity | None:
        order = {"info": 0, "warning": 1, "severe": 2}
        return max((f.severity for f in self.flags), key=lambda s: order[s], default=None)

    def has(self, code: str) -> bool:
        return any(f.code == code for f in self.flags)

    def to_dict(self) -> dict[str, Any]:
        return {"metrics": self.metrics, "flags": [asdict(f) for f in self.flags], "worst": self.worst}


def _texture_index(gray: np.ndarray) -> float:
    """Mean absolute Laplacian on the 0..255 scale: a cheap measure of fine detail.

    Strong texture leaks scene content into the noise residual and lowers the
    achievable correlation; flat, well-exposed images score low.
    """
    lap = cv2.Laplacian(gray, cv2.CV_32F, ksize=3)
    return float(np.mean(np.abs(lap)))


def assess_quality(image: IngestedImage, *, role: Literal["reference", "questioned"] = "questioned") -> QualityReport:
    px = as_float_image(image.pixels)
    gray = to_gray(px)
    if px.ndim == 3:
        sat = np.zeros(gray.shape, dtype=bool)
        for c in range(3):
            sat |= saturation_mask(px[..., c])
    else:
        sat = saturation_mask(px)
    megapixels = image.width * image.height / 1e6
    md = image.metadata
    metrics: dict[str, Any] = {
        "megapixels": round(megapixels, 3),
        "mean_intensity": float(gray.mean()),
        "saturated_fraction": float(sat.mean()),
        "dark_fraction": float((gray < 16).mean()),
        "texture_index": _texture_index(gray),
        "jpeg_quality_estimate": md.get("JpegQualityEstimate"),
    }
    flags: list[QualityFlag] = []

    def add(code: str, severity: Severity, message: str) -> None:
        flags.append(QualityFlag(code, severity, message))

    if megapixels < 0.25:
        add("very_low_resolution", "severe",
            f"Only {megapixels:.2f} MP. Too few pixels for a reliable statistic.")  # fmt: skip
    elif megapixels < 1.0:
        add("low_resolution", "warning",
            f"Only {megapixels:.2f} MP. Detection power falls with pixel count.")  # fmt: skip

    s = metrics["saturated_fraction"]
    if s > 0.5:
        add("heavy_saturation", "severe", f"{s:.0%} of pixels are clipped and carry no sensor pattern.")
    elif s > 0.15:
        add("saturation", "warning", f"{s:.0%} of pixels are clipped and carry no sensor pattern.")

    if metrics["mean_intensity"] < 25 or metrics["dark_fraction"] > 0.6:
        add("very_dark", "warning",
            "Image is very dark. PRNU is multiplicative, so dark regions contain little of it.")  # fmt: skip

    q = metrics["jpeg_quality_estimate"]
    if q is not None:
        if q < 50:
            add("strong_jpeg_compression", "severe",
                f"Estimated JPEG quality {q:.0f}. Strong compression removes most of the sensor pattern.")  # fmt: skip
        elif q < 75:
            add("jpeg_compression", "warning",
                f"Estimated JPEG quality {q:.0f}. Compression attenuates the sensor pattern.")  # fmt: skip

    if metrics["texture_index"] > 12.0:
        add("high_texture", "warning" if role == "reference" else "info",
            "Strongly textured content. Scene detail leaks into the noise residual and lowers the "
            "achievable correlation" + ("; flat, evenly lit reference images work best." if role == "reference" else "."))  # fmt: skip

    if image.format == "png":
        add("png_container", "warning",
            "PNG is rarely a camera original. The file may be a screenshot, an export or a "
            "conversion, in which case the sensor pattern may be absent or geometrically altered.")  # fmt: skip

    if not md.get("HasExif"):
        add("no_camera_metadata", "info",
            "No EXIF metadata. Metadata is often stripped by messaging apps, social networks and "
            "editors, which usually also recompress or resize the image.")  # fmt: skip

    software = str(md.get("Software", "")).lower()
    if software and any(e in software for e in _EDITORS):
        add("editing_software", "warning",
            f"Metadata names editing or sharing software ({md.get('Software')}). Edited or re-exported "
            "images may no longer be aligned with the sensor grid.")  # fmt: skip

    zoom = md.get("DigitalZoomRatio")
    if isinstance(zoom, (int, float)) and zoom > 1.01:
        add("digital_zoom", "severe",
            f"Digital zoom ratio {zoom:.2f} recorded. Digitally zoomed images are resampled and "
            "cannot be aligned with a native-resolution fingerprint by this version.")  # fmt: skip

    ew, eh = md.get("ExifImageWidth"), md.get("ExifImageHeight")
    if isinstance(ew, int) and isinstance(eh, int) and ew > 0 and eh > 0:
        if {ew, eh} != {image.width, image.height}:
            add("dimension_mismatch", "warning",
                f"EXIF records {ew}x{eh} px but the file is {image.width}x{image.height} px: the image "
                "was resized or cropped after capture.")  # fmt: skip

    cr = md.get("CustomRendered")
    if isinstance(cr, int) and cr not in (0,):
        add("custom_rendering", "warning",
            f"EXIF CustomRendered={cr}: the camera applied special processing (for example HDR, "
            "panorama or portrait rendering). Multi-frame and computational modes can weaken or "
            "displace the sensor pattern.")  # fmt: skip
    if md.get("CompositeImage") in (2, 3):
        add("composite_image", "warning", "EXIF marks this as a composite (multi-frame) image.")

    for note in image.decode_notes:
        add("decode_note", "info", note)

    return QualityReport(metrics=metrics, flags=flags)
