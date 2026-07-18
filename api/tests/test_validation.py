"""Unit — the doubled-limit size gate (Phase 5 §6.3).

``validate_upload`` takes a ``max_size`` (default = anonymous cap) and reports the
actual limit in the message; ``converter._max_size_for`` doubles it for a
signed-in user and leaves anonymous at the base cap.
"""

import pytest
from converter import _max_size_for
from validation import MAX_FILE_SIZE, ValidationError, validate_upload

ONE_MB = 1024 * 1024


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
