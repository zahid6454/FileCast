// Daily purge (Cron Trigger "0 3 * * *"). Enforces the 30-day retention promise
// made on the privacy page: nothing else in the system deletes old rows.
//
// Purged:   user_conversions, errors  (older than RETENTION_DAYS)
// Retained: conversions (anonymous aggregate counters) and ratings — these are
//           anonymous and intentionally kept (trust-signal counter + scores).

const RETENTION_DAYS = 30;

export async function handleScheduled(event, env, ctx) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400000).toISOString();

  const results = await env.DB.batch([
    env.DB.prepare("DELETE FROM user_conversions WHERE created_at < ?").bind(cutoff),
    env.DB.prepare("DELETE FROM errors WHERE created_at < ?").bind(cutoff),
  ]);

  const purged = {
    cutoff,
    user_conversions_deleted: results[0]?.meta?.changes ?? 0,
    errors_deleted: results[1]?.meta?.changes ?? 0,
  };
  console.log("scheduled purge", JSON.stringify(purged));
  return purged;
}
