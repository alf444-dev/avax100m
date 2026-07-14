import { getStore } from "@netlify/blobs";

// src/lib.js
var GENESIS = Date.UTC(2020, 8, 21);
var ERAS = [
  [Date.UTC(2021, 1, 9), "GENESIS", "before the first dex. before everything."],
  [Date.UTC(2021, 7, 18), "PANGOLIN SPRING", "first native dex. first c-chain boom."],
  [Date.UTC(2021, 10, 21), "AVALANCHE RUSH", "$180m in incentives. aave and curve move in."],
  [Date.UTC(2022, 1, 1), "WONDERLAND", "$146 ath. time (9,9). you saw the top."],
  [Date.UTC(2022, 4, 9), "SUBNET SZN", "summit barcelona. dfk crystalvale. crabada."],
  [Date.UTC(2023, 0, 1), "THE LONG WINTER", "terra. cryptoleaks. ftx. banff shipped anyway."],
  [Date.UTC(2023, 9, 1), "THE DESERT", "aws handshake. single digits. blocks anyway."],
  [Date.UTC(2023, 11, 7), "STARS ARENA", "socialfi mania, exploit, comeback. wild month."],
  [Date.UTC(2024, 2, 6), "COQ SZN", "memecoins and inscriptions. $9 to $48."],
  [Date.UTC(2024, 10, 16), "DURANGO", "warp messaging live. the rebuild begins."],
  [Date.UTC(2025, 0, 25), "AVALANCHE9000", "etna. subnets become l1s. costs drop 99%."],
  [Date.UTC(2025, 5, 1), "PRESALE SZN", "ket 720x. wink. blub shamefi. forms closed fast."],
  [Date.UTC(2025, 10, 19), "ARENA SUMMER", "1,800 tokens a day. lambo. wolfi. fifa moves in."],
  [Infinity, "GRANITE", "sub-second finality. world cup on-chain."]
];
var RANKS = [
  [2e3, "PERMAFROST", "here before most chains existed."],
  [1600, "OG", "watched the ath from the inside."],
  [1200, "VETERAN", "held through the long winter."],
  [800, "SURVIVOR", "outlasted the desert."],
  [400, "RESIDENT", "settled in for the rebuild."],
  [120, "SETTLER", "arrived when it got fast."],
  [0, "FRESH SNOW", "welcome. blocks don't wait."]
];
function eraFor(ts) {
  for (const e of ERAS) {
    if (ts < e[0]) return e;
  }
  return ERAS[ERAS.length - 1];
}
function rankFor(days) {
  for (const r of RANKS) {
    if (days >= r[0]) return r;
  }
  return RANKS[RANKS.length - 1];
}
var TOS = {
  "0x60ae616a28f1f202060ccb7207f87c051f4e5b3b": "swapped on trader joe",
  "0xe54ca86531e17ef3616d22ca28b0d458b6c89106": "swapped on pangolin",
  "0x794a61358d6845594f94dc1db02a252b5b4814ad": "deposited into aave",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "swapped via 1inch",
  "0x3c2269811836af69497e5f486a85d7316753cf62": "crossed chains via layerzero",
  "0x45a01e4e04f14f7a4a6702c74187c5f6222033cd": "bridged via stargate",
  "0x8eb8a3b98659cce290402893d0123abb75e3ab28": "bridged out via avalanche bridge"
};
var FROMS = { "0x8eb8a3b98659cce290402893d0123abb75e3ab28": "bridged in from ethereum" };
var SCAM_RE = /claim|visit|reward|bonus|airdrop|gift|prize|www|http|\.com|\.io|\.xyz|\.net|\.org/i;
var SKIP_TOKENS = { WAVAX: 1, USDC: 1, USDT: 1, DAI: 1, BUSD: 1, FRAX: 1, MIM: 1, TUSD: 1, USDP: 1, UST: 1, USDD: 1, EURC: 1, AUSD: 1, USD1: 1 };
function classifyTx(tx, addr) {
  const a = addr.toLowerCase(), to = (tx.to || "").toLowerCase(), from = (tx.from || "").toLowerCase();
  if (!to) return "deployed a contract";
  if (to === a) return FROMS[from] || null;
  return TOS[to] || null;
}
function cleanSymbol(t) {
  let s = (t.tokenSymbol || "").trim();
  const n = t.tokenName || "";
  if (!/^[A-Za-z0-9$]{1,12}$/.test(s)) return null;
  if (SCAM_RE.test(s) || SCAM_RE.test(n)) return null;
  s = s.toUpperCase();
  if (SKIP_TOKENS[s]) return null;
  return s;
}
function firstInteresting(txs, toks, addr) {
  for (const t of toks) {
    const s = cleanSymbol(t);
    if (s) return { key: "FIRST TOKEN", val: "$" + s, contract: (t.contractAddress || "").toLowerCase() || null };
  }
  const events = [];
  for (const tx of txs) {
    const lbl = classifyTx(tx, addr);
    if (lbl) events.push({ ts: parseInt(tx.timeStamp, 10), key: "FIRST MOVE", val: lbl });
  }
  if (!events.length) return { key: "FIRST MOVE", val: "just avax" };
  events.sort((a, b) => a.ts - b.ts);
  return events[0];
}
var API = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var RS_KEY = process.env.ROUTESCAN_KEY ? "&apikey=" + process.env.ROUTESCAN_KEY : "";
async function fetchWallet(addr) {
  const ft = getStore("firsttx");
  const cached = await ft.get(addr, { type: "json" }).catch(() => null);
  let ts, blk, mv, dateStr, cntj, blkj;
  if (cached && typeof cached.ts === "number" && cached.blk != null && cached.mvKey) {
    [cntj, blkj] = await Promise.all([
      fetch(API + "?module=proxy&action=eth_getTransactionCount&address=" + addr + "&tag=latest" + RS_KEY).then((r) => r.json()).catch(() => null),
      fetch(API + "?module=proxy&action=eth_blockNumber" + RS_KEY).then((r) => r.json()).catch(() => null)
    ]);
    ts = cached.ts; blk = cached.blk; dateStr = cached.dateStr;
    mv = { key: cached.mvKey, val: cached.mvVal, contract: cached.mvContract || null };
  } else {
    const base = API + "?module=account&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=25&sort=asc" + RS_KEY;
    let txj, tokj, intj;
    [txj, tokj, intj, cntj, blkj] = await Promise.all([
      fetch(base + "&action=txlist").then((r) => r.json()),
      fetch(base + "&action=tokentx").then((r) => r.json()).catch(() => ({ result: [] })),
      fetch(base + "&action=txlistinternal").then((r) => r.json()).catch(() => ({ result: [] })),
      fetch(API + "?module=proxy&action=eth_getTransactionCount&address=" + addr + "&tag=latest" + RS_KEY).then((r) => r.json()).catch(() => null),
      fetch(API + "?module=proxy&action=eth_blockNumber" + RS_KEY).then((r) => r.json()).catch(() => null)
    ]);
    const heads = [];
    if (txj.result && txj.result.length) heads.push(txj.result[0]);
    if (tokj && Array.isArray(tokj.result) && tokj.result.length) heads.push(tokj.result[0]);
    if (intj && Array.isArray(intj.result) && intj.result.length) heads.push(intj.result[0]);
    if (!heads.length) return null;
    const first = heads.reduce((a, b) => parseInt(a.timeStamp, 10) <= parseInt(b.timeStamp, 10) ? a : b);
    ts = parseInt(first.timeStamp, 10) * 1e3;
    blk = parseInt(first.blockNumber, 10);
    mv = firstInteresting(txj && txj.result || [], tokj && tokj.result || [], addr);
    dateStr = new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
    await ft.set(addr, JSON.stringify({ ts, blk, mvKey: mv.key, mvVal: mv.val, mvContract: mv.contract || null, dateStr, t: Date.now() })).catch(() => {});
  }
  const now = Date.now();
  const days = Math.floor((now - ts) / 864e5);
  const pct = Math.min(100, (now - ts) / (now - GENESIS) * 100);
  const curBlock = blkj && blkj.result ? parseInt(blkj.result, 16) : 1e8;
  const early = blk / curBlock * 100;
  const earlyStr = (early < 0.01 ? "<0.01" : early < 1 ? early.toFixed(2) : early.toFixed(1)) + "% of all blocks";
  const txc = cntj && cntj.result ? parseInt(cntj.result, 16) : null;
  return { addr, ts, blk, days, pct, era: eraFor(ts), rank: rankFor(days), mv, txc, earlyStr, dateStr };
}

