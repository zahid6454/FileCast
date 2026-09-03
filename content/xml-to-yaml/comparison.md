## XML vs YAML — When to Use Each

XML's explicit tags make it easy to validate strictly. YAML's indentation-based syntax makes it easier for a person to read and edit directly.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>XML</th><th>YAML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Structure markers</span></td><td data-label="XML">Opening/closing tags</td><td data-label="YAML">Indentation</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability</span></td><td data-label="XML">Verbose</td><td data-label="YAML">Compact, easy to scan</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Schema validation</span></td><td data-label="XML">XSD/DTD, widely supported</td><td data-label="YAML">Less standardized</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Comments</span></td><td data-label="XML"><code>&lt;!-- --&gt;</code></td><td data-label="YAML"><code>#</code> (more common in practice)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Common uses</span></td><td data-label="XML">Enterprise systems, SOAP APIs, legacy config</td><td data-label="YAML">Docker, Kubernetes, CI/CD, modern app config</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Keep XML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A target system (ERP, SOAP API, legacy platform) specifically requires XML</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need strict schema validation (XSD) as part of a data contract</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Convert to YAML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're writing configuration for Docker, Kubernetes, GitHub Actions, or similar YAML-first tooling</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Humans will be reading or editing the file directly, and readability matters more than strict validation</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want a more compact representation of the same structured data</li>
    </ul>
  </div>
</div>
