## Cropping vs Resizing — When to Use Which

Cropping and resizing both change an image's dimensions, but they do it in very different ways — one trims, the other scales.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Cropping</th><th>Resizing</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg>What it does</span></td><td data-label="Cropping">Removes part of the image</td><td data-label="Resizing">Scales the whole image up or down</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg>Content</span></td><td data-label="Cropping">Only the selected area remains</td><td data-label="Resizing">All original content stays, just smaller or larger</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Quality</span></td><td data-label="Cropping">No stretching or scaling artifacts</td><td data-label="Resizing">Can introduce softness at extreme scale changes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Best for</span></td><td data-label="Cropping">Removing unwanted background or fitting a specific area</td><td data-label="Resizing">Changing overall file dimensions while keeping everything visible</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-edit"></use></svg></span>
      <h3>Crop When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your photo includes background or people you want to remove</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to focus on a specific detail within a larger image</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're fitting an image into a fixed aspect ratio, like a square profile photo</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Part of the image is irrelevant or distracting</li>
    </ul>
  </div>
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-arrow-convert"></use></svg></span>
      <h3>Resize When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You want to keep the entire image but change its overall dimensions</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're meeting a specific width or height requirement without losing any content</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need a smaller file size without trimming what's shown — FileCast's <a href="/convert/image-resize/">Image Resizer</a> is built for exactly this</li>
    </ul>
  </div>
</div>
