// Users — admin listing/detail, plus GDPR self-service export and deletion.

import { json, error } from "./utils/http.js";
import {
  requireAdmin,
  requireJWT,
  JWT_COOKIE,
  LOGGED_IN_COOKIE,
} from "./middleware.js";
import { serializeCookie } from "./utils/http.js";

// GET /api/users — list users (admin).
export async function listUsers(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const rows = await env.DB.prepare(
    `SELECT id, email, name, avatar_url, role, created_at, last_login_at
       FROM users ORDER BY created_at DESC`,
  ).all();
  return json({ users: rows.results || [] });
}

// GET /api/users/:id — user detail + recent conversion history (admin).
export async function getUser(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const id = request.params.id;
  const user = await env.DB.prepare(
    `SELECT id, email, name, avatar_url, role, max_file_size, created_at, last_login_at
       FROM users WHERE id = ?`,
  )
    .bind(id)
    .first();
  if (!user) return error(404, "User not found");
  const history = await env.DB.prepare(
    `SELECT tool_id, input_format, output_format, status, created_at
       FROM user_conversions WHERE user_id = ? ORDER BY created_at DESC LIMIT 100`,
  )
    .bind(id)
    .all();
  const favorites = await env.DB.prepare(
    "SELECT tool_id, created_at FROM user_favorites WHERE user_id = ?",
  )
    .bind(id)
    .all();
  return json({
    user,
    history: history.results || [],
    favorites: favorites.results || [],
  });
}

// GET /api/users/me/export — full data export (GDPR portability, JWT).
export async function exportMe(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  const uid = request.user.sub;
  const [user, history, favorites, prefs] = await Promise.all([
    env.DB.prepare("SELECT * FROM users WHERE id = ?").bind(uid).first(),
    env.DB.prepare("SELECT * FROM user_conversions WHERE user_id = ?").bind(uid).all(),
    env.DB.prepare("SELECT * FROM user_favorites WHERE user_id = ?").bind(uid).all(),
    env.DB.prepare("SELECT preferences FROM user_preferences WHERE user_id = ?").bind(uid).first(),
  ]);
  const payload = {
    exported_at: new Date().toISOString(),
    user,
    conversion_history: history.results || [],
    favorites: favorites.results || [],
    preferences: prefs ? JSON.parse(prefs.preferences) : null,
  };
  return json(payload, {
    headers: {
      "Content-Disposition": 'attachment; filename="filecast-data.json"',
    },
  });
}

// DELETE /api/users/me — permanently delete account + all associated data (JWT).
export async function deleteMe(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  const uid = request.user.sub;
  // Remove all rows the user owns, then clear the session cookies.
  await env.DB.batch([
    env.DB.prepare("DELETE FROM user_conversions WHERE user_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM user_favorites WHERE user_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM user_preferences WHERE user_id = ?").bind(uid),
    env.DB.prepare("UPDATE ratings SET user_id = NULL WHERE user_id = ?").bind(uid),
    env.DB.prepare("DELETE FROM users WHERE id = ?").bind(uid),
  ]);
  const headers = new Headers();
  const base = { domain: env.COOKIE_DOMAIN, path: "/", secure: true, sameSite: "Lax", maxAge: 0 };
  headers.append("Set-Cookie", serializeCookie(JWT_COOKIE, "", { ...base, httpOnly: true }));
  headers.append("Set-Cookie", serializeCookie(LOGGED_IN_COOKIE, "", { ...base, httpOnly: false }));
  return json({ ok: true, deleted: true }, { headers });
}
