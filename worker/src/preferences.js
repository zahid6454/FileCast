// PUT /api/preferences — store a JSON blob of user preferences (JWT).

import { json, error } from "./utils/http.js";
import { requireJWT } from "./middleware.js";

export async function updatePreferences(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }
  // Accept either the raw preferences object or { preferences: {...} }.
  const prefs = body.preferences !== undefined ? body.preferences : body;
  const serialized = JSON.stringify(prefs);

  await env.DB.prepare(
    `INSERT INTO user_preferences (user_id, preferences)
     VALUES (?, ?)
     ON CONFLICT(user_id) DO UPDATE SET preferences = excluded.preferences`,
  )
    .bind(request.user.sub, serialized)
    .run();
  return json({ ok: true, preferences: prefs });
}
