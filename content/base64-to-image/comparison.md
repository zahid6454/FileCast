## Base64 Image Text vs. an Actual Image File

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Base64 Text</th><th>Image File (PNG/JPEG/GIF/WebP)</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-page"></use></svg>Format</span></td><td data-label="Base64 Text">Plain text string</td><td data-label="Image File (PNG/JPEG/GIF/WebP)">Binary file</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg>Viewable directly</span></td><td data-label="Base64 Text">No — just looks like random characters</td><td data-label="Image File (PNG/JPEG/GIF/WebP)">Yes, in any image viewer</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>Size</span></td><td data-label="Base64 Text">~33% larger than the original file</td><td data-label="Image File (PNG/JPEG/GIF/WebP)">Original, smaller size</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Embeddable in HTML/CSS/JSON</span></td><td data-label="Base64 Text">Yes, directly</td><td data-label="Image File (PNG/JPEG/GIF/WebP)">Needs a separate file reference</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-mail"></use></svg>Shareable as an attachment</span></td><td data-label="Base64 Text">No</td><td data-label="Image File (PNG/JPEG/GIF/WebP)">Yes</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Keep an Image as Base64 When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It needs to stay embedded inside HTML, CSS, or a JSON payload</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>It's small (an icon, a tiny thumbnail) where avoiding an extra HTTP request matters more than the size overhead</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg></span>
      <h3>Convert Base64 Back to an Image File When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to preview what the encoded data actually looks like</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to share, print, or edit it in an image editor</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're debugging an API response that returned an image as Base64 instead of a binary attachment</li>
    </ul>
  </div>
</div>
