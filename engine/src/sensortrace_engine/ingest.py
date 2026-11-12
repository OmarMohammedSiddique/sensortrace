"""Evidence ingestion: format verification, safe decoding, hashing, metadata.

Principles
----------
* The original bytes are never modified; the SHA-256 is of the bytes as received.
* The file type is established from content (magic bytes + a real decode),
  never from the filename or a client-supplied MIME type.
* Dimensions are checked from the header **before** pixel data is decoded so a
  decompression bomb is rejected cheaply.
* Pixels are returned in **stored geometry**: the EXIF orientation tag is
  recorded but not applied, and nothing is resampled. PRNU is a pixel-exact
  pattern of the sensor grid, so analysis must run on the grid as stored.
"""

from __future__ import annotations

import hashlib
import io
import warnings
from dataclasses import dataclass, field
from fractions import Fraction
from typing import Any

import cv2
import numpy as np
from numpy.typing import NDArray
from PIL import ExifTags, Image, UnidentifiedImageError

from .errors import (
    CorruptImageError,
    ImageTooLargeError,
    ImageTooSmallError,
    UnsupportedFormatError,
)
from .version import library_versions

JPEG_MAGIC = b"\xff\xd8\xff"
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"


@dataclass(frozen=True)
class IngestLimits:
    max_bytes: int = 64 * 1024 * 1024
    max_pixels: int = 80_000_000
    min_side: int = 64


DEFAULT_LIMITS = IngestLimits()

# IJG standard luminance quantisation table (quality 50), natural order as stored by Pillow.
_STD_LUMA = np.array(
    [
        16, 11, 10, 16, 24, 40, 51, 61, 12, 12, 14, 19, 26, 58, 60, 55,
        14, 13, 16, 24, 40, 57, 69, 56, 14, 17, 22, 29, 51, 87, 80, 62,
        18, 22, 37, 56, 68, 109, 103, 77, 24, 35, 55, 64, 81, 104, 113, 92,
        49, 64, 78, 87, 103, 121, 120, 101, 72, 92, 95, 98, 112, 100, 103, 99,
    ],
    dtype=np.float64,
)  # fmt: skip


@dataclass
class IngestedImage:
    sha256: str
    size_bytes: int
    format: str  # "jpeg" | "png"
    mime_type: str
    width: int
    height: int
    channels: int
    bit_depth: int
    #: EXIF orientation tag (1..8); 1 when absent.
    exif_orientation: int
    #: Selected, JSON-serialisable metadata.
    metadata: dict[str, Any]
    #: Decoding notes that affect interpretation (alpha dropped, palette expanded, ...).
    decode_notes: list[str]
    #: 64-bit difference hash of the display-oriented image, hex. For near-duplicate detection.
    dhash: str
    #: Pixels in stored geometry: uint8/uint16, shape (H, W) or (H, W, 3).
    pixels: NDArray = field(repr=False)
    provenance: dict[str, Any] = field(default_factory=dict)

    def summary(self) -> dict[str, Any]:
        return {
            "sha256": self.sha256,
            "size_bytes": self.size_bytes,
            "format": self.format,
            "mime_type": self.mime_type,
            "width": self.width,
            "height": self.height,
            "channels": self.channels,
            "bit_depth": self.bit_depth,
            "exif_orientation": self.exif_orientation,
            "metadata": self.metadata,
            "decode_notes": self.decode_notes,
            "dhash": self.dhash,
            "provenance": self.provenance,
        }


def sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sniff_format(data: bytes) -> str:
    """Return ``"jpeg"`` or ``"png"`` from magic bytes, else raise."""
    if data.startswith(JPEG_MAGIC):
        return "jpeg"
    if data.startswith(PNG_MAGIC):
        return "png"
    raise UnsupportedFormatError(
        "file content is not a JPEG or PNG image (only these formats are supported)"
    )


def _jsonable(v: Any) -> Any:
    if isinstance(v, bytes):
        return None
    if isinstance(v, (int, str, bool)) or v is None:
        if isinstance(v, str):
            return v.replace("\x00", "").strip()[:256]
        return v
    if isinstance(v, float):
        return v if np.isfinite(v) else None
    if isinstance(v, Fraction):
        return float(v) if v.denominator else None
    if hasattr(v, "numerator") and hasattr(v, "denominator"):
        try:
            return float(v.numerator) / float(v.denominator) if v.denominator else None
        except Exception:
            return None
    if isinstance(v, (tuple, list)):
        return [_jsonable(x) for x in v][:16]
    return None


