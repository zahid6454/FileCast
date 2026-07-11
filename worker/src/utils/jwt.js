// Minimal JWT (HS256) using the Web Crypto API — no npm dependency.
// Tokens are compact JWS: base64url(header).base64url(payload).base64url(sig).

function base64urlEncode(bytes) {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(str) {
  str = str.replace(/-/g, "+").replace(/_/g, "/");
  while (str.length % 4) str += "=";
  const bin = atob(str);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const enc = new TextEncoder();
const dec = new TextDecoder();

function jsonToB64url(obj) {
  return base64urlEncode(enc.encode(JSON.stringify(obj)));
}

async function importKey(secret) {
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

// Sign a payload. `expiresInSeconds` sets the `exp` claim.
export async function signJWT(payload, secret, expiresInSeconds = 60 * 60 * 24 * 30) {
  const now = Math.floor(Date.now() / 1000);
  const body = { iat: now, exp: now + expiresInSeconds, ...payload };
  const header = { alg: "HS256", typ: "JWT" };
  const signingInput = `${jsonToB64url(header)}.${jsonToB64url(body)}`;
  const key = await importKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(signingInput));
  return `${signingInput}.${base64urlEncode(new Uint8Array(sig))}`;
}

// Verify a token. Returns the decoded payload, or null if invalid/expired.
// Uses crypto.subtle.verify (constant-time) rather than string comparison.
export async function verifyJWT(token, secret) {
  if (!token || typeof token !== "string") return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, s] = parts;
  const signingInput = `${h}.${p}`;
  const key = await importKey(secret);
  let ok;
  try {
    ok = await crypto.subtle.verify(
      "HMAC",
      key,
      base64urlDecode(s),
      enc.encode(signingInput),
    );
  } catch {
    return null;
  }
  if (!ok) return null;
  let payload;
  try {
    payload = JSON.parse(dec.decode(base64urlDecode(p)));
  } catch {
    return null;
  }
  if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) {
    return null;
  }
  return payload;
}
