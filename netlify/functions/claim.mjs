import { getStore } from "@netlify/blobs";

import { ethers } from "ethers";

// src/claim.js
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var RS_KEY = process.env.ROUTESCAN_KEY ? "&apikey=" + process.env.ROUTESCAN_KEY : "";
var NONCE_MS = 10 * 60 * 1e3;
var mem = /* @__PURE__ */ new Map();
var memStore = {
  get: async (k, o) => {
    const v = mem.get(k);
    return v === void 0 ? null : o && o.type === "json" ? JSON.parse(v) : v;
  },
  set: async (k, v) => {
    mem.set(k, v);
  },
  delete: async (k) => {
    mem.delete(k);
  }
};
function storeOr() {
  try {
    const s = getStore({ name: "claim", consistency: "strong" });
    if (s) return s;
  } catch {
  }
  if (!process.env.NETLIFY && !process.env.URL) return memStore;
  return null;
}
var clean = (s) => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
var THEMES = { red: "#e84142", snow: "#f2f2f2", gold: "#d4a017", teal: "#2aa198", violet: "#7c5cff", pink: "#ff5ea8", term: "#00ff66" };
var cleanBadges = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9,]/g, "").split(",").filter(Boolean).slice(0, 3);
var cleanTop8 = (v) => String(v || "").toLowerCase().replace(/[^a-z0-9.,_-]/g, "").split(",").filter((x) => /^0x[0-9a-f]{40}$/.test(x) || /^[a-z0-9-_]+(\.[a-z0-9-_]+)*\.avax$/.test(x)).slice(0, 8);
var BLOCKED = /nigg|fagg|kike|spic\b|chink|retard|rape|hitler/i;
var URLISH = /(https?:|www\.|\.com|\.io|\.xyz|\.net|\.org|\.gg|\.fi|t\.me|discord)/i;
function statusProblem(st) {
  if (st.length > 100) return "status is capped at 100 characters.";
  if (URLISH.test(st)) return "no links in a status.";
  if (st.includes("@")) return "no handles in a status.";
  if (BLOCKED.test(st)) return "not that.";
  if (!/^[a-z0-9 .,'!?$#&()\/+\u2019\u00e0-\u00ff:;%*=~^-]*$/.test(st)) return "plain text only.";
  return null;
}
async function currentBlock() {
  try {
    const j = await fetch(RS + "?module=proxy&action=eth_blockNumber" + RS_KEY).then((r) => r.json());
    return j && j.result ? parseInt(j.result, 16) : null;
  } catch {
    return null;
  }
}
var claim_default = async (req) => {
  const url = new URL(req.url);
  const store = storeOr();
  if (!store) return new Response(JSON.stringify({ error: "storage unavailable \u2014 try again in a minute." }), { status: 503, headers: HEADERS });
  if (req.method === "GET") {
    const addr = clean(url.searchParams.get("addr"));
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return new Response(JSON.stringify({ error: "bad address" }), { status: 400, headers: HEADERS });
    if (url.searchParams.get("info") === "1") {
      const c = await store.get("c/" + addr, { type: "json" }).catch(() => null);
      let in8 = [];
      try {
        in8 = await store.get("in8/" + addr, { type: "json" }) || [];
      } catch {
      }
      let views = null;
      if (c && url.searchParams.get("view") === "1") {
        try {
          const wk = Math.floor(Date.now() / 6048e5);
          let v = await store.get("v/" + addr, { type: "json" }).catch(() => null);
          if (!v || v.w !== wk) v = { w: wk, n: 0 };
          v.n++;
          views = v.n;
          await store.set("v/" + addr, JSON.stringify(v)).catch(() => {
          });
        } catch {
        }
      }
      return new Response(JSON.stringify(c ? { claimed: true, settledAt: c.t, settledBlock: c.blk || null, status: c.status || null, theme: c.theme || "red", cardBadges: c.cardBadges || [], top8: c.top8 || [], in8Count: in8.length, views } : { claimed: false, in8Count: in8.length }), { headers: HEADERS });
    }
    const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16))).map((b) => b.toString(16).padStart(2, "0")).join("");
    await store.set("n/" + addr, JSON.stringify({ nonce, t: Date.now() })).catch(() => {
    });
    return new Response(JSON.stringify({ nonce }), { headers: HEADERS });
  }
  if (req.method === "POST") {
    let body = {};
    try {
      body = await req.json();
    } catch {
    }
    const addr = clean(body.addr);
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return new Response(JSON.stringify({ error: "bad address" }), { status: 400, headers: HEADERS });
    const nrec = await store.get("n/" + addr, { type: "json" }).catch(() => null);
    if (!nrec || Date.now() - nrec.t > NONCE_MS) return new Response(JSON.stringify({ error: "nonce expired \u2014 try again." }), { status: 400, headers: HEADERS });
    const action = body.action === "profile" ? "profile" : body.action === "status" ? "status" : "claim";
    if (body.method === "tx") {
      try {
        const j = await fetch(RS + "?module=account&action=txlist&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=10&sort=desc" + RS_KEY).then((r) => r.json());
        const hexNonce = nrec.nonce;
        const hit = (j.result || []).find((t) => (t.from || "").toLowerCase() === addr && (t.to || "").toLowerCase() === addr && (t.input || "").toLowerCase().includes(hexNonce) && Date.now() / 1e3 - parseInt(t.timeStamp, 10) < 3600);
        if (!hit) return new Response(JSON.stringify({ error: "no matching self-transaction found yet. it can take a minute to index." }), { status: 400, headers: HEADERS });
      } catch {
        return new Response(JSON.stringify({ error: "verification unavailable, try again." }), { status: 500, headers: HEADERS });
      }
    } else {
      const sig = body.sig;
      if (!sig) return new Response(JSON.stringify({ error: "missing signature" }), { status: 400, headers: HEADERS });
      const msg = action === "profile" ? "avax100m.xyz\nupdate profile for " + addr + "\nstatus: " + clean(body.status) + "\ntheme: " + (THEMES[clean(body.theme)] ? clean(body.theme) : "red") + "\nbadges: " + cleanBadges(body.cardBadges).join(",") + "\ntop8: " + cleanTop8(body.top8).join(",") + "\nnonce: " + nrec.nonce : action === "status" ? "avax100m.xyz\nset status for " + addr + "\nstatus: " + clean(body.status) + "\nnonce: " + nrec.nonce : "avax100m.xyz\nclaim page for " + addr + "\nnonce: " + nrec.nonce;
      let rec = null;
      try {
        rec = ethers.verifyMessage(msg, sig).toLowerCase();
      } catch {
      }
      if (rec !== addr) return new Response(JSON.stringify({ error: "signature doesn't match this wallet." }), { status: 401, headers: HEADERS });
    }
    await store.delete("n/" + addr).catch(() => {
    });
    if (action === "profile") {
      const existing = await store.get("c/" + addr, { type: "json" }).catch(() => null);
      if (!existing) return new Response(JSON.stringify({ error: "claim the page first." }), { status: 400, headers: HEADERS });
      const st = clean(body.status);
      if (st) {
        const prob = statusProblem(st);
        if (prob) return new Response(JSON.stringify({ error: prob }), { status: 400, headers: HEADERS });
      }
      existing.status = st || null;
      existing.theme = THEMES[clean(body.theme)] ? clean(body.theme) : "red";
      existing.cardBadges = cleanBadges(body.cardBadges);
      const newTop8 = cleanTop8(body.top8);
      const oldTop8 = existing.top8 || [];
      existing.top8 = newTop8;
      existing.profileT = Date.now();
      await store.set("c/" + addr, JSON.stringify(existing));
      const removed = oldTop8.filter((x) => newTop8.indexOf(x) < 0 && x.startsWith("0x"));
      const added = newTop8.filter((x) => oldTop8.indexOf(x) < 0 && x.startsWith("0x"));
      for (const target of removed.concat(added)) {
        try {
          const key = "in8/" + target;
          let list = await store.get(key, { type: "json" }) || [];
          if (added.indexOf(target) > -1 && list.indexOf(addr) < 0) list.push(addr);
          if (removed.indexOf(target) > -1) list = list.filter((x) => x !== addr);
          await store.set(key, JSON.stringify(list.slice(0, 500)));
        } catch {
        }
      }
      return new Response(JSON.stringify({ ok: true, status: existing.status, theme: existing.theme, cardBadges: existing.cardBadges, top8: existing.top8 }), { headers: HEADERS });
    }
    if (action === "status") {
      const existing = await store.get("c/" + addr, { type: "json" }).catch(() => null);
      if (!existing) return new Response(JSON.stringify({ error: "claim the page first." }), { status: 400, headers: HEADERS });
      const st = clean(body.status);
      const prob = statusProblem(st);
      if (prob) return new Response(JSON.stringify({ error: prob }), { status: 400, headers: HEADERS });
      existing.status = st;
      existing.statusT = Date.now();
      await store.set("c/" + addr, JSON.stringify(existing));
      return new Response(JSON.stringify({ ok: true, status: st }), { headers: HEADERS });
    }
    const already = await store.get("c/" + addr, { type: "json" }).catch(() => null);
    if (already) return new Response(JSON.stringify({ ok: true, claimed: true, settledAt: already.t, settledBlock: already.blk }), { headers: HEADERS });
    const blk = await currentBlock();
    const rec2 = { t: Date.now(), blk, method: body.method === "tx" ? "tx" : "sig" };
    await store.set("c/" + addr, JSON.stringify(rec2));
    return new Response(JSON.stringify({ ok: true, claimed: true, settledAt: rec2.t, settledBlock: blk }), { headers: HEADERS });
  }
  return new Response(JSON.stringify({ error: "method" }), { status: 405, headers: HEADERS });
};
var config = { path: "/api/claim" };
export {
  config,
  claim_default as default
};
/*! Bundled license information:

js-sha3/src/sha3.js:
  (**
   * [js-sha3]{@link https://github.com/emn178/js-sha3}
   *
   * @version 0.8.0
   * @author Chen, Yi-Cyuan [emn178@gmail.com]
   * @copyright Chen, Yi-Cyuan 2015-2018
   * @license MIT
   *)
*/
