import * as PImage from "pureimage";

// src/card.js
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

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
  [Date.UTC(2023, 11, 5), "STARS ARENA", "socialfi mania, exploit, comeback. wild month."],
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
async function fetchWallet(addr) {
  const base = API + "?module=account&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=25&sort=asc";
  const [txj, tokj, intj, cntj, blkj] = await Promise.all([
    fetch(base + "&action=txlist").then((r) => r.json()),
    fetch(base + "&action=tokentx").then((r) => r.json()).catch(() => ({ result: [] })),
    fetch(base + "&action=txlistinternal").then((r) => r.json()).catch(() => ({ result: [] })),
    fetch(API + "?module=proxy&action=eth_getTransactionCount&address=" + addr + "&tag=latest").then((r) => r.json()).catch(() => null),
    fetch(API + "?module=proxy&action=eth_blockNumber").then((r) => r.json()).catch(() => null)
  ]);
  const heads = [];
  if (txj.result && txj.result.length) heads.push(txj.result[0]);
  if (tokj && Array.isArray(tokj.result) && tokj.result.length) heads.push(tokj.result[0]);
  if (intj && Array.isArray(intj.result) && intj.result.length) heads.push(intj.result[0]);
  if (!heads.length) return null;
  const first = heads.reduce((a, b) => parseInt(a.timeStamp, 10) <= parseInt(b.timeStamp, 10) ? a : b);
  const ts = parseInt(first.timeStamp, 10) * 1e3;
  const blk = parseInt(first.blockNumber, 10);
  const now = Date.now();
  const days = Math.floor((now - ts) / 864e5);
  const pct = Math.min(100, (now - ts) / (now - GENESIS) * 100);
  const curBlock = blkj && blkj.result ? parseInt(blkj.result, 16) : 1e8;
  const early = blk / curBlock * 100;
  const earlyStr = (early < 0.01 ? "<0.01" : early < 1 ? early.toFixed(2) : early.toFixed(1)) + "% of all blocks";
  const txc = cntj && cntj.result ? parseInt(cntj.result, 16) : null;
  const mv = firstInteresting(txj && txj.result || [], tokj && tokj.result || [], addr);
  const dateStr = new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
  return { addr, ts, blk, days, pct, era: eraFor(ts), rank: rankFor(days), mv, txc, earlyStr, dateStr };
}

// src/card.js
var fontsReady = null;
function loadFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      PImage.registerFont(fileURLToPath(new URL("./assets/DejaVuSansMono.ttf", import.meta.url)), "Mono").load(),
      PImage.registerFont(fileURLToPath(new URL("./assets/DejaVuSansMono-Bold.ttf", import.meta.url)), "MonoB").load()
    ]);
  }
  return fontsReady;
}
function draw(w) {
  const W = 1200, H = 630;
  const img = PImage.make(W, H);
  const x = img.getContext("2d");
  x.fillStyle = "#0a0a0a";
  x.fillRect(0, 0, W, H);
  x.strokeStyle = "#e84142";
  x.lineWidth = 5;
  x.strokeRect(20, 20, W - 40, H - 40);
  x.strokeStyle = "#2a2a2a";
  x.lineWidth = 2;
  x.strokeRect(34, 34, W - 68, H - 68);
  const L = 76;
  x.fillStyle = "#7a7a7a";
  x.font = "22px Mono";
  x.fillText("AVALANCHE C-CHAIN", L, 88);
  x.fillStyle = "#e84142";
  x.font = "78px MonoB";
  x.fillText(w.rank[1], L, 165);
  x.fillStyle = "#7a7a7a";
  x.font = "21px Mono";
  x.fillText(w.rank[2], L, 200);
  x.fillStyle = "#2a2a2a";
  x.fillRect(L, 228, W - 2 * L, 2);
  function cell(k, v, cx, cy, big) {
    x.fillStyle = "#7a7a7a";
    x.font = "19px Mono";
    x.fillText(k, cx, cy);
    x.fillStyle = big ? "#e84142" : "#f2f2f2";
    x.font = big ? "44px MonoB" : "34px MonoB";
    x.fillText(v, cx, cy + (big ? 46 : 38));
  }
  cell("ERA OF ARRIVAL", w.era[1], L, 272, true);
  cell("FIRST SEEN", w.dateStr + " \xB7 #" + w.blk.toLocaleString("en-US"), L, 392);
  cell(w.mv.key, w.mv.val.toUpperCase(), L, 470);
  const R = 690;
  cell("DAYS", w.days.toLocaleString("en-US"), R, 272);
  cell("SURVIVED", w.pct.toFixed(1) + "%", R + 230, 272);
  if (w.txc !== null) cell("TXS SENT", w.txc.toLocaleString("en-US"), R, 360);
  cell("ARRIVED IN THE FIRST", w.earlyStr.toUpperCase(), R, 452, true);
  x.fillStyle = "#2a2a2a";
  x.fillRect(L, 556, W - 2 * L, 2);
  x.fillStyle = "#7a7a7a";
  x.font = "19px Mono";
  x.fillText(w.avvy ? w.avvy : w.addr.slice(0, 10) + "\u2026" + w.addr.slice(-8), L, 586);
  x.fillStyle = "#e84142";
  x.font = "19px MonoB";
  const tag = "AVAX100M.XYZ \xB7 ROAD TO BLOCK 100,000,000";
  x.fillText(tag, W - L - tag.length * 11.5, 586);
  return img;
}
async function toPng(img) {
  const s = new PassThrough();
  const chunks = [];
  const done = new Promise((res, rej) => {
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => res(Buffer.concat(chunks)));
    s.on("error", rej);
  });
  await PImage.encodePNGToStream(img, s);
  return done;
}
var card_default = async (req) => {
  const url = new URL(req.url);
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
  const m = url.pathname.match(/^\/card\/(0x[0-9a-fA-F]{40})\.png$/);
  if (!m) return Response.redirect(site + "/og.png", 302);
  try {
    await loadFonts();
    const [w, nm] = await Promise.all([
      fetchWallet(m[1]),
      fetch(site + "/api/resolve?addr=" + m[1].toLowerCase()).then((r) => r.json()).then((j) => j && j.name || null).catch(() => null)
    ]);
    if (!w) return Response.redirect(site + "/og.png", 302);
    w.avvy = nm;
    const png = await toPng(draw(w));
    return new Response(png, { headers: {
      "content-type": "image/png",
      "cache-control": "public, max-age=86400"
    } });
  } catch (e) {
    return Response.redirect(site + "/og.png", 302);
  }
};
var config = { path: "/card/*" };
export {
  config,
  card_default as default
};
