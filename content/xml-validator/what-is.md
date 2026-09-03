## What Is XML Validation?

"Well-formed" is XML's baseline requirement: every tag that opens must close, tags can't overlap, there's exactly one root element, and special characters like `&` and `<` must be escaped inside text content. A document can look mostly right and still fail one of these rules — a single unclosed tag makes the whole document unparseable.

Validation checks your XML against these well-formedness rules and tells you exactly what's wrong when it isn't — instead of leaving you to scan the whole document by eye for the one mismatched tag.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></span>
    <span class="stat-tile__label">Clear error description</span>
    <span class="stat-tile__sub">Not just a generic parse failure</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
    <span class="stat-tile__label">Formats valid input too</span>
    <span class="stat-tile__sub">Confirmed-valid, formatted result</span>
  </div>
</div>

### Why Validate XML?

Hand-edited XML (config files, RSS feeds, SOAP request bodies) is where well-formedness breaks most often — an unclosed tag, an unescaped `&` inside a URL, two root elements left over from a copy-paste. Validating before you use it catches these before they cause a confusing downstream parser failure.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This validator runs <strong>entirely in your browser</strong>. Paste your XML into the text area, click Validate, and see either a confirmed-valid, formatted result, or a clear description of what's wrong. Your data is never uploaded to any server — validation happens locally on your device.</p>
</div>
