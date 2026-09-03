## Plain Text vs. Base64

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Plain Text / Binary</th><th>Base64</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Character set</span></td><td data-label="Plain Text / Binary">Anything, including raw bytes</td><td data-label="Base64">64 fixed ASCII characters + padding</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>Size</span></td><td data-label="Plain Text / Binary">Original size</td><td data-label="Base64">~33% larger</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Safe to paste into JSON, XML, URLs</span></td><td data-label="Plain Text / Binary">Not always</td><td data-label="Base64">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Human readable</span></td><td data-label="Plain Text / Binary">Yes (if text)</td><td data-label="Base64">No — looks like random characters</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Common uses</span></td><td data-label="Plain Text / Binary">Source data, files</td><td data-label="Base64">Email attachments, data URLs, API tokens, config files</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Keep Data as Plain Text/Binary When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's already in a format the destination system accepts directly</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>File size matters and the ~33% overhead isn't worth it</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The data needs to stay human-readable, like a log file</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Encode to Base64 When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to embed binary data (an image, a font) directly inside CSS, HTML, or JSON</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A system only accepts plain-text fields but you need to send binary data through it</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're constructing a Basic Auth header or a JWT segment by hand</li>
    </ul>
  </div>
</div>
