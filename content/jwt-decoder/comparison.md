## Decoding a JWT vs. Verifying a JWT

<div class="table-scroll">
<table class="icon-table">
<colgroup><col><col><col></colgroup>
<thead><tr><th>Feature</th><th>Decoding</th><th>Verifying</th></tr></thead>
<tbody>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg>What it checks</span></td><td data-label="Decoding">Nothing — just reads the Base64url content</td><td data-label="Verifying">The signature, against a secret or public key</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>Requires a secret/key</span></td><td data-label="Decoding">No</td><td data-label="Verifying">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg>Tells you the claims</span></td><td data-label="Decoding">Yes</td><td data-label="Verifying">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Tells you if the token is genuine</span></td><td data-label="Decoding">No</td><td data-label="Verifying">Yes</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-calendar"></use></svg>Tells you if it's expired</span></td><td data-label="Decoding">You can read <code>exp</code>, but nothing enforces it</td><td data-label="Verifying">Yes, as part of validation</td></tr>
<tr><td class="feature-cell"><span class="feature-cell__inner"><svg aria-hidden="true" focusable="false"><use href="#icon-target"></use></svg>Safe to base an authorization decision on</span></td><td data-label="Decoding">No</td><td data-label="Verifying">Yes</td></tr>
</tbody>
</table>
</div>

<div class="panel-grid">
  <div class="panel panel--accent">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
      <h3>Decode a JWT When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're debugging what claims a token actually contains</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You're inspecting a token during development, not making a security decision based on it</li>
    </ul>
  </div>
  <div class="panel panel--neutral">
    <div class="panel__head">
      <span class="panel__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg></span>
      <h3>Verify a JWT When</h3>
    </div>
    <ul>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>Your application needs to trust the token's claims (authenticating a request, checking a role)</li>
      <li><svg aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>You need to confirm the token hasn't been tampered with or expired</li>
    </ul>
  </div>
</div>

This tool only decodes. Verification always needs to happen in your backend, using your actual signing secret or public key — never in a browser tool like this one, and never based on the payload's contents alone.
