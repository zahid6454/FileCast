## What Is PDF to PDF/A?

PDF/A is an ISO-standardized version of PDF (ISO 19005) built specifically for long-term archiving. It requires a document to be fully self-contained — everything needed to display it correctly, embedded directly in the file — so it keeps looking exactly the same decades from now, regardless of what software or fonts happen to be available at the time.

This tool adds the metadata identification block PDF/A-aware archives, records systems, and government filing portals look for when checking whether a document is tagged as PDF/A.

### Why Tag a PDF as PDF/A?

Ordinary PDFs can rely on things that aren't guaranteed to exist forever — a specific font installed on the viewer's system, external files it links to, encryption that depends on software still being able to read it. PDF/A exists precisely to remove those dependencies for documents meant to be readable indefinitely: court records, medical files, government archives, and other documents with long retention requirements.

Many institutions — courts, libraries, regulatory bodies — require or strongly prefer PDF/A specifically because of that guarantee.

### How This Tool Works

This tool runs entirely in your browser. It adds the PDF/A identification metadata (XMP) an archiving system checks for, locally, in your device's memory — your file is never uploaded to any server. **This is metadata tagging, not a full ISO 19005 conversion**: it doesn't verify or fix font embedding, convert color spaces, or remove PDF features that full compliance disallows. For a document where full, certified PDF/A compliance genuinely matters, validate the result with a dedicated tool like veraPDF afterward.
