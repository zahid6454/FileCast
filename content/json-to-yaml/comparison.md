## JSON vs YAML — When to Use Each

Both formats represent structured data, but they are optimized for different audiences.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>JSON</th><th>YAML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Syntax</span></td><td data-label="JSON">Braces and brackets</td><td data-label="YAML">Indentation-based</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability</span></td><td data-label="JSON">Compact, dense</td><td data-label="YAML">Clean, easy to scan</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Comments</span></td><td data-label="JSON">Not supported</td><td data-label="YAML">Supported with #</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Quoting</span></td><td data-label="JSON">Keys and strings must be quoted</td><td data-label="YAML">Quotes usually optional</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="JSON">APIs, JavaScript apps, data exchange</td><td data-label="YAML">Config files, DevOps, infrastructure</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Keep JSON When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The data is consumed by an API or JavaScript application</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The receiving system requires JSON format</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need strict, unambiguous parsing with no whitespace sensitivity</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The data will be processed programmatically, not read by humans</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Convert to YAML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are writing configuration for Docker, Kubernetes, or CI/CD pipelines</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The file will be read and edited by people regularly</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to add comments explaining configuration choices</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The target tool expects YAML input</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You prefer a cleaner visual layout for nested settings</li>
    </ul>
  </div>
</div>
