import { createHash } from "node:crypto";

// Per-visitor cap on COLD paid computes (Zerion / Moralis). Cached reads never
// count. Our own functions call /api/pnl server-side, so they forward the
// visitor's ip under a token derived from ADMIN_KEY; without the token a
// forwarded ip is ignored and the caller is bucketed by its own address.

export const COLD_PER_HOUR = 30;
const HOUR_MS = 36e5;

function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

export function internalToken(env = process.env) {
  const k = env.ADMIN_KEY;
  if (typeof k !== "string" || k.length < 16) return null;
  return createHash("sha256").update("avax100m-internal:" + k).digest("hex");
}

// headers for a function-to-function call made on behalf of a visitor
export function internalHeaders(context, env = process.env) {
  const t = internalToken(env), ip = context && context.ip;
  return t && ip ? { "x-internal-key": t, "x-client-ip": String(ip) } : {};
}

// the address to bucket: the forwarded one only if the token checks out
export function clientIp(req, context, env = process.env) {
  const t = internalToken(env);
  const fwd = req.headers.get("x-client-ip");
  if (t && fwd && safeEq(req.headers.get("x-internal-key") || "", t)) return fwd;
  return (context && context.ip) || null;
}

// Count one cold compute against `ip`. Returns false once the hour is spent.
// Fails open (no ip, no store, store error): a limiter must never be the outage.
// One blob per ip, overwritten each hour, keyed by a hash so no raw ip is stored.
export async function takeCold(store, ip, { limit = COLD_PER_HOUR, now = Date.now() } = {}) {
  if (!store || !ip) return true;
  const key = "rl/" + createHash("sha256").update(String(ip)).digest("hex").slice(0, 24);
  const hour = Math.floor(now / HOUR_MS);
  try {
    const cur = await store.get(key, { type: "json" });
    const n = cur && cur.h === hour && Number.isFinite(cur.n) ? cur.n : 0;
    if (n >= limit) return false;
    await store.set(key, JSON.stringify({ h: hour, n: n + 1 }));
    return true;
  } catch {
    return true;
  }
}
