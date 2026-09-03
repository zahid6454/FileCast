## What Is a JWT?

A JWT (JSON Web Token) is a compact way to pass a set of claims — like a user ID, a role, or an expiration time — between two parties, often used for authentication and API access tokens. It's three Base64url-encoded segments joined by dots: `header.payload.signature`.

The header describes the token (typically the signing algorithm). The payload holds the actual claims, as JSON. The signature lets the token's issuer prove it wasn't tampered with — but only the issuer, holding the secret or private key, can create or check a valid one.

<div class="eyebrow">At a Glance</div>
<div class="stat-strip">
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-code"></use></svg></span>
    <span class="stat-tile__label">Three segments</span>
    <span class="stat-tile__sub">header.payload.signature</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-search"></use></svg></span>
    <span class="stat-tile__label">Decode only</span>
    <span class="stat-tile__sub">No signature verification</span>
  </div>
  <div class="stat-tile">
    <span class="stat-tile__icon"><svg aria-hidden="true" focusable="false"><use href="#icon-zap"></use></svg></span>
    <span class="stat-tile__label">Instant, in your browser</span>
    <span class="stat-tile__sub">No upload, no server round-trip</span>
  </div>
</div>

### Why Decode a JWT?

The header and payload are Base64url-encoded, not encrypted — anyone can read them without a secret key. Decoding lets you inspect exactly what claims a token carries: who it's for, when it was issued, when it expires, and any custom fields an application added.

### How This Tool Works

<div class="callout">
  <svg aria-hidden="true" focusable="false"><use href="#icon-shield"></use></svg>
  <p>Paste a JWT into the box below and click Decode JWT. This tool splits the token into its three parts, Base64url-decodes the header and payload, and shows you the resulting JSON. <strong>It does not verify the signature</strong> — it can't, without the secret or public key — so treat the decoded contents as informational only, never as proof the token is genuine or unexpired. Everything runs <strong>in your browser</strong>; nothing is uploaded to any server.</p>
</div>
