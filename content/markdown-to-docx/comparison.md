## Markdown vs DOCX — When to Convert

Markdown and DOCX serve different purposes. A `.md` file is a lightweight, editable source format, while a `.docx` file is a fully-featured, editable Word document. Here is how they compare.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Markdown (.md)</th><th>DOCX Document</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Editing</span></td><td data-label="Markdown (.md)">Trivial in any text editor</td><td data-label="DOCX Document">Full word-processor editing (Word, LibreOffice, Google Docs)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Formatting marks</span></td><td data-label="Markdown (.md)">Visible as raw punctuation</td><td data-label="DOCX Document">Rendered as real headings, bold, lists</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Collaboration</span></td><td data-label="Markdown (.md)">Diffs cleanly in Git</td><td data-label="DOCX Document">Track changes, comments, shared review</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg>Version control</span></td><td data-label="Markdown (.md)">Plain text, diffs cleanly</td><td data-label="DOCX Document">Binary-ish format, doesn't diff meaningfully</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Audience</span></td><td data-label="Markdown (.md)">Developers and Markdown-aware tools</td><td data-label="DOCX Document">Anyone with a word processor</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Keep as Markdown When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You or a collaborator still needs to edit the raw source</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The file lives in a Git repository (a README, docs, release notes)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It will be rendered by a platform that understands Markdown natively (GitHub, a wiki, a static site)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the smallest, most portable, plain-text source format</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg></span>
      <h3>Convert to DOCX When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A collaborator needs to edit the content in Word, without knowing Markdown syntax</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need track changes, comments, or a shared review workflow</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A form or submission process specifically requires a <code>.docx</code> file</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the formatting to render correctly in a familiar word processor</li>
    </ul>
  </div>
</div>
