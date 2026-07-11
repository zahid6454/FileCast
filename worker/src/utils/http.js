// Shared HTTP helpers: JSON responses, error responses, cookie serialization,
// and CORS header computation. Kept dependency-free.

export function json(data, init = {}) {
  const headers = new Headers(init.headers || {});
  headers.set("Content-Type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(data), { ...init, headers });
}

export function error(status, message, extra = {}) {
  return json({ error: message, ...extra }, { status });
}

// Serialize a Set-Cookie header value.
export function serializeCookie(name, value, opts = {}) {
  const parts = [`${name}=${value}`];
  if (opts.domain) parts.push(`Domain=${opts.domain}`);
  parts.push(`Path=${opts.path || "/"}`);
  if (opts.maxAge != null) parts.push(`Max-Age=${opts.maxAge}`);
  if (opts.expires) parts.push(`Expires=${opts.expires.toUTCString()}`);
  if (opts.httpOnly) parts.push("HttpOnly");
  if (opts.secure !== false) parts.push("Secure");
  parts.push(`SameSite=${opts.sameSite || "Lax"}`);
  return parts.join("; ");
}

export function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const k = pair.slice(0, idx).trim();
    const v = pair.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Resolve the CORS origin to echo: only echo an allowed origin (credentialed
// CORS forbids "*"). ALLOWED_ORIGINS is a comma-separated env var.
export function corsOrigin(request, env) {
  const allowed = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const origin = request.headers.get("Origin");
  if (origin && allowed.includes(origin)) return origin;
  return allowed[0] || "https://filecast.io";
}

export function corsHeaders(request, env) {
  return {
    "Access-Control-Allow-Origin": corsOrigin(request, env),
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

// Apply CORS headers to a Response. Mutates headers in place rather than
// reconstructing via `new Headers(...)`, which can fold multiple Set-Cookie
// headers into one in the Workers runtime (the auth callback sets three).
// All our responses are locally constructed, so their headers are mutable.
export function withCors(response, request, env) {
  const headers = corsHeaders(request, env);
  try {
    for (const [k, v] of Object.entries(headers)) response.headers.set(k, v);
    return response;
  } catch {
    // Immutable headers (e.g. a Response from fetch()) — fall back to a rebuild.
    const h = new Headers(response.headers);
    for (const [k, v] of Object.entries(headers)) h.set(k, v);
    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: h,
    });
  }
}

// UUID helper (Web Crypto).
export function uuid() {
  return crypto.randomUUID();
}

// Current ISO-8601 timestamp (UTC).
export function nowIso() {
  return new Date().toISOString();
}
