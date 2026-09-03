## Optimized vs Original SVG — What Changes

An optimized SVG renders identically to the original — the difference is entirely in what's stripped out of the underlying XML, not in what you see.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Original SVG</th><th>Optimized SVG</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg>Visible rendering</span></td><td data-label="Original SVG">As exported</td><td data-label="Optimized SVG">Identical — no visual changes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Original SVG">Includes editor cruft</td><td data-label="Optimized SVG">Smaller — cruft removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Comments</span></td><td data-label="Original SVG">Often present</td><td data-label="Optimized SVG">Removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Editor metadata</span></td><td data-label="Original SVG">Design-tool-specific fields (Inkscape, Sodipodi, etc.)</td><td data-label="Optimized SVG">Removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Path/shape data</span></td><td data-label="Original SVG">Unchanged</td><td data-label="Optimized SVG">Unchanged — geometry is never modified</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Readability</span></td><td data-label="Original SVG">Can be cluttered if opened in a code editor</td><td data-label="Optimized SVG">Cleaner if you need to read or edit it by hand</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg></span>
      <h3>Keep the Original When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're actively editing the file in a design tool that relies on its own metadata (like Inkscape's <code>sodipodi:</code> fields for undo history or guides)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>File size genuinely doesn't matter for your use case</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
      <h3>Optimize When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're publishing the SVG on a website and want it to load as fast as possible</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're embedding the SVG inline in HTML and want to keep the markup clean</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're distributing an icon or logo and don't want to also ship the design tool's internal bookkeeping</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want a smaller file with zero visual difference</li>
    </ul>
  </div>
</div>
