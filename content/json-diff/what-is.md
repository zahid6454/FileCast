## What Is a JSON Diff?

A plain text diff compares two files line by line — which means reformatting a JSON file (reordering keys, changing indentation) shows up as a wall of changes even when the actual data is identical. A structural JSON diff instead compares the two documents as data: it walks matching keys and array positions and reports only what's actually different, regardless of key order or whitespace.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg></span>
    <span class="stat-tile__label">Compares data, not lines</span>
    <span class="stat-tile__sub">Key order and whitespace are ignored</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
    <span class="stat-tile__label">Exact path per change</span>
    <span class="stat-tile__sub">e.g. $.user.tags[2]</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
</div>

### Why Diff JSON Structurally?

When comparing two API responses, two config versions, or a before/after snapshot of some data, what you actually want to know is which fields changed — not which lines moved. A structural diff answers that directly: added fields, removed fields, and changed values, each with the exact path to where it happened.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This diff tool runs <strong>entirely in your browser</strong>. Paste the original JSON on the left and the changed version on the right, click Compare, and get a report of every difference — or a confirmation that both are structurally identical. Your data is never uploaded to any server — the comparison happens locally on your device.</p>
</div>
