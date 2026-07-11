// Google OAuth 2.0 (authorization-code flow) — no SDK. The Worker builds the
// redirect URL with a CSRF `state`, verifies `state` on callback before
// exchanging the code, fetches userinfo, and upserts the user into D1.
//
// Flow (matches OAUTH_REDIRECT_URI in wrangler.toml):
//   GET /api/auth/google           -> 302 to Google (sets signed state cookie)
//   GET /api/auth/google/callback  -> verify state, exchange code, set cookies,
//                                     302 back to the site
//   GET  /api/auth/me              -> current user + favorites
//   POST /api/auth/logout          -> clear both cookies
//
// The token exchange requires GOOGLE_CLIENT_SECRET, so it MUST happen
// server-side — a client-side flow could never set the httpOnly JWT cookie.

import { signJWT, verifyJWT } from "./utils/jwt.js";
import {
  json,
  error,
  serializeCookie,
  parseCookies,
  uuid,
  nowIso,
} from "./utils/http.js";
import { JWT_COOKIE, LOGGED_IN_COOKIE, requireJWT } from "./middleware.js";

const STATE_COOKIE = "fc_oauth_state";
const GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO = "https://www.googleapis.com/oauth2/v2/userinfo";
const JWT_TTL = 60 * 60 * 24 * 30; // 30 days

function cookieBase(env) {
  return { domain: env.COOKIE_DOMAIN, path: "/", secure: true };
}

// Only allow same-site return paths (no open redirect).
function safeReturnPath(raw) {
  if (!raw || typeof raw !== "string") return "/";
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/";
  return raw;
}

// GET /api/auth/google — kick off the flow.
export async function startGoogle(request, env) {
  const url = new URL(request.url);
  const ret = safeReturnPath(url.searchParams.get("return_to"));
  const nonce = uuid();

  // Signed, short-lived state cookie carries the nonce (and return path) so the
  // callback can verify it wasn't forged and knows where to send the user back.
  const stateToken = await signJWT({ nonce, ret }, env.JWT_SECRET, 600);

  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: env.OAUTH_REDIRECT_URI,
    response_type: "code",
    scope: "openid email profile",
    state: nonce,
    access_type: "online",
    prompt: "select_account",
  });

  const headers = new Headers();
  headers.append(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, stateToken, {
      ...cookieBase(env),
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 600,
    }),
  );
  headers.set("Location", `${GOOGLE_AUTH}?${params.toString()}`);
  return new Response(null, { status: 302, headers });
}

// GET /api/auth/google/callback — verify state, exchange code, set cookies.
export async function googleCallback(request, env) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (url.searchParams.get("error")) {
    return redirectHome(env, "/?auth=denied");
  }
  if (!code || !state) return error(400, "Missing code or state");

  // CSRF: the state nonce must match the signed state cookie.
  const cookies = parseCookies(request);
  const stateToken = cookies[STATE_COOKIE];
  const statePayload = await verifyJWT(stateToken, env.JWT_SECRET);
  if (!statePayload || statePayload.nonce !== state) {
    return error(403, "Invalid or expired OAuth state");
  }
  const ret = safeReturnPath(statePayload.ret);

  // Exchange the auth code for tokens (server-side; client secret never leaves).
  const tokenRes = await fetch(GOOGLE_TOKEN, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: env.OAUTH_REDIRECT_URI,
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) return error(502, "Token exchange failed");
  const tokens = await tokenRes.json();

  const infoRes = await fetch(GOOGLE_USERINFO, {
    headers: { Authorization: `Bearer ${tokens.access_token}` },
  });
  if (!infoRes.ok) return error(502, "Failed to fetch user info");
  const info = await infoRes.json();
  if (!info.email) return error(502, "Google account has no email");

  const user = await upsertUser(env, info);

  const jwt = await signJWT(
    { sub: user.id, email: user.email, role: user.role },
    env.JWT_SECRET,
    JWT_TTL,
  );

  const headers = new Headers();
  // httpOnly JWT — shared across subdomains via Domain=.filecast.io.
  headers.append(
    "Set-Cookie",
    serializeCookie(JWT_COOKIE, jwt, {
      ...cookieBase(env),
      httpOnly: true,
      sameSite: "Lax",
      maxAge: JWT_TTL,
    }),
  );
  // Companion non-httpOnly flag so client JS can cheaply detect "signed in".
  headers.append(
    "Set-Cookie",
    serializeCookie(LOGGED_IN_COOKIE, "1", {
      ...cookieBase(env),
      httpOnly: false,
      sameSite: "Lax",
      maxAge: JWT_TTL,
    }),
  );
  // Clear the one-shot state cookie.
  headers.append(
    "Set-Cookie",
    serializeCookie(STATE_COOKIE, "", {
      ...cookieBase(env),
      httpOnly: true,
      sameSite: "Lax",
      maxAge: 0,
    }),
  );
  headers.set("Location", `${env.SITE_ORIGIN}${ret}`);
  return new Response(null, { status: 302, headers });
}

async function upsertUser(env, info) {
  const existing = await env.DB.prepare("SELECT * FROM users WHERE email = ?")
    .bind(info.email)
    .first();
  const now = nowIso();
  if (existing) {
    await env.DB.prepare(
      "UPDATE users SET name = ?, avatar_url = ?, last_login_at = ? WHERE id = ?",
    )
      .bind(info.name || existing.name, info.picture || existing.avatar_url, now, existing.id)
      .run();
    return { ...existing, last_login_at: now };
  }
  const id = uuid();
  await env.DB.prepare(
    `INSERT INTO users (id, email, name, avatar_url, role, created_at, last_login_at)
     VALUES (?, ?, ?, ?, 'user', ?, ?)`,
  )
    .bind(id, info.email, info.name || null, info.picture || null, now, now)
    .run();
  return { id, email: info.email, name: info.name, avatar_url: info.picture, role: "user" };
}

function redirectHome(env, path) {
  return new Response(null, {
    status: 302,
    headers: { Location: `${env.SITE_ORIGIN}${path}` },
  });
}

// GET /api/auth/me — current user + favorites.
export async function me(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  const row = await env.DB.prepare(
    "SELECT id, email, name, avatar_url, role, max_file_size, created_at, last_login_at FROM users WHERE id = ?",
  )
    .bind(request.user.sub)
    .first();
  if (!row) return error(404, "User not found");
  const favs = await env.DB.prepare(
    "SELECT tool_id FROM user_favorites WHERE user_id = ?",
  )
    .bind(request.user.sub)
    .all();
  return json({ user: row, favorites: (favs.results || []).map((r) => r.tool_id) });
}

// POST /api/auth/logout — clear both cookies together.
export async function logout(request, env) {
  const headers = new Headers();
  for (const name of [JWT_COOKIE, LOGGED_IN_COOKIE]) {
    headers.append(
      "Set-Cookie",
      serializeCookie(name, "", {
        ...cookieBase(env),
        httpOnly: name === JWT_COOKIE,
        sameSite: "Lax",
        maxAge: 0,
      }),
    );
  }
  return json({ ok: true }, { headers });
}
