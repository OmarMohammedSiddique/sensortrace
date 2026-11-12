"""Engine exception hierarchy. All errors carry a stable machine-readable code."""

from __future__ import annotations


class EngineError(Exception):
    """Base class for all engine errors."""

    code = "engine_error"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        if code is not None:
            self.code = code


class UnsupportedFormatError(EngineError):
    code = "unsupported_format"


class CorruptImageError(EngineError):
    code = "corrupt_image"


class ImageTooLargeError(EngineError):
    code = "image_too_large"


class ImageTooSmallError(EngineError):
    code = "image_too_small"


class IncompatibleGeometryError(EngineError):
    code = "incompatible_geometry"


class InsufficientReferenceError(EngineError):
    code = "insufficient_reference_images"


class NumericalError(EngineError):
    code = "numerical_error"


class CancelledError(EngineError):
    code = "cancelled"
