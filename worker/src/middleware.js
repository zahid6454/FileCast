// Auth + anti-abuse middleware. itty-router treats a handler that RETURNS a
// Response as terminal (short-circuits the route); a handler that returns
// undefined falls through to the next. Guards below follow that contract and
// attach resolved state (request.user) for downstream handlers.

import { verifyJWT } from "./utils/jwt.js";
import { parseCookies, error } from "./utils/http.js";

export const JWT_COOKIE = "fc_jwt";
export const LOGGED_IN_COOKIE = "fc_logged_in";

// Resolve the current user from the JWT cookie (or Authorization: Bearer).
// Returns the payload or null; never throws.
export async function resolveUser(request, env) {
  const cookies = parseCookies(request);
  let token = cookies[JWT_COOKIE];
  if (!token) {
    const auth = request.headers.get("Authorization") || "";
    if (auth.startsWith("Bearer ")) token = auth.slice(7);
  }
  if (!token) return null;
  return verifyJWT(token, env.JWT_SECRET);
}

// Attach request.user if present, but never block. Used by /api/conversions so
// a signed-in user also gets a per-user history row (the dual-write).
export async function optionalJWT(request, env) {
  request.user = await resolveUser(request, env);
}

// Require a valid JWT; 401 otherwise.
export async function requireJWT(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return error(401, "Authentication required");
  request.user = user;
}

// Require an admin role. Re-reads the role from D1 rather than trusting the
// token, so a demotion takes effect immediately.
export async function requireAdmin(request, env) {
  const user = await resolveUser(request, env);
  if (!user) return error(401, "Authentication required");
  const row = await env.DB.prepare("SELECT role FROM users WHERE id = ?")
    .bind(user.sub)
    .first();
  if (!row || row.role !== "admin") return error(403, "Admin access required");
  request.user = { ...user, role: "admin" };
}

// Build-time key guard (GET /api/tools, GET /api/ratings for build.py).
// Accepts either the X-Build-Key header or an admin JWT.
export async function requireBuildKey(request, env) {
  const provided = request.headers.get("X-Build-Key");
  if (env.BUILD_KEY && provided && provided === env.BUILD_KEY) return;
  // Fall back to admin (dashboard uses these endpoints too).
  return requireAdmin(request, env);
}

// Verify a Cloudflare Turnstile token server-side. Reads the token from the
// JSON body's `turnstile_token` (the caller passes the already-parsed body).
export async function verifyTurnstile(token, request, env) {
  if (!env.TURNSTILE_SECRET) {
    // Fail closed in production; allow only if explicitly not configured AND
    // running locally. Here we treat missing secret as misconfiguration.
    return { ok: false, reason: "turnstile-not-configured" };
  }
  if (!token) return { ok: false, reason: "missing-token" };
  const ip =
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
    "";
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
  try {
    const res = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: form },
    );
    const data = await res.json();
    return { ok: !!data.success, reason: data.success ? "ok" : "verify-failed" };
  } catch {
    return { ok: false, reason: "verify-error" };
  }
}