_EXIF_KEEP = {
    "Make", "Model", "Software", "DateTime", "DateTimeOriginal", "DateTimeDigitized",
    "LensMake", "LensModel", "FocalLength", "FocalLengthIn35mmFilm", "FNumber",
    "ExposureTime", "ISOSpeedRatings", "PhotographicSensitivity", "DigitalZoomRatio",
    "ExifImageWidth", "ExifImageHeight", "CustomRendered", "SceneCaptureType",
    "ExposureMode", "WhiteBalance", "Flash", "ColorSpace", "BodySerialNumber",
    "LensSerialNumber", "ImageUniqueID", "OffsetTimeOriginal", "SubjectDistanceRange",
    "CompositeImage", "Orientation",
}  # fmt: skip


def _extract_exif(img: Image.Image) -> tuple[dict[str, Any], int]:
    out: dict[str, Any] = {}
    orientation = 1
    try:
        exif = img.getexif()
    except Exception:
        return out, orientation
    if not exif:
        return out, orientation
    merged: dict[int, Any] = dict(exif.items())
    try:
        merged.update(exif.get_ifd(ExifTags.IFD.Exif))
    except Exception:
        pass
    for tag, value in merged.items():
        name = ExifTags.TAGS.get(tag)
        if name in _EXIF_KEEP:
            jv = _jsonable(value)
            if jv is not None and jv != "":
                out[name] = jv
    try:
        gps = exif.get_ifd(ExifTags.IFD.GPSInfo)
        out["HasGPS"] = bool(gps)
    except Exception:
        out["HasGPS"] = False
    o = out.get("Orientation")
    if isinstance(o, int) and 1 <= o <= 8:
        orientation = o
    out["HasExif"] = True
    return out, orientation


def estimate_jpeg_quality(qtable: list[int] | None) -> float | None:
    """Approximate IJG quality (1..100) from the luminance quantisation table.

    Exact only for encoders that scale the IJG standard table; otherwise an
    indication of compression strength.
    """
    if not qtable or len(qtable) != 64:
        return None
    q = np.asarray(qtable, dtype=np.float64)
    # Pillow may give zig-zag or natural order depending on version; both sorted
    # sets are identical, so compare order-independently via sorted ratio.
    scale = float(np.mean(100.0 * np.sort(q) / np.sort(_STD_LUMA)))
    if scale <= 0:
        return 100.0
    quality = (200.0 - scale) / 2.0 if scale <= 100.0 else 5000.0 / scale
    return float(np.clip(quality, 1.0, 100.0))


def apply_orientation(pixels: NDArray, orientation: int) -> NDArray:
    """Return pixels rotated/flipped for upright *display* (never used for analysis)."""
    ops = {
        2: lambda a: a[:, ::-1],
        3: lambda a: a[::-1, ::-1],
        4: lambda a: a[::-1, :],
        5: lambda a: np.swapaxes(a, 0, 1),
        6: lambda a: np.rot90(a, -1),
        7: lambda a: np.swapaxes(a, 0, 1)[::-1, ::-1],
        8: lambda a: np.rot90(a, 1),
    }
    fn = ops.get(orientation)
    return np.ascontiguousarray(fn(pixels)) if fn else pixels


def _to_uint8(pixels: NDArray) -> NDArray[np.uint8]:
    if pixels.dtype == np.uint16:
        return (pixels >> 8).astype(np.uint8)
    return pixels.astype(np.uint8, copy=False)


def difference_hash(pixels: NDArray, orientation: int = 1) -> str:
    """64-bit dHash of the display-oriented luminance (near-duplicate detection only)."""
    a = _to_uint8(apply_orientation(pixels, orientation))
    if a.ndim == 3:
        a = cv2.cvtColor(a, cv2.COLOR_RGB2GRAY)
    small = cv2.resize(a, (9, 8), interpolation=cv2.INTER_AREA).astype(np.int16)
    bits = (small[:, 1:] > small[:, :-1]).flatten()
    return f"{int(''.join('1' if b else '0' for b in bits), 2):016x}"


def hamming_hex(a: str, b: str) -> int:
    return (int(a, 16) ^ int(b, 16)).bit_count()


