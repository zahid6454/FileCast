## With Metadata vs Without — What Actually Changes

Removing metadata never touches the visible image — only the hidden data traveling alongside it. Here's exactly what differs.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Original (With Metadata)</th><th>Cleaned (Metadata Removed)</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg>Visible image</span></td><td data-label="Original (With Metadata)">Unchanged</td><td data-label="Cleaned (Metadata Removed)">Identical — same pixels, same quality</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>File size</span></td><td data-label="Original (With Metadata)">Slightly larger (metadata adds a few KB)</td><td data-label="Cleaned (Metadata Removed)">Slightly smaller</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>GPS location</span></td><td data-label="Original (With Metadata)">Often embedded if location services were on</td><td data-label="Cleaned (Metadata Removed)">Removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Camera/device model</span></td><td data-label="Original (With Metadata)">Usually present</td><td data-label="Cleaned (Metadata Removed)">Removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-calendar"></use></svg>Date/time taken</span></td><td data-label="Original (With Metadata)">Usually present</td><td data-label="Cleaned (Metadata Removed)">Removed</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-user"></use></svg>Editing/author info</span></td><td data-label="Original (With Metadata)">Sometimes present (IPTC/XMP)</td><td data-label="Cleaned (Metadata Removed)">Removed</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-photo"></use></svg></span>
      <h3>Keep Metadata When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're archiving personal photos and want to preserve when and where they were taken</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're a photographer who relies on EXIF data (camera, lens, settings) for your own records</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>The metadata is required by a workflow — some stock photo or archival systems expect it</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg></span>
      <h3>Remove Metadata When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're posting a photo publicly and don't want to reveal your location</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're sharing a screenshot or photo with a stranger, client, or on a marketplace listing</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're publishing images on a website and don't need the extra file size</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You just want to be cautious by default before sharing any photo online</li>
    </ul>
  </div>
</div>
