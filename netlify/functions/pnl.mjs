import { getStore } from "@netlify/blobs";
import { fetchPnlData, normalizeSymbol, PnlProviderError } from "./lib/pnl-provider.mjs";

// src/pnl.js
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var CACHE_MS = 7 * 24 * 3600 * 1e3;
var RETRY_CACHE_MS = 3 * 60 * 1e3;
var WORK_LEASE_MS = 30 * 1e3;
var RECORDS_KEY = "records-v25";
var NOPE = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain", "cache-control": "no-store" } });
function safeEq(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i++) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}
function isAdmin(req) {
  const key = process.env.ADMIN_KEY;
  return typeof key === "string" && key.length >= 16 && safeEq(req.headers.get("x-admin-key") || "", key);
}
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var RS_KEY = process.env.ROUTESCAN_KEY ? "&apikey=" + process.env.ROUTESCAN_KEY : "";
var REC_ERAS = [
  [Date.UTC(2021, 1, 9), "GENESIS"], [Date.UTC(2021, 7, 18), "PANGOLIN SPRING"], [Date.UTC(2021, 10, 21), "AVALANCHE RUSH"],
  [Date.UTC(2022, 1, 1), "WONDERLAND"], [Date.UTC(2022, 4, 9), "SUBNET SZN"], [Date.UTC(2023, 0, 1), "THE LONG WINTER"],
  [Date.UTC(2023, 9, 1), "THE DESERT"], [Date.UTC(2023, 11, 7), "STARS ARENA"], [Date.UTC(2024, 2, 6), "COQ SZN"],
  [Date.UTC(2024, 10, 16), "DURANGO"], [Date.UTC(2025, 0, 25), "AVALANCHE9000"], [Date.UTC(2025, 5, 1), "PRESALE SZN"],
  [Date.UTC(2025, 10, 19), "ARENA SUMMER"], [Infinity, "GRANITE"]
];
async function walletEra(addr) {
  try {
    const j = await fetch(RS + "?module=account&action=txlist&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=1&sort=asc" + RS_KEY).then((r) => r.json());
    const f = j && j.result && j.result[0];
    if (!f) return null;
    const ts = parseInt(f.timeStamp, 10) * 1e3;
    for (const e of REC_ERAS) if (ts < e[0]) return e[1];
    return REC_ERAS[REC_ERAS.length - 1][1];
  } catch {
    return null;
  }
}
async function walletTag(addr) {
  try {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("rec/" + addr));
    return Array.from(new Uint8Array(buf)).slice(0, 5).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
async function updateRecords(addr, rows, extra) {
  try {
    const rstore = getStore("records");
    const wins = rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit);
    const losses = rows.filter((r) => r.profit < 0).sort((a, b) => a.profit - b.profit);
    const hasRoundtripEvidence = !!(extra && Array.isArray(extra.roundtrips));
    const rt0 = hasRoundtripEvidence && extra.roundtrips[0];
    const cand = {
      w: wins[0] && wins[0].profit >= 1e3 ? { v: Math.round(wins[0].profit), sym: normalizeSymbol(wins[0].sym, wins[0].tokenAddress) } : null,
      l: losses[0] && losses[0].profit <= -1e3 ? { v: Math.round(losses[0].profit), sym: normalizeSymbol(losses[0].sym, losses[0].tokenAddress) } : null,
      rt: rt0 && rt0.rtUsd >= 1e3 ? { v: rt0.rtUsd, sym: normalizeSymbol(rt0.sym) } : null
    };
    const rec = await rstore.get(RECORDS_KEY, { type: "json" }).catch(() => null) || { w: [], l: [], rt: [] };
    const tag = await walletTag(addr);
    let era = null, dirty = false;
    const hits = [];
    const categories = hasRoundtripEvidence ? ["w", "l", "rt"] : ["w", "l"];
    for (const cat of categories) {
      const c = cand[cat];
      let board = (rec[cat] || []).map((b) => Object.assign({}, b, { sym: normalizeSymbol(b.sym) }));
      const beats = (a, b) => cat === "l" ? a < b : a > b;
      const mine = tag ? board.findIndex((b) => b.h === tag) : -1;
      if (mine > -1) {
        board.splice(mine, 1);
        dirty = true;
      }
      rec[cat] = board;
      if (!c) continue;
      if (board.length >= 5 && !beats(c.v, board[4].v)) continue;
      if (era === null) era = await walletEra(addr);
      board.push({ v: c.v, sym: c.sym, era: era || void 0, h: tag || void 0, t: Date.now() });
      board.sort((a, b) => cat === "l" ? a.v - b.v : b.v - a.v);
      rec[cat] = board = board.slice(0, 5);
      dirty = true;
      const pos = board.findIndex((b) => b.v === c.v && b.sym === c.sym);
      if (pos > -1) hits.push({ cat, pos: pos + 1 });
    }
    if (dirty) await rstore.set(RECORDS_KEY, JSON.stringify(rec)).catch(() => {
    });
    return hits.length ? hits : null;
  } catch {
    return null;
  }
}

