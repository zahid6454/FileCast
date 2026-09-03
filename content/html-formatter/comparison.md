## Minified vs. Formatted HTML

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Minified HTML</th><th>Formatted HTML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Layout</span></td><td data-label="Minified HTML">Single line, no spaces</td><td data-label="Formatted HTML">Indented, one element per line</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Minified HTML">Smallest</td><td data-label="Formatted HTML">Larger (whitespace adds bytes)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readability</span></td><td data-label="Minified HTML">Hard to scan</td><td data-label="Formatted HTML">Easy to scan and diff</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Minified HTML">Production page weight</td><td data-label="Formatted HTML">Debugging, code review, documentation</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
      <h3>Keep HTML Minified When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's the version actually served to visitors (page weight matters)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's embedded inside another minified asset</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's cached or stored and never read directly</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Format HTML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're debugging a layout issue in "View Source" output</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to review a template change in a pull request</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're documenting a markup snippet for other developers</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're copying HTML out of a browser's dev tools for reuse elsewhere</li>
    </ul>
  </div>
</div>
