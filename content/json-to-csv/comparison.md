## JSON vs CSV — When to Use Each

Both formats store plain text, so they are lightweight and portable. The right choice depends on how you plan to use the data.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>JSON</th><th>CSV</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Structure</span></td><td data-label="JSON">Nested objects and arrays</td><td data-label="CSV">Flat rows and columns</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability</span></td><td data-label="JSON">Easy for machines, verbose for humans</td><td data-label="CSV">Easy to scan in any spreadsheet</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Nesting support</span></td><td data-label="JSON">Supports deeply nested data</td><td data-label="CSV">No nesting — strictly tabular</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best uses</span></td><td data-label="JSON">APIs, configuration files, data transfer</td><td data-label="CSV">Spreadsheets, reports, database imports</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Tool support</span></td><td data-label="JSON">Code editors, developer tools</td><td data-label="CSV">Excel, Google Sheets, databases</td></tr>
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
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your data has nested or hierarchical relationships that a flat table cannot capture</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are sending or receiving data through an API</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to store configuration settings for an application</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The data includes mixed types such as arrays within objects</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to preserve the original structure for later processing</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Convert to CSV When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to open the data in Excel or Google Sheets for sorting and filtering</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are building reports or dashboards that expect tabular input</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to import records into a relational database</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are sharing data with colleagues who are more comfortable with spreadsheets</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need a quick, visual overview of rows and columns without writing any code</li>
    </ul>
  </div>
</div>
