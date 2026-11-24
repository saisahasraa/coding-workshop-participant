"""Password hashing with the standard library's scrypt (no native dependencies)."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os

_N, _R, _P, _DKLEN = 2**14, 8, 1, 64


def hash_password(password: str) -> str:
    """Return a self-describing hash: ``scrypt$N$r$salt$digest`` (base64 parts)."""
    salt = os.urandom(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=_N, r=_R, p=_P, dklen=_DKLEN)
    return "$".join(("scrypt", str(_N), str(_R), base64.b64encode(salt).decode(), base64.b64encode(digest).decode()))


def verify_password(password: str, stored: str | None) -> bool:
    """Check ``password`` against a hash from ``hash_password`` in constant time."""
    if not stored:
        return False
    try:
        algo, n, r, salt_b64, digest_b64 = stored.split("$")
        if algo != "scrypt":
            return False
        salt, expected = base64.b64decode(salt_b64), base64.b64decode(digest_b64)
        actual = hashlib.scrypt(password.encode(), salt=salt, n=int(n), r=int(r), p=_P, dklen=len(expected))
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False
