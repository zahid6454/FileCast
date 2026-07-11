// POST /api/conversions — the ONLY write path for per-user history.
//
// Dual-write:
//   1. ALWAYS increment the anonymous aggregate counter (tool_id + date).
//   2. If a valid JWT rides along, ALSO insert one user_conversions row.
// Anonymous callers write only the aggregate. A history-insert failure must
// never fail the counter, so it's wrapped and swallowed (fire-and-forget).
//
// Gated by Turnstile + Cloudflare Rate Limiting Rules (edge-configured).

import { json, error, nowIso } from "./utils/http.js";
import { optionalJWT, verifyTurnstile } from "./middleware.js";

export async function recordConversion(request, env, ctx) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }

  // Only these four are required; the rest are optional because the three
  // client call sites (File / raw text / batch) each have a different subset.
  const { tool_id, input_format, output_format, status } = body;
  if (!tool_id || !input_format || !output_format || !status) {
    return error(400, "tool_id, input_format, output_format, status are required");
  }

  // Anti-spam: this endpoint backs the homepage conversion-counter trust
  // signal, so a valid Turnstile token is mandatory.
  const turnstile = await verifyTurnstile(body.turnstile_token, request, env);
  if (!turnstile.ok) {
    return error(403, "Turnstile verification failed", { reason: turnstile.reason });
  }

  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const isFailure = status !== "success";
  const successCount =
    typeof body.success_count === "number" ? body.success_count : isFailure ? 0 : 1;
  const fileCount = typeof body.file_count === "number" ? body.file_count : 1;
  const failInc = Math.max(0, fileCount - successCount);
  const okInc = Math.max(0, successCount) || (isFailure ? 0 : 1);

  // (1) Aggregate counter — upsert on (tool_id, date).
  await env.DB.prepare(
    `INSERT INTO conversions (tool_id, date, count, failures)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(tool_id, date) DO UPDATE SET
       count = count + excluded.count,
       failures = failures + excluded.failures`,
  )
    .bind(tool_id, date, okInc, failInc)
    .run();

  // (2) Per-user history row — only when signed in.
  await optionalJWT(request, env);
  let savedToHistory = false;
  if (request.user) {
    const insertHistory = env.DB.prepare(
      `INSERT INTO user_conversions
        (user_id, tool_id, input_format, output_format, file_size_kb, duration_ms, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      request.user.sub,
      tool_id,
      input_format,
      output_format,
      typeof body.file_size_kb === "number" ? Math.round(body.file_size_kb) : null,
      typeof body.duration_ms === "number" ? Math.round(body.duration_ms) : null,
      status,
      nowIso(),
    );
    // Fire-and-forget: never let a history failure fail the counter write.
    savedToHistory = true;
    if (ctx && typeof ctx.waitUntil === "function") {
      ctx.waitUntil(insertHistory.run().catch(() => {}));
    } else {
      try {
        await insertHistory.run();
      } catch {
        savedToHistory = false;
      }
    }
  }

  return json({ ok: true, saved_to_history: savedToHistory });
}
