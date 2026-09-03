## Minified vs. Formatted XML

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Minified XML</th><th>Formatted XML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Layout</span></td><td data-label="Minified XML">Single line, no spaces</td><td data-label="Formatted XML">Indented, one element per line</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Minified XML">Smallest</td><td data-label="Formatted XML">Larger (whitespace adds bytes)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readability</span></td><td data-label="Minified XML">Hard to scan</td><td data-label="Formatted XML">Easy to scan and diff</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Minified XML">API transfer, storage</td><td data-label="Formatted XML">Debugging, code review, documentation</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-minimize"></use></svg></span>
      <h3>Keep XML Minified When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's being sent over the network (every byte counts)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's stored or cached and never read directly</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's embedded inside another file</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Format XML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're debugging a SOAP response or a config file</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to review changes in a pull request</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're documenting an XML schema or example for other developers</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're inspecting an RSS/Atom feed or an Android layout file by hand</li>
    </ul>
  </div>
</div>
