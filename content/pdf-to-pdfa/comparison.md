## PDF/A Metadata Tagging vs Full PDF/A Conversion

"Convert to PDF/A" can mean two different things depending on the tool. Here's how the quick metadata tagging this tool does compares to a full, validated conversion.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Consideration</th><th>This Tool (Metadata Tagging)</th><th>Full PDF/A Conversion (Acrobat Pro, LibreOffice)</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Adds PDF/A identification metadata</span></td><td data-label="This Tool (Metadata Tagging)">Yes</td><td data-label="Full PDF/A Conversion (Acrobat Pro, LibreOffice)">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg>Verifies all fonts are embedded</span></td><td data-label="This Tool (Metadata Tagging)">No</td><td data-label="Full PDF/A Conversion (Acrobat Pro, LibreOffice)">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg>Converts color spaces / adds ICC profile</span></td><td data-label="This Tool (Metadata Tagging)">No</td><td data-label="Full PDF/A Conversion (Acrobat Pro, LibreOffice)">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-x"></use></svg>Strips disallowed features (encryption, JavaScript)</span></td><td data-label="This Tool (Metadata Tagging)">No</td><td data-label="Full PDF/A Conversion (Acrobat Pro, LibreOffice)">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Passes a formal PDF/A validator (veraPDF)</span></td><td data-label="This Tool (Metadata Tagging)">Not guaranteed</td><td data-label="Full PDF/A Conversion (Acrobat Pro, LibreOffice)">Yes, when done correctly</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg>Speed</span></td><td data-label="This Tool (Metadata Tagging)">Seconds</td><td data-label="Full PDF/A Conversion (Acrobat Pro, LibreOffice)">Minutes, requires the software installed</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
      <h3>Use This Tool When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need a quick, no-install way to add PDF/A identification to a document</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Full ISO 19005 certification isn't a hard requirement for your use case</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're preparing a document for a system that checks for PDF/A metadata but doesn't run a strict validator</li>
    </ul>
  </div>
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg></span>
      <h3>Use a Full Conversion Tool When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need a document to pass formal PDF/A validation (a legal filing, a regulated archive with strict acceptance checks)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The source PDF has non-embedded fonts, transparency, or other features that need to be corrected, not just tagged</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Certified compliance is a contractual or regulatory requirement</li>
    </ul>
  </div>
</div>
