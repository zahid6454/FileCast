## What Is HTML Formatting?

Browsers don't care about whitespace in HTML — a page's markup can be minified to one dense line by a build tool or a CMS and still render identically. But minified markup is nearly impossible to read: nested `div`s, `span`s, and lists all run together with no visual structure.

Formatting adds consistent indentation so the element hierarchy is easy to follow by eye, without changing what the page renders.

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
    <span class="stat-tile__label">No rendering change</span>
    <span class="stat-tile__sub">Same page, just readable markup</span>
  </div>
</div>

### Why Format HTML?

Minified HTML is common — production builds strip whitespace to shave page weight, and copying markup from "View Source" or a browser's dev tools often loses its original indentation. When you need to actually read the structure, debug a layout issue, or document a snippet, formatting turns it back into something scannable.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>This formatter runs <strong>entirely in your browser</strong>. Paste your HTML into the text area, click Format, and get properly indented output instantly. Your data is never uploaded to any server — formatting happens locally on your device.</p>
</div>
