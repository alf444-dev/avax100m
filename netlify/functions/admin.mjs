import { getStore } from "@netlify/blobs";

// src/admin.js
// Private stats endpoint. Requires the x-admin-key header to match ADMIN_KEY (Netlify env var).
// Returns AGGREGATES ONLY. No wallet address is ever rendered — the covenant holds even here.
var HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
var NOPE = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain" } });

// constant-time-ish compare so a wrong key can't be timed character by character
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

var ERAS = [
  [Date.UTC(2021, 1, 9), "GENESIS"], [Date.UTC(2021, 7, 18), "PANGOLIN SPRING"], [Date.UTC(2021, 10, 21), "AVALANCHE RUSH"],
  [Date.UTC(2022, 1, 1), "WONDERLAND"], [Date.UTC(2022, 4, 9), "SUBNET SZN"], [Date.UTC(2023, 0, 1), "THE LONG WINTER"],
  [Date.UTC(2023, 9, 1), "THE DESERT"], [Date.UTC(2023, 11, 5), "STARS ARENA"], [Date.UTC(2024, 2, 6), "COQ SZN"],
  [Date.UTC(2024, 10, 16), "DURANGO"], [Date.UTC(2025, 0, 25), "AVALANCHE9000"], [Date.UTC(2025, 5, 1), "PRESALE SZN"],
  [Date.UTC(2025, 10, 19), "ARENA SUMMER"], [Infinity, "GRANITE"]
];

var admin_default = async (req) => {
  const key = process.env.ADMIN_KEY;
  // If no key is configured on the server, the endpoint does not exist. Fail closed.
  if (!key || key.length < 16) return NOPE();
  const given = req.headers.get("x-admin-key") || "";
  if (!safeEq(given, key)) return NOPE();

  const url = new URL(req.url);
  const view = url.searchParams.get("view") || "summary";
  const pstore = getStore("pnl");

  if (view === "uniques") {
    // Count distinct wallets that reached a profile P&L compute, across every cache version.
    // Cursor-paginated so large stores don't blow the function budget. Addresses hashed into
    // a Set purely to de-dupe — the raw address never leaves this function.
    const state = await pstore.get("admin-uniq-state", { type: "json" }).catch(() => null);
    if (state === "done") {
      const final = await pstore.get("admin-uniq-final", { type: "json" }).catch(() => null);
      return new Response(JSON.stringify(final || { done: true }), { headers: HEADERS });
    }
    const t0 = Date.now();
    const seen = new Set(state && state.seen || []);
    const byVer = state && state.byVer || {};
    let cur = state && state.c || void 0, timedOut = false;
    do {
      if (Date.now() - t0 > 3500) { timedOut = true; break; }
      const page = await pstore.list({ prefix: "v", cursor: cur });
      for (const b of page.blobs || []) {
        const m = /^v(\d+)\/(0x[0-9a-f]{40})$/.exec(b.key);
        if (!m) continue;
        // store only a short hash of the address in state, never the address itself
        const h = await sha(m[2]);
        seen.add(h);
        byVer[m[1]] = (byVer[m[1]] || 0) + 1;
      }
      cur = page.cursor;
    } while (cur);
    if (timedOut) {
      await pstore.set("admin-uniq-state", JSON.stringify({ c: cur, seen: [...seen], byVer })).catch(() => {});
      return new Response(JSON.stringify({ done: false, uniqueSoFar: seen.size, keysByVersion: byVer }), { headers: HEADERS });
    }
    const final = { done: true, uniqueWallets: seen.size, keysByVersion: byVer, note: "distinct wallets with a profile compute since earliest surviving cache entry; checker-only visits not included" };
    await pstore.set("admin-uniq-final", JSON.stringify(final)).catch(() => {});
    await pstore.set("admin-uniq-state", JSON.stringify("done")).catch(() => {});
    return new Response(JSON.stringify(final), { headers: HEADERS });
  }

  if (view === "records") {
    const rec = await getStore("records").get("records", { type: "json" }).catch(() => null) || { w: [], l: [], rt: [] };
    // strip the hashed tag before returning — value/token/era only
    const clean = (arr) => (arr || []).map((e) => ({ v: e.v, sym: e.sym, era: e.era || null, t: e.t || null }));
    return new Response(JSON.stringify({ w: clean(rec.w), l: clean(rec.l), rt: clean(rec.rt) }), { headers: HEADERS });
  }

  if (view === "claimed") {
    // How many pages are claimed, bucketed by theme/status — counts only, zero addresses.
    const cstore = getStore("claim");
    let cur = void 0, total = 0;
    const themes = {}, withTop8 = { yes: 0, no: 0 }, withStatus = { yes: 0, no: 0 };
    const t0 = Date.now();
    do {
      if (Date.now() - t0 > 3500) break;
      const page = await cstore.list({ prefix: "c/", cursor: cur });
      for (const b of page.blobs || []) {
        if (!/^c\/0x[0-9a-f]{40}$/.test(b.key)) continue;
        const c = await cstore.get(b.key, { type: "json" }).catch(() => null);
        if (!c) continue;
        total++;
        themes[c.theme || "red"] = (themes[c.theme || "red"] || 0) + 1;
        (c.top8 && c.top8.length ? withTop8.yes++ : withTop8.no++);
        (c.status ? withStatus.yes++ : withStatus.no++);
      }
      cur = page.cursor;
    } while (cur);
    return new Response(JSON.stringify({ claimed: total, themes, withTop8, withStatus }), { headers: HEADERS });
  }

  // default: census aggregates + record snapshot
  const census = await getStore("census").get("counts", { type: "json" }).catch(() => null) || { total: 0, eras: {}, ranks: {}, moves: {} };
  return new Response(JSON.stringify({ census, hint: "views: uniques (paginate until done:true), records, claimed" }), { headers: HEADERS });
};

async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

var config = { path: "/api/admin" };
export { config, admin_default as default };
