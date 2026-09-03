## What Is URL Encoding?

URL (or "percent") encoding replaces characters that aren't safe inside a URL — spaces, `&`, `?`, `#`, non-ASCII letters, and more — with a `%` followed by their hex byte value. `hello world` becomes `hello%20world`; `café` becomes `caf%C3%A9`. It keeps a URL parseable when the data inside it (a search query, a redirect target, a file name) contains characters that would otherwise be mistaken for part of the URL's own structure.

Decoding reverses the process, turning `%20` back into a space and so on.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-auto"></use></svg></span>
    <span class="stat-tile__label">Auto-detects direction</span>
    <span class="stat-tile__sub">Encodes or decodes automatically</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
    <span class="stat-tile__label">Reserved characters escaped</span>
    <span class="stat-tile__sub">&amp;, ?, #, = and more</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
</div>

### Why Encode URLs?

Reserved characters like `&` and `=` already mean something specific in a URL (separating query parameters, for example). If a value you're putting into a query string contains one of those characters unencoded, it can silently break the URL or get parsed as a different parameter than you intended. Encoding removes the ambiguity.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>Paste text or a percent-encoded string into the box below and click the button. This tool automatically detects which direction you need — if your input contains <code>%XX</code> sequences that decode successfully, it decodes them; otherwise, it encodes your input. Everything runs <strong>in your browser</strong>; nothing is uploaded to any server.</p>
</div>
