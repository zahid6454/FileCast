// Anonymous tool ratings with server-computed fingerprint dedup.
// The client sends only { tool_id, vote, user_id?, turnstile_token }.

import { json, error, nowIso } from "./utils/http.js";
import { verifyTurnstile, requireBuildKey } from "./middleware.js";
import { computeFingerprint, clientIp } from "./utils/fingerprint.js";

// POST /api/ratings — submit a yes/no vote (Turnstile + rate-limited).
export async function submitRating(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return error(400, "Invalid JSON body");
  }
  const { tool_id, vote } = body;
  if (!tool_id || (vote !== "yes" && vote !== "no")) {
    return error(400, "tool_id and vote ('yes'|'no') are required");
  }

  const turnstile = await verifyTurnstile(body.turnstile_token, request, env);
  if (!turnstile.ok) {
    return error(403, "Turnstile verification failed", { reason: turnstile.reason });
  }

  const fingerprint = await computeFingerprint(
    clientIp(request),
    tool_id,
    env.FINGERPRINT_SALT,
  );

  // UNIQUE(tool_id, fingerprint) enforces one vote per fingerprint window; a
  // repeat vote updates the existing choice rather than double-counting.
  await env.DB.prepare(
    `INSERT INTO ratings (tool_id, vote, fingerprint, user_id, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tool_id, fingerprint) DO UPDATE SET
       vote = excluded.vote, created_at = excluded.created_at`,
  )
    .bind(tool_id, vote, fingerprint, body.user_id || null, nowIso())
    .run();

  return json(await aggregate(env, tool_id));
}

async function aggregate(env, toolId) {
  const row = await env.DB.prepare(
    `SELECT
       COUNT(*) AS total,
       SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) AS yes
     FROM ratings WHERE tool_id = ?`,
  )
    .bind(toolId)
    .first();
  const total = row?.total || 0;
  const yes = row?.yes || 0;
  const pct = total > 0 ? Math.round((yes / total) * 100) : null;
  return { tool_id: toolId, total, yes, no: total - yes, satisfaction: pct };
}

// GET /api/ratings/:tool_id — aggregate for one tool (public).
export async function getRating(request, env) {
  return json(await aggregate(env, request.params.tool_id));
}

// GET /api/ratings — aggregates for ALL tools in one call (build key / admin).
// Used by build.py's build-time fetch and the admin ratings summary so neither
// has to make 34 per-tool requests.
export async function getAllRatings(request, env) {
  const guard = await requireBuildKey(request, env);
  if (guard) return guard;
  const rows = await env.DB.prepare(
    `SELECT
       tool_id,
       COUNT(*) AS total,
       SUM(CASE WHEN vote = 'yes' THEN 1 ELSE 0 END) AS yes
     FROM ratings GROUP BY tool_id`,
  ).all();
  const out = {};
  for (const r of rows.results || []) {
    const pct = r.total > 0 ? Math.round((r.yes / r.total) * 100) : null;
    out[r.tool_id] = {
      total: r.total,
      yes: r.yes,
      no: r.total - r.yes,
      satisfaction: pct,
    };
  }
  return json({ ratings: out });
}
