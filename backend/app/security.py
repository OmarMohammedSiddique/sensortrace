"""Password hashing, opaque tokens, signed file-access tokens and the TOTP second factor."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

import pyotp
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from .config import get_settings

_ph = PasswordHasher()  # argon2id with library defaults (OWASP-compliant parameters)
#: Verified against when the account does not exist, so timing does not reveal which emails are registered.
_DUMMY_HASH = _ph.hash("sensortrace-dummy-password")

COMMON_PASSWORDS = {
    "password", "password1", "password123", "1234567890", "12345678910", "qwertyuiop",
    "letmein123", "iloveyou123", "sensortrace", "administrator", "changeme123",
}  # fmt: skip


def password_problem(password: str, email: str = "") -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters long."
    if len(password) > 256:
        return "Password must be at most 256 characters long."
    low = password.lower()
    if low in COMMON_PASSWORDS or low == email.lower() or low == email.split("@")[0].lower():
        return "This password is too easy to guess."
    if len(set(password)) < 5:
        return "Password must contain at least 5 different characters."
    return None


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password_hash: str | None, password: str) -> bool:
    try:
        return _ph.verify(password_hash or _DUMMY_HASH, password) and password_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def needs_rehash(password_hash: str) -> bool:
    return _ph.check_needs_rehash(password_hash)


def new_token(nbytes: int = 32) -> str:
    return secrets.token_urlsafe(nbytes)


def hash_token(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(body: str) -> str:
    key = get_settings().secret_key.encode()
    return _b64(hmac.new(key, b"file-token:" + body.encode(), hashlib.sha256).digest())


def make_file_token(*, bucket: str, key: str, user_id: str, filename: str, content_type: str,
                    inline: bool = False, ttl: int | None = None) -> str:  # fmt: skip
    """Signed token granting one user time-limited read access to one stored object."""
    exp = int(time.time()) + (ttl or get_settings().file_token_seconds)
    body = _b64(json.dumps({"b": bucket, "k": key, "u": user_id, "n": filename, "t": content_type,
                            "i": inline, "e": exp}, separators=(",", ":")).encode())  # fmt: skip
    return f"{body}.{_sign(body)}"


def read_file_token(token: str) -> dict[str, Any] | None:
    try:
        body, sig = token.split(".", 1)
        if not hmac.compare_digest(sig, _sign(body)):
            return None
        data = json.loads(_unb64(body))
        if int(data["e"]) < time.time():
            return None
        return data
    except Exception:
        return None


# ------------------------------------------------------------------ second factor (TOTP, RFC 6238)

#: Codes from one step either side of now are accepted, to allow for clock drift.
TOTP_WINDOW = 1
RECOVERY_CODE_COUNT = 10


def _totp_key() -> bytes:
    return hashlib.sha256(b"totp-secret-encryption:" + get_settings().secret_key.encode()).digest()


def new_totp_secret() -> str:
    return pyotp.random_base32()


def seal_totp_secret(secret: str) -> str:
    """Encrypt a TOTP secret for storage, so a database copy alone cannot generate codes."""
    nonce = secrets.token_bytes(12)
    return _b64(nonce + AESGCM(_totp_key()).encrypt(nonce, secret.encode(), b"totp"))


def open_totp_secret(sealed: str) -> str | None:
    """Decrypt a stored TOTP secret. None if it cannot be read, for example after ST_SECRET_KEY changed."""
    try:
        raw = _unb64(sealed)
        return AESGCM(_totp_key()).decrypt(raw[:12], raw[12:], b"totp").decode()
    except (InvalidTag, ValueError):
        return None


def totp_uri(secret: str, email: str) -> str:
    return pyotp.TOTP(secret).provisioning_uri(name=email, issuer_name="SensorTrace")


def verify_totp(secret: str, code: str, last_step: int | None) -> int | None:
    """Return the time step a valid code belongs to, or None. A step at or before ``last_step`` is refused,
    so an observed code cannot be replayed."""
    code = "".join(ch for ch in code if ch.isdigit())
    if len(code) != 6:
        return None
    totp = pyotp.TOTP(secret)
    now = int(time.time()) // totp.interval
    for step in range(now - TOTP_WINDOW, now + TOTP_WINDOW + 1):
        if last_step is not None and step <= last_step:
            continue
        if hmac.compare_digest(totp.generate_otp(step), code):
            return step
    return None


def new_recovery_codes() -> tuple[list[str], list[str]]:
    """Ten single-use codes, returned once in plain text and stored only as hashes."""
    codes = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = base64.b32encode(secrets.token_bytes(10)).decode().lower()
        codes.append(f"{raw[:4]}-{raw[4:8]}-{raw[8:12]}-{raw[12:16]}")
    return codes, [hash_recovery_code(c) for c in codes]


def hash_recovery_code(code: str) -> str:
    return hash_token("recovery:" + "".join(ch for ch in code.lower() if ch.isalnum()))
