## YAML vs XML — When to Use Each

YAML is easier to write and read by hand. XML is more verbose but is still the required format for a lot of older, schema-driven systems.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>YAML</th><th>XML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Structure markers</span></td><td data-label="YAML">Indentation</td><td data-label="XML">Opening/closing tags</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability</span></td><td data-label="YAML">Compact, easy to scan</td><td data-label="XML">Verbose</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Schema validation</span></td><td data-label="YAML">Less standardized</td><td data-label="XML">XSD/DTD, widely supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Common uses</span></td><td data-label="YAML">Docker, Kubernetes, CI/CD, modern app config</td><td data-label="XML">Enterprise systems, SOAP APIs, legacy config</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Tool support</span></td><td data-label="YAML">Modern DevOps tooling</td><td data-label="XML">Enterprise and legacy platforms</td></tr>
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
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're writing configuration for Docker, Kubernetes, GitHub Actions, or similar YAML-first tooling</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Human readability matters more than strict schema validation</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Convert to XML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A target system (ERP, SOAP API, legacy platform) specifically requires XML input</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need schema validation (XSD) as part of a data exchange contract</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're integrating with older Java/.NET tooling that only reads XML configuration or data files</li>
    </ul>
  </div>
</div>
