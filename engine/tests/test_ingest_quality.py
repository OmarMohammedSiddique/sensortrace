from __future__ import annotations

import io
import struct
import zlib

import numpy as np
import pytest
from PIL import Image

from sensortrace_engine.errors import (
    CorruptImageError,
    ImageTooLargeError,
    ImageTooSmallError,
    UnsupportedFormatError,
)
from sensortrace_engine.ingest import (
    IngestLimits,
    apply_orientation,
    hamming_hex,
    ingest_image,
    make_preview,
    sha256_hex,
)
from sensortrace_engine.quality import assess_quality
from sensortrace_engine.synthetic import encode_jpeg, encode_png


@pytest.fixture(scope="module")
def img(sensor_a):
    return sensor_a.capture(7)


def _jpeg_with_exif(pixels, **tags) -> bytes:
    im = Image.fromarray(pixels)
    exif = Image.Exif()
    names = {"Orientation": 0x0112, "Make": 0x010F, "Model": 0x0110, "Software": 0x0131}
    for k, v in tags.items():
        if k in names:
            exif[names[k]] = v
    sub = exif.get_ifd(0x8769)
    if "DigitalZoomRatio" in tags:
        sub[0xA404] = tags["DigitalZoomRatio"]
    if "ExifImageWidth" in tags:
        sub[0xA002] = tags["ExifImageWidth"]
        sub[0xA003] = tags["ExifImageHeight"]
    buf = io.BytesIO()
    im.save(buf, format="JPEG", quality=95, exif=exif)
    return buf.getvalue()


def test_jpeg_ingest_basic(img):
    data = encode_jpeg(img, 93)
    out = ingest_image(data)
    assert out.format == "jpeg" and out.mime_type == "image/jpeg"
    assert (out.height, out.width) == img.shape[:2] and out.channels == 3
    assert out.sha256 == sha256_hex(data) and out.size_bytes == len(data)
    assert 88 <= out.metadata["JpegQualityEstimate"] <= 97
    assert out.exif_orientation == 1 and out.metadata["HasExif"] is False


def test_png_ingest_is_lossless(img):
    out = ingest_image(encode_png(img))
    assert out.format == "png" and np.array_equal(out.pixels, img)


def test_png_16bit_rgba_gray_palette(img):
    import cv2

    ok, buf = cv2.imencode(".png", (img[..., ::-1].astype(np.uint16) * 257))
    o16 = ingest_image(buf.tobytes())
    assert o16.bit_depth == 16 and o16.pixels.dtype == np.uint16 and np.array_equal(o16.pixels >> 8, img)

    rgba = np.dstack([img, np.full(img.shape[:2], 200, np.uint8)])
    b = io.BytesIO()
    Image.fromarray(rgba, "RGBA").save(b, format="PNG")
    o = ingest_image(b.getvalue())
    assert o.channels == 3 and np.array_equal(o.pixels, img) and any("Alpha" in n for n in o.decode_notes)

    b = io.BytesIO()
    Image.fromarray(img[..., 1]).save(b, format="PNG")
    og = ingest_image(b.getvalue())
    assert og.channels == 1 and np.array_equal(og.pixels, img[..., 1])

    b = io.BytesIO()
    Image.fromarray(img).quantize(64).save(b, format="PNG")
    op = ingest_image(b.getvalue())
    assert op.pixels.ndim == 3 and any("Palette" in n for n in op.decode_notes)


def test_exif_orientation_is_recorded_but_not_applied(img):
    data = _jpeg_with_exif(img, Orientation=6, Make="Acme", Model="X1")
    out = ingest_image(data)
    assert out.exif_orientation == 6
    assert out.pixels.shape[:2] == img.shape[:2]  # stored geometry untouched
    assert out.metadata["Make"] == "Acme" and out.metadata["Model"] == "X1"
    assert apply_orientation(out.pixels, 6).shape[:2] == img.shape[:2][::-1]


