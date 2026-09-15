## Two PDFs That Look Identical and Aren't

Open two PDFs side by side — both show a page of neat, readable text — and you might assume they're built the same way underneath. Try selecting a sentence in each, though, and one lets you highlight and copy the words like any normal document, while the other only lets you draw a selection box around a picture. That second file isn't broken. It's a scanned image of a page, wearing a PDF file extension, with no actual text data inside it at all.

## What a "Text-Based" PDF Actually Contains

A PDF exported from Word, Google Docs, a web page, or almost any modern software stores its text as text — actual character data, positioned on the page, that a viewer renders as readable glyphs. That's why you can select it, search it with Ctrl+F, and extract it programmatically: the words are genuinely there in the file, not just visually implied.

## What a Scanned PDF Actually Contains

A scanned PDF — from a physical scanner, a "scan to PDF" phone app, or a fax — is a different thing wearing the same file extension: a photograph of a page, saved as an image, then wrapped in a PDF container. There is no character data in the file at all. What looks like text to your eyes is, to the computer, indistinguishable from a photo of a mountain — just pixels arranged in a pattern that happens to be legible to a human. Select-and-copy doesn't work because there's nothing to select; search doesn't work because there's nothing to search.

## Where Text Extraction Fits — and Where It Doesn't

A text-extraction tool reads the character data a PDF already contains and pulls it out as plain text or into an editable document. That's a fast, exact, lossless operation when the PDF is text-based, because the words are already there — extraction just copies them out. Run the same tool on a scanned PDF and it comes back empty, not because the tool failed, but because there's no text in the source file to find. This is worth being precise about: a text-extraction tool and an OCR (optical character recognition) tool solve genuinely different problems. OCR looks at the *image* of a scanned page and uses pattern recognition to guess what characters it's looking at, effectively re-typing the document from a photo — a fundamentally heavier, imperfect, error-prone process compared to extraction, since it's reconstructing text that was never actually stored, rather than reading text that already exists.

## How to Tell Which One You Have

Before reaching for any tool, try selecting a line of text in the PDF viewer you already have open. If it highlights normally, it's text-based — extraction will work perfectly. If you can only draw a box around the whole area like an image, it's a scan, and only OCR (a separate, more involved process) will get usable text out of it — extraction alone won't.

For the text-based case — the far more common one for anything generated on a computer rather than scanned from paper — [FileCast's PDF to Text tool](/convert/pdf-to-text/) pulls the full text out of every page in your browser, nothing uploaded. If you need the result as an editable, formatted document rather than plain text, [PDF to DOCX](/convert/pdf-to-docx/) does the same underlying extraction into a Word file.

## The One-Sentence Version

A PDF that looks like text isn't always text — check whether you can select it before assuming extraction will work, because a scanned page needs OCR to reconstruct text that was never actually there.
