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
  [Date.UTC(2023, 9, 1), "THE DESERT"], [Date.UTC(2023, 11, 7), "STARS ARENA"], [Date.UTC(2024, 2, 6), "COQ SZN"],
  [Date.UTC(2024, 10, 16), "DURANGO"], [Date.UTC(2025, 0, 25), "AVALANCHE9000"], [Date.UTC(2025, 5, 1), "PRESALE SZN"],
  [Date.UTC(2025, 10, 19), "ARENA SUMMER"], [Infinity, "GRANITE"]
];
var RANK_BOUNDS = [[2000, "PERMAFROST"], [1600, "OG"], [1200, "VETERAN"], [800, "SURVIVOR"], [400, "RESIDENT"], [120, "SETTLER"], [0, "FRESH SNOW"]];
function eraFor(ts) {
  for (const e of ERAS) if (ts < e[0]) return e[1];
  return "GRANITE";
}
function rankFor(days) {
  for (const r of RANK_BOUNDS) if (days >= r[0]) return r[1];
  return "FRESH SNOW";
}

// first-tx lookup, same 3-source-min method as the live checker (normal tx,
// token transfer, internal tx) — txlist-only misfiles airdrop-first wallets.
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var RS_KEY = process.env.ROUTESCAN_KEY ? "&apikey=" + process.env.ROUTESCAN_KEY : "";
function tsOf(j) {
  const f = j && Array.isArray(j.result) && j.result[0];
  const n = f && f.timeStamp ? parseInt(f.timeStamp, 10) : NaN;
  return Number.isFinite(n) ? n * 1e3 : null;
}
async function firstTs(addr) {
  const base = RS + "?module=account&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=1&sort=asc" + RS_KEY;
  const [tx, tok, itx] = await Promise.all([
    fetch(base + "&action=txlist").then((r) => r.json()).catch(() => null),
    fetch(base + "&action=tokentx").then((r) => r.json()).catch(() => null),
    fetch(base + "&action=txlistinternal").then((r) => r.json()).catch(() => null)
  ]);
  const cands = [tsOf(tx), tsOf(tok), tsOf(itx)].filter((t) => t !== null);
  return cands.length ? Math.min(...cands) : null;
}
// shared first-tx cache (immutable data, no TTL) — a wallet seen by a profile view,
// census, or a prior build never costs a Routescan round again. { fetched } lets the
// caller count only real network hits against its per-pass RS budget.
async function firstTsCached(addr) {
  const ft = getStore("firsttx");
  const c = await ft.get(addr, { type: "json" }).catch(() => null);
  if (c && typeof c.ts === "number") return { ts: c.ts, fetched: false };
  const ts = await firstTs(addr);
  if (ts) await ft.set(addr, JSON.stringify({ ts, t: Date.now() })).catch(() => {});
  return { ts: ts || null, fetched: true };
}
// bounded-concurrency map (verbatim from pnl.mjs) — lets a build/audit pass fan out
// Routescan lookups now that an API key gives real rate headroom.
async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k], k);
    }
  });
  await Promise.all(workers);
}
var CONC = parseInt(process.env.ROUTESCAN_CONC, 10) || 3;

// parse a "+$1,234" / "-$5.6k" / "$1.2m" signed-usd string into a number
function parseUsd(s) {
  if (typeof s === "number") return s;
  if (typeof s !== "string") return null;
  const m = /(-?)\$?([\d.,]+)\s*([kmb])?/i.exec(s.replace(/,/g, ""));
  if (!m) return null;
  let v = parseFloat(m[2]);
  if (!Number.isFinite(v)) return null;
  const mul = { k: 1e3, m: 1e6, b: 1e9 }[(m[3] || "").toLowerCase()] || 1;
  return (m[1] === "-" ? -1 : 1) * v * mul;
}

