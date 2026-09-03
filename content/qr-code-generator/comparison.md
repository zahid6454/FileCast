## QR Code vs Barcode — When to Use Each

Both encode data into a scannable image — the difference is mostly about how much you need to fit and who's doing the scanning.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>QR Code</th><th>Code 128 (barcode)</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Shape</span></td><td data-label="QR Code">2D — a square grid</td><td data-label="Code 128 (barcode)">1D — a single row of bars</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>Data capacity</span></td><td data-label="QR Code">High — up to ~2,300 bytes</td><td data-label="Code 128 (barcode)">Lower — best for short codes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Error correction</span></td><td data-label="QR Code">Built in (recovers from ~15% damage at this tool's setting)</td><td data-label="Code 128 (barcode)">None built in beyond a checksum</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg>Scanner requirements</span></td><td data-label="QR Code">Camera-based (most smartphones)</td><td data-label="Code 128 (barcode)">Any laser or camera barcode scanner</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Common uses</span></td><td data-label="QR Code">URLs, Wi-Fi credentials, contact sharing, marketing</td><td data-label="Code 128 (barcode)">Retail, shipping, inventory</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Use a QR Code When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're encoding a URL, Wi-Fi network, contact card, or any content longer than a short ID</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The audience will scan it with an ordinary smartphone camera, not dedicated scanner hardware</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want resilience against partial damage or a small logo placed in the middle</li>
    </ul>
  </div>
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg></span>
      <h3>Use a Barcode When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're labeling inventory, shipping packages, or retail products — the systems already reading barcodes expect a 1D format</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The content is short — a SKU or serial number — and needs compatibility with existing laser scanners</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>See our <a href="/convert/barcode-generator/">Barcode Generator</a> if that's what you need instead</li>
    </ul>
  </div>
</div>
