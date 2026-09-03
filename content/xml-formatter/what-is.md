## What Is XML Formatting?

XML is valid regardless of whitespace — a SOAP response, an Android layout file, or an RSS feed is often generated or transmitted as one dense line with no indentation at all. Every element is still well-formed; it's just unreadable to a person scanning it.

Formatting adds consistent indentation so nested elements are visually easy to follow, without touching a single tag, attribute, or text value.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
    <span class="stat-tile__label">Consistent indentation</span>
    <span class="stat-tile__sub">One element per line</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">No value changes</span>
    <span class="stat-tile__sub">Same tags, attributes, and text</span>
  </div>
</div>

### Why Format XML?

APIs and build tools frequently strip whitespace from XML to save bytes. That's fine until you need to actually read the structure — debug a SOAP response, review a config change, or check which element a value belongs to. Formatting turns compact XML back into something you can follow at a glance.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This formatter runs <strong>entirely in your browser</strong>. Paste your XML into the text area, click Format, and get properly indented output instantly. Your data is never uploaded to any server — formatting happens locally on your device.</p>
</div>
