"""Unit tests — pure logic, no DB. Covers new Phase 1 logic AND pre-existing
converter/validation/log helpers."""

import json
import logging
import sys
from pathlib import Path

import pytest
from data.config import settings

# seed.py lives at the repo root; make it importable.
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))


# ---------------------------------------------------------------------------
# seed.compute_global_order (ledger D1 — global monotonic sort_order)
# ---------------------------------------------------------------------------


def _tool(id, category, homepage_order=None):
    d = {"id": id, "category": category}
    if homepage_order is not None:
        d["homepage_order"] = homepage_order
    return d


def test_seed_global_order_category_walk_and_homepage_first(monkeypatch):
    import seed

    # Pin the walk order so this tests the algorithm, not site-config.yaml.
    monkeypatch.setattr(
        seed,
        "CATEGORY_ORDER",
        ["image-conversion", "document-tools", "data-conversion"],
    )
    tools = [
        _tool("zeta-img", "image-conversion"),
        _tool("alpha-img", "image-conversion"),
        _tool("feat-img", "image-conversion", homepage_order=1),
        _tool("doc-b", "document-tools"),
        _tool("doc-a", "document-tools", homepage_order=1),
        _tool("data-x", "data-conversion"),
    ]
    ordered = [t["id"] for t in seed.compute_global_order(tools)]
    # image category first, homepage_order-first then alphabetical, then document,
    # then data — a single global monotonic order.
    assert ordered == [
        "feat-img",
        "alpha-img",
        "zeta-img",  # image
        "doc-a",
        "doc-b",  # document
        "data-x",  # data
    ]


def test_seed_unknown_category_sorts_last(monkeypatch):
    import seed

    monkeypatch.setattr(
        seed,
        "CATEGORY_ORDER",
        ["image-conversion", "document-tools", "data-conversion"],
    )
    tools = [_tool("mystery", "audio-video"), _tool("img", "image-conversion")]
    ordered = [t["id"] for t in seed.compute_global_order(tools)]
    assert ordered == ["img", "mystery"]


def test_category_order_follows_site_config():
    """The admin category grouping must match the homepage section order, so the
    walk order is sourced from site-config.yaml (not a hardcoded list)."""
    import yaml

    import seed

    with open(seed.SITE_CONFIG, encoding="utf-8") as f:
        expected = [c["id"] for c in (yaml.safe_load(f) or {}).get("categories", [])]
    order = seed._load_category_order()
    assert order == expected
    # Regression guard for the reported mismatch: document before image.
    assert order.index("document-tools") < order.index("image-conversion")


# ---------------------------------------------------------------------------
# netutil.get_client_ip — spoof resistance
# ---------------------------------------------------------------------------


class FakeConn:
    def __init__(self, host, headers=None):
        self.client = type("C", (), {"host": host})()
        self.headers = headers or {}


def test_get_client_ip_defaults_to_peer():
    from data.netutil import get_client_ip

    assert get_client_ip(FakeConn("1.2.3.4")) == "1.2.3.4"


def test_get_client_ip_prefers_cf_connecting_ip():
    from data.netutil import get_client_ip

    conn = FakeConn("1.2.3.4", {"cf-connecting-ip": "9.9.9.9"})
    assert get_client_ip(conn) == "9.9.9.9"


def test_get_client_ip_ignores_xff_from_untrusted_peer():
    from data.netutil import get_client_ip

    conn = FakeConn("1.2.3.4", {"x-forwarded-for": "6.6.6.6, 7.7.7.7"})
    # peer not in trusted_proxies → XFF is NOT trusted (anti-spoof)
    assert get_client_ip(conn) == "1.2.3.4"


def test_get_client_ip_trusts_xff_from_trusted_peer(monkeypatch):
    from data.netutil import get_client_ip

    monkeypatch.setattr(settings, "trusted_proxies", "1.2.3.4")
    conn = FakeConn("1.2.3.4", {"x-forwarded-for": "6.6.6.6, 7.7.7.7"})
    assert get_client_ip(conn) == "6.6.6.6"


