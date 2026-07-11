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
  const [txj, tokj, cntj, blkj] = await Promise.all([
    fetch(base + "&action=txlist").then((r) => r.json()),
    fetch(base + "&action=tokentx").then((r) => r.json()).catch(() => ({ result: [] })),
    fetch(API + "?module=proxy&action=eth_getTransactionCount&address=" + addr + "&tag=latest").then((r) => r.json()).catch(() => null),
    fetch(API + "?module=proxy&action=eth_blockNumber").then((r) => r.json()).catch(() => null)
  ]);
  if (!txj.result || !txj.result.length) return null;
  const tx = txj.result[0];
  const ts = parseInt(tx.timeStamp, 10) * 1e3;
  const blk = parseInt(tx.blockNumber, 10);
  const now = Date.now();
  const days = Math.floor((now - ts) / 864e5);
  const pct = Math.min(100, (now - ts) / (now - GENESIS) * 100);
  const curBlock = blkj && blkj.result ? parseInt(blkj.result, 16) : 1e8;
  const early = blk / curBlock * 100;
  const earlyStr = (early < 0.01 ? "<0.01" : early < 1 ? early.toFixed(2) : early.toFixed(1)) + "% of all blocks";
  const txc = cntj && cntj.result ? parseInt(cntj.result, 16) : null;
  const mv = firstInteresting(txj.result, tokj && tokj.result || [], addr);
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
  const D = JSON.stringify({ addr: w.addr, ts: w.ts, era: w.era[1], firstContract: w.mv.contract || null, firstToken: w.mv.key === "FIRST TOKEN" ? w.mv.val : null });
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
  <div class="hero">
    <div class="eyebrow">avalanche c-chain \xB7 wallet profile</div>
    <h1>${esc(w.rank[1])}</h1>
    <div class="tagline">${esc(w.rank[2])}</div>
    <div class="addrline">
      <span class="a">${esc(short)}</span>
      <button class="btn" id="copy-addr">copy address</button>
      <button class="btn" id="copy-link">copy page link</button>
      <button class="btn primary" id="share-x">share on x</button>
    </div>
  </div>

  <section>
    <h2>origin</h2>
    <div class="grid">
      <div class="cell"><div class="k">era of arrival</div><div class="v red">${esc(w.era[1])}</div></div>
      <div class="cell"><div class="k">first seen</div><div class="v">${esc(w.dateStr)}<br><small>#${w.blk.toLocaleString("en-US")}</small></div></div>
      <div class="cell"><div class="k">${esc(w.mv.key.toLowerCase())}</div><div class="v">${esc(w.mv.val)}</div><div id="holding" style="font-size:11px;color:var(--dim);margin-top:4px"></div></div>
      <div class="cell"><div class="k">arrived in the first</div><div class="v red">${esc(w.earlyStr)}</div></div>
      <div class="cell"><div class="k">days on mainnet</div><div class="v">${w.days.toLocaleString("en-US")}</div></div>
      <div class="cell"><div class="k">mainnet survived</div><div class="v">${w.pct.toFixed(1)}%</div></div>
      <div class="cell"><div class="k">tx count</div><div class="v">${w.txc === null ? "\u2014" : w.txc.toLocaleString("en-US")}</div></div>
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
    <div class="note" id="pnl-note">syncing trade history\u2026</div>
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
function binance(ts){var day=ts-(ts%86400000);
 return Promise.all([
  fetch("https://api.binance.com/api/v3/klines?symbol=AVAXUSDT&interval=1d&startTime="+day+"&limit=1").then(function(r){return r.json();}).then(function(k){return (k&&k[0]&&k[0][4])?parseFloat(k[0][4]):null;}),
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
  function set(id,o){ var el=document.getElementById(id);
    if(!o){ el.textContent="\u2014"; return; }
    el.innerHTML=o.line+(o.sub?' <small>'+o.sub+'</small>':""); }
  set("pnl-w", s.biggestW);
  set("pnl-l", s.biggestL);
  set("pnl-rt", s.roundtrip);
  set("pnl-ste", s.soldTooEarly);
  note.textContent = "realized only \xB7 tracked tokens only \xB7 "+(s.tokens||0)+" tokens traded";
}).catch(function(){ document.getElementById("pnl-note").textContent="trade history sync coming soon."; });
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
