## What Is Base64 Encoding?

Base64 is a way of representing binary data — or any text — using only 64 printable ASCII characters (A–Z, a–z, 0–9, `+`, `/`, with `=` for padding). It doesn't compress or encrypt anything; it just re-packages bytes into a format that's safe to paste into places that only expect plain text, like an email body, a JSON field, or a CSS `url()`.

Encoding turns readable text (or raw bytes) into that Base64 alphabet. Decoding reverses it, turning the Base64 string back into the original data.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-auto"></use></svg></span>
    <span class="stat-tile__label">Auto-detects direction</span>
    <span class="stat-tile__sub">Encodes or decodes automatically</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
    <span class="stat-tile__label">64-character alphabet</span>
    <span class="stat-tile__sub">A–Z · a–z · 0–9 · + · /</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg></span>
    <span class="stat-tile__label">~33% larger output</span>
    <span class="stat-tile__sub">The cost of a text-safe format</span>
  </div>
</div>

### Why Use Base64?

Some systems — old email protocols, certain APIs, URL query strings, JSON documents — can't safely carry arbitrary binary bytes or every character a string might contain. Base64 sidesteps that by using a fixed, safe character set, at the cost of making the encoded output about 33% larger than the original.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>Paste text or a Base64 string into the box below and click the button. This tool automatically detects which direction you need — if what you pasted decodes cleanly as valid Base64, it decodes it; otherwise, it encodes it. Everything happens <strong>in your browser</strong>; nothing is uploaded to any server.</p>
</div>
