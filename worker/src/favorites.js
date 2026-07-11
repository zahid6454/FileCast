// Favorites — all JWT-guarded.

import { json, error, nowIso } from "./utils/http.js";
import { requireJWT } from "./middleware.js";

// POST /api/favorites — add a favorite tool. Body: { tool_id }.
export async function addFavorite(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }
  if (!body.tool_id) return error(400, "tool_id is required");
  await env.DB.prepare(
    `INSERT INTO user_favorites (user_id, tool_id, created_at)
     VALUES (?, ?, ?)
     ON CONFLICT(user_id, tool_id) DO NOTHING`,
  )
    .bind(request.user.sub, body.tool_id, nowIso())
    .run();
  return json({ ok: true });
}

// DELETE /api/favorites/:tool_id — remove a favorite.
export async function removeFavorite(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  await env.DB.prepare(
    "DELETE FROM user_favorites WHERE user_id = ? AND tool_id = ?",
  )
    .bind(request.user.sub, request.params.tool_id)
    .run();
  return json({ ok: true });
}

// GET /api/favorites — list favorites.
export async function listFavorites(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  const rows = await env.DB.prepare(
    "SELECT tool_id, created_at FROM user_favorites WHERE user_id = ? ORDER BY created_at DESC",
  )
    .bind(request.user.sub)
    .all();
  return json({ favorites: rows.results || [] });
}