// project a full pnl `stats` object into one compact directory record field-set
function classifyStats(stats, rowsIdx) {
  const out = { netUsd: null, wins: null, losses: null, winrate: null, tokens: null, bw: null, bl: null, rt: null, ste: null, flags: [], quality: {} };
  if (!stats) return out;
  const su = stats.summary || {};
  // prefer an exact sum of the token ledger; fall back to the summary string
  let net = null;
  if (Array.isArray(rowsIdx) && rowsIdx.length) net = rowsIdx.reduce((s, r) => s + (r.p || 0), 0);
  else net = parseUsd(su.total);
  out.netUsd = net === null ? null : Math.round(net);
  out.wins = typeof su.wins === "number" ? su.wins : null;
  out.losses = typeof su.losses === "number" ? su.losses : null;
  out.winrate = su.winrate ? parseInt(su.winrate, 10) : null;
  out.tokens = stats.tokens != null ? parseInt(stats.tokens, 10) : null;
  if (stats.biggestW) out.bw = { usd: stats.biggestW.usd, sym: stats.biggestW.sym };
  if (stats.biggestL) out.bl = { usd: stats.biggestL.usd, sym: stats.biggestL.sym };
  const rt0 = (stats.roundtrips || [])[0];
  if (rt0) out.rt = { usd: rt0.rtUsd != null ? rt0.rtUsd : null, sym: rt0.sym };
  const ste0 = (stats.soldEarly || [])[0];
  if (ste0) out.ste = { usd: ste0.missedUsd != null ? ste0.missedUsd : null, sym: ste0.sym };
  out.flags = Object.keys(stats.flags || {});
  out.quality = { partial: !!stats.partial, thin: !!stats.thin };
  return out;
}

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

  // ── WALLET DIRECTORY ──────────────────────────────────────────────────────
  // Owner-only, key-gated, noindex. Reverses the public "aggregates only" covenant
  // for this private surface: lists every recoverable checked address (pnl ∪ badges
  // ∪ claim key-spaces), classified. Public census/records stay hashed & anonymous.
  const astore = getStore("admin");

  if (view === "wallets-build") {
    // Resumable build. Two stages inside one persisted state blob (admin-widx-state):
    //   stage "enum"     — cursor-walk pnl/badges/claim key names, union addresses
    //   stage "classify" — per new address: pnl stats + claim + routescan era/rank
    // Client drives it by calling repeatedly until { done:true }. Idempotent: a
    // finished build re-runs enum to pick up new wallets, classifies only the unseen.
    const t0 = Date.now();
    const BUDGET = 4200;              // soft per-invocation wall-clock budget (ms)
    const RS_CAP = 22;               // max routescan-costing classifications per pass
    const fresh = url.searchParams.get("fresh") === "1";     // full rebuild, wipe index
    const refresh = url.searchParams.get("refresh") === "1"; // re-enumerate, keep index
    const NEW_ENUM = () => ({ stage: "enum", addrs: {}, cur: {}, ci: 0, list: null });
    let state = await astore.get("widx-state", { type: "json" }).catch(() => null);
    if (fresh) await astore.set("widx", JSON.stringify([])).catch(() => {});
    if (fresh || !state) state = NEW_ENUM();
    else if (state.stage === "done" && refresh) state = NEW_ENUM();  // incremental top-up

    // load the current index once (also gives us the already-classified set)
    const index = fresh ? [] : (await astore.get("widx", { type: "json" }).catch(() => null) || []);
    const have = new Set(index.map((r) => r.a));

    if (state.stage === "enum") {
      const bstore = getStore("badges");
      const cstore = getStore("claim");
      const sources = [
        { store: pstore, prefix: "v", ck: "pnl", re: /^v(\d+)\/(0x[0-9a-f]{40})$/ },
        { store: bstore, prefix: "w2/", ck: "bw2", re: /^w2\/(0x[0-9a-f]{40})$/ },
        { store: bstore, prefix: "seen/0x", ck: "bseen", re: /^seen\/(0x[0-9a-f]{40})$/ },
        { store: cstore, prefix: "c/", ck: "claim", re: /^c\/(0x[0-9a-f]{40})$/ }
      ];
      let timedOut = false;
      for (const s of sources) {
        if (state.cur[s.ck] === "done") continue;
        let cur = state.cur[s.ck] || void 0;
        do {
          if (Date.now() - t0 > BUDGET) { timedOut = true; break; }
          const page = await s.store.list({ prefix: s.prefix, cursor: cur });
          for (const b of page.blobs || []) {
            const m = s.re.exec(b.key);
            if (!m) continue;
            // pnl keys carry a version group; badges/claim don't
            const addr = (m[2] || m[1]).toLowerCase();
            const ver = m[2] ? parseInt(m[1], 10) : 0;
            const cur2 = state.addrs[addr] || 0;
            if (ver > cur2) state.addrs[addr] = ver;      // keep newest pnl version
            else if (!(addr in state.addrs)) state.addrs[addr] = ver;
          }
          cur = page.cursor;
          state.cur[s.ck] = cur || "done";
        } while (cur);
        if (timedOut) break;
      }
      if (timedOut) {
        await astore.set("widx-state", JSON.stringify(state)).catch(() => {});
        return new Response(JSON.stringify({ done: false, stage: "enum", discovered: Object.keys(state.addrs).length }), { headers: HEADERS });
      }
      // enumeration complete → freeze the work list, move to classify
      state.list = Object.keys(state.addrs).filter((a) => !have.has(a));
      state.ci = 0;
      state.stage = "classify";
      await astore.set("widx-state", JSON.stringify(state)).catch(() => {});
      return new Response(JSON.stringify({ done: false, stage: "classify", discovered: Object.keys(state.addrs).length, toClassify: state.list.length }), { headers: HEADERS });
    }

    if (state.stage === "classify") {
      const cstore = getStore("claim");
      const list = state.list || [];
      const added = [];
      let rsUsed = 0;
      const classifyOne = async (addr) => {
        const ver = state.addrs[addr] || 0;
        let stats = null, rowsIdx = null, lastT = null;
        if (ver) {
          const pv = await pstore.get("v" + ver + "/" + addr, { type: "json" }).catch(() => null);
          if (pv) { stats = pv.stats; rowsIdx = pv.rowsIdx; lastT = pv.t || null; }
        }
        const claim = await cstore.get("c/" + addr, { type: "json" }).catch(() => null);
        const ftr = await firstTsCached(addr); if (ftr.fetched) rsUsed++;
        const ts = ftr.ts;
        added.push(Object.assign(
          { a: addr, ver, ts: ts || null, era: ts ? eraFor(ts) : null, rank: ts ? rankFor(Math.floor((Date.now() - ts) / 864e5)) : null,
            t: lastT, claimed: !!claim, theme: claim && claim.theme || null,
            hasTop8: !!(claim && claim.top8 && claim.top8.length), hasStatus: !!(claim && claim.status),
            src: { pnl: !!stats, claim: !!claim } },
          classifyStats(stats, rowsIdx)
        ));
      };
      while (state.ci < list.length) {
        if (Date.now() - t0 > BUDGET || rsUsed >= RS_CAP) break;
        const batch = [];
        while (batch.length < CONC && state.ci < list.length) {
          const a = list[state.ci]; state.ci++;
          if (have.has(a)) continue;                     // classified in a prior pass
          have.add(a); batch.push(a);                    // reserve to avoid dupes within the batch
        }
        if (batch.length) await pool(batch, CONC, classifyOne);
      }
      if (added.length) { index.push(...added); await astore.set("widx", JSON.stringify(index)).catch(() => {}); }
      const done = state.ci >= list.length;
      if (done) { state.stage = "done"; await astore.set("widx-built", JSON.stringify(Date.now())).catch(() => {}); }
      await astore.set("widx-state", JSON.stringify(state)).catch(() => {});
      return new Response(JSON.stringify({ done, stage: state.stage, classified: state.ci, toClassify: list.length, indexed: index.length }), { headers: HEADERS });
    }

    return new Response(JSON.stringify({ done: true, stage: "done", indexed: index.length }), { headers: HEADERS });
  }

  if (view === "wallets") {
    const index = await astore.get("widx", { type: "json" }).catch(() => null) || [];
    const built = await astore.get("widx-built", { type: "json" }).catch(() => null);
    return new Response(JSON.stringify({ built, count: index.length, wallets: index }), { headers: HEADERS });
  }

  if (view === "wallet") {
    // full drill-down for one address: uncompacted stats + top-token ledger
    const addr = (url.searchParams.get("addr") || "").toLowerCase();
    if (!/^0x[0-9a-f]{40}$/.test(addr)) return new Response(JSON.stringify({ error: "bad addr" }), { status: 400, headers: HEADERS });
    const ver = parseInt(url.searchParams.get("ver") || "24", 10) || 24;
    let pv = await pstore.get("v" + ver + "/" + addr, { type: "json" }).catch(() => null);
    if (!pv && ver !== 24) pv = await pstore.get("v24/" + addr, { type: "json" }).catch(() => null);
    const claim = await getStore("claim").get("c/" + addr, { type: "json" }).catch(() => null);
    return new Response(JSON.stringify({ addr, stats: pv && pv.stats || null, rowsIdx: pv && pv.rowsIdx || null, t: pv && pv.t || null, claim: claim || null }), { headers: HEADERS });
  }

  if (view === "wallets-audit") {
    // Re-verify era classification against a fresh Routescan first-tx. Because an
    // endpoint hiccup can only ever make the observed first-tx LATER (never earlier),
    // the truth is the earliest timestamp ever seen (stored vs fresh) — so a
    // correction can only move a wallet to an OLDER era, never a false demotion.
    // Resumable + RS-capped like the build. ?era= limits to one stored era,
    // ?fix=1 writes corrections back to the index, ?restart=1 forces a fresh pass.
    const t0 = Date.now();
    const BUDGET = 4200, RS_CAP = 22;
    const eraFilter = url.searchParams.get("era") || null;
    const doFix = url.searchParams.get("fix") === "1";
    const restart = url.searchParams.get("restart") === "1";
    const index = await astore.get("widx", { type: "json" }).catch(() => null) || [];
    let st = await astore.get("widx-audit-state", { type: "json" }).catch(() => null);
    if (restart || !st || st.era !== eraFilter || st.fix !== doFix) st = { era: eraFilter, fix: doFix, ci: 0, checked: 0, fixed: 0, mism: [] };
    let rsUsed = 0, dirty = false;
    const ftStore = getStore("firsttx");
    const auditOne = async (rec) => {
      const cachedFt = await ftStore.get(rec.a, { type: "json" }).catch(() => null);
      let fresh = await firstTs(rec.a); rsUsed++;                 // force-fresh (bypass cache) to catch build hiccups
      if (fresh == null) fresh = await firstTs(rec.a);           // one retry on empty
      const cand = [rec.ts, cachedFt && cachedFt.ts, fresh].filter((x) => x != null);
      const truthTs = cand.length ? Math.min(...cand) : null;    // earliest ever seen = truth
      st.checked++;
      if (truthTs == null) return;
      if (!cachedFt || cachedFt.ts !== truthTs) await ftStore.set(rec.a, JSON.stringify({ ts: truthTs, t: Date.now() })).catch(() => {});
      const truthEra = eraFor(truthTs);
      if (truthEra !== rec.era) {
        if (st.mism.length < 500) st.mism.push({ a: rec.a, was: rec.era, now: truthEra, wasTs: rec.ts || null, nowTs: truthTs });
        if (doFix) { rec.ts = truthTs; rec.era = truthEra; rec.rank = rankFor(Math.floor((Date.now() - truthTs) / 864e5)); dirty = true; st.fixed++; }
      } else if (doFix && truthTs !== rec.ts) {
        rec.ts = truthTs; rec.rank = rankFor(Math.floor((Date.now() - truthTs) / 864e5)); dirty = true;
      }
    };
    while (st.ci < index.length) {
      if (Date.now() - t0 > BUDGET || rsUsed >= RS_CAP) break;
      const batch = [];
      while (batch.length < CONC && st.ci < index.length) {
        const rec = index[st.ci]; st.ci++;
        if (!rec || !/^0x[0-9a-f]{40}$/.test(rec.a)) continue;
        if (eraFilter && rec.era !== eraFilter) continue;
        batch.push(rec);
      }
      if (batch.length) await pool(batch, CONC, auditOne);
    }
    if (dirty) await astore.set("widx", JSON.stringify(index)).catch(() => {});
    const done = st.ci >= index.length;
    if (done) await astore.set("widx-built", JSON.stringify(Date.now())).catch(() => {});
    await astore.set("widx-audit-state", JSON.stringify(st)).catch(() => {});
    return new Response(JSON.stringify({ done, checked: st.checked, scanned: st.ci, total: index.length, mismatches: st.mism, fixed: st.fixed, era: eraFilter, fix: doFix }), { headers: HEADERS });
  }

  // default: census aggregates + record snapshot
  const census = await getStore("census").get("counts", { type: "json" }).catch(() => null) || { total: 0, eras: {}, ranks: {}, moves: {} };
  return new Response(JSON.stringify({ census, hint: "views: uniques, records, claimed, wallets-build, wallets, wallet, wallets-audit" }), { headers: HEADERS });
};

async function sha(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

var config = { path: "/api/admin" };
export { config, admin_default as default };
