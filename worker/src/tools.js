// Tool operational state (overlay on YAML). Read for build.py, mutate for admin.

import { json, error, nowIso } from "./utils/http.js";
import { requireBuildKey, requireAdmin } from "./middleware.js";

// GET /api/tools — all tools with D1 state (consumed by build.py).
export async function listTools(request, env) {
  const guard = await requireBuildKey(request, env);
  if (guard) return guard;
  const rows = await env.DB.prepare(
    "SELECT id, enabled, display_name, sort_order, maintenance_message, custom_max_file_size, updated_at FROM tools ORDER BY sort_order ASC",
  ).all();
  return json({ tools: rows.results || [] });
}

// PUT /api/tools/:id — update a single tool's overlay fields (admin).
export async function updateTool(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const id = request.params.id;
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }

  const fields = [];
  const values = [];
  const allowed = {
    display_name: "display_name",
    enabled: "enabled",
    maintenance_message: "maintenance_message",
    custom_max_file_size: "custom_max_file_size",
    sort_order: "sort_order",
  };
  for (const [key, col] of Object.entries(allowed)) {
    if (key in body) {
      fields.push(`${col} = ?`);
      values.push(key === "enabled" ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (!fields.length) return error(400, "No updatable fields provided");
  fields.push("updated_at = ?");
  values.push(nowIso());

  // Update the overlay row. A tool must be seeded first (seed.py); editing an
  // unseeded id returns 404 rather than silently creating a partial row.
  const res = await env.DB.prepare(
    `UPDATE tools SET ${fields.join(", ")} WHERE id = ?`,
  )
    .bind(...values, id)
    .run();
  if (res.meta.changes === 0) {
    return error(404, "Tool not found (run seed.py first)");
  }
  return json({ ok: true, id });
}

// PUT /api/tools/reorder — batch sort_order update from drag-and-drop (admin).
// Body: { order: ["tool-a", "tool-b", ...] } — array position defines rank.
export async function reorderTools(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }
  const order = body.order;
  if (!Array.isArray(order) || order.length === 0) {
    return error(400, "Body must be { order: [tool_id, ...] }");
  }
  const now = nowIso();
  const stmt = env.DB.prepare(
    "UPDATE tools SET sort_order = ?, updated_at = ? WHERE id = ?",
  );
  // One atomic D1 batch — all rows move together or not at all.
  const batch = order.map((id, i) => stmt.bind(i + 1, now, id));
  await env.DB.batch(batch);
  return json({ ok: true, count: order.length });
}
