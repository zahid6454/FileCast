## CSV vs XML — When to Use Each

CSV is compact and easy to open in a spreadsheet. XML is verbose but self-describing and widely supported by older enterprise tooling that predates JSON.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>CSV</th><th>XML</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Structure</span></td><td data-label="CSV">Flat rows and columns</td><td data-label="XML">Nested, self-describing tags</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Nesting</span></td><td data-label="CSV">Not supported</td><td data-label="XML">Fully supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Schema validation</span></td><td data-label="CSV">None built-in</td><td data-label="XML">XSD/DTD support</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="CSV">Compact</td><td data-label="XML">Larger (repeated tag names)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Tool support</span></td><td data-label="CSV">Spreadsheets, legacy exports</td><td data-label="XML">Enterprise systems, SOAP APIs, config files</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best uses</span></td><td data-label="CSV">Reports, exports, simple lists</td><td data-label="XML">Data exchange with legacy/enterprise systems</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Keep CSV When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're working in Excel or Google Sheets and need a format they handle natively</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your data is genuinely flat, with no nested relationships to express</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>File size matters and you don't need tag-level structure</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Convert to XML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A target system (ERP, SOAP API, legacy platform) specifically requires XML input</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need schema validation (XSD) as part of a data contract</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're integrating with older Java/.NET tooling that reads XML configuration or data files</li>
    </ul>
  </div>
</div>
