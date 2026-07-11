// Announcements — public read of the active one, admin CRUD for the rest.

import { json, error, nowIso } from "./utils/http.js";
import { requireAdmin } from "./middleware.js";

// GET /api/announcements/active — the current active announcement (public).
// "Active" means active=1 and now within [starts_at, ends_at] when those are set.
export async function activeAnnouncement(request, env) {
  const now = nowIso();
  const row = await env.DB.prepare(
    `SELECT id, message, link, type, starts_at, ends_at
       FROM announcements
      WHERE active = 1
        AND (starts_at IS NULL OR starts_at <= ?)
        AND (ends_at IS NULL OR ends_at >= ?)
      ORDER BY created_at DESC
      LIMIT 1`,
  )
    .bind(now, now)
    .first();
  return json({ announcement: row || null });
}

// GET /api/announcements — list all (admin).
export async function listAnnouncements(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const rows = await env.DB.prepare(
    "SELECT * FROM announcements ORDER BY created_at DESC",
  ).all();
  return json({ announcements: rows.results || [] });
}

// POST /api/announcements — create (admin).
export async function createAnnouncement(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }
  if (!body.message) return error(400, "message is required");
  const res = await env.DB.prepare(
    `INSERT INTO announcements (message, link, type, active, starts_at, ends_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      body.message,
      body.link || null,
      body.type || "info",
      body.active ? 1 : 0,
      body.starts_at || null,
      body.ends_at || null,
      nowIso(),
    )
    .run();
  return json({ ok: true, id: res.meta.last_row_id });
}

// PUT /api/announcements/:id — update (admin).
export async function updateAnnouncement(request, env) {
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
  const allowed = ["message", "link", "type", "active", "starts_at", "ends_at"];
  for (const key of allowed) {
    if (key in body) {
      fields.push(`${key} = ?`);
      values.push(key === "active" ? (body[key] ? 1 : 0) : body[key]);
    }
  }
  if (!fields.length) return error(400, "No updatable fields provided");
  const res = await env.DB.prepare(
    `UPDATE announcements SET ${fields.join(", ")} WHERE id = ?`,
  )
    .bind(...values, id)
    .run();
  if (res.meta.changes === 0) return error(404, "Announcement not found");
  return json({ ok: true, id });
}

// DELETE /api/announcements/:id — delete (admin).
export async function deleteAnnouncement(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const res = await env.DB.prepare("DELETE FROM announcements WHERE id = ?")
    .bind(request.params.id)
    .run();
  if (res.meta.changes === 0) return error(404, "Announcement not found");
  return json({ ok: true });
}
