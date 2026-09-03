## MD5 vs SHA-256 — When to Use Each

Both produce a fixed-length fingerprint of the input. The difference is whether that fingerprint needs to hold up against someone deliberately trying to forge a match.

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>MD5</th><th>SHA-256</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-maximize"></use></svg>Digest length</span></td><td data-label="MD5">128 bits (32 hex characters)</td><td data-label="SHA-256">256 bits (64 hex characters)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg>Speed</span></td><td data-label="MD5">Faster</td><td data-label="SHA-256">Slower (still fast for normal use)</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Collision resistance</span></td><td data-label="MD5">Broken — collisions are practical to construct</td><td data-label="SHA-256">No known practical collision attack</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Suitable for security purposes</span></td><td data-label="MD5">No</td><td data-label="SHA-256">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Common uses today</span></td><td data-label="MD5">File integrity checksums, cache keys, non-adversarial deduplication</td><td data-label="SHA-256">Digital signatures, TLS certificates, password hashing (with a proper KDF), blockchain</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
      <h3>Use MD5 When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're checking a downloaded file against a checksum the publisher provided, purely to catch accidental corruption</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need a quick, short key to deduplicate or index data where nobody is adversarially trying to create a collision</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're working with legacy systems or tools that specifically expect MD5</li>
    </ul>
  </div>
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
      <h3>Use SHA-256 When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Security matters at all — verifying a file from an untrusted source, generating an API signature, or anything where a forged match would be a problem</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're building something that will eventually need to interoperate with systems (TLS, Git, blockchain) that already standardize on SHA-256</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're not sure which to use — SHA-256 has no real downside for general-purpose hashing today</li>
    </ul>
  </div>
</div>
