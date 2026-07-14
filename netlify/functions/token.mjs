import { getStore } from "@netlify/blobs";
import { normalizeSymbol } from "./lib/pnl-provider.mjs";
import {
  fetchErc20Balance,
  fetchRoutescanRows,
  foldTokenTransfers,
  registeredContractsForQuery,
  registeredToken,
  tokenSymbol
} from "./lib/token-history.mjs";

// src/token.js
var mems = {};
var _mem = mems;
function storeOr(name, opts) {
  try {
    const s = getStore(opts ? Object.assign({ name }, opts) : name);
    if (s) return s;
  } catch {
  }
  if (process.env.NETLIFY || process.env.URL) return null;
  if (!mems[name]) mems[name] = /* @__PURE__ */ new Map();
  const m = mems[name];
  return {
    get: async (k, o) => {
      const v = m.get(k);
      return v === void 0 ? null : o && o.type === "json" ? JSON.parse(v) : v;
    },
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    }
  };
}
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var PNL_CACHE_VERSION = 25;
var pnlCacheKey = (addr) => "v" + PNL_CACHE_VERSION + "/" + addr;
var TOKEN_CACHE_VERSION = 9;
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";

// DeFiLlama is the keyless primary for long-tail prices; CoinGecko is fallback.
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
  // DeFiLlama rejects /chart requests above 500 points. Pick the finest period
  // that covers first-held through now without exceeding that limit.
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
  let v = null;
  const dl = await llamaPrice(addr);
  if (dl && dl.cur > 0) v = { ath: dl.cur, cur: dl.cur, athDate: null, sym: dl.sym, src: "llama" };
  else v = await cgTokenCG(addr);
  if (store && v) try {
    await store.set("px/" + addr, JSON.stringify({ t: Date.now(), v }));
  } catch {
  }
  return v;
}
async function peakSince(contract, fromTs, store) {
  const bucket = Math.floor(fromTs / (30 * 864e5));
  const ck = "peak4/" + contract + "/" + bucket;
  if (store) try {
    const c = await store.get(ck, { type: "json" });
    if (c && Date.now() - c.t < 7 * 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  try {
    let prices = await llamaChart(contract, fromTs);
    let src = "llama";
    if (!prices) { prices = await cgChartCG(contract, fromTs); src = "cg"; }
    if (!prices || !prices.length) return null;
    let maxP = 0, maxTs = null, maxI = 0;
    for (let i = 0; i < prices.length; i++) {
      if (prices[i][1] > maxP) { maxP = prices[i][1]; maxTs = prices[i][0]; maxI = i; }
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
    try { v = BigInt(t.value || "0"); } catch { continue; }
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
  while (i < evs.length) { bal += evs[i][1]; check(evs[i][0]); i++; }
  return best.ts ? best : null;
}
async function fetchTokenTx(addr, contract) {
  return fetchRoutescanRows({
    address: addr,
    contract,
    routescanBase: RS,
    routescanKey: process.env.ROUTESCAN_KEY || ""
  });
}
function foldTok(rows, addr, refTs) {
  return foldTokenTransfers(rows, addr, refTs);
}
function usdAtArrival(evs, series) {
  if (!evs || !evs.length || !series || !series.length) return null;
  const sorted = evs.slice().sort((a, b) => a[0] - b[0]);
  let i = 0, last = series[0][1], sum = 0;
  for (const [ts, amt] of sorted) {
    while (i < series.length && series[i][0] <= ts) { last = series[i][1]; i++; }
    sum += amt * last;
  }
  return sum;
}
function classifyTargetFlows(rows, addr) {
  const out = { inSwap: 0, outSwap: 0, inXfer: 0, outXfer: 0, xferInEvs: [] };
  const swapish = (value) => /swap|execute\(bytes|^exec\(|strictlySwap/i.test(value || "");
  for (const row of rows || []) {
    const decimals = Number.parseInt(row.tokenDecimal || "18", 10);
    const amount = Number(row.value || "0") / 10 ** (Number.isFinite(decimals) ? decimals : 18);
    const inbound = String(row.to || "").toLowerCase() === addr;
    const outbound = String(row.from || "").toLowerCase() === addr;
    if (!inbound && !outbound) continue;
    if (swapish(row.functionName)) {
      if (inbound) out.inSwap += amount;
      else out.outSwap += amount;
    } else if (inbound) {
      out.inXfer += amount;
      out.xferInEvs.push([Number.parseInt(row.timeStamp, 10) * 1000, amount]);
    } else {
      out.outXfer += amount;
    }
  }
  return out;
}

var token_default = async (req) => {
  const url = new URL(req.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim();
  if (!/^0x[0-9a-f]{40}$/.test(addr) || !q) {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: HEADERS });
  }
  const claimStore = storeOr("claim");
  const claimed = claimStore ? !!await claimStore.get("c/" + addr, { type: "json" }).catch(() => null) : false;
  if (!claimed) return new Response(JSON.stringify({ locked: true }), { status: 403, headers: HEADERS });

  const store = storeOr("pnl");
  let rowsIdx = [];
  if (store) try {
    const cached = await store.get(pnlCacheKey(addr), { type: "json" });
    if (cached && cached.rowsIdx) rowsIdx = cached.rowsIdx;
  } catch {
  }

  const addressQuery = /^0x[0-9a-f]{40}$/i.test(q);
  const registeredMatches = addressQuery ? [] : registeredContractsForQuery(q);
  if (!rowsIdx.length) {
    const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
    try { await fetch(site + "/api/pnl?addr=" + addr); } catch {
    }
    if (store) try {
      const cached = await store.get(pnlCacheKey(addr), { type: "json" });
      if (cached && cached.rowsIdx) rowsIdx = cached.rowsIdx;
    } catch {
    }
  }

  let contract = null;
  let row = null;
  if (addressQuery) {
    contract = q.toLowerCase();
    row = rowsIdx.find((candidate) => candidate.a === contract) || null;
  } else {
    const symbol = normalizeSymbol(q, null);
    const byAddress = new Map();
    for (const match of rowsIdx.filter((candidate) => normalizeSymbol(candidate.s, candidate.a) === symbol)) byAddress.set(match.a, match);
    for (const knownContract of registeredMatches) if (!byAddress.has(knownContract)) byAddress.set(knownContract, null);
    const matches = [...byAddress.entries()];
    if (matches.length > 1) {
      return new Response(JSON.stringify({ ambiguous: matches.map(([candidateContract, candidateRow]) => ({
        sym: candidateRow && normalizeSymbol(candidateRow.s, candidateContract) || registeredToken(candidateContract).symbol,
        contract: candidateContract
      })) }), { headers: HEADERS });
    }
    if (matches.length === 1) { contract = matches[0][0]; row = matches[0][1]; }
  }
  if (!contract) return new Response(JSON.stringify({ none: true, q }), { headers: HEADERS });

  const dossierKey = "tok" + TOKEN_CACHE_VERSION + "/" + addr + "/" + contract;
  if (store) try {
    const cached = await store.get(dossierKey, { type: "json" });
    if (cached) {
      const ttl = cached.deg ? 10 * 60 * 1e3 : 7 * 24 * 3600 * 1e3;
      if (Date.now() - cached.t < ttl) return new Response(JSON.stringify(cached.d), { headers: HEADERS });
    }
  } catch {
  }

  const workKey = "work/tok" + TOKEN_CACHE_VERSION + "/" + addr;
  const workStore = storeOr("pnl", { consistency: "strong" }) || store;
  if (workStore) {
    const lease = await workStore.get(workKey, { type: "json" }).catch(() => null);
    if (lease && Number.isFinite(lease.t) && Date.now() - lease.t < 30000) {
      return new Response(JSON.stringify({ pending: true, retryAfter: 3 }), {
        status: 202,
        headers: Object.assign({}, HEADERS, { "retry-after": "3" })
      });
    }
    await workStore.set(workKey, JSON.stringify({ t: Date.now() })).catch(() => {});
  }

  try {
    const history = await fetchTokenTx(addr, contract);
    if (!history.complete) {
      return new Response(JSON.stringify({ incomplete: true, q, error: "token history is temporarily incomplete", reason: history.reason }), { status: 503, headers: HEADERS });
    }
    const targetRows = history.rows;
    const rp = foldTok(targetRows, addr, null);
    if (!rp) return new Response(JSON.stringify({ none: true, q }), { headers: HEADERS });

    const flow = classifyTargetFlows(targetRows, addr);
    const [cg, directBalance] = await Promise.all([
      cgToken(contract, store),
      fetchErc20Balance({ address: addr, contract, decimals: rp.decimals })
    ]);
    const currentBalance = directBalance === null ? Math.max(0, rp.balNow) : directBalance;
    const currentUsd = cg && cg.cur ? currentBalance * cg.cur : null;
    const meaningfulHolding = currentBalance > 0 && (currentUsd === null || currentUsd >= 1);
    const dust = currentBalance > 0 && currentUsd !== null && currentUsd < 1;

    const pk = cg ? await peakSince(contract, rp.firstTs, store) : null;
    const truePk = pk && pk.series ? peakBagOver(pk.series, targetRows, addr) : null;
    const peakPrice = pk ? pk.price : cg ? cg.ath : null;
    const peakTs0 = pk ? pk.ts : cg ? cg.athDate : null;
    const peakTs = peakTs0 ? Math.max(peakTs0, rp.firstTs) : null;
    let verdict = null;
    if (peakTs) {
      const atPeak = foldTok(targetRows, addr, peakTs);
      if (atPeak && atPeak.balAtRef !== null && rp.peakBag > 0) {
        const ratio = atPeak.balAtRef / rp.peakBag;
        if (meaningfulHolding && ratio >= 0.5) verdict = "still aboard";
        else if (ratio >= 0.5) verdict = "rode it down, then sold";
        else verdict = "sold before the top";
      }
    }

    const recvUsd = flow.xferInEvs.length && pk && pk.series ? usdAtArrival(flow.xferInEvs, pk.series) : null;
    const hasPnl = !!(row && Number.isFinite(row.p) && Number.isFinite(row.i) && Number.isFinite(row.so));
    const sym = normalizeSymbol(tokenSymbol({ row, transfers: targetRows, contract, priceSymbol: cg && cg.sym, query: q }), contract);
    const d = {
      sym,
      contract,
      realized: hasPnl ? row.p : null,
      invested: hasPnl ? row.i : null,
      soldUsd: hasPnl ? row.so : null,
      pnlUnavailable: hasPnl ? null : "this token's routed swaps are not covered by the wallet P&L provider",
      airdropRealized: null,
      synth: false,
      synthPartial: false,
      firstHeld: new Date(rp.firstTs).toISOString().slice(0, 10),
      lastActivity: new Date(rp.lastTs).toISOString().slice(0, 10),
      transfers: rp.transfers,
      peakBagTk: rp.peakBag,
      peakBagUsd: truePk ? Math.round(truePk.usd) : peakPrice ? Math.round(rp.peakBag * peakPrice) : null,
      peakDate: truePk ? new Date(truePk.ts).toISOString().slice(0, 10) : peakTs ? new Date(peakTs).toISOString().slice(0, 10) : null,
      holdingNow: meaningfulHolding,
      holdingDust: dust,
      holdingTk: currentBalance,
      holdingUsd: currentUsd,
      priceSrc: cg ? cg.src || "cg" : null,
      peakSrc: pk ? pk.src || "cg" : null,
      verdict,
      updated: null,
      lp: null,
      recvTk: flow.inXfer > 0 ? Math.round(flow.inXfer) : null,
      recvUsd: recvUsd ? Math.round(recvUsd) : null,
      truncated: false
    };
    const degraded = !pk || !pk.series || directBalance === null;
    if (store) try {
      await store.set(dossierKey, JSON.stringify({ t: Date.now(), d, deg: degraded }));
    } catch {
    }
    return new Response(JSON.stringify(d), { headers: HEADERS });
  } finally {
    if (workStore && typeof workStore.delete === "function") await workStore.delete(workKey).catch(() => {});
  }
};
var config = { path: "/api/token" };
export {
  _mem,
  config,
  token_default as default
};
