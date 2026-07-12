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
  [Date.UTC(2024, 11, 16), "DURANGO", "warp messaging live. the rebuild begins."],
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

// src/wallet.js
var esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function page(w, site) {
  const short = w.addr.slice(0, 8) + "\u2026" + w.addr.slice(-6);
  const title = `${w.rank[1]} \xB7 ${w.era[1]} \u2014 avax100m.xyz`;
  const desc = `first seen ${w.dateStr.toLowerCase()} \xB7 ${w.mv.key.toLowerCase()}: ${w.mv.val.toLowerCase()} \xB7 arrived in the first ${w.earlyStr}`;
  const img = `${site}/card/${w.addr}.png`;
  const pageUrl = `${site}/w/${w.addr}`;
  const D = JSON.stringify({ addr: w.addr, ts: w.ts, era: w.era[1], rank: w.rank[1], firstContract: w.mv.contract || null, firstToken: w.mv.key === "FIRST TOKEN" ? w.mv.val : null, mvKey: w.mv.key, mvVal: w.mv.val, survived: Math.round(w.pct * 10) / 10, days: w.days, txs: w.txc });
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="profile">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc(title)}">
<meta name="twitter:description" content="${esc(desc)}">
<meta name="twitter:image" content="${img}">
<style>
:root{--bg:#0a0a0a;--ink:#f2f2f2;--dim:#7a7a7a;--faint:#2a2a2a;--red:#e84142;
--mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--mono);font-size:14px;line-height:1.6}
a{color:var(--ink)}
::selection{background:var(--red);color:#000}
.wrap{max-width:900px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--faint)}
.hbar{display:flex;justify-content:space-between;align-items:center;height:52px}
.logo{font-weight:700;letter-spacing:.08em;text-decoration:none}
.logo b{color:var(--red)}
.hbar .nav{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);text-decoration:none}
.hbar .nav:hover{color:var(--red)}
.hero{padding:64px 0 40px;border-bottom:1px solid var(--faint)}
.eyebrow{font-size:11px;letter-spacing:.24em;color:var(--dim);text-transform:uppercase;margin-bottom:14px}
h1{font-size:clamp(44px,9vw,84px);line-height:1;color:var(--red);letter-spacing:-.01em}
.tagline{color:var(--dim);margin-top:10px}
.addrline{margin-top:26px;font-size:12px;color:var(--dim);word-break:break-all;display:flex;gap:12px;align-items:center;flex-wrap:wrap}
.addrline .a{color:var(--ink)}
.badges{display:flex;flex-wrap:wrap;gap:10px}
.brack{position:absolute;top:4px;right:0;display:grid;grid-template-columns:repeat(5,38px);gap:8px;justify-content:end;max-width:270px}
.btile{position:relative;width:38px;height:38px;border:1px solid var(--faint);display:flex;align-items:center;justify-content:center;cursor:default;outline:none;background:var(--bg)}
.btile:hover,.btile:focus-visible{border-color:var(--red)}
.btile svg{width:22px;height:22px;display:block}
.btile.medal{background:var(--red);border-color:var(--red)}
.btile.medal .g-ink,.btile.medal .g-red{fill:#0a0a0a}
.btile.medal .s-ink,.btile.medal .s-red{stroke:#0a0a0a}
.btile .tip{display:none;position:absolute;top:calc(100% + 8px);right:-1px;width:264px;z-index:9;background:var(--bg);border:1px solid var(--red);padding:10px 12px;text-align:left;cursor:default}
.btile:hover .tip,.btile:focus-visible .tip{display:block}
.btile .tip .tn{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:var(--ink)}
.btile .tip .tn .bt{color:var(--red)}
.btile.medal .tip .tn,.btile.medal .tip .tr,.btile.medal .tip .tv{color:var(--ink)}
.btile .tip .tr{display:block;font-size:9px;color:var(--dim);letter-spacing:.1em;margin:3px 0 7px}
.btile .tip .tv{font-size:10px;color:var(--dim);letter-spacing:.05em;line-height:1.55}
.btile .tip .tv b{color:var(--ink)}
.btile .tip .tl{color:var(--red);letter-spacing:.2em;font-size:9px;display:block;margin-bottom:3px}
@media(max-width:760px){.brack{position:static;display:flex;flex-wrap:wrap;justify-content:flex-start;max-width:none;margin:22px 0 4px}.btile .tip{right:auto;left:-1px}}
.bdg{position:relative;border:1px solid var(--faint);padding:8px 13px 7px;display:flex;align-items:center;gap:9px;outline:none;cursor:default}
.bdg:hover,.bdg:focus-visible{border-color:var(--red)}
.bdg svg{width:16px;height:16px;flex:none;display:block}
.bdg .bn{font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;white-space:nowrap}
.bdg .br{display:block;font-size:9px;color:var(--dim);letter-spacing:.08em;font-weight:400}
.bdg .bt{color:var(--red)}
.bdg.medal{background:var(--red);border-color:var(--red)}
.bdg.medal .bn,.bdg.medal .br{color:#0a0a0a}
.bdg.medal .br{opacity:.75}
.bdg.medal .g-ink,.bdg.medal .g-red{fill:#0a0a0a}
.bdg.medal .s-ink,.bdg.medal .s-red{stroke:#0a0a0a}
.bdg .ev{display:none;position:absolute;left:-1px;top:calc(100% + 4px);min-width:230px;max-width:320px;z-index:5;background:var(--bg);border:1px solid var(--red);padding:8px 11px;font-size:10px;color:var(--dim);letter-spacing:.05em;line-height:1.55;white-space:normal}
.bdg .ev b{color:var(--ink)}
.bdg .ev .evl{color:var(--red);letter-spacing:.2em;font-size:9px;display:block;margin-bottom:3px}
.bdg:hover .ev,.bdg:focus-visible .ev{display:block}
.g-ink{fill:var(--ink)}.g-red{fill:var(--red)}
.s-ink{stroke:var(--ink);fill:none;stroke-width:2}.s-red{stroke:var(--red);fill:none;stroke-width:2}.s-thin{stroke-width:1.5}
.btn{background:transparent;border:1px solid var(--faint);color:var(--dim);font-family:var(--mono);font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:6px 12px;cursor:pointer}
.btn:hover{border-color:var(--red);color:var(--red)}
.btn.primary{background:var(--red);border-color:var(--red);color:#000;font-weight:700}
.btn.primary:hover{background:var(--ink);border-color:var(--ink)}
section{padding:44px 0;border-bottom:1px solid var(--faint)}
h2{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--red);font-weight:700;margin-bottom:22px}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:var(--faint);border:1px solid var(--faint)}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}}
.cell{background:var(--bg);padding:16px 14px;min-height:86px}
.cell .k{font-size:10px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}
.cell .v{font-size:19px;font-weight:700;margin-top:6px;word-break:break-word}
.cell .v.red{color:var(--red)}
.cell .v small{font-size:11px;color:var(--dim);font-weight:400}
.note{margin-top:14px;font-size:11px;color:var(--dim);letter-spacing:.06em}
footer{padding:36px 0 64px;color:var(--dim);font-size:12px}
footer .frow{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
footer a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--faint)}
footer a:hover{color:var(--red);border-color:var(--red)}
</style>
</head>
<body>
<header><div class="wrap hbar">
  <a class="logo" href="${site}"><b>AVAX</b>/100M</a>
  <a class="nav" href="${site}">check a wallet \u2192</a>
</div></header>

<main class="wrap">
  <div class="hero" style="position:relative">
    <div id="brack" class="brack" aria-label="badges"></div>
    <div class="eyebrow">avalanche c-chain \xB7 wallet profile</div>
    <h1>${esc(w.rank[1])}</h1>
    <div class="tagline">${esc(w.rank[2])}</div>
    <div id="status-line" style="display:none;margin-top:20px;font-size:15px;color:var(--ink);letter-spacing:.02em">\u201C<span id="status-text"></span>\u201D</div>
    <div id="avvy" style="display:none;margin-top:24px;font-size:20px;font-weight:700;color:var(--ink);letter-spacing:.02em"></div>
    <div class="addrline">
      <span class="a">${esc(short)}</span>
      <button class="btn" id="copy-addr">copy address</button>
      <button class="btn" id="copy-link">copy page link</button>
      <button class="btn primary" id="share-x">share on x</button>
      <button class="btn" id="claim-btn" style="display:none">claim this page</button>
      <button class="btn" id="status-btn" style="display:none">customize</button>
      <span id="settled" style="display:none;font-size:10px;color:var(--dim);letter-spacing:.08em"></span>
    </div>
    <div id="claim-msg" style="display:none;font-size:11px;color:var(--dim);margin-top:10px;letter-spacing:.05em"></div>
    <div id="cust" style="display:none;margin-top:18px;border:1px solid var(--faint);padding:16px 18px;max-width:560px">
      <div style="font-size:10px;color:var(--red);letter-spacing:.25em;text-transform:uppercase;margin-bottom:12px">customize \xB7 one signature saves everything</div>
      <div style="font-size:10px;color:var(--dim);letter-spacing:.1em;text-transform:uppercase;margin-bottom:6px">status \xB7 100 chars \xB7 no links</div>
      <input id="cust-status" maxlength="100" spellcheck="false" style="width:100%;background:var(--bg);border:1px solid var(--faint);color:var(--ink);font-family:var(--mono);font-size:13px;padding:9px 11px;letter-spacing:.02em;outline:none" placeholder="never selling. ask my roundtrip.">
      <div style="font-size:10px;color:var(--dim);letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px">accent</div>
      <div id="cust-themes" style="display:flex;gap:8px"></div>
      <div style="font-size:10px;color:var(--dim);letter-spacing:.1em;text-transform:uppercase;margin:16px 0 8px">badges on your card \xB7 pick up to 3</div>
      <div id="cust-badges" style="display:flex;flex-wrap:wrap;gap:6px"></div>
      <div style="display:flex;gap:10px;margin-top:16px">
        <button class="btn primary" id="cust-save">sign &amp; save</button>
        <button class="btn" id="cust-cancel">cancel</button>
      </div>
    </div>
  </div>

  <section id="oracle-sec" style="display:none">
    <h2>ask the chain</h2>
    <div style="display:flex;gap:20px;align-items:flex-start;flex-wrap:wrap">
      <button id="oracle" aria-label="ask the chain" style="width:72px;height:72px;background:var(--bg);border:1px solid var(--faint);cursor:pointer;display:flex;align-items:center;justify-content:center;flex:none">
        <span style="width:26px;height:26px;background:var(--red);display:flex;align-items:center;justify-content:center;color:#0a0a0a;font-weight:800;font-size:17px;font-family:var(--mono)">8</span>
      </button>
      <div style="flex:1;min-width:240px">
        <div id="oracle-out" style="font-size:14px;color:var(--ink);letter-spacing:.02em;line-height:1.7;min-height:48px"></div>
        <button class="btn" id="oracle-share" style="display:none;margin-top:10px">share the verdict</button>
      </div>
    </div>
    <div class="note">the chain has read your history. click the square. it is not your friend.</div>
  </section>

  <section>
    <h2>origin</h2>
    <div class="grid">
      <div class="cell"><div class="k">era of arrival</div><div class="v red">${esc(w.era[1])}</div></div>
      <div class="cell"><div class="k">first seen</div><div class="v">${esc(w.dateStr)}<br><small>#${w.blk.toLocaleString("en-US")}</small></div></div>
      <div class="cell"><div class="k">${esc(w.mv.key.toLowerCase())}</div><div class="v">${esc(w.mv.val)}</div><div id="holding" style="font-size:11px;color:var(--dim);margin-top:4px"></div></div>
      <div class="cell"><div class="k">arrived in the first</div><div class="v red">${esc(w.earlyStr)}</div></div>
      <div class="cell"><div class="k">days on mainnet</div><div class="v">${w.days.toLocaleString("en-US")}</div></div>
      <div class="cell"><div class="k">mainnet survived</div><div class="v">${w.pct.toFixed(1)}%</div></div>
      <div class="cell"><div class="k">txs sent</div><div class="v">${w.txc === null ? "\u2014" : w.txc.toLocaleString("en-US")}</div></div>
      <div class="cell"><div class="k">avax at arrival</div><div class="v" id="price">\u2014</div></div>
    </div>
    <div class="note" id="cohort"></div>
  </section>

  <section>
    <h2>realized p&amp;l</h2>
    <div class="grid" id="pnl-grid">
      <div class="cell"><div class="k">biggest w</div><div class="v" id="pnl-w">\u2014</div></div>
      <div class="cell"><div class="k">biggest l</div><div class="v" id="pnl-l">\u2014</div></div>
      <div class="cell"><div class="k">biggest roundtrip</div><div class="v" id="pnl-rt">\u2014</div></div>
      <div class="cell"><div class="k">sold too early</div><div class="v" id="pnl-ste">\u2014</div></div>
    </div>
    <div class="note" id="pnl-summary" style="display:none;font-size:13px;color:var(--ink)"></div>
    <div class="note" id="pnl-note">syncing trade history\u2026</div>
    <button class="btn" id="ledger-toggle" style="display:none;margin-top:16px">full ledger \u2192</button>
    <div id="ledger" style="display:none;margin-top:22px">
      <div class="grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="cell"><div class="k">top wins</div><div id="lg-w" style="font-size:12px;margin-top:8px"></div></div>
        <div class="cell"><div class="k">top losses</div><div id="lg-l" style="font-size:12px;margin-top:8px"></div></div>
        <div class="cell"><div class="k">roundtrips</div><div id="lg-rt" style="font-size:12px;margin-top:8px"></div></div>
        <div class="cell"><div class="k">sold too early</div><div id="lg-ste" style="font-size:12px;margin-top:8px"></div></div>
      </div>
    </div>
    <div id="pnl-card-wrap" style="display:none;margin-top:22px">
      <canvas id="pnl-card" width="1080" height="1350" style="width:100%;max-width:360px;border:1px solid var(--faint);display:block"></canvas>
      <div style="display:flex;gap:10px;margin-top:12px;max-width:360px">
        <button class="btn" id="pnl-dl" style="flex:1">download p&amp;l card</button>
        <button class="btn primary" id="pnl-share" style="flex:1">share on x</button>
      </div>
    </div>
  </section>
</main>

<footer><div class="wrap frow">
  <span>no connect \xB7 no signature \xB7 computed live from the chain</span>
  <span>made by <a href="https://x.com/Alf444_" target="_blank" rel="noopener">@Alf444_</a> \xB7 <a href="${site}">avax100m.xyz</a></span>
</div></footer>

<script>
(function(){
"use strict";
var D=${D};
var RANK=D.rank, ERA=D.era;
var SITE=${JSON.stringify(site)};
var PAGE=SITE+"/w/"+D.addr;

document.getElementById("copy-addr").addEventListener("click",function(){cp(D.addr,this);});
document.getElementById("copy-link").addEventListener("click",function(){cp(PAGE,this);});
function cp(t,btn){ if(navigator.clipboard){navigator.clipboard.writeText(t).then(function(){var o=btn.textContent;btn.textContent="copied";setTimeout(function(){btn.textContent=o;},1400);}).catch(function(){});} }
document.getElementById("share-x").addEventListener("click",function(){
  var t=document.title.split(" \u2014 ")[0].toLowerCase()+". road to block 100,000,000.";
  window.open("https://twitter.com/intent/tweet?text="+encodeURIComponent(t)+"&url="+encodeURIComponent(PAGE),"_blank");
});

/* avax at arrival: binance primary, coingecko fallback */
function fmtPrice(p){return "$"+(p>=100?p.toFixed(0):p>=10?p.toFixed(1):p.toFixed(2));}
function fmtChange(now,then){var pct=Math.round((now/then-1)*100);return (pct>=0?"+":"")+pct.toLocaleString("en-US")+"%";}
function binance(ts){var hour=ts-(ts%3600000);
 return Promise.all([
  fetch("https://api.binance.com/api/v3/klines?symbol=AVAXUSDT&interval=1h&startTime="+hour+"&limit=1").then(function(r){return r.json();}).then(function(k){return (k&&k[0]&&k[0][4])?parseFloat(k[0][4]):null;}),
  fetch("https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT").then(function(r){return r.json();}).then(function(j){return (j&&j.price)?parseFloat(j.price):null;})]);}
function gecko(ts){var d=new Date(ts);var p=function(n){return String(n).padStart(2,"0");};
 var ds=p(d.getUTCDate())+"-"+p(d.getUTCMonth()+1)+"-"+d.getUTCFullYear();
 return Promise.all([
  fetch("https://api.coingecko.com/api/v3/coins/avalanche-2/history?date="+ds).then(function(r){return r.json();}).then(function(j){return j.market_data&&j.market_data.current_price&&j.market_data.current_price.usd;}),
  fetch("https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd").then(function(r){return r.json();}).then(function(j){return j["avalanche-2"]&&j["avalanche-2"].usd;})]);}
binance(D.ts).then(function(pp){return (pp[0]&&pp[1])?pp:gecko(D.ts);}).catch(function(){return gecko(D.ts);})
 .then(function(pp){ if(pp&&pp[0]&&pp[1]) document.getElementById("price").innerHTML=fmtPrice(pp[0])+' <small>'+fmtChange(pp[1],pp[0])+' since</small>'; })
 .catch(function(){});

/* census cohort line */
fetch(SITE+"/api/census").then(function(r){return r.json();}).then(function(c){
  if(c&&c.total&&c.eras&&c.eras[D.era]){
    document.getElementById("cohort").textContent="one of "+c.eras[D.era].toLocaleString("en-US")+" "+D.era.toLowerCase()+" wallets in the census \xB7 "+c.total.toLocaleString("en-US")+" counted";
  }
}).catch(function(){});

/* first bag: still holding? */
if(D.firstContract && D.firstToken){
  fetch("https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api?module=account&action=tokenbalance&contractaddress="+D.firstContract+"&address="+D.addr+"&tag=latest")
   .then(function(r){return r.json();})
   .then(function(j){ if(j&&j.result!==undefined&&j.result!==null){
     document.getElementById("holding").textContent = (String(j.result)!=="0") ? "still holding" : "sold"; } })
   .catch(function(){});
}

/* realized p&l via /api/pnl */
fetch(SITE+"/api/pnl?addr="+D.addr).then(function(r){return r.json();}).then(function(p){
  var note=document.getElementById("pnl-note");
  if(!p || !p.available){ note.textContent="trade history sync coming soon."; return; }
  var s=p.stats||{};
  renderPnl(s);
  if(p.stale){
    fetch(SITE+"/api/pnl?addr="+D.addr+"&refresh=1").then(function(r){return r.json();})
      .then(function(p2){ if(p2 && p2.available) renderPnl(p2.stats); }).catch(function(){});
  }
}).catch(function(){ document.getElementById("pnl-note").textContent="trade history sync coming soon."; });

function renderPnl(s){
  function set(id,o){ var el=document.getElementById(id);
    if(!o){ el.textContent="\u2014"; return; }
    el.innerHTML=o.line+(o.sub?' <small>'+o.sub+'</small>':""); }
  set("pnl-w", s.biggestW);
  set("pnl-l", s.biggestL);
  set("pnl-rt", s.roundtrip);
  set("pnl-ste", s.soldTooEarly);
  if(s.summary && s.summary.total){
    var sm=document.getElementById("pnl-summary");
    sm.innerHTML="total realized: <b style='color:var(--red)'>"+s.summary.total+"</b>"
      +(s.summary.winrate?" \xB7 "+s.summary.winrate+" winrate ("+s.summary.wins+"w / "+s.summary.losses+"l)":"");
    sm.style.display=(s.thin && s.summary.wins+s.summary.losses<=1)?"none":"block";
  }
  document.getElementById("pnl-note").textContent = s.thin
    ? "thin dex history \u2014 we track dex swaps only. arena launchpad, perps and cex trades don't show here."
    : "realized dex trades only \xB7 "+(s.tokens||0)+" tokens traded";
  function list(id, arr){
    var el=document.getElementById(id);
    if(!arr || !arr.length){ el.innerHTML='<span style="color:var(--faint)">\u2014</span>'; return; }
    el.innerHTML=arr.map(function(o){return '<div style="padding:3px 0;border-bottom:1px solid var(--faint)"><b>'+o.line+'</b> <span style="color:var(--dim)">'+o.sub+'</span></div>';}).join("");
  }
  var nLists=((s.topW||[]).length)+((s.topL||[]).length)+((s.roundtrips||[]).length)+((s.soldEarly||[]).length);
  if(nLists>=3){
    list("lg-w", s.topW); list("lg-l", s.topL); list("lg-rt", s.roundtrips); list("lg-ste", s.soldEarly);
    var tg=document.getElementById("ledger-toggle");
    tg.style.display="inline-block";
    tg.onclick=function(){
      var lg=document.getElementById("ledger");
      var open=lg.style.display!=="none";
      lg.style.display=open?"none":"block";
      tg.textContent=open?"full ledger \u2192":"close ledger";
    };
  }
  drawPnlCard(s);
}

/* badge glyphs \u2014 ops: [0,x,y,w,h,c]=rect [1,..]=stroke rect [2,"pts",c]=poly [3,x1,y1,x2,y2,c,w]=line [4,"pts",c]=polyline [5,cx,cy,r,c,f]=circle */
var GLYPHS={
permafrost:[[1,3,3,18,18,"i"],[3,3,9,21,9,"i"],[3,3,15,21,15,"i"],[0,4,16,16,4,"r"]],
furniture:[[0,6,4,2,10,"i"],[0,6,12,12,2,"r"],[0,6,14,2,6,"i"],[0,16,14,2,6,"i"]],
firstlove:[[0,6,6,4,4,"r"],[0,14,6,4,4,"r"],[0,6,10,12,4,"r"],[0,8,14,8,2,"r"],[0,10,16,4,2,"r"]],
allseasons:[[0,4,4,7,7,"i"],[0,13,4,7,7,"i"],[0,4,13,7,7,"i"],[0,13,13,7,7,"r"]],
thousand:[[0,4,5,2,14,"i"],[0,9,5,2,14,"i"],[0,14,5,2,14,"i"],[0,19,5,2,14,"i"],[3,2,17,22,7,"r"]],
immigrant:[[0,3,7,18,2,"i"],[0,5,9,3,8,"i"],[0,16,9,3,8,"i"],[3,4,21,15,21,"r"],[2,"15,18 21,21 15,24","r"]],
registry:[[1,3,7,18,10,"i"],[0,6,10,4,4,"r"],[3,12,10.5,18,10.5,"i",1.5],[3,12,13.5,16,13.5,"i",1.5]],
longwinter:[[2,"3,7 9,7 6,16","i"],[2,"9,7 15,7 12,18","r"],[2,"15,7 21,7 18,16","i"]],
netup:[[0,4,15,4,5,"i"],[0,10,11,4,9,"i"],[0,16,7,4,13,"i"],[2,"15,5 21,5 18,0.5","r"]],
sniper:[[1,6,6,12,12,"i"],[3,12,2,12,6,"i"],[3,12,18,12,22,"i"],[3,2,12,6,12,"i"],[3,18,12,22,12,"i"],[0,10,10,4,4,"r"]],
caughtone:[[4,"3,19 9,13 13,16 20,5","i"],[0,18,3,4,4,"r"]],
soldtop:[[2,"12,7 4,20 20,20","i"],[3,12,7,12,1,"i"],[2,"12,1 18,3 12,5","r"]],
onetrick:[[0,4,17,3,3,"i"],[0,9,5,5,15,"r"],[0,17,15,3,5,"i"]],
deepbench:[[0,3,10,3,10,"i"],[0,7,10,3,10,"i"],[0,11,10,3,10,"r"],[0,15,10,3,10,"i"],[0,19,10,3,10,"i"]],
fullcircle:[[3,6,6,18,6,"i"],[3,18,6,18,18,"i"],[3,18,18,10,18,"i"],[2,"10,14.5 10,21.5 3.5,18","r"]],
exitthere:[[1,4,3,9,16,"i"],[3,11,20.5,18,20.5,"r"],[2,"18,17.5 23,20.5 18,23.5","r"]],
boughttop:[[2,"12,8 4,21 20,21","i"],[3,12,1,12,4,"r"],[2,"9,4 15,4 12,8","r"]],
captain:[[2,"7,4 7,13 15,13","i"],[2,"5,13 17,13 15,19 7,19","i"],[3,2,15.5,22,15.5,"r"]],
graveyard:[[5,12,9,5,"i",1],[0,7,9,10,11,"i"],[0,10,12,4,3,"r"],[3,3,20,21,20,"i"]],
zoo:[[0,4,4,2,16,"i"],[0,8.5,4,2,16,"i"],[0,13,4,2,7,"r"],[0,17.5,4,2,16,"i"],[3,3,4,21,4,"i",1.5],[3,3,20,21,20,"i",1.5]],
exitliq:[[0,4,5,12,4,"i"],[0,11,9,4,4,"i"],[0,11.5,15,3,3,"r"],[0,11.5,20,3,3,"r"]],
stableloss:[[5,12,12,8,"i",0],[0,8,11,8,2,"r"]],
spammagnet:[[0,5,8,4,12,"i"],[0,15,8,4,12,"i"],[3,5,20,19,20,"i"],[0,10,2,4,4,"r"]],
roundvictim:[[3,3,6,21,6,"r"],[0,9,9,6,12,"i"]],
pangolin:[[2,"4,6 4,18 12,12","i"],[2,"10,6 10,18 18,12","r"],[2,"16,6 16,18 22,12","i"]],
rush:[[2,"14,2 7,13 11,13 9,22 17,10 13,10 16,2","r"]],
wonderland:[[1,4,4,16,16,"i"],[3,12,11,7,11,"r"],[3,12,14,8,14,"r"]],
coq:[[2,"7,10 9,5 11,10 13,5 15,10","r"],[0,7,10,10,8,"i"],[2,"17,12 21,14 17,16","i"],[0,13,12,2,2,"b"]],
presale:[[1,5,3,14,18,"i"],[3,8,8,16,8,"i",1.5],[3,8,11,16,11,"i",1.5],[3,8,15,13,19,"r"],[3,13,15,8,19,"r"]],
arena:[[1,4,4,16,16,"i"],[1,8,8,8,8,"i"],[0,11,11,2,2,"r"]],
witness100m:[[4,"2,12 8,6 16,6 22,12 16,18 8,18 2,12","i"],[0,10,10,4,4,"r"]],
homesteader:[[1,4,10,16,10,"i"],[3,12,10,12,2,"i"],[2,"12,2 19,4 12,6","r"]]
};
var BNAMES={permafrost:"permafrost",furniture:"mainnet furniture",firstlove:"first love",allseasons:"all seasons",thousand:"thousand club",immigrant:"immigrant",registry:"on the registry",longwinter:"long winter veteran",netup:"net up",sniper:"sniper",caughtone:"caught one",soldtop:"sold the top",onetrick:"one trick pony",deepbench:"deep bench",fullcircle:"full circle",exitthere:"the exit was right there",boughttop:"bought the top",captain:"captain",graveyard:"graveyard keeper",zoo:"zoo keeper",exitliq:"exit liquidity",stableloss:"lost money on a stablecoin",spammagnet:"spam magnet",roundvictim:"round number victim",pangolin:"pangolin patriot",rush:"rush arrival",wonderland:"wonderland witness",coq:"coq era veteran",presale:"presale survivor",arena:"arena native",witness100m:"block 100m witness",homesteader:"homesteader"};
var ROMAN=["","i","ii","iii"];
function svgFor(id){
  var ops=GLYPHS[id]; if(!ops) return "";
  var cls={i:"g-ink",r:"g-red",b:""};
  var scls={i:"s-ink",r:"s-red"};
  var out='<svg viewBox="0 0 24 24" aria-hidden="true">';
  ops.forEach(function(o){
    if(o[0]===0) out+='<rect x="'+o[1]+'" y="'+o[2]+'" width="'+o[3]+'" height="'+o[4]+'"'+(o[5]==="b"?' fill="#0a0a0a"':' class="'+cls[o[5]]+'"')+'/>';
    else if(o[0]===1) out+='<rect x="'+o[1]+'" y="'+o[2]+'" width="'+o[3]+'" height="'+o[4]+'" class="'+scls[o[5]]+'"/>';
    else if(o[0]===2) out+='<polygon points="'+o[1]+'" class="'+cls[o[2]]+'"/>';
    else if(o[0]===3) out+='<line x1="'+o[1]+'" y1="'+o[2]+'" x2="'+o[3]+'" y2="'+o[4]+'" class="'+scls[o[5]]+'"'+(o[6]?' style="stroke-width:'+o[6]+'"':'')+'/>';
    else if(o[0]===4) out+='<polyline points="'+o[1]+'" class="'+scls[o[2]]+'" fill="none"/>';
    else if(o[0]===5) out+='<circle cx="'+o[1]+'" cy="'+o[2]+'" r="'+o[3]+'"'+(o[5]?' class="'+cls[o[4]]+'"':' class="'+scls[o[4]]+'"')+'/>';
  });
  return out+"</svg>";
}
function drawGlyph(x,id,ox,oy,s,inv){
  var ops=GLYPHS[id]; if(!ops) return;
  var k=s/24;
  var R=window.THEME_HEX||"#e84142";
  var C={i:inv?"#0a0a0a":"#f2f2f2",r:inv?"#0a0a0a":R,b:inv?R:"#0a0a0a"};
  ops.forEach(function(o){
    if(o[0]===0){ x.fillStyle=C[o[5]]; x.fillRect(ox+o[1]*k,oy+o[2]*k,o[3]*k,o[4]*k); }
    else if(o[0]===1){ x.strokeStyle=C[o[5]]; x.lineWidth=2*k; x.strokeRect(ox+o[1]*k,oy+o[2]*k,o[3]*k,o[4]*k); }
    else if(o[0]===2){ var p=o[1].split(" ").map(function(q){return q.split(",").map(Number);}); x.fillStyle=C[o[2]]; x.beginPath(); x.moveTo(ox+p[0][0]*k,oy+p[0][1]*k); p.slice(1).forEach(function(q){x.lineTo(ox+q[0]*k,oy+q[1]*k);}); x.closePath(); x.fill(); }
    else if(o[0]===3){ x.strokeStyle=C[o[5]]; x.lineWidth=(o[6]||2)*k; x.beginPath(); x.moveTo(ox+o[1]*k,oy+o[2]*k); x.lineTo(ox+o[3]*k,oy+o[4]*k); x.stroke(); }
    else if(o[0]===4){ var p2=o[1].split(" ").map(function(q){return q.split(",").map(Number);}); x.strokeStyle=C[o[2]]; x.lineWidth=2*k; x.beginPath(); x.moveTo(ox+p2[0][0]*k,oy+p2[0][1]*k); p2.slice(1).forEach(function(q){x.lineTo(ox+q[0]*k,oy+q[1]*k);}); x.stroke(); }
    else if(o[0]===5){ x.beginPath(); x.arc(ox+o[1]*k,oy+o[2]*k,o[3]*k,0,Math.PI*2); if(o[5]){x.fillStyle=C[o[4]];x.fill();}else{x.strokeStyle=C[o[4]];x.lineWidth=2*k;x.stroke();} }
  });
}
var EARNED=null;
fetch(SITE+"/api/badges?addr="+D.addr).then(function(r){return r.json();}).then(function(p){
  if(!p||!p.badges||!p.badges.length) return;
  EARNED=p.badges;
  if(CUR.cardBadges&&CUR.cardBadges.length){
    EARNED.sort(function(a,b){
      var ai=CUR.cardBadges.indexOf(a.id), bi=CUR.cardBadges.indexOf(b.id);
      return (ai<0?9:ai)-(bi<0?9:bi);
    });
  }
  var el=document.getElementById("brack");
  el.innerHTML=p.badges.map(function(b,i){
    var nm=BNAMES[b.id]||b.id;
    var tier=b.tier?' <span class="bt">'+ROMAN[b.tier]+'</span>':'';
    var rar=(b.rarity&&b.rarity.total>=20)
      ? (Math.round(b.rarity.count/b.rarity.total*1000)/10)+"% of census"
      : "held by "+((b.rarity&&b.rarity.count)||1)+((b.rarity&&b.rarity.count)===1?" wallet":" wallets")+" so far";
    return '<span class="btile'+(i===0?' medal':'')+'" tabindex="0" aria-label="'+nm+'">'+svgFor(b.id)
      +'<span class="tip"><span class="tl">EVIDENCE</span><span class="tn">'+nm+tier+'</span><span class="tr">'+rar+'</span><span class="tv">'+b.ev+'</span></span></span>';
  }).join("");
  if(LAST_PNL) drawPnlCard(LAST_PNL);
}).catch(function(){});

/* ---- claim / status / oracle ---- */
var CLAIMED=false;
var THEMES={red:"#e84142",snow:"#f2f2f2",gold:"#d4a017",teal:"#2aa198",violet:"#7c5cff"};
var CUR={status:"",theme:"red",cardBadges:[]};
function applyTheme(t){
  var c=THEMES[t]||THEMES.red;
  document.documentElement.style.setProperty("--red",c);
  window.THEME_HEX=c;
  if(LAST_PNL) drawPnlCard(LAST_PNL);
}
function claimInfo(){
  fetch(SITE+"/api/claim?addr="+D.addr+"&info=1").then(function(r){return r.json();}).then(function(c){
    CLAIMED=!!(c&&c.claimed);
    if(CLAIMED){
      CUR.status=c.status||""; CUR.theme=c.theme||"red"; CUR.cardBadges=c.cardBadges||[];
      applyTheme(CUR.theme);
      if(c.status){ document.getElementById("status-text").textContent=c.status; document.getElementById("status-line").style.display="block"; }
      var s=document.getElementById("settled");
      s.textContent="settled "+new Date(c.settledAt).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}).toLowerCase()+(c.settledBlock?" \xB7 block #"+c.settledBlock.toLocaleString("en-US"):"");
      s.style.display="inline";
      document.getElementById("status-btn").style.display="inline-block";
      document.getElementById("oracle-sec").style.display="block";
    } else {
      document.getElementById("claim-btn").style.display="inline-block";
    }
  }).catch(function(){});
}
claimInfo();
function cmsg(t,err){ var m=document.getElementById("claim-msg"); m.textContent=t; m.style.color=err?"var(--red)":"var(--dim)"; m.style.display="block"; }
function withSig(buildMsg, done){
  if(!window.ethereum){ cmsg("no wallet detected. hardware-wallet route: ask on x @Alf444_ for the self-send flow.",1); return; }
  window.ethereum.request({method:"eth_requestAccounts"}).then(function(accs){
    var acc=(accs&&accs[0]||"").toLowerCase();
    if(acc!==D.addr){ cmsg("connected wallet is "+acc.slice(0,8)+"\u2026 \u2014 this page belongs to "+D.addr.slice(0,8)+"\u2026. switch accounts.",1); return; }
    fetch(SITE+"/api/claim?addr="+D.addr).then(function(r){return r.json();}).then(function(n){
      if(!n||!n.nonce){ cmsg("couldn't get a nonce. try again.",1); return; }
      var msg=buildMsg(n.nonce);
      window.ethereum.request({method:"personal_sign",params:[msg,acc]}).then(function(sig){ done(sig); })
        .catch(function(){ cmsg("signature declined. no signature, no ownership \u2014 that's the whole system.",1); });
    });
  }).catch(function(){ cmsg("wallet connection declined.",1); });
}
document.getElementById("claim-btn").addEventListener("click",function(){
  cmsg("one signature. costs nothing, moves nothing, proves everything.");
  withSig(function(nonce){ return "avax100m.xyz\\nclaim page for "+D.addr+"\\nnonce: "+nonce; }, function(sig){
    fetch(SITE+"/api/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({addr:D.addr,sig:sig})})
      .then(function(r){return r.json();}).then(function(j){
        if(j&&j.ok){
          cmsg("page claimed. settled at block #"+(j.settledBlock?j.settledBlock.toLocaleString("en-US"):"?")+".");
          document.getElementById("claim-btn").style.display="none";
          // unlock immediately from the response \u2014 don't wait on a re-read
          CLAIMED=true;
          var s=document.getElementById("settled");
          s.textContent="settled "+new Date(j.settledAt||Date.now()).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}).toLowerCase()+(j.settledBlock?" \xB7 block #"+j.settledBlock.toLocaleString("en-US"):"");
          s.style.display="inline";
          document.getElementById("status-btn").style.display="inline-block";
          document.getElementById("oracle-sec").style.display="block";
          setTimeout(claimInfo, 1500);
        }
        else cmsg((j&&j.error)||"claim failed.",1);
      });
  });
});
document.getElementById("status-btn").addEventListener("click",function(){
  var p=document.getElementById("cust");
  if(p.style.display==="block"){ p.style.display="none"; return; }
  document.getElementById("cust-status").value=CUR.status||"";
  var th=document.getElementById("cust-themes");
  th.innerHTML=Object.keys(THEMES).map(function(k){
    return '<button data-t="'+k+'" title="'+k+'" style="width:30px;height:30px;background:'+THEMES[k]+';border:2px solid '+(k===CUR.theme?"var(--ink)":"transparent")+';cursor:pointer"></button>';
  }).join("");
  th.querySelectorAll("button").forEach(function(b){ b.addEventListener("click",function(){
    CUR.theme=b.getAttribute("data-t"); applyTheme(CUR.theme);
    th.querySelectorAll("button").forEach(function(x){ x.style.borderColor=x===b?"var(--ink)":"transparent"; });
  });});
  var bd=document.getElementById("cust-badges");
  if(EARNED&&EARNED.length){
    bd.innerHTML=EARNED.map(function(b){
      var on=CUR.cardBadges.indexOf(b.id)>-1;
      return '<button data-b="'+b.id+'" class="btn" style="'+(on?"border-color:var(--red);color:var(--red);":"")+'">'+(BNAMES[b.id]||b.id)+'</button>';
    }).join("");
    bd.querySelectorAll("button").forEach(function(b){ b.addEventListener("click",function(){
      var id=b.getAttribute("data-b"); var i=CUR.cardBadges.indexOf(id);
      if(i>-1){ CUR.cardBadges.splice(i,1); b.style.borderColor=""; b.style.color=""; }
      else if(CUR.cardBadges.length<3){ CUR.cardBadges.push(id); b.style.borderColor="var(--red)"; b.style.color="var(--red)"; }
    });});
  } else { bd.innerHTML='<span style="font-size:10px;color:var(--dim)">badges are still computing \u2014 come back in a minute.</span>'; }
  p.style.display="block";
});
document.getElementById("cust-cancel").addEventListener("click",function(){ document.getElementById("cust").style.display="none"; });
document.getElementById("cust-save").addEventListener("click",function(){
  var st=(document.getElementById("cust-status").value||"").toLowerCase().replace(/s+/g," ").trim().slice(0,100);
  var theme=CUR.theme, badges=CUR.cardBadges.join(",");
  withSig(function(nonce){ return "avax100m.xyz\\nupdate profile for "+D.addr+"\\nstatus: "+st+"\\ntheme: "+theme+"\\nbadges: "+badges+"\\nnonce: "+nonce; }, function(sig){
    fetch(SITE+"/api/claim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({addr:D.addr,sig:sig,action:"profile",status:st,theme:theme,cardBadges:badges})})
      .then(function(r){return r.json();}).then(function(j){
        if(j&&j.ok){
          CUR.status=j.status||""; CUR.theme=j.theme||"red"; CUR.cardBadges=j.cardBadges||[];
          if(j.status){ document.getElementById("status-text").textContent=j.status; document.getElementById("status-line").style.display="block"; }
          else document.getElementById("status-line").style.display="none";
          applyTheme(CUR.theme);
          if(EARNED&&CUR.cardBadges.length){
            EARNED.sort(function(a,b){
              var ai=CUR.cardBadges.indexOf(a.id), bi=CUR.cardBadges.indexOf(b.id);
              return (ai<0?9:ai)-(bi<0?9:bi);
            });
            if(LAST_PNL) drawPnlCard(LAST_PNL);
          }
          document.getElementById("cust").style.display="none";
          cmsg("saved. signed. permanent-ish.");
        } else cmsg((j&&j.error)||"rejected.",1);
      });
  });
});

/* ---- the oracle ---- *//* ---- the oracle ---- */
function oracleLines(){
  var L=[];
  var ids={}; (EARNED||[]).forEach(function(b){ids[b.id]=b;});
  var s=LAST_PNL||{};
  var sm=s.summary||{}; var fb=null;
  var rt=s.roundtrip, ste=s.soldTooEarly, W=s.biggestW;
  var wr=sm.winrate?parseInt(sm.winrate):null;
  var rtSym=rt&&rt.sub?("$"+(rt.sub.split("\xB7")[0]||"").replace("$","").trim()):null;
  var steSym=ste?ste.line:null;
  var wSym=W?W.sub:null; var wUsd=W?W.line:null;
  var toks=s.tokens||null;
  var year=new Date(D.ts||Date.now()).getUTCFullYear();
  function add(c,t){ if(c) L.push(t); }
  add(ids.captain&&rt, "you watched "+(rt?rt.sub.split("\xB7")[1].trim():"the peak")+" become dust in real time and chose violence against yourself.");
  add(ids.captain&&rtSym, "you didn't sell "+rtSym+" at the top. you won't sell it at the bottom. this is a hostage situation and you're both parties.");
  add(ids.fullcircle, "diamond hands is a personality when you're up. you're not up.");
  add(ste&&steSym, "you sold "+steSym+" early enough to watch the whole pump from outside. front row. no ticket.");
  add(ste, "your patience lasted exactly until it mattered.");
  add(ids.exitliq&&wr!==null, "winrate "+wr+"%. the market doesn't thank its liquidity providers, but it should.");
  add(ids.exitliq, "you are the counterparty everyone prays for.");
  add(ids.sniper&&wr!==null, wr+"% winrate. insufferable at dinner parties, probably.");
  add(ids.onetrick&&wSym, wSym+" carried you like luggage.");
  add(ids.onetrick, "one token made you. every trade since has been you trying to prove it wasn't luck. the ledger disagrees.");
  add(ids.stableloss, "you lost money on a stablecoin. it has one job. you gave it a second one: humbling you.");
  add(ids.zoo&&toks, toks+" tokens traded. at some point this stopped being investing and became collecting.");
  add(ids.netup, "net positive. congratulations on beating an opponent that was yourself the whole time.");
  add(ids.graveyard, "your wallet is a cemetery with a block explorer.");
  add(ids.thousand&&D.txs, D.txs.toLocaleString("en-US")+" transactions. the gas alone could have been a position.");
  add(ids.caughtone, "you caught a big one once. you'll be paying for that high for the rest of your life.");
  add(ids.firstlove, "still holding your first token. that's not loyalty, that's a shrine.");
  add(D.days>1400, "here since "+year+". survived everything except your own entries.");
  add(ids.permafrost||D.days>1800, "og status: confirmed. og returns: pending.");
  add(ids.wonderland, "(9,9). you trusted a man named daniele with your money and you would absolutely do it again.");
  add(ids.coq, "you traded the chicken coin and you're still here explaining it to people.");
  add(ids.boughttop, "your average entry is within 20% of the top. you don't buy dips. you provide them.");
  add(ids.soldtop, "you actually sold a top once. statistically, that was someone else using your wallet.");
  add(ids.spammagnet, "scammers airdrop you more consistently than your investments pay out.");
  add(ids.roundvictim, "your bag died just short of the round number. the universe is not subtle with you.");
  add(ids.immigrant, "you bridged from ethereum for the cheap gas and stayed for the emotional damage.");
  add(ids.pangolin, "first swap on pangolin. early to everything except profit.");
  add(ids.rush, "you arrived when they were paying people to be here. you stayed after they stopped. interesting choice.");
  add(ids.arena, "arena summer. 1,800 tokens a day and you still picked wrong.");
  add(ids.deepbench, "five tokens over a grand each. genuinely competent. this square is as confused as you are.");
  add(ids.exitliq&&ids.zoo&&toks&&wr!==null, toks+" tokens, "+wr+"% winrate. quantity was never going to fix this.");
  add(ids.captain&&ids.netup&&rtSym, "net positive AND riding "+rtSym+" to zero. you contain multitudes. all of them bagholders.");
  add(ids.onetrick&&ids.stableloss&&wUsd, "you made "+wUsd+" on one coin and lost money on a dollar. the range is incredible.");
  // always eligible
  L.push("the chain has seen everything you've done. it's not mad. it's disappointed.");
  L.push("you call it a strategy. the mempool calls it content.");
  L.push("somewhere out there is the person who sold you every bag you hold. they think about you fondly.");
  L.push("you've never been early. you've been first to be late.");
  L.push("the blockchain is permanent. unfortunately, so is your entry price.");
  L.push("you don't have a portfolio. you have evidence.");
  L.push("day "+((D.days||0).toLocaleString("en-US"))+" on mainnet. the blocks kept coming. so did you. neither of you knows why.");
  L.push("you check this page more often than your positions. correct priorities, honestly.");
  return L;
}
var lastOracle=-1, lastLine="";
document.getElementById("oracle").addEventListener("click",function(){
  var L=oracleLines(); if(!L.length) return;
  var i; do { i=Math.floor(Math.random()*L.length); } while(L.length>1 && i===lastOracle);
  lastOracle=i; lastLine=L[i];
  var out=document.getElementById("oracle-out"); out.textContent="";
  var k=0; var t=setInterval(function(){ out.textContent=lastLine.slice(0,++k); if(k>=lastLine.length){ clearInterval(t); document.getElementById("oracle-share").style.display="inline-block"; } },14);
});
document.getElementById("oracle-share").addEventListener("click",function(){
  var t='the chain read my wallet: "'+lastLine+'"';
  window.open("https://twitter.com/intent/tweet?text="+encodeURIComponent(t)+"&url="+encodeURIComponent(PAGE),"_blank");
});

/* .avax reverse resolution */
var AVVY_NAME = null;
fetch(SITE+"/api/resolve?addr="+D.addr).then(function(r){return r.json();}).then(function(j){
  if(j && j.name){
    AVVY_NAME = j.name;
    var el = document.getElementById("avvy");
    el.textContent = j.name;
    el.style.display = "block";
    if(LAST_PNL) drawPnlCard(LAST_PNL); // re-render the card wearing the name
  }
}).catch(function(){});
var LAST_PNL = null;

/* shareable p&l card */
function drawPnlCard(s){
  if(!s.biggestW && !s.biggestL && !s.roundtrip && !s.soldTooEarly) return;
  LAST_PNL = s;
  var c=document.getElementById("pnl-card"),x=c.getContext("2d");
  var W=1080,H=1350,mono="monospace";
  x.fillStyle="#0a0a0a";x.fillRect(0,0,W,H);
  x.strokeStyle=(window.THEME_HEX||"#e84142");x.lineWidth=6;x.strokeRect(28,28,W-56,H-56);
  x.strokeStyle="#2a2a2a";x.lineWidth=2;x.strokeRect(48,48,W-96,H-96);
  x.textBaseline="top";
  x.fillStyle="#7a7a7a";x.font="600 30px "+mono;
  x.fillText("AVALANCHE C-CHAIN",92,104);
  x.fillStyle=(window.THEME_HEX||"#e84142");x.font="800 84px "+mono;
  x.fillText("REALIZED P&L",92,150);
  x.fillStyle="#7a7a7a";x.font="400 27px "+mono;
  var subline = RANK.toLowerCase()+" \xB7 since "+ERA.toLowerCase();
  if(s.summary && s.summary.total) subline += " \xB7 total "+s.summary.total.toLowerCase()+(s.summary.winrate?" \xB7 "+s.summary.winrate+" winrate":"");
  x.fillText(subline.length>66?subline.slice(0,66):subline,92,254);
  x.fillStyle="#2a2a2a";x.fillRect(92,306,W-184,2);
  function block(k,o,y){
    x.fillStyle="#7a7a7a";x.font="600 26px "+mono;x.fillText(k,92,y);
    if(!o){ x.fillStyle="#3d3d3d";x.font="700 54px "+mono;x.fillText("\u2014",92,y+38); return; }
    x.fillStyle=(window.THEME_HEX||"#e84142");x.font="800 60px "+mono;
    x.fillText(o.line.replace(/<[^>]*>/g,""),92,y+38);
    if(o.sub){ x.fillStyle="#f2f2f2";x.font="400 28px "+mono;
      var t=o.sub.replace(/<[^>]*>/g,"");
      x.fillText(t.length>58?t.slice(0,58):t,92,y+112); }
  }
  block("BIGGEST W", s.biggestW, 352);
  block("BIGGEST L", s.biggestL, 552);
  block("BIGGEST ROUNDTRIP", s.roundtrip, 752);
  block("SOLD TOO EARLY", s.soldTooEarly, 952);
  if(EARNED && EARNED.length){
    var bx=92, by=1128, bh=56;
    EARNED.slice(0,3).forEach(function(b,i){
      var nm=(BNAMES[b.id]||b.id).toUpperCase()+(b.tier?" "+ROMAN[b.tier].toUpperCase():"");
      x.font="700 22px "+mono;
      var tw=x.measureText(nm).width;
      var cw=16+30+10+tw+16;
      var medal=(i===0);
      if(medal){ x.fillStyle=(window.THEME_HEX||"#e84142"); x.fillRect(bx,by,cw,bh); }
      else { x.strokeStyle="#2a2a2a"; x.lineWidth=2; x.strokeRect(bx,by,cw,bh); }
      drawGlyph(x,b.id,bx+16,by+(bh-30)/2,30,medal);
      x.fillStyle=medal?"#0a0a0a":"#f2f2f2";
      x.textBaseline="middle";
      x.fillText(nm,bx+16+30+10,by+bh/2+1);
      x.textBaseline="top";
      bx+=cw+12;
    });
  } else {
    x.fillStyle="#3d3d3d";x.font="400 24px "+mono;
    x.fillText("realized only \xB7 tracked tokens only",92,1152);
  }
  x.fillStyle="#2a2a2a";x.fillRect(92,1200,W-184,2);
  x.fillStyle="#7a7a7a";x.font="600 24px "+mono;
  x.fillText(AVVY_NAME ? AVVY_NAME : (D.addr.slice(0,10)+"\u2026"+D.addr.slice(-8)),92,1228);
  x.fillStyle=(window.THEME_HEX||"#e84142");x.textAlign="right";
  x.fillText("AVAX100M.XYZ",W-92,1228);
  x.textAlign="left";
  document.getElementById("pnl-card-wrap").style.display="block";
  document.getElementById("pnl-dl").onclick=function(){
    var a=document.createElement("a");a.download="avax-pnl.png";a.href=c.toDataURL("image/png");a.click();
  };
  document.getElementById("pnl-share").onclick=function(){
    var bits=[];
    if(s.biggestW) bits.push("biggest w: "+s.biggestW.line.toLowerCase()+" on "+s.biggestW.sub.toLowerCase());
    if(s.roundtrip) bits.push("roundtripped "+s.roundtrip.line.toLowerCase().replace("-","")+" like a champ");
    var t=(AVVY_NAME?AVVY_NAME+". ":"")+"my avalanche p&l. "+bits.join(". ")+". road to block 100,000,000.";
    var isMobile=/android|iphone|ipad|ipod/i.test(navigator.userAgent);
    if(!isMobile && window.ClipboardItem && navigator.clipboard && navigator.clipboard.write){
      try{ navigator.clipboard.write([new ClipboardItem({"image/png":new Promise(function(res){c.toBlob(res,"image/png");})})])
        .then(function(){ document.getElementById("pnl-note").textContent="card copied \u2014 paste it (ctrl+v) into your post."; }).catch(function(){}); }catch(e){}
    } else if(isMobile){ document.getElementById("pnl-note").textContent="tip: download the card, then attach it in your post."; }
    window.open("https://twitter.com/intent/tweet?text="+encodeURIComponent(t)+"&url="+encodeURIComponent(PAGE),"_blank");
  };
}
})();
</script>
</body>
</html>`;
}
var wallet_default = async (req) => {
  const url = new URL(req.url);
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
  const m = url.pathname.match(/^\/w\/(0x[0-9a-fA-F]{40})\/?$/);
  if (!m) return Response.redirect(site, 302);
  if (m[1] !== m[1].toLowerCase()) return Response.redirect(site + "/w/" + m[1].toLowerCase(), 301);
  let w = null;
  try {
    w = await fetchWallet(m[1]);
  } catch {
  }
  if (!w) return Response.redirect(site, 302);
  return new Response(page(w, site), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" }
  });
};
var config = { path: "/w/*" };
export {
  config,
  wallet_default as default
};
