// GET /api/user/history — the signed-in user's conversion history (JWT).
// Populated exclusively by the /api/conversions dual-write.

import { json } from "./utils/http.js";
import { requireJWT } from "./middleware.js";

export async function getHistory(request, env) {
  const guard = await requireJWT(request, env);
  if (guard) return guard;
  const url = new URL(request.url);
  const limit = Math.min(
    parseInt(url.searchParams.get("limit") || "100", 10) || 100,
    500,
  );
  const rows = await env.DB.prepare(
    `SELECT id, tool_id, input_format, output_format, file_size_kb, duration_ms, status, created_at
       FROM user_conversions
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?`,
  )
    .bind(request.user.sub, limit)
    .all();
  return json({ history: rows.results || [] });
}
