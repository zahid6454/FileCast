// POST /api/errors — log a client-side conversion error (public, rate-limited).
// Append-only; trimmed to 30 days by the scheduled purge.

import { json, error, nowIso } from "./utils/http.js";

const MAX_MESSAGE_LEN = 2000;

export async function logError(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }
  if (!body.tool_id) return error(400, "tool_id is required");

  const message =
    typeof body.error_message === "string"
      ? body.error_message.slice(0, MAX_MESSAGE_LEN)
      : null;

  await env.DB.prepare(
    `INSERT INTO errors (tool_id, error_type, error_message, browser, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  )
    .bind(
      body.tool_id,
      body.error_type || null,
      message,
      body.browser || request.headers.get("User-Agent") || null,
      nowIso(),
    )
    .run();

  return json({ ok: true });
}
