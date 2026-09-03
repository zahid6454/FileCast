## CSV vs JSON — When to Use Each

CSV keeps things flat and simple. JSON gives you the freedom to describe relationships and hierarchy within your data. Neither format is universally better — the right pick depends on the task at hand.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>CSV</th><th>JSON</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Structure</span></td><td data-label="CSV">Flat rows and columns</td><td data-label="JSON">Key-value pairs, flexible shape</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Nesting</span></td><td data-label="CSV">Not supported</td><td data-label="JSON">Fully supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Readability by humans</span></td><td data-label="CSV">Easy for small tables</td><td data-label="JSON">Easy for structured records</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Tool support</span></td><td data-label="CSV">Spreadsheets, legacy systems</td><td data-label="JSON">Web apps, APIs, modern databases</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best uses</span></td><td data-label="CSV">Reports, exports, simple lists</td><td data-label="JSON">Data exchange, configuration, web development</td></tr>
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
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are working in spreadsheets like Excel or Google Sheets and need a format they handle natively</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your data is genuinely flat — a list of names, a table of sales figures, a simple inventory</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are dealing with legacy systems or older software that only accepts comma-delimited files</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The people receiving the data are more comfortable reviewing it in a tabular layout</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Convert to JSON When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to send data to an API that expects structured payloads</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your project runs on the web and uses JavaScript or a similar language that parses JSON directly</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The data has nested relationships — for example, a customer record containing an array of orders</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You are importing records into a document-based database like MongoDB</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want a format that pairs naturally with modern development tools and frameworks</li>
    </ul>
  </div>
</div>
