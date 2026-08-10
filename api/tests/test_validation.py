"""Unit — the doubled-limit size gate (Phase 5 §6.3).

``validate_upload`` takes a ``max_size`` (default = anonymous cap) and reports the
actual limit in the message; ``converter._max_size_for`` doubles it for a
signed-in user and leaves anonymous at the base cap.
"""

import pytest
from converter import _max_size_for, _read_capped
from validation import MAX_FILE_SIZE, ValidationError, validate_upload

ONE_MB = 1024 * 1024


class _FakeUploadFile:
    """Yields fixed-size chunks and records how many were actually consumed —
    stands in for Starlette's UploadFile without needing a real request."""

    def __init__(self, total_bytes: int):
        self._remaining = total_bytes
        self.reads = 0

    async def read(self, size: int) -> bytes:
        self.reads += 1
        n = min(size, self._remaining)
        self._remaining -= n
        return b"\x00" * n


def test_default_max_is_anonymous_cap_and_message_says_25mb():
    over = b"\x00" * (MAX_FILE_SIZE + 1)
    with pytest.raises(ValidationError) as ei:
        validate_upload(over, "f.txt", "generic")
    assert ei.value.error_type == "too_large"
    assert "25MB" in ei.value.message


def test_custom_max_size_lets_a_larger_file_through():
    # 2MB payload passes when max_size is 4MB (no magic/ext rules for "generic").
    payload = b"\x00" * (2 * ONE_MB)
    validate_upload(payload, "f.txt", "generic", max_size=4 * ONE_MB)  # no raise


def test_custom_max_size_message_reflects_the_actual_limit():
    payload = b"\x00" * (2 * ONE_MB)
    with pytest.raises(ValidationError) as ei:
        validate_upload(payload, "f.txt", "generic", max_size=ONE_MB)
    assert ei.value.error_type == "too_large"
    assert "1MB" in ei.value.message


def test_max_size_for_doubles_only_when_signed_in():
    assert _max_size_for(None) == MAX_FILE_SIZE
    assert _max_size_for(object()) == MAX_FILE_SIZE * 2  # any user ⇒ ×2


async def test_read_capped_returns_full_content_under_limit():
    fake = _FakeUploadFile(3 * ONE_MB)
    content = await _read_capped(fake, max_size=4 * ONE_MB)
    assert len(content) == 3 * ONE_MB


async def test_read_capped_aborts_before_reading_the_whole_body():
    # 100MB declared, but the cap is 5MB — a plain `await file.read()` would
    # buffer all 100MB before validate_upload ever got a look at it.
    fake = _FakeUploadFile(100 * ONE_MB)
    with pytest.raises(ValidationError) as ei:
        await _read_capped(fake, max_size=5 * ONE_MB)
    assert ei.value.error_type == "too_large"
    # Aborted at the 6th MB-sized chunk, not after reading all 100.
    assert fake.reads == 6
    # The partial size actually read is preserved for logging, not lost.
    assert ei.value.bytes_read == 6 * ONE_MB
