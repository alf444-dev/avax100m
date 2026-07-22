import { getStore } from "@netlify/blobs";
import { rpc } from "./lib/pchain.mjs";
import { recoverAvaxAddr, bareAvaxAddr } from "./lib/avax-addr.mjs";

// Validator self-claim: an operator proves control of a NodeID by signing a
// nonce with the key that owns the validation reward, then sets handle / PFP /
// socials on the node's profile record (vprofile store, key v/<nodeID>) — the
// same record the card + PNG read. Two-step: POST (no sig) prepares the exact
// message to sign; POST (with sig) commits after verifying the recovered
// Avalanche address matches the on-chain reward owner.

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

var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: HEADERS });
var NONCE_MS = 10 * 60 * 1e3;

// Allowlist sanitizers (no control chars, no markup) — the server rebuilds the
// signed message from these, so a signature only validates the exact values.
const cleanUrl = (s) => { s = String(s || "").trim(); return /^https:\/\/[^\s"'<>]{1,300}$/i.test(s) ? s : ""; };
const cleanHandle = (s) => String(s || "").replace(/[^A-Za-z0-9 ._-]/g, "").trim().slice(0, 24);
const cleanDiscord = (s) => String(s || "").replace(/[^A-Za-z0-9 ._#-]/g, "").trim().slice(0, 40);
function cleanX(s) { const m = String(s || "").trim().match(/(?:^|x\.com\/|twitter\.com\/|@)([A-Za-z0-9_]{1,15})$/i); return m ? "https://x.com/" + m[1] : ""; }
function sanitize(body) {
  return {
    handle: cleanHandle(body.handle),
    pfp: cleanUrl(body.pfp),
    x: cleanX(body.x),
    discord: cleanDiscord(body.discord),
    site: cleanUrl(body.site)
  };
}
const profileMsg = (node, v, nonce) =>
  "avax100m.xyz\nset validator profile " + node + "\nhandle: " + v.handle + "\npfp: " + v.pfp +
  "\nx: " + v.x + "\ndiscord: " + v.discord + "\nsite: " + v.site + "\nnonce: " + nonce;

async function rewardOwners(node) {
  const res = await rpc("getCurrentValidators", { nodeIDs: [node] });
  const v = res && res.validators && res.validators[0];
  const addrs = (v && v.validationRewardOwner && v.validationRewardOwner.addresses) || [];
  return addrs.map(bareAvaxAddr);
}

var vclaim_default = async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: "bad json" }, 400); }
  const node = String(body.node || "").trim();
  if (!/^NodeID-[A-Za-z0-9]+$/.test(node)) return json({ error: "bad node" }, 400);

  const store = storeOr("vprofile", { consistency: "strong" });
  const nonceKey = "vn/" + node;

  // Step 2 — commit: a signature is present.
  if (body.sig) {
    const pend = store ? await store.get(nonceKey, { type: "json" }).catch(() => null) : null;
    if (!pend || !Number.isFinite(pend.t) || Date.now() - pend.t > NONCE_MS) return json({ error: "nonce expired — start over" }, 400);
    const msg = profileMsg(node, pend.vals, pend.nonce);
    let derived;
    try { derived = recoverAvaxAddr(msg, body.sig); } catch { return json({ error: "bad signature" }, 400); }
    const owners = pend.owners || [];
    if (!owners.includes(derived)) return json({ error: "signature is not from this validator's reward owner", signer: derived, owners }, 401);
    if (store) await store.delete(nonceKey).catch(() => {});
    const prev = store ? await store.get("v/" + node, { type: "json" }).catch(() => null) : null;
    const v = pend.vals;
    // Preserve portal-set fields (tier, grantedBadges) on prev; overwrite self fields.
    const rec = Object.assign({}, prev, {
      handle: v.handle, pfp: v.pfp,
      socials: { x: v.x, discord: v.discord, site: v.site },
      owner: derived, claimedAt: (prev && prev.claimedAt) || Date.now(), t: Date.now(), source: "self"
    });
    if (store) await store.set("v/" + node, JSON.stringify(rec)).catch(() => {});
    return json({ ok: true, profile: { handle: rec.handle, pfp: rec.pfp, socials: rec.socials } });
  }

  // Step 1 — prepare: sanitize, fetch reward owners, mint a nonce, return the message to sign.
  let owners;
  try { owners = await rewardOwners(node); } catch { return json({ error: "could not read reward owner from the p-chain" }, 502); }
  if (!owners.length) return json({ error: "no reward owner on record for this validator" }, 404);
  const vals = sanitize(body);
  const nonce = Math.random().toString(36).slice(2) + Date.now().toString(36);
  if (store) await store.set(nonceKey, JSON.stringify({ nonce, t: Date.now(), vals, owners })).catch(() => {});
  return json({ message: profileMsg(node, vals, nonce), nonce, owners });
};
var config = { path: "/api/vclaim" };
export {
  _mem,
  config,
  vclaim_default as default
};
