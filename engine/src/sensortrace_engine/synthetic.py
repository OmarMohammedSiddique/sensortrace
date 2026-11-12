"""Synthetic sensors and scenes for unit tests, demos and onboarding.

**Synthetic data exercises the code paths; it says nothing about real-world
accuracy.** The simulated sensor is a textbook model (multiplicative Gaussian
PRNU plus additive Gaussian noise) without demosaicing, lens correction,
multi-frame fusion or any of the processing that makes real attribution hard.
"""

from __future__ import annotations

import io

import numpy as np
from numpy.typing import NDArray
from PIL import Image
from scipy.ndimage import gaussian_filter


class SyntheticSensor:
    """A simulated sensor with a fixed multiplicative PRNU pattern."""

    def __init__(
        self,
        seed: int,
        shape: tuple[int, int] = (256, 384),
        *,
        prnu_strength: float = 0.02,
        read_noise: float = 1.5,
    ) -> None:
        self.seed = int(seed)
        self.shape = shape
        self.read_noise = float(read_noise)
        rng = np.random.default_rng([0x5E4507, self.seed])
        self.k = (rng.standard_normal((*shape, 3)) * prnu_strength).astype(np.float32)

    def scene(self, rng: np.random.Generator, *, flat: bool = False) -> NDArray[np.float32]:
        h, w = self.shape
        if flat:
            level = rng.uniform(110, 190)
            base = np.full((h, w, 3), level, dtype=np.float32)
            base += gaussian_filter(rng.standard_normal((h, w, 1)) * 40, (24, 24, 0))
            return base.astype(np.float32)
        img = np.zeros((h, w, 3), dtype=np.float32)
        for sigma, amp in ((32, 260), (8, 110), (2, 30)):
            layer = rng.standard_normal((h, w, 3)).astype(np.float32)
            img += gaussian_filter(layer, (sigma, sigma, 0)) * amp * sigma / 8
        img = img - img.min()
        img = img / max(float(img.max()), 1e-6)
        return (20 + img * 215).astype(np.float32)

    def capture(
        self,
        image_seed: int,
        *,
        flat: bool = False,
        jpeg_quality: int | None = None,
    ) -> NDArray[np.uint8]:
        """Simulate one exposure. Deterministic for a given ``(sensor, image_seed)``."""
        rng = np.random.default_rng([0x1A6E, self.seed, int(image_seed), int(flat)])
        scene = self.scene(rng, flat=flat)
        exposed = scene * (1.0 + self.k)
        exposed += rng.standard_normal(exposed.shape).astype(np.float32) * self.read_noise
        out = np.clip(np.rint(exposed), 0, 255).astype(np.uint8)
        if jpeg_quality is not None:
            out = jpeg_roundtrip(out, jpeg_quality)
        return out


def jpeg_roundtrip(pixels: NDArray[np.uint8], quality: int) -> NDArray[np.uint8]:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="JPEG", quality=int(quality), subsampling=0)
    buf.seek(0)
    return np.asarray(Image.open(buf).convert("RGB"))


def encode_jpeg(pixels: NDArray[np.uint8], quality: int = 95) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="JPEG", quality=int(quality), subsampling=0)
    return buf.getvalue()


def encode_png(pixels: NDArray[np.uint8]) -> bytes:
    buf = io.BytesIO()
    Image.fromarray(pixels).save(buf, format="PNG")
    return buf.getvalue()
