## What Is a Unix Timestamp?

A Unix timestamp (or "epoch time") is a single number representing a moment in time: the number of seconds that have elapsed since January 1, 1970, 00:00:00 UTC. Many systems use milliseconds instead of seconds for extra precision, which is the same idea, just multiplied by 1,000.

It's a compact, timezone-free way to store a date — no parsing ambiguity, no locale formatting differences, just one number that means exactly one instant everywhere in the world.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-auto"></use></svg></span>
    <span class="stat-tile__label">Auto-detects the format</span>
    <span class="stat-tile__sub">Timestamp or date string, either works</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-calendar"></use></svg></span>
    <span class="stat-tile__label">Every common format</span>
    <span class="stat-tile__sub">Seconds · ms · ISO 8601 · UTC · local</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
</div>

### Why Use Unix Timestamps?

Storing a date as a single integer avoids the headaches of string date formats (is `01/02/2024` January 2nd or February 1st?) and sidesteps timezone confusion entirely, since a timestamp is always relative to UTC. Databases, APIs, and logs favor them for exactly this reason — they're unambiguous and easy to sort, compare, and do arithmetic on.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>Paste one or more timestamps or dates, one per line, and click Convert. This tool detects whether each line is a timestamp (auto-distinguishing seconds from milliseconds) or a date string, then shows every common representation — Unix seconds, Unix milliseconds, ISO 8601, UTC, and your local time. Everything runs <strong>in your browser</strong>; nothing is uploaded to any server.</p>
</div>
