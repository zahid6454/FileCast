"""Password hashing + policy for email/password auth (P4 §37).

Uses the ``bcrypt`` PyPI package directly (the actual Python-native bcrypt
library, not a Node port — the technical report's original text named
"bcrypt" against a Node.js architecture assumption that doesn't apply here;
see the correction note at the top of ``O1-FileCast-Technical-Report.md``).
No passlib wrapper: bcrypt's own two-function API is small enough that a
wrapper would only add a dependency without adding safety.
"""

import re

import bcrypt

MIN_PASSWORD_LENGTH = 8
# bcrypt silently ignores input past 72 BYTES (not characters) in some
# implementations and raises in others — reject explicitly so behavior is the
# same either way and a truncated password isn't confused for the real one.
MAX_PASSWORD_BYTES = 72

_PASSWORD_HAS_LETTER = re.compile(r"[A-Za-z]")
_PASSWORD_HAS_DIGIT = re.compile(r"\d")

# A fixed, valid bcrypt hash checked on every login where the account lookup
# or password field comes up empty, so verify_password() always does the same
# amount of work — a login attempt for a nonexistent email must not respond
# measurably faster than one for a real email with a wrong password (timing
# side channel for account enumeration).
_DUMMY_HASH = bcrypt.hashpw(b"dummy-password-for-timing", bcrypt.gensalt()).decode(
    "utf-8"
)


class WeakPasswordError(Exception):
    def __init__(self, message: str):
        self.message = message
        super().__init__(message)


def validate_password_strength(password: str) -> None:
    if len(password) < MIN_PASSWORD_LENGTH:
        raise WeakPasswordError(
            f"Password must be at least {MIN_PASSWORD_LENGTH} characters."
        )
    if len(password.encode("utf-8")) > MAX_PASSWORD_BYTES:
        raise WeakPasswordError("Password is too long.")
    if not _PASSWORD_HAS_LETTER.search(password) or not _PASSWORD_HAS_DIGIT.search(
        password
    ):
        raise WeakPasswordError(
            "Password must contain at least one letter and one number."
        )


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, password_hash: str | None) -> bool:
    """Constant-effort verify — always calls ``checkpw`` even when
    ``password_hash`` is ``None`` (no such user / a Google-only account), so a
    caller can't distinguish "no account" from "wrong password" by timing."""
    target = password_hash or _DUMMY_HASH
    try:
        result = bcrypt.checkpw(password.encode("utf-8"), target.encode("utf-8"))
    except ValueError:
        return False
    return result and password_hash is not None
