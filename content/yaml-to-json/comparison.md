## YAML vs JSON — When to Use Each

Both formats carry the same types of data, but they serve different purposes.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>YAML</th><th>JSON</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Syntax</span></td><td data-label="YAML">Indentation-based</td><td data-label="JSON">Braces and brackets</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability</span></td><td data-label="YAML">Clean, human-friendly</td><td data-label="JSON">Compact, dense</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Comments</span></td><td data-label="YAML">Supported with #</td><td data-label="JSON">Not supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Strictness</span></td><td data-label="YAML">Flexible, forgiving</td><td data-label="JSON">Strict, unambiguous</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="YAML">Config files, DevOps tools</td><td data-label="JSON">APIs, data exchange, programming</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Keep YAML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The file is a configuration for Docker, Kubernetes, or CI/CD</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Humans will read and edit the file regularly</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need inline comments to document settings</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The consuming tool expects YAML format</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Convert to JSON When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to send the data to an API endpoint</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The receiving application only accepts JSON</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are processing the data in JavaScript, Python, or another language</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want strict parsing with no ambiguity from indentation</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The data will be stored in a database or cache that uses JSON</li>
    </ul>
  </div>
</div>