# ---------------------------------------------------------------------------
# fingerprint.compute_fingerprint — determinism + variation
# ---------------------------------------------------------------------------


def test_fingerprint_deterministic_and_varies():
    from data.fingerprint import compute_fingerprint

    a = compute_fingerprint(FakeConn("1.2.3.4"), "jpg-to-png")
    b = compute_fingerprint(FakeConn("1.2.3.4"), "jpg-to-png")
    c = compute_fingerprint(FakeConn("1.2.3.4"), "png-to-jpg")
    d = compute_fingerprint(FakeConn("5.6.7.8"), "jpg-to-png")
    assert a == b  # same ip+tool+day → stable
    assert a != c  # different tool
    assert a != d  # different ip
    assert len(a) == 64  # sha256 hex


# ---------------------------------------------------------------------------
# conversions._counts
# ---------------------------------------------------------------------------


def _body(**kw):
    from data.routers.conversions import ConversionBody

    base = dict(tool_id="t", input_format="A", output_format="B", status="success")
    base.update(kw)
    return ConversionBody(**base)


def test_counts_success_and_error():
    from data.routers.conversions import _counts

    assert _counts(_body(status="success")) == (1, 0)
    assert _counts(_body(status="error")) == (0, 1)


def test_counts_partial_with_success_count():
    from data.routers.conversions import _counts

    assert _counts(_body(file_count=10, success_count=7)) == (7, 3)
    # clamp out-of-range success_count
    assert _counts(_body(file_count=5, success_count=99)) == (5, 0)


# ---------------------------------------------------------------------------
# validation.py (pre-existing)
# ---------------------------------------------------------------------------


def test_validation_accepts_valid_docx():
    from validation import validate_upload

    content = b"PK\x03\x04" + b"\x00" * 100
    validate_upload(content, "file.docx", "docx-to-pdf")  # no raise


def test_validation_rejects_wrong_extension():
    from validation import ValidationError, validate_upload

    with pytest.raises(ValidationError) as e:
        validate_upload(b"PK\x03\x04data", "file.txt", "docx-to-pdf")
    assert e.value.error_type == "wrong_format"


def test_validation_rejects_empty_and_oversized():
    from validation import MAX_FILE_SIZE, ValidationError, validate_upload

    with pytest.raises(ValidationError) as e1:
        validate_upload(b"", "file.docx", "docx-to-pdf")
    assert e1.value.error_type == "empty_file"
    with pytest.raises(ValidationError) as e2:
        validate_upload(b"x" * (MAX_FILE_SIZE + 1), "file.docx", "docx-to-pdf")
    assert e2.value.error_type == "too_large"


def test_validation_bad_magic_bytes():
    from validation import ValidationError, validate_upload

    with pytest.raises(ValidationError) as e:
        validate_upload(b"not a zip", "file.docx", "docx-to-pdf")
    assert e.value.error_type == "invalid_file"


def test_validate_compress_quality():
    from validation import validate_compress_quality

    assert validate_compress_quality("SCREEN") == "screen"
    assert validate_compress_quality("garbage") == "ebook"  # fallback


def test_validate_html_content():
    from validation import validate_html_content

    assert validate_html_content(b"  <!DOCTYPE html><html>")
    assert validate_html_content(b"<div>hi</div>")
    assert not validate_html_content(b"plain text")


# ---------------------------------------------------------------------------
# converter._safe_filename (pre-existing)
# ---------------------------------------------------------------------------


def test_safe_filename():
    from converter import _safe_filename

    assert _safe_filename("report.docx", ".pdf") == "report.pdf"
    # path separators are stripped (no directory traversal in the output)
    assert _safe_filename("a/b/c.docx", ".pdf") == "abc.pdf"
    assert "/" not in _safe_filename("../../etc/passwd", ".pdf")
    assert _safe_filename("", ".pdf") == "converted.pdf"


# ---------------------------------------------------------------------------
# security.hash_token
# ---------------------------------------------------------------------------


