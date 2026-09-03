## Formatted vs. Minified HTML

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Formatted HTML</th><th>Minified HTML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Layout</span></td><td data-label="Formatted HTML">Indented, one element per line</td><td data-label="Minified HTML">Comments and inter-tag whitespace removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Formatted HTML">Larger</td><td data-label="Minified HTML">Smaller</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readability</span></td><td data-label="Formatted HTML">Easy to scan</td><td data-label="Minified HTML">Hard to scan</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Formatted HTML">Development, debugging</td><td data-label="Minified HTML">Production page weight</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
      <h3>What Gets Removed</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>HTML comments (<code>&lt;!-- ... --&gt;</code>)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Line breaks and indentation between tags</li>
    </ul>
  </div>
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
      <h3>What Stays Untouched</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The exact content of <code>&lt;pre&gt;</code> and <code>&lt;textarea&gt;</code> (whitespace there is part of what's displayed or submitted)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The exact content of <code>&lt;script&gt;</code> and <code>&lt;style&gt;</code> blocks (whitespace inside JS/CSS can be meaningful, and needs its own minifier — see our <a href="/convert/css-js-minifier/">CSS/JS Minifier</a>)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>All attributes, attribute values, and text content</li>
    </ul>
  </div>
</div>