@pytest.mark.parametrize(
    "payload",
    [b"", b"hello world, definitely not an image", b"GIF89a" + b"\x00" * 64, b"%PDF-1.7\n", b"<svg></svg>",
     b"RIFF\x00\x00\x00\x00WEBPVP8 ", b"\x00\x00\x00\x18ftypheic" + b"\x00" * 32],
)  # fmt: skip
def test_non_images_and_unsupported_formats_rejected(payload):
    with pytest.raises((UnsupportedFormatError, CorruptImageError)):
        ingest_image(payload)


def test_extension_is_irrelevant_magic_bytes_rule(img):
    # An executable or script renamed to .jpg has no JPEG magic and is refused.
    with pytest.raises(UnsupportedFormatError):
        ingest_image(b"MZ\x90\x00" + b"\x00" * 200)
    with pytest.raises(UnsupportedFormatError):
        ingest_image(b"#!/bin/sh\nrm -rf /\n")


def test_truncated_and_corrupted_files_rejected(img):
    j = encode_jpeg(img)
    with pytest.raises(CorruptImageError):
        ingest_image(j[: len(j) // 3])
    with pytest.raises(CorruptImageError):
        ingest_image(j[:2] + b"\xff\xd8\xff\xe0" + b"\x00" * 50)
    p = bytearray(encode_png(img))
    p[len(p) // 2] ^= 0xFF  # break a CRC / deflate stream
    with pytest.raises(CorruptImageError):
        ingest_image(bytes(p))
    with pytest.raises(CorruptImageError):
        ingest_image(bytes(p[:100]))


def _png_header_only(width: int, height: int) -> bytes:
    def chunk(tag: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", zlib.crc32(tag + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    idat = zlib.compress(b"\x00" * 1024)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


@pytest.mark.parametrize("dims", [(20000, 20000), (60000, 60000), (2**31 - 1, 2**31 - 1)])
def test_decompression_bomb_rejected_from_header(dims):
    bomb = _png_header_only(*dims)
    assert len(bomb) < 2000
    with pytest.raises((ImageTooLargeError, CorruptImageError)):
        ingest_image(bomb)


def test_size_limits(img):
    data = encode_jpeg(img)
    with pytest.raises(ImageTooLargeError):
        ingest_image(data, IngestLimits(max_bytes=1000))
    with pytest.raises(ImageTooLargeError):
        ingest_image(data, IngestLimits(max_pixels=1000))
    with pytest.raises(ImageTooSmallError):
        ingest_image(encode_png(img[:32, :32]))


def test_dhash_detects_near_duplicates(sensor_a, img):
    a = ingest_image(encode_jpeg(img, 95)).dhash
    b = ingest_image(encode_jpeg(img, 60)).dhash
    c = ingest_image(encode_jpeg(sensor_a.capture(8), 95)).dhash
    assert hamming_hex(a, b) <= 4 < hamming_hex(a, c)


def test_preview_is_oriented_small_and_metadata_free(img):
    prev = make_preview(img, orientation=6, max_side=128)
    im = Image.open(io.BytesIO(prev))
    assert max(im.size) == 128 and im.size[0] < im.size[1]
    assert not im.getexif()


def test_quality_flags(img):
    def codes(data, role="questioned"):
        return {f.code for f in assess_quality(ingest_image(data), role=role).flags}

    assert "png_container" in codes(encode_png(img))
    assert "strong_jpeg_compression" in codes(encode_jpeg(img, 30))
    assert "jpeg_compression" in codes(encode_jpeg(img, 65))
    assert "no_camera_metadata" in codes(encode_jpeg(img, 95))
    assert "editing_software" in codes(_jpeg_with_exif(img, Software="Adobe Photoshop 25.0"))
    assert "digital_zoom" in codes(_jpeg_with_exif(img, DigitalZoomRatio=2.0))
    assert "dimension_mismatch" in codes(_jpeg_with_exif(img, ExifImageWidth=4000, ExifImageHeight=3000))
    sat = img.copy()
    sat[:, : sat.shape[1] * 2 // 3] = 255
    assert "heavy_saturation" in codes(encode_png(sat))
    dark = (img // 16).astype(np.uint8)
    assert "very_dark" in codes(encode_png(dark))
    assert "low_resolution" in codes(encode_png(img)) or "very_low_resolution" in codes(encode_png(img))
