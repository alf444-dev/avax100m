import { getStore } from "@netlify/blobs";
import { normalizeSymbol } from "./lib/pnl-provider.mjs";

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
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var RS_KEY = process.env.ROUTESCAN_KEY ? "&apikey=" + process.env.ROUTESCAN_KEY : "";
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
    const cgSym = normalizeSymbol(j.symbol, addr);
    return ath && ath > 0 ? { ath, cur: cur || 0, athDate, sym: cgSym, src: "cg" } : null;
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
  // primary: DeFiLlama current price (+ symbol). ath is a conservative floor (=cur);
  // the real peak comes from peakSince's series (cg.ath only used when that is null).
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
async function fetchTokenTx(addr, contract) {
  try {
    const r = await fetch(RS + "?module=account&action=tokentx&contractaddress=" + contract + "&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=10000&sort=asc" + RS_KEY);
    if (!r.ok) return { rows: [], complete: false, reason: "http_error" };
    const j = await r.json();
    if (!Array.isArray(j && j.result)) return { rows: [], complete: false, reason: "schema_error" };
    if (j.result.length >= 10000) return { rows: j.result, complete: false, reason: "row_limit" };
    return { rows: j.result, complete: true, reason: null };
  } catch {
    return { rows: [], complete: false, reason: "fetch_error" };
  }
}
async function fetchWalletTx(addr) {
  try {
    const r = await fetch(RS + "?module=account&action=tokentx&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=10000&sort=asc" + RS_KEY);
    if (!r.ok) return { rows: [], complete: false, reason: "http_error" };
    const j = await r.json();
    if (!Array.isArray(j && j.result)) return { rows: [], complete: false, reason: "schema_error" };
    if (j.result.length >= 10000) return { rows: j.result, complete: false, reason: "row_limit" };
    return { rows: j.result, complete: true, reason: null };
  } catch {
    return { rows: [], complete: false, reason: "fetch_error" };
  }
}
function foldTok(rows, addr, refTs) {
  if (!rows || !rows.length) return null;
  let bal = 0n, peakBag = 0n, peakBeforeRef = 0n, balAtRef = null, dec = null, firstTs = null, lastTs = null, transfers = 0;
  for (const t of rows) {
    if (dec === null && t.tokenDecimal) dec = parseInt(t.tokenDecimal, 10);
    const ts = parseInt(t.timeStamp, 10) * 1e3;
    if (firstTs === null) firstTs = ts;
    lastTs = ts;
    if (refTs && balAtRef === null && ts > refTs) balAtRef = bal;
    let v;
    try {
      v = BigInt(t.value || "0");
    } catch {
      continue;
    }
    if ((t.to || "").toLowerCase() === addr) bal += v;
    else if ((t.from || "").toLowerCase() === addr) bal -= v;
    if (bal > peakBag) peakBag = bal;
    if (refTs && ts <= refTs && bal > peakBeforeRef) peakBeforeRef = bal;
    transfers++;
  }
  if (refTs && balAtRef === null) balAtRef = bal;
  const d = dec === null || isNaN(dec) ? 18 : dec;
  const f = (x) => Number(x) / Math.pow(10, d);
  return { firstTs, lastTs, transfers, peakBag: f(peakBag), peakBeforeRef: f(peakBeforeRef), balNow: f(bal), balAtRef: balAtRef === null ? null : f(balAtRef) };
}
var WAVAX_C = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";
var AIRDROP_META = {
  "0xffff003a6bad9b743d658048742935fffe2b6ed7": "KET",
  "0x7698a5311da174a95253ce86c21ca7272b9b05f8": "WINK",
  "0x0f669808d88b2b0b3d23214dcd2a1cc6a8b1b5cd": "BLUB"
};
var STABLE_SYMS = { "USDT": 1, "USDC": 1, "DAI": 1, "MIM": 1, "FRAX": 1, "USDT.E": 1, "USDC.E": 1, "DAI.E": 1, "BUSD": 1, "TUSD": 1 };
async function avaxSeries(store) {
  const ck = "avaxusd/v1";
  if (store) try {
    const c = await store.get(ck, { type: "json" });
    if (c && Date.now() - c.t < 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  try {
    const u = "https://api.coingecko.com/api/v3/coins/avalanche-2/market_chart/range?vs_currency=usd&from=1600000000&to=" + Math.floor(Date.now() / 1e3);
    let r = await fetch(u);
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 2200));
      r = await fetch(u);
    }
    if (!r.ok) return null;
    const j = await r.json();
    let prices = j && j.prices || [];
    if (!prices.length) return null;
    if (prices.length > 500) {
      const stride = Math.ceil(prices.length / 500);
      prices = prices.filter((_, i) => i % stride === 0 || i === prices.length - 1);
    }
    const v = prices.map((p) => [Math.round(p[0]), +p[1].toPrecision(6)]);
    if (store) try {
      await store.set(ck, JSON.stringify({ t: Date.now(), v }));
    } catch {
    }
    return v;
  } catch {
    return null;
  }
}
function usdAtArrival(evs, series) {
  if (!evs || !evs.length || !series || !series.length) return null;
  const sorted = evs.slice().sort((a, b) => a[0] - b[0]);
  let i = 0, last = series[0][1], sum = 0;
  for (const [ts, amt] of sorted) {
    while (i < series.length && series[i][0] <= ts) {
      last = series[i][1];
      i++;
    }
    sum += amt * last;
  }
  return sum;
}
function classifyLp(all, targetRows, contract, addr) {
  const map = {};
  for (const x of all) (map[x.hash] = map[x.hash] || []).push(x);
  const isLpSym = (sy) => /^(JLP|PGL|ULP)$|(^|[^A-Z])LP([^A-Z]|$)/i.test(sy || "");
  const inCp = {}, outCp = {};
  for (const x of targetRows) {
    if ((x.to || "").toLowerCase() === addr) inCp[(x.from || "").toLowerCase()] = 1;
    else if ((x.from || "").toLowerCase() === addr) outCp[(x.to || "").toLowerCase()] = 1;
  }
  let dec = null;
  const out = { adds: 0, removes: 0, inSwap: 0, inXfer: 0, inLp: 0, outSwap: 0, outXfer: 0, outLp: 0, xferInEvs: [], putWavax: [], gotWavax: [], putStable: 0, gotStable: 0, buyWavax: [], sellWavax: [], buyStable: 0, sellStable: 0, unpricedSwapTk: 0 };
  const swapLegs = (sibs, ts, buying) => {
    let found = false;
    for (const y of sibs) {
      const ca = (y.contractAddress || "").toLowerCase();
      const sy = (y.tokenSymbol || "").toUpperCase();
      const ydec = parseInt(y.tokenDecimal || "18", 10);
      const yamt = Number(y.value || "0") / Math.pow(10, isNaN(ydec) ? 18 : ydec);
      const userLeg = buying ? (y.from || "").toLowerCase() === addr : (y.to || "").toLowerCase() === addr;
      if (!userLeg) continue;
      if (ca === WAVAX_C) {
        (buying ? out.buyWavax : out.sellWavax).push([ts, yamt]);
        found = true;
      } else if (STABLE_SYMS[sy]) {
        if (buying) out.buyStable += yamt;
        else out.sellStable += yamt;
        found = true;
      }
    }
    return found;
  };
  const moneyLegs = (sibs, ts) => {
    for (const y of sibs) {
      const ca = (y.contractAddress || "").toLowerCase();
      const sy = (y.tokenSymbol || "").toUpperCase();
      const ydec = parseInt(y.tokenDecimal || "18", 10);
      const yamt = Number(y.value || "0") / Math.pow(10, isNaN(ydec) ? 18 : ydec);
      const yIn = (y.to || "").toLowerCase() === addr;
      const yOut = (y.from || "").toLowerCase() === addr;
      if (ca === WAVAX_C) {
        if (yOut) out.putWavax.push([ts, yamt]);
        else if (yIn) out.gotWavax.push([ts, yamt]);
      } else if (STABLE_SYMS[sy]) {
        if (yOut) out.putStable += yamt;
        else if (yIn) out.gotStable += yamt;
      }
    }
  };
  for (const x of targetRows) {
    if (dec === null && x.tokenDecimal) dec = parseInt(x.tokenDecimal, 10);
    const amt = Number(x.value || "0") / Math.pow(10, dec === null || isNaN(dec) ? 18 : dec);
    const sibs = (map[x.hash] || []).filter((y) => (y.contractAddress || "").toLowerCase() !== contract);
    const inbound = (x.to || "").toLowerCase() === addr;
    const cp = inbound ? (x.from || "").toLowerCase() : (x.to || "").toLowerCase();
    const poolish = inCp[cp] && outCp[cp];
    const lpIn = sibs.some((y) => isLpSym(y.tokenSymbol) && (y.to || "").toLowerCase() === addr);
    const lpOut = sibs.some((y) => isLpSym(y.tokenSymbol) && (y.from || "").toLowerCase() === addr);
    const ts2 = parseInt(x.timeStamp, 10) * 1e3;
    if (!inbound && lpIn) {
      out.adds++;
      out.outLp += amt;
      moneyLegs(sibs, ts2);
    } else if (inbound && lpOut) {
      out.removes++;
      out.inLp += amt;
      moneyLegs(sibs, ts2);
    } else if (inbound && (sibs.some((y) => (y.from || "").toLowerCase() === addr) || poolish)) {
      out.inSwap += amt;
      if (!swapLegs(sibs, ts2, true)) out.unpricedSwapTk += amt;
    } else if (!inbound && (sibs.some((y) => (y.to || "").toLowerCase() === addr) || poolish)) {
      out.outSwap += amt;
      if (!swapLegs(sibs, ts2, false)) out.unpricedSwapTk += amt;
    }
    else if (inbound) {
      out.inXfer += amt;
      out.xferInEvs.push([parseInt(x.timeStamp, 10) * 1e3, amt]);
    }
    else out.outXfer += amt;
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
  let claimed = false;
  try {
    claimed = !!await getStore("claim").get("c/" + addr, { type: "json" });
  } catch {
  }
  if (!claimed) {
    return new Response(JSON.stringify({ locked: true }), { status: 403, headers: HEADERS });
  }
  const store = storeOr("pnl");
  let rowsIdx = [];
  if (store) try {
    const cached = await store.get(pnlCacheKey(addr), { type: "json" });
    if (cached && cached.rowsIdx) rowsIdx = cached.rowsIdx;
  } catch {
  }
  if (!rowsIdx.length) {
    const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
    try {
      await fetch(site + "/api/pnl?addr=" + addr);
    } catch {
    }
    if (store) try {
      const cached = await store.get(pnlCacheKey(addr), { type: "json" });
      if (cached && cached.rowsIdx) rowsIdx = cached.rowsIdx;
    } catch {
    }
  }
  let contract = null, row = null;
  if (/^0x[0-9a-f]{40}$/i.test(q)) {
    contract = q.toLowerCase();
    row = rowsIdx.find((r) => r.a === contract) || null;
  } else {
    const qq = q.toUpperCase().replace(/^\$/, "");
    const matches = rowsIdx.filter((r) => r.s === qq);
    if (matches.length > 1) {
      return new Response(JSON.stringify({ ambiguous: matches.map((m) => ({ sym: m.s, contract: m.a })) }), { headers: HEADERS });
    }
    if (matches.length === 1) {
      row = matches[0];
      contract = row.a;
    }
  }
  if (!contract) {
    return new Response(JSON.stringify({ none: true, q }), { headers: HEADERS });
  }
  const dk = "tok8/" + addr + "/" + contract;
  if (store) try {
    const c = await store.get(dk, { type: "json" });
    if (c) {
      const ttl = c.deg ? 10 * 60 * 1e3 : 7 * 24 * 3600 * 1e3;
      if (Date.now() - c.t < ttl) return new Response(JSON.stringify(c.d), { headers: HEADERS });
    }
  } catch {
  }
  const workKey = "work/tok8/" + addr;
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
  const allResult = await fetchWalletTx(addr);
  const all = allResult.rows;
  const truncated = !allResult.complete;
  let targetResult = allResult.complete
    ? { rows: all.filter((x) => (x.contractAddress || "").toLowerCase() === contract), complete: true, reason: null }
    : null;
  if (!targetResult || !targetResult.rows.length) targetResult = await fetchTokenTx(addr, contract);
  if (!targetResult.complete) {
    return new Response(JSON.stringify({ partial: true, error: "history_incomplete", reason: targetResult.reason }), { status: 503, headers: HEADERS });
  }
  const targetRows = targetResult.rows;
  const rp = foldTok(targetRows, addr, null);
  if (!rp) return new Response(JSON.stringify({ none: true, q }), { headers: HEADERS });
  const lp = allResult.complete && targetRows ? classifyLp(all, targetRows, contract, addr) : null;
  const cg = await cgToken(contract, store);
  const pk = cg ? await peakSince(contract, rp.firstTs, store) : null;
  const peakPrice = pk ? pk.price : cg ? cg.ath : null;
  const peakTs0 = pk ? pk.ts : cg ? cg.athDate : null;
  const peakTs = peakTs0 ? Math.max(peakTs0, rp.firstTs) : null;
  let verdict = null, balAtPeak = null;
  if (peakTs) {
    const rp2 = foldTok(targetRows, addr, peakTs);
    balAtPeak = rp2 ? rp2.balAtRef : null;
    if (balAtPeak !== null && rp.peakBag > 0) {
      const ratio = balAtPeak / rp.peakBag;
      if (rp.balNow > 0 && ratio >= 0.5) verdict = "still aboard";
      else if (ratio >= 0.5) verdict = "rode it down, then sold";
      else verdict = "sold before the top";
    }
  }
  const truePk = pk && pk.series ? peakBagOver(pk.series, targetRows, addr) : null;
  const recvUsd = lp && lp.xferInEvs.length && pk && pk.series ? usdAtArrival(lp.xferInEvs, pk.series) : null;
  let lpNetTk = null, lpPutUsd = null, lpGotUsd = null, synthInv = null, synthSold = null;
  if (lp) {
    const needAvax = lp.putWavax.length || lp.gotWavax.length || lp.buyWavax.length || lp.sellWavax.length;
    const av = needAvax ? await avaxSeries(store) : null;
    if (lp.adds || lp.removes) {
      lpNetTk = lp.outLp - lp.inLp;
      const pw = av && lp.putWavax.length ? usdAtArrival(lp.putWavax, av) : 0;
      const gw = av && lp.gotWavax.length ? usdAtArrival(lp.gotWavax, av) : 0;
      lpPutUsd = Math.round((pw || 0) + lp.putStable) || null;
      lpGotUsd = Math.round((gw || 0) + lp.gotStable) || null;
    }
    if (!row && (lp.inSwap > 0 || lp.outSwap > 0)) {
      const bw = av && lp.buyWavax.length ? usdAtArrival(lp.buyWavax, av) : 0;
      const sw = av && lp.sellWavax.length ? usdAtArrival(lp.sellWavax, av) : 0;
      const inv = (bw || 0) + lp.buyStable;
      const sold = (sw || 0) + lp.sellStable;
      if (inv > 0) synthInv = Math.round(inv);
      if (sold > 0) synthSold = Math.round(sold);
    }
  }
  let airdropRealized = null;
  if (AIRDROP_META[contract] && lp && lp.xferInEvs.length && recvUsd > 50) {
    const proceeds = row ? row.so : synthSold || 0;
    const inv = row ? row.i : synthInv || 0;
    const ar = proceeds - inv;
    if (ar > 0) airdropRealized = Math.round(ar);
  }
  if (lp && lpNetTk !== null && lpNetTk > 0 && lpNetTk > lp.outSwap && verdict !== "bag arrived after the party") {
    const mostlyGone = rp.peakBag > 0 && lpNetTk >= rp.peakBag * 0.5;
    if (verdict !== "still aboard" || mostlyGone) verdict = "never sold. the pool sold it for you.";
  }
  if (lp && verdict && verdict !== "still aboard") {
    const totalIn = lp.inSwap + lp.inXfer + lp.inLp;
    if (totalIn > 0 && (lp.inXfer + lp.inLp) / totalIn >= 0.8 && peakTs && peakTs - rp.firstTs < 7 * 864e5) verdict = "bag arrived after the party";
  }
  const sym = row ? normalizeSymbol(row.s, contract) : normalizeSymbol(q.replace(/^\$/, ""), contract);
  const d = {
    sym,
    contract,
    realized: row ? row.p : null,
    invested: row ? row.i : synthInv,
    soldUsd: row ? row.so : synthSold,
    airdropRealized,
    synth: !row && !!(synthInv || synthSold),
    synthPartial: !row && !!(lp && lp.unpricedSwapTk > 0),
    firstHeld: new Date(rp.firstTs).toISOString().slice(0, 10),
    lastActivity: new Date(rp.lastTs).toISOString().slice(0, 10),
    transfers: rp.transfers,
    peakBagTk: rp.peakBag,
    peakBagUsd: truePk ? Math.round(truePk.usd) : peakPrice ? Math.round(rp.peakBag * peakPrice) : null,
    peakDate: truePk ? new Date(truePk.ts).toISOString().slice(0, 10) : peakTs ? new Date(peakTs).toISOString().slice(0, 10) : null,
    holdingNow: rp.balNow > 0,
    holdingUsd: rp.balNow > 0 && cg && cg.cur ? Math.round(rp.balNow * cg.cur) : null,
    priceSrc: cg ? cg.src || "cg" : null,
    peakSrc: pk ? pk.src || "cg" : null,
    verdict,
    lp: lp ? { adds: lp.adds, removes: lp.removes, netTk: lpNetTk !== null ? Math.round(lpNetTk) : null, putUsd: lpPutUsd, gotUsd: lpGotUsd } : null,
    recvTk: lp && lp.inXfer > 0 ? Math.round(lp.inXfer) : null,
    recvUsd: recvUsd ? Math.round(recvUsd) : null,
    truncated
  };
  const deg = !pk || !pk.series || !!(lp && lp.xferInEvs.length && !recvUsd);
  if (store) try {
    await store.set(dk, JSON.stringify({ t: Date.now(), d, deg }));
  } catch {
  }
  return new Response(JSON.stringify(d), { headers: HEADERS });
};
var config = { path: "/api/token" };
export {
  _mem,
  config,
  token_default as default
};
