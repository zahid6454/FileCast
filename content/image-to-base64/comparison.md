## Base64 vs a Regular Image File — When to Embed

A Base64 data URL and a regular image file show the exact same picture — the difference is how it's stored and delivered, not how it looks. Here's how the two compare.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Image File</th><th>Base64 Data URL</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Image File">Original size</td><td data-label="Base64 Data URL">About 33% larger (Base64 encoding overhead)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg>HTTP requests</span></td><td data-label="Image File">One extra request per image</td><td data-label="Base64 Data URL">Zero — embedded directly in the page or file</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg>Caching</span></td><td data-label="Image File">Cached separately by the browser</td><td data-label="Base64 Data URL">Cached only as part of the parent file</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>Editability</span></td><td data-label="Image File">Open directly in any image viewer</td><td data-label="Base64 Data URL">Must be decoded back to an image first</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Image File">Most images, especially large or reused ones</td><td data-label="Base64 Data URL">Small icons, inline emails, single-file bundles</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg></span>
      <h3>Keep a Regular Image File When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The image is large — the ~33% size increase adds up quickly</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The same image is reused across many pages (a separate file can be cached once)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to edit the image again later in an image editor</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're optimizing for page load performance at scale</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Convert to Base64 When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're embedding a small icon or logo directly into CSS or HTML</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to send an image inside a JSON payload or config file</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're building a single-file HTML email or report with no external assets</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to avoid an extra network request for a tiny, one-off image</li>
    </ul>
  </div>
</div>
