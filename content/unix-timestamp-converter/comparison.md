## Unix Timestamp vs. Human-Readable Date

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Unix Timestamp</th><th>Human-Readable Date (e.g. ISO 8601)</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Format</span></td><td data-label="Unix Timestamp">A single integer</td><td data-label="Human-Readable Date (e.g. ISO 8601)">A formatted string</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-calendar"></use></svg>Timezone handling</span></td><td data-label="Unix Timestamp">Always UTC-relative, unambiguous</td><td data-label="Human-Readable Date (e.g. ISO 8601)">Depends on format — may need an explicit offset</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Easy to sort/compare</span></td><td data-label="Unix Timestamp">Yes (just compare numbers)</td><td data-label="Human-Readable Date (e.g. ISO 8601)">Only if formats match exactly</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readable</span></td><td data-label="Unix Timestamp">No</td><td data-label="Human-Readable Date (e.g. ISO 8601)">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Common uses</span></td><td data-label="Unix Timestamp">Databases, APIs, logs, <code>git log</code> timestamps</td><td data-label="Human-Readable Date (e.g. ISO 8601)">UI display, documents, human communication</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Use a Unix Timestamp When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Storing a date in a database column or passing it through an API</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to sort, compare, or do arithmetic on dates efficiently</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Timezone ambiguity would otherwise be a problem</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-calendar"></use></svg></span>
      <h3>Use a Human-Readable Date When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Displaying a date to a person in a UI or document</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Writing a date into a config file, email, or log message meant to be read directly</li>
    </ul>
  </div>
</div>
