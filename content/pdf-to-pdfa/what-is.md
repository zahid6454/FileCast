## What Is PDF to PDF/A?

PDF/A is an ISO-standardized version of PDF (ISO 19005) built specifically for long-term archiving. It requires a document to be fully self-contained — everything needed to display it correctly, embedded directly in the file — so it keeps looking exactly the same decades from now, regardless of what software or fonts happen to be available at the time.

This tool adds the metadata identification block PDF/A-aware archives, records systems, and government filing portals look for when checking whether a document is tagged as PDF/A.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">ISO 19005 metadata</span>
    <span class="stat-tile__sub">Adds the PDF/A identification block</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg></span>
    <span class="stat-tile__label">Tagging, not full conversion</span>
    <span class="stat-tile__sub">Doesn't fix fonts or color spaces</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
    <span class="stat-tile__label">Runs in your browser</span>
    <span class="stat-tile__sub">Files never uploaded</span>
  </div>
</div>

### Why Tag a PDF as PDF/A?

Ordinary PDFs can rely on things that aren't guaranteed to exist forever — a specific font installed on the viewer's system, external files it links to, encryption that depends on software still being able to read it. PDF/A exists precisely to remove those dependencies for documents meant to be readable indefinitely: court records, medical files, government archives, and other documents with long retention requirements.

Many institutions — courts, libraries, regulatory bodies — require or strongly prefer PDF/A specifically because of that guarantee.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This tool runs <strong>entirely in your browser</strong>. It adds the PDF/A identification metadata (XMP) an archiving system checks for, locally, in your device's memory — your file is never uploaded to any server.</p>
</div>

<strong>This is metadata tagging, not a full ISO 19005 conversion</strong>: it doesn't verify or fix font embedding, convert color spaces, or remove PDF features that full compliance disallows. For a document where full, certified PDF/A compliance genuinely matters, validate the result with a dedicated tool like veraPDF afterward.