// src/badges.js
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var CACHE_MS = 7 * 24 * 3600 * 1e3;
var SCAM = /claim|visit|reward|bonus|airdrop|gift|prize|www|http|\.com|\.io|\.xyz|\.net|\.org/i;
var usd = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
var badges_default = async (req) => {
  const url = new URL(req.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return new Response(JSON.stringify({ badges: [] }), { status: 400, headers: HEADERS });
  }
  const debug = url.searchParams.get("debug") === "1";
  let store = null;
  try {
    store = getStore("badges");
  } catch {
  }
  if (store && !debug) try {
    const c = await store.get("w2/" + addr, { type: "json" });
    if (c && Date.now() - c.t < CACHE_MS) return new Response(JSON.stringify({ badges: c.b }), { headers: HEADERS });
  } catch {
  }
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
  const [w, pnlj, resj, tokj] = await Promise.all([
    fetchWallet(addr).catch(() => null),
    fetch(site + "/api/pnl?addr=" + addr).then((r) => r.json()).catch(() => null),
    fetch(site + "/api/resolve?addr=" + addr).then((r) => r.json()).catch(() => null),
    fetch(RS + "?module=account&action=tokentx&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=100&sort=asc" + RS_KEY).then((r) => r.json()).catch(() => ({ result: [] }))
  ]);
  if (!w) return new Response(JSON.stringify({ badges: [] }), { headers: HEADERS });
  const earned = [];
  const push = (id, tier, ev) => earned.push({ id, tier: tier || 0, ev });
  if (w.rank && w.rank[1] === "PERMAFROST")
    push("permafrost", 0, "first touch <b>" + w.dateStr.toLowerCase() + "</b>, block #" + w.blk.toLocaleString("en-US") + " \u2014 in the first " + w.earlyStr + ".");
  if (w.pct >= 75)
    push("furniture", w.pct >= 95 ? 3 : w.pct >= 90 ? 2 : 1, "survived <b>" + w.pct.toFixed(1) + "%</b> of mainnet's existence.");
  if (w.txc !== null && w.txc >= 1e3)
    push("thousand", w.txc >= 1e4 ? 3 : w.txc >= 5e3 ? 2 : 1, "<b>" + w.txc.toLocaleString("en-US") + "</b> transactions sent.");
  const mvVal = w.mv && w.mv.val || "";
  if (/bridged in from ethereum/i.test(mvVal))
    push("immigrant", 0, "first touch was a <b>bridge in from ethereum</b>. came here on purpose.");
  if (/pangolin/i.test(mvVal))
    push("pangolin", 0, "first swap was on <b>pangolin</b>. before the joe era.");
  if (w.era && w.era[1] === "AVALANCHE RUSH")
    push("rush", 0, "arrived during <b>avalanche rush</b> \u2014 the $180m summer.");
  if (w.mv && w.mv.key === "FIRST TOKEN" && w.mv.contract) {
    try {
      const bj = await fetch(RS + "?module=account&action=tokenbalance&contractaddress=" + w.mv.contract + "&address=" + addr + "&tag=latest" + RS_KEY).then((r) => r.json());
      if (bj && bj.result && BigInt(bj.result) > 0n)
        push("firstlove", 0, "first token <b>$" + mvVal + "</b>, " + w.dateStr.toLowerCase() + " \u2014 balance never reached zero. " + w.days.toLocaleString("en-US") + " days.");
    } catch {
    }
  }
  if (resj && resj.name)
    push("registry", 0, "reverse record set: <b>" + resj.name + "</b>. the chain knows your name.");
  try {
    const seen = {};
    let n = 0;
    for (const t of tokj && tokj.result || []) {
      if ((t.to || "").toLowerCase() !== addr) continue;
      const nm = (t.tokenName || "") + " " + (t.tokenSymbol || "");
      if (SCAM.test(nm) && !seen[t.contractAddress]) {
        seen[t.contractAddress] = 1;
        n++;
      }
    }
    if (n >= 25) push("spammagnet", 0, "<b>" + n + "</b> scam airdrops received. you did nothing. the chain chose you.");
  } catch {
  }
  const st = pnlj && pnlj.available && pnlj.stats || {};
  const f = st.flags || {};
  const era = w.era && w.era[1] || "";
  if (f.fullCircle) {
    const rt0 = st.roundtrips && st.roundtrips[0] || null;
    push("fullcircle", f.fullCircle.tier, rt0 ? "held <b>" + rt0.sub.split("\xB7")[1].trim() + "</b> of <b>$" + (rt0.sym || "") + "</b>. " + (rt0.sub.split("\xB7")[2] || "").trim() + "." : "roundtripped <b>" + usd(f.fullCircle.amt) + "</b>.");
  }
  if (f.exitThere) push("exitthere", 0, "exited <b>$" + f.exitThere.sym + "</b> before a <b>" + f.exitThere.x + "x</b>. the exit was right there.");
  if (f.boughtTop) push("boughttop", 0, "average entry within 20% of <b>$" + f.boughtTop.sym + "</b>'s peak-while-held.");
  if (f.captain) push("captain", 0, "still holding <b>$" + f.captain.sym + "</b>, down <b>" + f.captain.downPct + "%</b> from its peak. goes down with the ship.");
  if (f.soldTop) push("soldtop", 0, "exited <b>$" + f.soldTop.sym + "</b> within 7 days of its peak-while-held. verified by transfer replay.");
  if (f.netUp) push("netup", 0, "total realized: <b>+" + usd(f.netUp.total) + "</b> across " + (st.tokens || "20+") + " tokens.");
  if (f.sniper) push("sniper", 0, "<b>" + f.sniper.pct + "%</b> winrate on 20+ decided positions.");
  if (f.exitLiq) push("exitliq", 0, "<b>" + f.exitLiq.pct + "%</b> winrate on 20+ decided positions. worn openly.");
  if (f.caughtOne) push("caughtone", 0, "realized a <b>" + f.caughtOne.x + "x</b> on <b>$" + f.caughtOne.sym + "</b>. the chain confirms.");
  if (f.oneTrick) push("onetrick", 0, "<b>$" + f.oneTrick.sym + "</b> is <b>" + f.oneTrick.pct + "%</b> of all realized profit.");
  if (f.deepBench) push("deepbench", 0, "<b>" + f.deepBench.n + "</b> tokens each realized over $1,000. a rotation, not a lottery.");
  if (f.zoo) push("zoo", f.zoo.tier, "<b>" + f.zoo.n + "</b> tokens traded through dex swaps.");
  if (f.stableLoss) push("stableloss", 0, "realized <b>\u2212" + usd(f.stableLoss.amt) + "</b> trading <b>$" + f.stableLoss.sym + "</b>. a stablecoin. it holds still and you still lost.");
  if (f.graveyard) push("graveyard", 0, "<b>" + f.graveyard.n + "</b> tokens in the wallet each worth under a dollar. a museum of decisions.");
  if (f.roundVictim) push("roundvictim", 0, "<b>$" + f.roundVictim.sym + "</b> bag peaked at <b>" + usd(f.roundVictim.peak) + "</b> \u2014 " + usd(f.roundVictim.target - f.roundVictim.peak) + " short of " + usd(f.roundVictim.target) + ". never crossed.");
  if (f.wonderland) push("wonderland", 0, "held or traded <b>$TIME</b>. (9,9). no further questions.");
  if (f.coqVet) push("coq", 0, "traded <b>$COQ</b>. the memecoin spring left a mark.");
  if (era === "ARENA SUMMER" && f.arenaTraded) push("arena", 0, "arrived during <b>arena summer</b> with <b>$ARENA</b> in the history.");
  try {
    const cs = getStore("claim");
    const c = cs ? await cs.get("c/" + addr, { type: "json" }) : null;
    if (c) push("homesteader", 0, "claimed at block <b>#" + (c.blk ? c.blk.toLocaleString("en-US") : "?") + "</b> \u2014 before the milestone. settled ground.");
  } catch {
  }
  let counts = { total: 0, byId: {} };
  if (store) {
    try {
      counts = await store.get("counts", { type: "json" }) || counts;
    } catch {
    }
    let seen = null;
    try {
      seen = await store.get("seen/" + addr);
    } catch {
    }
    if (!seen) {
      counts.total++;
      for (const b of earned) counts.byId[b.id] = (counts.byId[b.id] || 0) + 1;
      try {
        await store.set("seen/" + addr, "1");
        await store.set("counts", JSON.stringify(counts));
      } catch {
      }
    }
  }
  for (const b of earned) b.rarity = { count: counts.byId[b.id] || 1, total: Math.max(counts.total, 1) };
  earned.sort((a, b) => a.rarity.count - b.rarity.count);
  if (store && !debug) try {
    await store.set("w2/" + addr, JSON.stringify({ t: Date.now(), b: earned }));
  } catch {
  }
  return new Response(JSON.stringify({ badges: earned }), { headers: HEADERS });
};
var config = { path: "/api/badges" };
export {
  config,
  badges_default as default
};
