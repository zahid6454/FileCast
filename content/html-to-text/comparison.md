## HTML vs. Plain Text

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>HTML</th><th>Plain Text</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Formatting</span></td><td data-label="HTML">Tags control bold, links, structure</td><td data-label="Plain Text">None — just line breaks</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Scripts and styles</span></td><td data-label="HTML">Can be embedded</td><td data-label="Plain Text">Not applicable</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="HTML">Larger (markup adds bytes)</td><td data-label="Plain Text">Smaller</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg>Searchable/indexable as raw content</span></td><td data-label="HTML">Markup can interfere</td><td data-label="Plain Text">Clean, direct</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="HTML">Web pages, rich display</td><td data-label="Plain Text">Plain-text fields, search indexing, analysis</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Keep Content as HTML When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It needs to render with formatting, links, and images in a browser</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're editing or storing it in a CMS that expects markup</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg></span>
      <h3>Strip to Plain Text When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're pasting content into a field that doesn't support (or shouldn't render) markup</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're feeding it into a text-analysis tool, search index, or word counter</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to read the actual copy without HTML cluttering every line</li>
    </ul>
  </div>
</div>
