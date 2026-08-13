## Frequently Asked Questions

### Is my image data uploaded anywhere?

No. Decoding, previewing, and downloading all happen entirely in your browser — nothing is sent to any server.

### Does this work with a full data URL, or just the raw Base64 part?

Both. You can paste a complete `data:image/png;base64,...` URL, or just the Base64 characters on their own — the tool detects which one you gave it.

### What image formats are supported?

PNG, JPEG, GIF, WebP, and BMP. The tool identifies the format by checking the decoded bytes' actual file signature, not by trusting a claimed `data:` mime type, so it works correctly even if the type label was wrong or missing.

### Why did I get an error saying it's not a recognized image format?

That means the decoded bytes don't match any supported image file signature — either the Base64 wasn't image data to begin with, it's a format this tool doesn't support (like SVG, which is text-based XML rather than a binary image), or the string was truncated or corrupted before you pasted it.

### Can I convert an image to Base64 too?

That's the reverse direction of what this tool does. It isn't available yet as its own dedicated tool on FileCast — check back, or in the meantime most browsers can do it via a short script using the `FileReader` API's `readAsDataURL` method.
