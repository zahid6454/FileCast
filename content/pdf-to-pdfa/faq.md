## Frequently Asked Questions

### Is it safe to use this tool on my PDF?

Yes. This tool processes your file entirely in your browser. Your PDF is never uploaded to any server — everything happens locally on your device.

### Does this make my PDF fully PDF/A compliant?

Not on its own. This tool adds the PDF/A identification metadata an archiving system looks for, but full ISO 19005 compliance also requires all fonts to be embedded, a correct color profile, and the removal of disallowed features like encryption or JavaScript — this tool doesn't check or fix any of that. For guaranteed, certified compliance, validate the result with a dedicated tool like veraPDF.

### Which PDF/A level should I choose?

PDF/A-2B is a reasonable default for most documents — it's widely accepted and supports more modern PDF features than PDF/A-1B. PDF/A-1B is the most conservative and broadly compatible option. PDF/A-3B additionally allows embedding non-PDF/A attachments, useful if your document needs to carry the original source file alongside it.

### Will tagging change how my document looks?

No. This tool only adds metadata — it doesn't alter the visible content, fonts, or layout of your document.

### What if my PDF has non-embedded fonts?

This tool doesn't detect or fix that. A document with non-embedded fonts won't reliably pass a strict PDF/A validator even after tagging, since font embedding is a hard requirement for genuine compliance, not just a metadata flag.
