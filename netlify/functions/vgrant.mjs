import { getStore } from "@netlify/blobs";
import { VGRANTED } from "./lib/vbadges.mjs";

// Portal / Discord (/t1validator) sync — the write side. An authenticated caller
// sets a validator's program data (Tier A/B/C + granted badges) on the shared
// vprofile record (v/<nodeID>) that the card + PNG read. Self-set fields
// (handle/pfp/socials/owner from vclaim) are preserved. Fails closed (404)
// without the correct PORTAL_KEY, so the endpoint is invisible otherwise.
//
// Contract: POST /api/vgrant  header x-portal-key: <PORTAL_KEY>
//   body { node: "NodeID-…", tier?: "A"|"B"|"C"|null, grantedBadges?: string[]|null }
//   - omit a field to leave it unchanged; null/"" to clear it.
//   - valid grantedBadges ids: builder, educator, pillar, streaker, founding.

var mems = {};
var _mem = mems;
function storeOr(name, opts) {
  try {
    const s = getStore(opts ? Object.assign({ name }, opts) : name);
    if (s) return s;
  } catch {}
  if (process.env.NETLIFY || process.env.URL) return null;
  if (!mems[name]) mems[name] = /* @__PURE__ */ new Map();
  const m = mems[name];
  return {
    get: async (k, o) => { const v = m.get(k); return v === void 0 ? null : o && o.type === "json" ? JSON.parse(v) : v; },
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); }
  };
}

var HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
const NOPE = () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });

function safeEq(a, b) {
  a = String(a || ""); b = String(b || "");
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

var vgrant_default = async (req) => {
  const key = process.env.PORTAL_KEY;
  if (!key || key.length < 16) return NOPE();
  if (!safeEq(req.headers.get("x-portal-key") || "", key)) return NOPE();
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const node = String(body.node || "").trim();
  if (!/^NodeID-[A-Za-z0-9]+$/.test(node)) return json({ error: "bad node" }, 400);

  const store = storeOr("vprofile", { consistency: "strong" });
  const prev = store ? await store.get("v/" + node, { type: "json" }).catch(() => null) : null;
  const rec = Object.assign({}, prev);

  if (body.tier !== undefined) {
    const t = String(body.tier || "").toUpperCase();
    if (/^[ABC]$/.test(t)) rec.tier = t; else delete rec.tier;
  }
  if (body.grantedBadges !== undefined) {
    const list = Array.isArray(body.grantedBadges) ? body.grantedBadges : [];
    const ids = [...new Set(list.map((s) => String(s || "").toLowerCase()).filter((s) => VGRANTED[s]))].slice(0, 8);
    if (ids.length) rec.grantedBadges = ids; else delete rec.grantedBadges;
  }
  rec.tierSource = "portal";
  rec.t = Date.now();
  if (store) await store.set("v/" + node, JSON.stringify(rec)).catch(() => {});
  return json({ ok: true, node, tier: rec.tier || null, grantedBadges: rec.grantedBadges || [] });
};
var config = { path: "/api/vgrant" };
export {
  _mem,
  config,
  vgrant_default as default
};
