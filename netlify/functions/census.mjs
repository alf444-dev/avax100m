import { getStore } from "@netlify/blobs";

// src/census.js
var ERAS = [
  "GENESIS",
  "PANGOLIN SPRING",
  "AVALANCHE RUSH",
  "WONDERLAND",
  "SUBNET SZN",
  "THE LONG WINTER",
  "THE DESERT",
  "STARS ARENA",
  "COQ SZN",
  "DURANGO",
  "AVALANCHE9000",
  "PRESALE SZN",
  "ARENA SUMMER",
  "GRANITE"
];
var RANKS = ["PERMAFROST", "OG", "VETERAN", "SURVIVOR", "RESIDENT", "SETTLER", "FRESH SNOW"];
var EMPTY = () => ({ total: 0, eras: {}, ranks: {}, moves: {} });
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var ERA_BOUNDS = [
  [Date.UTC(2021, 1, 9), "GENESIS"], [Date.UTC(2021, 7, 18), "PANGOLIN SPRING"], [Date.UTC(2021, 10, 21), "AVALANCHE RUSH"],
  [Date.UTC(2022, 1, 1), "WONDERLAND"], [Date.UTC(2022, 4, 9), "SUBNET SZN"], [Date.UTC(2023, 0, 1), "THE LONG WINTER"],
  [Date.UTC(2023, 9, 1), "THE DESERT"], [Date.UTC(2023, 11, 5), "STARS ARENA"], [Date.UTC(2024, 2, 6), "COQ SZN"],
  [Date.UTC(2024, 10, 16), "DURANGO"], [Date.UTC(2025, 0, 25), "AVALANCHE9000"], [Date.UTC(2025, 5, 1), "PRESALE SZN"],
  [Date.UTC(2025, 10, 19), "ARENA SUMMER"], [Infinity, "GRANITE"]
];
var RANK_BOUNDS = [[2000, "PERMAFROST"], [1600, "OG"], [1200, "VETERAN"], [800, "SURVIVOR"], [400, "RESIDENT"], [120, "SETTLER"], [0, "FRESH SNOW"]];
function eraFor(ts) {
  for (const e of ERA_BOUNDS) if (ts < e[0]) return e[1];
  return "GRANITE";
}
function rankFor(days) {
  for (const r of RANK_BOUNDS) if (days >= r[0]) return r[1];
  return "FRESH SNOW";
}
async function sha256hex(s) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function firstTs(addr) {
  const j = await fetch(RS + "?module=account&action=txlist&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=1&sort=asc").then((r) => r.json());
  const f = j && j.result && j.result[0];
  return f ? parseInt(f.timeStamp, 10) * 1e3 : null;
}
var HEADERS = {
  "content-type": "application/json",
  "access-control-allow-origin": "*",
  "cache-control": "no-store"
};
var census_default = async (req) => {
  const store = getStore("census");
  if (req.method === "GET") {
    const counts2 = await store.get("counts", { type: "json" }) || EMPTY();
    counts2.records = await getStore("records").get("records", { type: "json" }).catch(() => null) || null;
    return new Response(JSON.stringify(counts2), { headers: HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 405, headers: HEADERS });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "bad json" }), { status: 400, headers: HEADERS });
  }
  if (body && body.backfill && typeof body.key === "string") {
    if (!process.env.CENSUS_KEY || body.key !== process.env.CENSUS_KEY) {
      return new Response(JSON.stringify({ error: "bad key" }), { status: 403, headers: HEADERS });
    }
    const pstore = getStore("pnl");
    const state = await store.get("bf-state", { type: "json" }).catch(() => null);
    if (state === "done") {
      const counts3 = await store.get("counts", { type: "json" }) || EMPTY();
      return new Response(JSON.stringify({ done: true, note: "census backfill already complete", total: counts3.total }), { headers: HEADERS });
    }
    const t0 = Date.now();
    const counts = await store.get("counts", { type: "json" }) || EMPTY();
    let cur = state && state.c || void 0, added = 0, skipped = 0, scanned = 0, timedOut = false;
    const done2 = new Set(state && state.done || []);
    outer: do {
      const page = await pstore.list({ prefix: "v", cursor: cur });
      for (const b of page.blobs || []) {
        if (Date.now() - t0 > 3200) {
          timedOut = true;
          break outer;
        }
        const m = /^v\d+\/(0x[0-9a-f]{40})$/.exec(b.key);
        if (!m) continue;
        const addr = m[1];
        if (done2.has(addr)) continue;
        done2.add(addr);
        scanned++;
        const h = await sha256hex(addr);
        const seenKey2 = "seen/" + h;
        if (await store.get(seenKey2)) {
          skipped++;
          continue;
        }
        const ts = await firstTs(addr);
        if (!ts) {
          skipped++;
          continue;
        }
        const era2 = eraFor(ts), rank2 = rankFor(Math.floor((Date.now() - ts) / 864e5));
        await store.set(seenKey2, "1");
        counts.total += 1;
        counts.eras[era2] = (counts.eras[era2] || 0) + 1;
        counts.ranks[rank2] = (counts.ranks[rank2] || 0) + 1;
        counts.moves["other"] = (counts.moves["other"] || 0) + 1;
        added++;
      }
      cur = page.cursor;
    } while (cur);
    await store.set("counts", JSON.stringify(counts));
    if (timedOut) await store.set("bf-state", JSON.stringify({ c: cur || null, done: [...done2] })).catch(() => {
    });
    else await store.set("bf-state", JSON.stringify("done")).catch(() => {
    });
    return new Response(JSON.stringify({ done: !timedOut, scanned, added, skipped, total: counts.total }), { headers: HEADERS });
  }
  if (body && body.restore && typeof body.key === "string") {
    if (!process.env.CENSUS_KEY || body.key !== process.env.CENSUS_KEY) {
      return new Response(JSON.stringify({ error: "bad key" }), { status: 403, headers: HEADERS });
    }
    const r = body.restore;
    if (typeof r.total !== "number" || typeof r.eras !== "object" || typeof r.ranks !== "object" || typeof r.moves !== "object") {
      return new Response(JSON.stringify({ error: "bad backup shape" }), { status: 400, headers: HEADERS });
    }
    await store.set("counts", JSON.stringify({ total: r.total, eras: r.eras, ranks: r.ranks, moves: r.moves }));
    return new Response(JSON.stringify({ restored: true, total: r.total }), { headers: HEADERS });
  }
  const { era, rank, move, h } = body || {};
  if (!ERAS.includes(era) || !RANKS.includes(rank) || typeof h !== "string" || !/^[0-9a-f]{64}$/.test(h)) {
    return new Response(JSON.stringify({ error: "bad payload" }), { status: 400, headers: HEADERS });
  }
  let mv = (typeof move === "string" ? move : "").toLowerCase().trim().slice(0, 40);
  if (!/^[a-z0-9$ ]+$/.test(mv)) mv = "other";
  const seenKey = "seen/" + h;
  const seen = await store.get(seenKey);
  const counts = await store.get("counts", { type: "json" }) || EMPTY();
  if (seen) {
    return new Response(JSON.stringify(counts), { headers: HEADERS });
  }
  await store.set(seenKey, "1");
  counts.total += 1;
  counts.eras[era] = (counts.eras[era] || 0) + 1;
  counts.ranks[rank] = (counts.ranks[rank] || 0) + 1;
  if (!(mv in counts.moves) && Object.keys(counts.moves).length >= 300) mv = "other";
  counts.moves[mv] = (counts.moves[mv] || 0) + 1;
  await store.set("counts", JSON.stringify(counts));
  return new Response(JSON.stringify(counts), { headers: HEADERS });
};
var config = { path: "/api/census" };
export {
  config,
  census_default as default
};
