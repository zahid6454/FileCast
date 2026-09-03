## Formatted vs. Minified JSON

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Formatted JSON</th><th>Minified JSON</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Layout</span></td><td data-label="Formatted JSON">Indented, one field per line</td><td data-label="Minified JSON">Single line, no extra spaces</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Formatted JSON">Larger</td><td data-label="Minified JSON">Smallest possible for the same data</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readability</span></td><td data-label="Formatted JSON">Easy to scan</td><td data-label="Minified JSON">Hard to scan</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Formatted JSON">Debugging, code review</td><td data-label="Minified JSON">Network transfer, storage, embedding</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Keep JSON Formatted When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A person needs to read or edit it</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's checked into version control, where diffs matter</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're actively debugging its structure</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
      <h3>Minify JSON When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's being sent over the network and size matters</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's embedded inside another minified file (a bundled JS asset, for example)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's stored in a database column or cache and never read directly by a person</li>
    </ul>
  </div>
</div>
