## Minified vs. Formatted JSON

Both represent exactly the same data — the only difference is whitespace.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Minified JSON</th><th>Formatted JSON</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Layout</span></td><td data-label="Minified JSON">Single line, no spaces</td><td data-label="Formatted JSON">Indented, one field per line</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Minified JSON">Smallest</td><td data-label="Formatted JSON">Larger (whitespace adds bytes)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readability</span></td><td data-label="Minified JSON">Hard to scan</td><td data-label="Formatted JSON">Easy to scan and diff</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Minified JSON">API responses, storage, transfer</td><td data-label="Formatted JSON">Debugging, code review, documentation</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
      <h3>Keep JSON Minified When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's being sent over the network (every byte counts)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's stored in a database column or cache</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's embedded in another file and never read directly</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Format JSON When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're debugging an API response or a config file</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to review changes in a pull request</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're documenting a JSON structure for other developers</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're pasting an example into documentation or a bug report</li>
    </ul>
  </div>
</div>