def test_hash_token_deterministic():
    from data.security import hash_token

    assert hash_token("abc") == hash_token("abc")
    assert hash_token("abc") != hash_token("abd")
    assert len(hash_token("abc")) == 64


# ---------------------------------------------------------------------------
# log.JSONFormatter (pre-existing)
# ---------------------------------------------------------------------------


def test_json_formatter_emits_structured_line():
    from log import JSONFormatter

    rec = logging.LogRecord("filecast.x", logging.INFO, "p", 1, "hello", None, None)
    out = json.loads(JSONFormatter().format(rec))
    assert out["msg"] == "hello"
    assert out["level"] == "info"
    assert out["service"] == "filecast-api"


# ---------------------------------------------------------------------------
# RateLimitMiddleware — path matching + bucket eviction (memory bound)
# ---------------------------------------------------------------------------


def test_rate_limit_path_matching():
    from middleware import RateLimitMiddleware

    match = RateLimitMiddleware._match_limit
    assert match("/api/v1/announcements/active")[0] == "/api/v1/announcements"
    assert match("/api/v1/preferences")[0] == "/api/v1/preferences"
    assert match("/api/v1/convert/docx-to-pdf")[0] == "/api/v1/convert"
    assert match("/api/v1/tools") is None  # not rate limited
    # OAuth: start + callback share one budgeted bucket; dev-login stays separate.
    assert match("/api/v1/auth/google")[0] == "/api/v1/auth/google"
    assert match("/api/v1/auth/google/callback")[0] == "/api/v1/auth/google"
    assert match("/api/v1/auth/dev-login")[0] == "/api/v1/auth/dev-login"


def test_rate_limiter_sweep_evicts_idle_buckets():
    import time

    from middleware import RATE_WINDOW, RateLimitMiddleware

    mw = RateLimitMiddleware(None)
    now = time.time()
    mw.requests["errors:1.1.1.1"] = [now - RATE_WINDOW - 10]  # stale (idle IP)
    mw.requests["errors:2.2.2.2"] = [now]  # fresh
    mw._sweep(now)
    assert "errors:1.1.1.1" not in mw.requests  # evicted → no unbounded growth
    assert "errors:2.2.2.2" in mw.requests  # active bucket retained


# --------------------------------------------------------------------------- #
# Settings env-var naming (Phase 9 §5 item 3)
# --------------------------------------------------------------------------- #


def test_github_workflow_ignores_the_reserved_actions_var(monkeypatch):
    from data.config import Settings

    # GitHub Actions RESERVES GITHUB_WORKFLOW=<name> as a built-in, and the
    # empty-prefix Settings used to read it straight into github_workflow — so
    # inside a runner it resolved to the CI job's name and would have dispatched
    # to a workflow called "CI". Prod was never affected (docker-compose sets
    # none of these), but the collision is gone rather than merely documented.
    monkeypatch.setenv("GITHUB_WORKFLOW", "CI")
    monkeypatch.delenv("FILECAST_GITHUB_WORKFLOW", raising=False)
    assert Settings(_env_file=None).github_workflow == "deploy.yml"


def test_github_workflow_reads_the_app_namespaced_var(monkeypatch):
    from data.config import Settings

    monkeypatch.setenv("FILECAST_GITHUB_WORKFLOW", "other.yml")
    assert Settings(_env_file=None).github_workflow == "other.yml"


def test_other_github_settings_keep_their_bare_names(monkeypatch):
    from data.config import Settings

    # Only github_workflow collides with a reserved var; the owner docs name
    # GITHUB_PAT in the prod .env, so renaming these would break a live deploy.
    monkeypatch.setenv("GITHUB_PAT", "pat-value")
    monkeypatch.setenv("GITHUB_OWNER", "someone")
    monkeypatch.setenv("GITHUB_REPO", "SomeRepo")
    s = Settings(_env_file=None)
    assert s.github_pat == "pat-value"
    assert s.github_owner == "someone"
    assert s.github_repo == "SomeRepo"
