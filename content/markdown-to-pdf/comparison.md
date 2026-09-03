## Markdown vs PDF — When to Convert

Markdown and PDF serve different purposes. A `.md` file is a lightweight, editable source format, while a PDF is a fixed, finished document. Here is how they compare.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Markdown (.md)</th><th>PDF Document</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Editing</span></td><td data-label="Markdown (.md)">Trivial in any text editor</td><td data-label="PDF Document">Requires a PDF editor</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Formatting marks</span></td><td data-label="Markdown (.md)">Visible as raw punctuation</td><td data-label="PDF Document">Rendered as real headings, bold, lists</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Layout</span></td><td data-label="Markdown (.md)">Reflows to fit whatever renders it</td><td data-label="PDF Document">Fixed page size and pagination</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg>Version control</span></td><td data-label="Markdown (.md)">Diffs cleanly in Git</td><td data-label="PDF Document">Doesn't diff meaningfully</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Audience</span></td><td data-label="Markdown (.md)">Developers and Markdown-aware tools</td><td data-label="PDF Document">Anyone with a PDF viewer</td></tr>
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
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You or a collaborator still needs to edit the content</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The file lives in a Git repository (a README, docs, release notes)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It will be rendered by a platform that understands Markdown natively (GitHub, a wiki, a static site)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the smallest, most portable, plain-text source format</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Convert to PDF When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're sending the document to someone without a Markdown viewer</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>A form, portal, or application specifically requires a PDF upload</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're printing or archiving the content as a finished document</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want the formatting to render correctly and consistently for everyone</li>
    </ul>
  </div>
</div>