def ingest_image(data: bytes, limits: IngestLimits = DEFAULT_LIMITS) -> IngestedImage:
    """Validate and decode an evidence file. Raises an :class:`EngineError` subclass on failure."""
    if len(data) == 0:
        raise CorruptImageError("file is empty")
    if len(data) > limits.max_bytes:
        raise ImageTooLargeError(
            f"file is {len(data):,} bytes; the limit is {limits.max_bytes:,} bytes"
        )
    fmt = sniff_format(data)
    digest = sha256_hex(data)
    notes: list[str] = []

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            img = Image.open(io.BytesIO(data), formats=["JPEG" if fmt == "jpeg" else "PNG"])
    except (UnidentifiedImageError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise CorruptImageError("file header could not be parsed as an image") from None
    except Exception as exc:
        raise CorruptImageError(f"file header could not be parsed: {type(exc).__name__}") from None

    width, height = img.size
    if width <= 0 or height <= 0:
        raise CorruptImageError("image has invalid dimensions")
    if width * height > limits.max_pixels:
        raise ImageTooLargeError(
            f"image is {width}x{height} px ({width * height:,} px); the limit is {limits.max_pixels:,} px"
        )
    if min(width, height) < limits.min_side:
        raise ImageTooSmallError(
            f"image is {width}x{height} px; the minimum side is {limits.min_side} px"
        )
    if getattr(img, "n_frames", 1) > 1:
        notes.append("File contains multiple frames; only the first frame is analysed.")

    metadata, orientation = _extract_exif(img)
    metadata.setdefault("HasExif", False)
    bit_depth = 8

    try:
        if fmt == "jpeg":
            qt = getattr(img, "quantization", None) or {}
            luma = list(qt[0]) if 0 in qt else None
            metadata["JpegQualityEstimate"] = estimate_jpeg_quality(luma)
            metadata["JpegQuantHash"] = (
                hashlib.sha256(
                    b"".join(bytes(int(v) & 0xFF for v in qt[k]) for k in sorted(qt))
                ).hexdigest()[:16]
                if qt
                else None
            )
            metadata["JpegProgressive"] = bool(img.info.get("progressive", False))
            layer = getattr(img, "layer", None)
            if layer and len(layer) >= 1:
                metadata["JpegSampling"] = "x".join(f"{c[1]}{c[2]}" for c in layer)
            mode = img.mode
            if mode not in ("L", "RGB"):
                notes.append(f"JPEG colour mode {mode} converted to RGB by the decoder.")
                img = img.convert("RGB")
            img.load()
            pixels = np.asarray(img)
        else:
            mode = img.mode
            img.verify()  # structural/CRC check; consumes the file object
            arr = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_UNCHANGED)
            if arr is None:
                raise CorruptImageError("PNG pixel data could not be decoded")
            if arr.dtype == np.uint16:
                bit_depth = 16
            elif arr.dtype != np.uint8:
                raise UnsupportedFormatError(f"unsupported PNG sample type {arr.dtype}")
            if arr.ndim == 3:
                if arr.shape[2] == 4:
                    notes.append("Alpha channel discarded; analysis uses colour samples only.")
                    arr = arr[..., :3]
                if arr.shape[2] == 2:
                    notes.append("Alpha channel discarded; analysis uses grey samples only.")
                    arr = arr[..., 0]
                elif arr.shape[2] == 3:
                    arr = arr[..., ::-1]  # BGR -> RGB
            if mode == "P":
                notes.append("Palette (indexed-colour) PNG expanded to RGB.")
            pixels = np.ascontiguousarray(arr)
    except (CorruptImageError, UnsupportedFormatError):
        raise
    except (OSError, SyntaxError, ValueError, Image.DecompressionBombError) as exc:
        raise CorruptImageError(
            f"image data is corrupt or truncated ({type(exc).__name__})"
        ) from None

    if pixels.shape[0] != height or pixels.shape[1] != width:
        raise CorruptImageError("decoded dimensions do not match the file header")

    return IngestedImage(
        sha256=digest,
        size_bytes=len(data),
        format=fmt,
        mime_type="image/jpeg" if fmt == "jpeg" else "image/png",
        width=width,
        height=height,
        channels=1 if pixels.ndim == 2 else 3,
        bit_depth=bit_depth,
        exif_orientation=orientation,
        metadata=metadata,
        decode_notes=notes,
        dhash=difference_hash(pixels, orientation),
        pixels=pixels,
        provenance={"decoder": "pillow" if fmt == "jpeg" else "opencv", "libraries": library_versions()},
    )


def make_preview(pixels: NDArray, orientation: int = 1, max_side: int = 1024, quality: int = 85) -> bytes:
    """Display-oriented JPEG preview with no metadata (a derived artefact, never analysed)."""
    a = _to_uint8(apply_orientation(pixels, orientation))
    h, w = a.shape[:2]
    scale = max_side / max(h, w)
    if scale < 1.0:
        a = cv2.resize(a, (max(1, round(w * scale)), max(1, round(h * scale))), interpolation=cv2.INTER_AREA)
    buf = io.BytesIO()
    Image.fromarray(a).save(buf, format="JPEG", quality=quality)
    return buf.getvalue()
