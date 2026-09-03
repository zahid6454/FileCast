## AVIF vs WebP — When to Use Each

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>AVIF</th><th>WebP</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="AVIF">Generally smaller</td><td data-label="WebP">Small, but usually larger than AVIF</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-refresh"></use></svg>Compression</span></td><td data-label="AVIF">Lossy or lossless</td><td data-label="WebP">Lossy or lossless</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg>Transparency</span></td><td data-label="AVIF">Supported</td><td data-label="WebP">Supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg>Animation</span></td><td data-label="AVIF">Supported</td><td data-label="WebP">Supported</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-sliders"></use></svg>Color depth</span></td><td data-label="AVIF">Up to 12-bit</td><td data-label="WebP">8-bit</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Compatibility</span></td><td data-label="AVIF">~93% of browsers, ~1% of websites actually use it</td><td data-label="WebP">Broader real-world adoption, longer track record</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Encoder/tooling maturity</span></td><td data-label="AVIF">Newer, still maturing</td><td data-label="WebP">Mature, widely integrated into CMS/CDN pipelines</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg></span>
      <h3>Keep AVIF When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Serving images on your own website to modern browsers</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Maximum compression and HDR/wide-color support matter most</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You control both the encoder and the viewing environment</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-arrow-convert"></use></svg></span>
      <h3>Convert to WebP When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Publishing to a platform, CMS, or CDN that supports WebP but not AVIF</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want broader real-world compatibility than AVIF currently has</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your image-optimization pipeline is already built around WebP</li>
    </ul>
  </div>
</div>
