## CSV vs XLSX — When to Use Each

CSV is the simplest, most portable way to move tabular data between systems. XLSX is the format to hand someone who's going to open it directly in Excel and start working.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>CSV</th><th>XLSX</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg>File type</span></td><td data-label="CSV">Plain text</td><td data-label="XLSX">Real spreadsheet binary format</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg>Opens directly in Excel</span></td><td data-label="CSV">With an import prompt</td><td data-label="XLSX">Instantly, no prompt</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Cell types (number vs. text)</span></td><td data-label="CSV">Not stored — guessed on import</td><td data-label="XLSX">Stored explicitly per cell</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Formulas, multiple sheets, formatting</span></td><td data-label="CSV">Not supported</td><td data-label="XLSX">Supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="CSV">Smaller</td><td data-label="XLSX">Larger</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best uses</span></td><td data-label="CSV">Data exchange, scripts, version control</td><td data-label="XLSX">Sharing a ready-to-use spreadsheet</td></tr>
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
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're feeding the data into a script, API, or database import that expects plain text</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the file to be readable in any text editor and to diff cleanly in version control</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>File size matters more than native spreadsheet features</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg></span>
      <h3>Convert to XLSX When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're sending the file to someone who will open it directly in Excel, Google Sheets, or LibreOffice Calc</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want numbers to behave as numbers immediately, without an import step</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need the recipient to skip Excel's CSV import prompt entirely</li>
    </ul>
  </div>
</div>
