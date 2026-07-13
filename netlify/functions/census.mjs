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
