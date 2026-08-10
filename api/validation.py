"""File validation for server-side conversions.

Validates file type via magic bytes and enforces size limits.
"""

MAX_FILE_SIZE = 25 * 1024 * 1024  # 25MB

MAGIC_BYTES = {
    "docx": [(b"PK\x03\x04", 0), (b"PK\x05\x06", 0)],
    "xlsx": [(b"PK\x03\x04", 0), (b"PK\x05\x06", 0)],
    "pptx": [(b"PK\x03\x04", 0), (b"PK\x05\x06", 0)],
    "pdf": [(b"%PDF", 0)],
    "html": [],  # validated by content inspection
}

ALLOWED_EXTENSIONS = {
    "docx-to-pdf": {".docx"},
    "xlsx-to-pdf": {".xlsx"},
    "pptx-to-pdf": {".pptx"},
    "html-to-pdf": {".html", ".htm"},
    "pdf-compress": {".pdf"},
    "pdf-to-docx": {".pdf"},
}

COMPRESS_QUALITIES = {"screen", "ebook", "printer", "prepress"}


class ValidationError(Exception):
    def __init__(
        self,
        message: str,
        error_type: str = "validation_error",
        bytes_read: int | None = None,
    ):
        self.message = message
        self.error_type = error_type
        # Set only when raised mid-stream (e.g. converter.py's capped read
        # aborting before the full body is buffered) — lets callers log how
        # much was actually read instead of 0 for a rejection that happened
        # before a `content` object ever existed.
        self.bytes_read = bytes_read
        super().__init__(message)


def get_extension(filename: str) -> str:
    dot = filename.rfind(".")
    return filename[dot:].lower() if dot != -1 else ""


def check_magic_bytes(data: bytes, file_type: str) -> bool:
    entries = MAGIC_BYTES.get(file_type, [])
    if not entries:
        return True
    return any(data[offset : offset + len(sig)] == sig for sig, offset in entries)


def validate_html_content(data: bytes) -> bool:
    text = data[:4096].lstrip()
    if not text:
        return False
    return text[0:1] == b"<" or text.lower().startswith(b"<!doctype")


def validate_upload(
    content: bytes, filename: str, tool_id: str, max_size: int = MAX_FILE_SIZE
) -> None:
    # ``max_size`` defaults to the anonymous cap (backward-compatible); the convert
    # routes pass ×2 for a signed-in user (spec §6.3). The message reflects the
    # actual limit so a 50MB signed-in cap never reads "25MB".
    if len(content) > max_size:
        raise ValidationError(
            f"File exceeds the {max_size // (1024 * 1024)}MB limit "
            "for this conversion type.",
            "too_large",
        )

    if len(content) == 0:
        raise ValidationError("File is empty.", "empty_file")

    ext = get_extension(filename)
    allowed_exts = ALLOWED_EXTENSIONS.get(tool_id, set())
    if allowed_exts and ext not in allowed_exts:
        raise ValidationError(
            f"This tool accepts {', '.join(sorted(allowed_exts))} files. "
            f"You uploaded a {ext or 'unknown'} file.",
            "wrong_format",
        )

    file_type = ext.lstrip(".")
    if file_type in ("docx", "xlsx", "pptx", "pdf"):
        if not check_magic_bytes(content, file_type):
            raise ValidationError(
                "This file appears to be damaged or is not a valid "
                f"{ext.upper().lstrip('.')} file.",
                "invalid_file",
            )
    elif file_type in ("html", "htm"):
        if not validate_html_content(content):
            raise ValidationError(
                "This file does not appear to be valid HTML.",
                "invalid_file",
            )


def validate_compress_quality(quality: str) -> str:
    quality = quality.lower().strip()
    if quality not in COMPRESS_QUALITIES:
        return "ebook"
    return quality
