"""Password hashing, opaque tokens and signed, expiring file-access tokens."""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import secrets
import time
from typing import Any

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from zxcvbn import zxcvbn

from .config import get_settings

_ph = PasswordHasher()  # argon2id with library defaults (OWASP-compliant parameters)
#: Verified against when the account does not exist, so timing does not reveal which emails are registered.
_DUMMY_HASH = _ph.hash("sensortrace-dummy-password")

#: zxcvbn score (0-4) a new password must reach. 3 means about 10^8 guesses or more: the estimate
#: draws on lists of passwords exposed in breaches, common words, names, keyboard patterns and dates.
MIN_PASSWORD_SCORE = 3
#: zxcvbn's own input limit. Anything longer is already well beyond the score needed.
_SCORED_LENGTH = 72


def password_problem(password: str, email: str = "", display_name: str = "") -> str | None:
    if len(password) < 10:
        return "Password must be at least 10 characters long."
    if len(password) > 256:
        return "Password must be at most 256 characters long."
    if len(set(password)) < 5:
        return "Password must contain at least 5 different characters."
    names = display_name.split()
    hints = [h for h in (email, email.split("@")[0], "".join(names), *names, "sensortrace") if h]
    result = zxcvbn(password[:_SCORED_LENGTH], user_inputs=hints)
    if result["score"] < MIN_PASSWORD_SCORE:
        warning = result["feedback"].get("warning") or ""
        reason = f" {warning.rstrip('.')}." if warning else ""
        return f"This password is too easy to guess.{reason} Try a longer phrase of unrelated words."
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
