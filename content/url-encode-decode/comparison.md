## Raw Text vs. URL-Encoded Text

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Raw Text</th><th>URL-Encoded Text</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Spaces</span></td><td data-label="Raw Text">Literal space</td><td data-label="URL-Encoded Text"><code>%20</code> (or <code>+</code> in query strings)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Reserved characters (&amp;, ?, #, =)</span></td><td data-label="Raw Text">Literal, can break URL parsing</td><td data-label="URL-Encoded Text">Escaped as <code>%XX</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Non-ASCII characters (é, 日本語, emoji)</span></td><td data-label="Raw Text">Literal</td><td data-label="URL-Encoded Text">UTF-8 bytes, each escaped as <code>%XX</code></td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Safe to embed in a query string</span></td><td data-label="Raw Text">Not always</td><td data-label="URL-Encoded Text">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readable</span></td><td data-label="Raw Text">Yes</td><td data-label="URL-Encoded Text">Harder to read at a glance</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Keep Text Raw When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's not going inside a URL at all</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's already confirmed safe (plain ASCII letters, digits, <code>-</code>, <code>_</code>, <code>.</code>, <code>~</code>)</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>URL-Encode Text When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're building a query string parameter by hand (<code>?redirect=</code> + encoded URL)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your value might contain <code>&amp;</code>, <code>=</code>, <code>#</code>, spaces, or non-ASCII characters</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're debugging why a link with special characters isn't working as expected</li>
    </ul>
  </div>
</div>
