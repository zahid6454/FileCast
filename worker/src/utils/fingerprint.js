// Server-side rating-dedup fingerprint. The client never sends a fingerprint
// and no canvas/screen/timezone fingerprinting runs in the browser (see
// 08-design-decisions.md). We hash CF-Connecting-IP + tool_id with a salt that
// rotates daily, so a given IP can vote once per tool per day-salt window and
// the raw IP is never stored.

const enc = new TextEncoder();

function toHex(buf) {
  const bytes = new Uint8Array(buf);
  let hex = "";
  for (const b of bytes) hex += b.toString(16).padStart(2, "0");
  return hex;
}

// `salt` is the FINGERPRINT_SALT secret; it is combined with the UTC date so
// the effective salt rotates every day without any stored state.
export async function computeFingerprint(ip, toolId, salt) {
  const day = new Date().toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  const material = `${salt || "filecast"}:${day}:${ip || "unknown"}:${toolId}`;
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(material));
  return toHex(digest);
}

export function clientIp(request) {
  return (
    request.headers.get("CF-Connecting-IP") ||
    request.headers.get("X-Forwarded-For")?.split(",")[0].trim() ||
    "unknown"
  );
}