var usd = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
var signedUsd = (n) => (n < 0 ? "-" : "+") + usd(n);
// ── prices: DeFiLlama primary (on-chain DEX prices, best long-tail coverage,
// free & keyless), CoinGecko as automatic fallback. Avalanche C-Chain = "avax".
async function llamaPrice(contract) {
  const u = "https://coins.llama.fi/prices/current/avax:" + contract;
  try {
    let r = await fetch(u);
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1500)); r = await fetch(u); }
    if (!r.ok) return null;
    const j = await r.json();
    const coins = j && j.coins || {};
    const k = Object.keys(coins)[0];
    const c = k && coins[k];
    return c && c.price > 0 ? { cur: c.price, sym: normalizeSymbol(c.symbol, contract) } : null;
  } catch { return null; }
}
function llamaChartUrl(contract, fromTs) {
  // DeFiLlama caps /chart at 500 points — pick the FINEST period that fits firstTs→now
  // in ≤500 points (a >500-point request is rejected outright, killing the peak).
  const periods = [["1h", 3600e3], ["4h", 144e5], ["12h", 432e5], ["1d", 864e5], ["2d", 1728e5], ["3d", 2592e5], ["1w", 6048e5]];
  const range = Date.now() - fromTs;
  let sel = periods[periods.length - 1];
  for (const p of periods) { if (Math.ceil(range / p[1]) <= 500) { sel = p; break; } }
  const span = Math.min(500, Math.max(2, Math.ceil(range / sel[1])));
  return "https://coins.llama.fi/chart/avax:" + contract + "?start=" + Math.floor(fromTs / 1e3) + "&span=" + span + "&period=" + sel[0] + "&searchWidth=" + Math.round(sel[1] / 1e3);
}
async function llamaChart(contract, fromTs) {
  const u = llamaChartUrl(contract, fromTs);
  try {
    let r = await fetch(u);
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 1500)); r = await fetch(u); }
    if (!r.ok) return null;
    const j = await r.json();
    const coins = j && j.coins || {};
    const k = Object.keys(coins)[0];
    const arr = k && coins[k] && coins[k].prices || [];
    const out = arr.map((p) => [p.timestamp * 1e3, p.price]).filter((p) => p[1] > 0);
    return out.length ? out : null;
  } catch { return null; }
}
async function cgTokenCG(addr) {
  try {
    let r = await fetch("https://api.coingecko.com/api/v3/coins/avalanche/contract/" + addr);
    if (r.status === 429) { await new Promise((res) => setTimeout(res, 2200)); r = await fetch("https://api.coingecko.com/api/v3/coins/avalanche/contract/" + addr); }
    if (!r.ok) return null;
    const j = await r.json();
    const md = j && j.market_data;
    if (!md) return null;
    const ath = md.ath && md.ath.usd;
    const cur = md.current_price && md.current_price.usd;
    const athDate = md.ath_date && md.ath_date.usd ? Date.parse(md.ath_date.usd) : null;
    return ath && ath > 0 ? { ath, cur: cur || 0, athDate, sym: normalizeSymbol(j.symbol, addr), src: "cg" } : null;
  } catch { return null; }
}
async function cgChartCG(contract, fromTs) {
  const u = "https://api.coingecko.com/api/v3/coins/avalanche/contract/" + contract + "/market_chart/range?vs_currency=usd&from=" + Math.floor(fromTs / 1e3) + "&to=" + Math.floor(Date.now() / 1e3);
  try {
    let r = await fetch(u);
    for (let a = 0; a < 2 && r.status === 429; a++) { await new Promise((res) => setTimeout(res, 2200)); r = await fetch(u); }
    if (!r.ok) return null;
    const j = await r.json();
    const prices = j && j.prices || [];
    return prices.length ? prices : null;
  } catch { return null; }
}
async function cgToken(addr, store) {
  if (store) try {
    const c = await store.get("px/" + addr, { type: "json" });
    if (c && Date.now() - c.t < 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  // primary: DeFiLlama current price. ath is a conservative floor (=cur) — the real
  // peak comes from peakSince's price series; cg.ath only matters when peakSince is
  // null, and understating peak there is the safe direction (never fabricates an STE).
  let v = null;
  const dl = await llamaPrice(addr);
  if (dl && dl.cur > 0) v = { ath: dl.cur, cur: dl.cur, athDate: null, src: "llama" };
  else v = await cgTokenCG(addr);
  if (store && v) try {
    await store.set("px/" + addr, JSON.stringify({ t: Date.now(), v }));
  } catch {
  }
  return v;
}
async function fetchTransfers(addr, contract) {
  try {
    const r = await fetch(RS + "?module=account&action=tokentx&contractaddress=" + contract + "&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=10000&sort=asc" + RS_KEY);
    if (!r.ok) return null;
    const j = await r.json();
    if (!Array.isArray(j && j.result)) return null;
    if (j.result.length >= 10000) return null;
    if (!j.result.length) return null;
    return j.result;
  } catch {
    return null;
  }
}
function foldBag(rows, addr, athTs, athTs2) {
  if (!rows || !rows.length) return null;
  let bal = 0n, peakBeforeAth = 0n, peakEver = 0n, balAtAth = null, balAtAth2 = null, dec = null, firstTs = null, nearOut = 0n;
  const W = 7 * 864e5;
  for (const t of rows) {
    if (dec === null && t.tokenDecimal) dec = parseInt(t.tokenDecimal, 10);
    const ts = parseInt(t.timeStamp, 10) * 1e3;
    if (firstTs === null) firstTs = ts;
    if (athTs && balAtAth === null && ts > athTs) balAtAth = bal;
    if (athTs2 && balAtAth2 === null && ts > athTs2) balAtAth2 = bal;
    let v;
    try {
      v = BigInt(t.value || "0");
    } catch {
      continue;
    }
    if ((t.to || "").toLowerCase() === addr) bal += v;
    else if ((t.from || "").toLowerCase() === addr) {
      bal -= v;
      if (athTs && Math.abs(ts - athTs) <= W) nearOut += v;
    }
    if (bal > peakEver) peakEver = bal;
    if (athTs && ts <= athTs && bal > peakBeforeAth) peakBeforeAth = bal;
  }
  if (athTs && balAtAth === null) balAtAth = bal;
  if (athTs2 && balAtAth2 === null) balAtAth2 = bal;
  const d = dec === null || isNaN(dec) ? 18 : dec;
  const f = (x) => Number(x) / Math.pow(10, d);
  return { peakEver: f(peakEver), peakBeforeAth: f(peakBeforeAth), balAtAth: balAtAth === null ? null : f(balAtAth), balAtAth2: balAtAth2 === null ? null : f(balAtAth2), firstTs, nearOut: f(nearOut) };
}
async function replayBag(addr, contract, athTs, athTs2) {
  const rows = await fetchTransfers(addr, contract);
  return foldBag(rows, addr, athTs, athTs2);
}
async function peakSince(contract, fromTs, store) {
  const bucket = Math.floor(fromTs / (30 * 864e5));
  const ck = "peak3/" + contract + "/" + bucket;
  if (store) try {
    const c = await store.get(ck, { type: "json" });
    if (c && Date.now() - c.t < 7 * 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  try {
    let prices = await llamaChart(contract, fromTs);   // DeFiLlama series [[ms,price],…]
    let src = "llama";
    if (!prices) { prices = await cgChartCG(contract, fromTs); src = "cg"; }   // CoinGecko fallback
    if (!prices || !prices.length) return null;
    let maxP = 0, maxTs = null, maxI = 0;
    for (let i = 0; i < prices.length; i++) {
      if (prices[i][1] > maxP) {
        maxP = prices[i][1];
        maxTs = prices[i][0];
        maxI = i;
      }
    }
    let series = prices;
    if (prices.length > 500) {
      const stride = Math.ceil(prices.length / 500);
      series = prices.filter((_, i) => i % stride === 0 || i === maxI || i === prices.length - 1);
    }
    series = series.map((p) => [Math.round(p[0]), +p[1].toPrecision(6)]);
    const v = { price: maxP, ts: maxTs, series, src };
    if (store) try {
      await store.set(ck, JSON.stringify({ t: Date.now(), v }));
    } catch {
    }
    return v;
  } catch {
    return null;
  }
}
function peakBagOver(series, rows, addr) {
  if (!series || !series.length || !rows || !rows.length) return null;
  let dec = null;
  const evs = [];
  for (const t of rows) {
    if (dec === null && t.tokenDecimal) dec = parseInt(t.tokenDecimal, 10);
    let v;
    try {
      v = BigInt(t.value || "0");
    } catch {
      continue;
    }
    const ts = parseInt(t.timeStamp, 10) * 1e3;
    if ((t.to || "").toLowerCase() === addr) evs.push([ts, v]);
    else if ((t.from || "").toLowerCase() === addr) evs.push([ts, -v]);
  }
  const d = dec === null || isNaN(dec) ? 18 : dec;
  const div = Math.pow(10, d);
  let bal = 0n, i = 0, lastPrice = 0;
  let best = { usd: 0, ts: null, bal: 0 };
  const check = (ts) => {
    const usd = Number(bal) / div * lastPrice;
    if (usd > best.usd) best = { usd, ts, bal: Number(bal) / div };
  };
  for (const p of series) {
    while (i < evs.length && evs[i][0] <= p[0]) {
      bal += evs[i][1];
      if (lastPrice > 0) check(evs[i][0]);
      i++;
    }
    lastPrice = p[1];
    check(p[0]);
  }
  while (i < evs.length) {
    bal += evs[i][1];
    check(evs[i][0]);
    i++;
  }
  return best.ts ? best : null;
}
async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k]);
    }
  });
  await Promise.all(workers);
}
var INFRA_ADDR = { "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7": 1 };
var INFRA_SYM = { "WAVAX": 1, "AVAX": 1 };
var noStory = (r) => INFRA_ADDR[r.tokenAddress] || INFRA_SYM[r.sym] || STABLES[r.sym];
async function enrich(rows, balances, ADDR, store, diag, deadline, depth) {
  const flags = {};
  let complete = true;
  depth = depth || 15;
  const m = depth / 15;
  const overBudget = () => deadline && Date.now() > deadline;
  const gone = (r) => r.invested - (balances[r.tokenAddress] && balances[r.tokenAddress].usd || 0);
  const eligible = (r) => r.tokenAddress && !noStory(r) && (r.invested > 100 || r.sold > 50);
  const scanTotal = new Set(rows.filter(eligible).map((r) => r.tokenAddress)).size;
  const heldByInvested = rows.filter((r) => r.tokenAddress && !noStory(r) && r.invested > 100 && balances[r.tokenAddress] && balances[r.tokenAddress].tk > 0).sort((a, b) => gone(b) - gone(a)).slice(0, Math.ceil(6 * m));
  const byInvested = rows.filter((r) => r.tokenAddress && !noStory(r) && r.invested > 100).sort((a, b) => b.invested - a.invested).slice(0, Math.ceil(4 * m));
  const bySold = rows.filter((r) => r.tokenAddress && !noStory(r) && r.sold > 50).sort((a, b) => b.sold - a.sold).slice(0, Math.ceil(9 * m));
  const seen = {};
  const cands = [];
  const lanes = [heldByInvested, bySold, byInvested];
  for (let i = 0; cands.length < depth && lanes.some((l) => i < l.length); i++) {
    for (const l of lanes) {
      const c = l[i];
      if (c && !seen[c.tokenAddress] && cands.length < depth) {
        seen[c.tokenAddress] = 1;
        cands.push(c);
      }
    }
  }
  const rts = [], stes = [];
  const mergeFlags = (f2) => {
    for (const k in f2) if (!flags[k]) flags[k] = f2[k];
  };
  const applyOut = (o) => {
    mergeFlags(o.flags || {});
    if (o.rt) rts.push(o.rt);
    if (o.ste) stes.push(o.ste);
  };
  await pool(cands, 3, async (c) => {
    const d = { sym: c.sym, sold: Math.round(c.sold) };
    if (diag) diag.push(d);
    const ck = "cand/v4/" + ADDR + "/" + c.tokenAddress;
    if (store) try {
      const hit = await store.get(ck, { type: "json" });
      if (hit && Date.now() - hit.t < (hit.deg ? 10 * 60 * 1e3 : 7 * 24 * 3600 * 1e3)) {
        d.cached = true;
        applyOut(hit.o);
        return;
      }
    } catch {
    }
    if (overBudget()) {
      d.skip = "time budget";
      complete = false;
      return;
    }
    const out = { flags: {}, rt: null, ste: null };
    const done = async (deg) => {
      applyOut(out);
      if (store) try {
        await store.set(ck, JSON.stringify({ t: Date.now(), o: out, deg: !!deg }));
      } catch {
      }
    };
    const cg = await cgToken(c.tokenAddress, store);
    if (!cg) {
      d.skip = "no coingecko data";
      return done(true);
    }
    const heldTk = balances[c.tokenAddress] && balances[c.tokenAddress].tk || 0;
    const wantsSte = c.soldTk > 0 && c.sold > 50;
    if (heldTk <= 0 && !wantsSte) return done(false);
    const transfers = await fetchTransfers(ADDR, c.tokenAddress);
    const rp = foldBag(transfers, ADDR, null);
    if (!rp || !rp.firstTs) {
      d.skip = "replay failed";
      complete = false;
      return;
    }
    d.firstHeld = new Date(rp.firstTs).toISOString().slice(0, 10);
    if (overBudget()) {
      d.skip = "time budget";
      complete = false;
      return;
    }
    const pk = await peakSince(c.tokenAddress, rp.firstTs, store);
    const degraded = !pk || !pk.series;
    const peakPrice = pk ? pk.price : cg.ath;
    const peakTs = pk ? Math.max(pk.ts, rp.firstTs) : cg.athDate ? Math.max(cg.athDate, rp.firstTs) : null;
    d.peakSinceHeld = peakPrice;
    if (!peakTs) return done(degraded);
    const rp2 = foldBag(transfers, ADDR, peakTs, peakTs - 7 * 864e5);
    if (!rp2 || rp2.balAtAth === null) {
      d.skip = "replay failed";
      complete = false;
      return;
    }
    const balAtPeak = rp2.balAtAth;
    const truePk = pk && pk.series ? peakBagOver(pk.series, transfers, ADDR) : null;
    d.balAtPeak = balAtPeak;
    if (truePk) d.truePeakUsd = Math.round(truePk.usd);
    const avgSell = c.soldTk > 0 ? c.sold / c.soldTk : 0;
    if (heldTk > 0 && heldTk * peakPrice > 500 && cg.cur <= peakPrice * 0.1) {
      out.flags.captain = { sym: c.sym, downPct: Math.round((1 - cg.cur / peakPrice) * 100) };
    }
    if (c.invested > 100 && c.boughtTk > 0) {
      const avgBuy = c.invested / c.boughtTk;
      if (avgBuy >= peakPrice * 0.8 && avgBuy <= peakPrice * 1.5) {
        out.flags.boughtTop = { sym: c.sym };
      }
    }
    if (balAtPeak > 0 || truePk) {
      const pv = truePk ? truePk.usd : balAtPeak * peakPrice;
      for (const T of [1e4, 1e5, 1e6]) {
        if (pv >= T * 0.95 && pv < T) {
          out.flags.roundVictim = { sym: c.sym, peak: Math.round(pv), target: T };
          break;
        }
      }
    }
    if (rp2.balAtAth2 !== null && rp2.balAtAth2 > 0 && rp2.peakBeforeAth > 0 && rp2.balAtAth2 >= rp2.peakBeforeAth * 0.5 && balAtPeak < rp2.peakBeforeAth * 0.1 && rp2.balAtAth2 * peakPrice > 500) {
      out.flags.soldTop = { sym: c.sym };
    }
    const exitRatio = rp2.peakBeforeAth > 0 ? balAtPeak / rp2.peakBeforeAth : balAtPeak > 0 ? 1 : 0;
    d.exitRatio = +exitRatio.toFixed(3);
    if (wantsSte && rp2.peakBeforeAth > 0 && exitRatio < 0.2) {
      const exitedTk = rp2.peakBeforeAth - balAtPeak;
      const proceeds = exitedTk * avgSell;
      const athValue = exitedTk * peakPrice;
      d.proceeds = Math.round(proceeds);
      d.athValue = Math.round(athValue);
      const missed = athValue - proceeds;
      if (proceeds > 50 && athValue > 500 && (athValue > proceeds * 3 || missed > 25e3 && athValue > proceeds * 1.5)) {
        d.steQualified = true;
        if (athValue > proceeds * 5) out.flags.exitThere = { sym: c.sym, x: Math.round(athValue / Math.max(1, proceeds)) };
        out.ste = { missed: athValue - proceeds, missedUsd: Math.round(athValue - proceeds), sym: c.sym, line: "$" + c.sym, sub: "sold for ~" + usd(proceeds) + " \xB7 " + usd(athValue) + " at peak" };
      }
    } else if (balAtPeak > 0 || truePk && truePk.bal > 0) {
      const pBal = truePk ? truePk.bal : balAtPeak;
      const peakValue = truePk ? truePk.usd : balAtPeak * peakPrice;
      const heldPart = Math.min(heldTk, pBal);
      const soldAfter = Math.max(0, pBal - heldPart);
      const walked = soldAfter * avgSell + heldPart * cg.cur;
      const rt = peakValue - walked;
      d.peakValue = Math.round(peakValue);
      d.walked = Math.round(walked);
      if (peakValue > 500 && rt > 250 && rt / peakValue > 0.5) {
        d.rtQualified = true;
        out.rt = { rt, sym: c.sym, line: "-" + usd(rt), sub: "$" + c.sym + " \xB7 " + usd(peakValue) + " at peak \xB7 " + (soldAfter * avgSell > heldPart * cg.cur ? "walked with ~" + usd(walked) : usd(heldPart * cg.cur) + " now") };
      }
    }
    return done(degraded);
  });
  rts.sort((a, b) => b.rt - a.rt);
  stes.sort((a, b) => b.missed - a.missed);
  const clean = (arr) => arr.slice(0, 5).map((x) => ({ line: x.line, sub: x.sub, missedUsd: x.missedUsd, rtUsd: x.rt ? Math.round(x.rt) : void 0, sym: x.sym }));
  if (rts[0]) {
    const amt = rts[0].rt;
    flags.fullCircle = { amt: Math.round(amt), tier: amt >= 1e6 ? 3 : amt >= 1e5 ? 2 : amt >= 1e4 ? 1 : 0 };
    if (!flags.fullCircle.tier) delete flags.fullCircle;
  }
  return {
    flags,
    complete,
    scan: { depth: cands.length, total: scanTotal },
    roundtrip: rts[0] ? { line: rts[0].line, sub: rts[0].sub } : null,
    soldTooEarly: stes[0] ? { line: stes[0].line, sub: stes[0].sub } : null,
    roundtrips: clean(rts),
    soldEarly: clean(stes)
  };
}
var STABLES = { "USDT": 1, "USDC": 1, "DAI": 1, "BUSD": 1, "FRAX": 1, "MIM": 1, "TUSD": 1, "USDP": 1, "UST": 1, "USDD": 1, "EURC": 1, "AUSD": 1, "USD1": 1, "USDT.E": 1, "USDC.E": 1, "DAI.E": 1 };
function rowFlags(rows, balances) {
  const f = {};
  const n = rows.length;
  const wins = rows.filter((r) => r.profit > 0), losses = rows.filter((r) => r.profit < 0);
  const decided = wins.length + losses.length;
  const total = rows.reduce((s, r) => s + r.profit, 0);
  if (n >= 100) f.zoo = { n, tier: n >= 300 ? 2 : 1 };
  const sl = rows.filter((r) => STABLES[r.sym] && r.profit < 0).sort((a, b) => a.profit - b.profit)[0];
  if (sl) f.stableLoss = { sym: sl.sym, amt: Math.round(sl.profit) };
  if (total > 0 && n >= 20) f.netUp = { total: Math.round(total) };
  if (decided >= 20 && wins.length / decided > 0.6) f.sniper = { pct: Math.round(wins.length / decided * 100) };
  if (decided >= 20 && wins.length / decided < 0.3) f.exitLiq = { pct: Math.round(wins.length / decided * 100) };
  const c1 = rows.filter((r) => r.invested > 50 && r.profit / r.invested >= 10).sort((a, b) => b.profit / b.invested - a.profit / a.invested)[0];
  if (c1) f.caughtOne = { sym: c1.sym, x: Math.round(c1.profit / c1.invested) + 1 };
  const posSum = wins.reduce((s, r) => s + r.profit, 0);
  if (wins.length >= 3 && posSum > 1e3 && wins[0] && rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit)[0].profit / posSum > 0.9) {
    const top = rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit)[0];
    f.oneTrick = { sym: top.sym, pct: Math.round(top.profit / posSum * 100) };
  }
  const bench = rows.filter((r) => r.profit > 1e3);
  if (bench.length >= 5) f.deepBench = { n: bench.length };
  if (rows.some((r) => r.sym === "TIME")) f.wonderland = true;
  if (rows.some((r) => r.sym === "COQ")) f.coqVet = true;
  if (rows.some((r) => r.sym === "ARENA")) f.arenaTraded = true;
  const grave = Object.values(balances).filter((b) => b.usd > 0 && b.usd < 1).length;
  if (grave >= 10) f.graveyard = { n: grave };
  return f;
}
function summarize(rows, incomplete, aggregate) {
  const base = { tokens: incomplete ? rows.length + "+" : rows.length, biggestW: null, biggestL: null, topW: [], topL: [], summary: null };
  const wins = rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit);
  const losses = rows.filter((r) => r.profit < 0).sort((a, b) => a.profit - b.profit);
  const rowTotal = rows.reduce((s, r) => s + r.profit, 0);
  const total = aggregate && Number.isFinite(aggregate.realizedGain) ? aggregate.realizedGain : rowTotal;
  const decided = wins.length + losses.length;
  base.biggestW = wins[0] ? { line: signedUsd(wins[0].profit), sub: "$" + wins[0].sym, usd: Math.round(wins[0].profit), sym: wins[0].sym } : null;
  base.biggestL = losses[0] ? { line: signedUsd(losses[0].profit), sub: "$" + losses[0].sym, usd: Math.round(losses[0].profit), sym: losses[0].sym } : null;
  base.topW = wins.slice(0, 5).map((r) => ({ line: signedUsd(r.profit), sub: "$" + r.sym, usd: Math.round(r.profit), sym: r.sym }));
  base.topL = losses.slice(0, 5).map((r) => ({ line: signedUsd(r.profit), sub: "$" + r.sym, usd: Math.round(r.profit), sym: r.sym }));
  base.summary = {
    total: signedUsd(total),
    winrate: decided >= 3 ? Math.round(wins.length / decided * 100) + "%" : null,
    wins: wins.length,
    losses: losses.length
  };
  if (aggregate && Number.isFinite(aggregate.unrealizedGain)) base.summary.unrealized = signedUsd(aggregate.unrealizedGain);
  if (aggregate && Number.isFinite(aggregate.totalFee)) base.summary.fees = usd(aggregate.totalFee);
  if (aggregate && Number.isFinite(aggregate.totalGain)) base.summary.totalGain = signedUsd(aggregate.totalGain);
  if (aggregate && aggregate.accountingMethod) base.summary.accountingMethod = aggregate.accountingMethod;
  base.thin = decided < 3;
  return base;
}
var pnl_default = async (req) => {
  const url = new URL(req.url);
  if (url.searchParams.get("backfill") === "records") {
    if (!isAdmin(req)) return NOPE();
    const pstore = getStore("pnl");
    const rstore = getStore("records");
    const state = await rstore.get("bf25-cursor", { type: "json" }).catch(() => null);
    if (state === "done") return new Response(JSON.stringify({ done: true, note: "full-history backfill already complete" }), { headers: HEADERS });
    const t0 = Date.now();
    let scanned = 0, hits = 0, cur = state && state.c || void 0, timedOut = false;
    const best = /* @__PURE__ */ new Map();
    outer: do {
      const page = await pstore.list({ prefix: "v25/", cursor: cur });
      for (const b of page.blobs || []) {
        if (Date.now() - t0 > 3e3) {
          timedOut = true;
          break outer;
        }
        const m = /^v25\/(0x[0-9a-f]{40})$/.exec(b.key);
        if (!m) continue;
        const a2 = m[1];
        const cached = await pstore.get(b.key, { type: "json" }).catch(() => null);
        if (!cached || !cached.stats || cached.stats.quality?.aggregateAuthoritative !== true ||
            cached.stats.quality?.ledgerComplete !== true || cached.stats.quality?.metadataComplete !== true) continue;
        scanned++;
        const e = best.get(a2) || {};
        for (const r of cached.rowsIdx || []) {
          if (r.p >= 1e3 && (!e.w || r.p > e.w.v)) e.w = { v: r.p, sym: r.s };
          if (r.p <= -1e3 && (!e.l || r.p < e.l.v)) e.l = { v: r.p, sym: r.s };
        }
        const rt0 = (cached.stats.roundtrips || [])[0];
        if (rt0 && rt0.rtUsd >= 1e3 && (!e.rt || rt0.rtUsd > e.rt.v)) e.rt = { v: rt0.rtUsd, sym: rt0.sym };
        if (e.w || e.l || e.rt) best.set(a2, e);
      }
      cur = page.cursor;
    } while (cur);
    const boards = { w: [], l: [], rt: [] };
    for (const [a2, e] of best) {
      for (const cat of ["w", "l", "rt"]) {
        if (!e[cat]) continue;
        boards[cat].push({ v: e[cat].v, a2 });
        boards[cat].sort((x, y) => cat === "l" ? x.v - y.v : y.v - x.v);
        if (boards[cat].length > 6) boards[cat].pop();
      }
    }
    const uniq = /* @__PURE__ */ new Set();
    for (const cat of ["w", "l", "rt"]) boards[cat].forEach((x) => uniq.add(x.a2));
    for (const a2 of uniq) {
      const e = best.get(a2);
      const rows = [];
      if (e.w) rows.push({ profit: e.w.v, sym: e.w.sym });
      if (e.l) rows.push({ profit: e.l.v, sym: e.l.sym });
      const hit = await updateRecords(a2, rows, { roundtrips: e.rt ? [{ rtUsd: e.rt.v, sym: e.rt.sym }] : [] });
      if (hit) hits++;
    }
    if (timedOut) await rstore.set("bf25-cursor", JSON.stringify({ c: cur || null })).catch(() => {
    });
    else await rstore.set("bf25-cursor", JSON.stringify("done")).catch(() => {
    });
    return new Response(JSON.stringify({ done: !timedOut, scanned, candidates: uniq.size, boardHits: hits }), { headers: HEADERS });
  }
  if (url.searchParams.get("backfill") === "claimed") {
    if (!isAdmin(req)) return NOPE();
    try {
      const cstore = getStore("claim");
      const addrs = [];
      let cur = void 0;
      do {
        const page = await cstore.list({ prefix: "c/", cursor: cur });
        for (const b of page.blobs || []) {
          const a2 = b.key.slice(2);
          if (/^0x[0-9a-f]{40}$/.test(a2)) addrs.push(a2);
        }
        cur = page.cursor;
      } while (cur && addrs.length < 2e3);
      return new Response(JSON.stringify({ addrs }), { headers: HEADERS });
    } catch {
      return new Response(JSON.stringify({ addrs: [] }), { headers: HEADERS });
    }
  }
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return new Response(JSON.stringify({ available: false, error: "bad address" }), { status: 400, headers: HEADERS });
  }
  const moralisKey = process.env.MORALIS_KEY;
  const zerionKey = process.env.ZERION_API_KEY || process.env.ZERION_KEY;
  let store = null;
  let leaseStore = null;
  try {
    store = getStore("pnl");
    leaseStore = getStore({ name: "pnl", consistency: "strong" });
  } catch {
  }
  const cacheKey = "v25/" + addr;
  const deadline = Date.now() + 6500;
  const debug = url.searchParams.get("debug") === "1";
  if (debug && !isAdmin(req)) return NOPE();
  const deeper = url.searchParams.get("deeper") === "1";
  if (deeper) return NOPE();
  const refresh = url.searchParams.get("refresh") === "1";
  let depth = 15;
  if (store) try {
    const dj = await store.get("depth/" + addr, { type: "json" });
    if (dj && dj.d) depth = dj.d;
  } catch {
  }
  let cached = null;
  if (store && !debug) try {
    cached = await store.get(cacheKey, { type: "json" });
    if (cached) {
      const retryablePartial = !!(cached.stats && cached.stats.partial && cached.stats.quality && cached.stats.quality.retryable);
      const ttl = retryablePartial ? RETRY_CACHE_MS : CACHE_MS;
      const fresh = Date.now() - cached.t < ttl;
      if (fresh || (!fresh && !refresh && !retryablePartial)) {
        return new Response(JSON.stringify({ available: true, stats: cached.stats, cached: true, stale: !fresh }), { headers: HEADERS });
      }
    }
  } catch {
    cached = null;
  }
  if (!moralisKey && !zerionKey) {
    if (cached && cached.stats) return new Response(JSON.stringify({ available: true, stats: cached.stats, cached: true, stale: true }), { headers: HEADERS });
    return new Response(JSON.stringify({ available: false, error: "provider unavailable" }), { status: 503, headers: HEADERS });
  }
  const workKey = "work/v25/" + addr;
  if (leaseStore && !debug) {
    const lease = await leaseStore.get(workKey, { type: "json" }).catch(() => null);
    if (lease && Number.isFinite(lease.t) && Date.now() - lease.t < WORK_LEASE_MS) {
      if (cached && cached.stats) {
        return new Response(JSON.stringify({ available: true, stats: cached.stats, cached: true, stale: true, refreshPending: true }), { headers: HEADERS });
      }
      return new Response(JSON.stringify({ available: false, pending: true, retryAfter: 3 }), {
        status: 202,
        headers: Object.assign({}, HEADERS, { "retry-after": "3" })
      });
    }
    await leaseStore.set(workKey, JSON.stringify({ t: Date.now() })).catch(() => {});
  }
  try {
    const diag = debug ? [] : null;
    const source = await fetchPnlData({ addr, zerionKey, moralisKey, store, deadline });
    const usedFallback = source.quality.fallbackFrom === "zerion";
    if (usedFallback && cached?.stats?.quality?.aggregateAuthoritative === true) {
      return new Response(JSON.stringify({
        available: true,
        stats: cached.stats,
        cached: true,
        stale: true,
        refreshFailed: true,
        fallbackPending: true
      }), { headers: HEADERS });
    }
    const rows = source.rows;
    const balances = source.balances || {};
    if (diag) diag.push({ rowsAfterFilters: rows.length, rows: rows.slice(0, 30).map((r) => ({ sym: r.sym, profit: Math.round(r.profit), invested: Math.round(r.invested), sold: Math.round(r.sold) })) });
    const stats = summarize(rows, !source.complete, source.aggregate);
    const extra = source.complete && source.quality.balancesComplete
      ? await enrich(rows, balances, addr, store, diag, deadline, depth)
      : { flags: {}, complete: true, roundtrip: null, soldTooEarly: null };
    stats.flags = source.complete ? Object.assign(rowFlags(rows, balances), extra.flags || {}) : {};
    const excluded = source.quality.coverage && source.quality.coverage.excludedAssets || {};
    const excludedAssets = (excluded.fungibleIds || []).length + (excluded.fungibleImplementations || []).length;
    const stopReason = source.quality.coverage && source.quality.coverage.stopReason;
    const balanceStopReason = source.quality.coverage && source.quality.coverage.balanceStopReason;
    const transientReasons = ["deadline", "deadline_exceeded", "network_error", "upstream_http", "fetch_error", "schema_error", "cursor_loop"];
    const transientWarning = (source.quality.warnings || []).some((warning) => transientReasons.some((reason) => String(warning).includes(reason)));
    const providerRetryable = usedFallback || transientReasons.includes(stopReason) || transientReasons.includes(balanceStopReason) || transientWarning;
    stats.quality = {
      provider: source.provider,
      accountingMethod: source.quality.accountingMethod,
      aggregateAuthoritative: source.quality.aggregateAuthoritative === true,
      ledgerComplete: !!source.complete,
      balancesComplete: !!source.quality.balancesComplete,
      metadataComplete: !!source.quality.metadataComplete,
      excludedAssets,
      fallbackFrom: source.quality.fallbackFrom || null,
      warnings: source.quality.warnings || [],
      retryable: providerRetryable || extra.complete === false
    };
    if (usedFallback || !source.complete || !source.quality.balancesComplete || !source.quality.metadataComplete || extra.complete === false) stats.partial = true;
    if (extra.scan) stats.scan = extra.scan;
    stats.roundtrip = extra.roundtrip;
    stats.soldTooEarly = extra.soldTooEarly;
    stats.roundtrips = extra.roundtrips || [];
    stats.soldEarly = extra.soldEarly || [];
    const recordSafe = source.complete && source.quality.aggregateAuthoritative === true && source.quality.metadataComplete && extra.complete !== false;
    stats.records = recordSafe ? await updateRecords(addr, rows, extra) : null;
    const rowsIdx = rows.map((r) => ({ s: r.sym, a: r.tokenAddress, p: r.profit, i: r.invested, so: r.sold, bt: r.boughtTk, st: r.soldTk }));
    if (store && !debug) await store.set(cacheKey, JSON.stringify({ t: Date.now(), provider: source.provider, stats, rowsIdx })).catch(() => {
    });
    const out = { available: true, stats };
    if (debug) out.diag = diag;
    return new Response(JSON.stringify(out), { headers: HEADERS });
  } catch (e) {
    if (cached && cached.stats) {
      return new Response(JSON.stringify({ available: true, stats: cached.stats, cached: true, stale: true, refreshFailed: true }), { headers: HEADERS });
    }
    if (e instanceof PnlProviderError && e.code === "bootstrapping") {
      return new Response(JSON.stringify({ available: false, pending: true, retryAfter: e.retryAfter || 5 }), {
        status: 202,
        headers: Object.assign({}, HEADERS, { "retry-after": String(e.retryAfter || 5) })
      });
    }
    const code = e instanceof PnlProviderError ? e.code : "compute_failed";
    return new Response(JSON.stringify({ available: false, error: code }), { status: 503, headers: HEADERS });
  } finally {
    if (leaseStore && !debug && typeof leaseStore.delete === "function") await leaseStore.delete(workKey).catch(() => {});
  }
};
var config = { path: "/api/pnl" };
export {
  config,
  pnl_default as default
};
