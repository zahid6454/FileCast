## TSV vs CSV — When to Use Each

Both formats do the same job — the difference is almost entirely about which one the tool on the other end expects.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>TSV</th><th>CSV</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Delimiter</span></td><td data-label="TSV">Tab character</td><td data-label="CSV">Comma</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Quoting needed for delimiter in data</span></td><td data-label="TSV">Rarely (tabs are uncommon in real data)</td><td data-label="CSV">Often (commas are common in real data)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-upload-cloud"></use></svg>Default export format</span></td><td data-label="TSV">Databases, command-line tools</td><td data-label="CSV">Spreadsheets, most import/export tools</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Tool support</span></td><td data-label="TSV">Narrower</td><td data-label="CSV">Nearly universal</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability in a plain text editor</span></td><td data-label="TSV">Columns don't visually align without a monospace font</td><td data-label="CSV">Similar</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Keep TSV When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're passing data between command-line tools or scripts that already expect tabs</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your data commonly contains commas, and you'd rather avoid comma-quoting entirely</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Convert to CSV When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're importing into a spreadsheet app or database tool that expects comma-delimited files specifically</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>An API or upload form says "CSV" and rejects tab-delimited input</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the more broadly recognized format for sharing with someone else</li>
    </ul>
  </div>
</div>
