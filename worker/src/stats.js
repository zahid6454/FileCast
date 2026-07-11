// Admin dashboard statistics. All admin-guarded.

import { json } from "./utils/http.js";
import { requireAdmin } from "./middleware.js";

function daysAgoIso(days) {
  return new Date(Date.now() - days * 86400000).toISOString();
}
function dateDaysAgo(days) {
  return new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
}

// GET /api/stats/dashboard — headline aggregates (admin).
export async function dashboard(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const [totals, last30, users, errors30, topTools] = await Promise.all([
    env.DB.prepare(
      "SELECT COALESCE(SUM(count),0) AS conversions, COALESCE(SUM(failures),0) AS failures FROM conversions",
    ).first(),
    env.DB.prepare(
      "SELECT COALESCE(SUM(count),0) AS conversions FROM conversions WHERE date >= ?",
    ).bind(dateDaysAgo(30)).first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM users").first(),
    env.DB.prepare("SELECT COUNT(*) AS n FROM errors WHERE created_at >= ?")
      .bind(daysAgoIso(30)).first(),
    env.DB.prepare(
      `SELECT tool_id, SUM(count) AS conversions
         FROM conversions GROUP BY tool_id ORDER BY conversions DESC LIMIT 10`,
    ).all(),
  ]);
  return json({
    total_conversions: totals?.conversions || 0,
    total_failures: totals?.failures || 0,
    conversions_last_30d: last30?.conversions || 0,
    total_users: users?.n || 0,
    errors_last_30d: errors30?.n || 0,
    top_tools: topTools.results || [],
  });
}

// GET /api/stats/conversions?days=30 — conversion counts by date (admin).
export async function conversionStats(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const url = new URL(request.url);
  const days = Math.min(parseInt(url.searchParams.get("days") || "30", 10) || 30, 365);
  const rows = await env.DB.prepare(
    `SELECT date, SUM(count) AS conversions, SUM(failures) AS failures
       FROM conversions WHERE date >= ? GROUP BY date ORDER BY date ASC`,
  )
    .bind(dateDaysAgo(days))
    .all();
  return json({ days, series: rows.results || [] });
}

// GET /api/stats/errors?limit=100 — recent errors (admin).
export async function errorStats(request, env) {
  const guard = await requireAdmin(request, env);
  if (guard) return guard;
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 500);
  const rows = await env.DB.prepare(
    `SELECT id, tool_id, error_type, error_message, browser, created_at
       FROM errors ORDER BY created_at DESC LIMIT ?`,
  )
    .bind(limit)
    .all();
  return json({ errors: rows.results || [] });
}
