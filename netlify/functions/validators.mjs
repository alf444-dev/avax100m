import { getStore } from "@netlify/blobs";
import {
  fetchCurrentSupply,
  fetchCurrentValidators,
  foldValidators,
  queryDirectory
} from "./lib/pchain.mjs";

// /validators — P-chain validator section: network staking stats, a sortable
// directory, single-validator lookup, and per-validator reward/APR. One Netlify
// function serves both the HTML page and the JSON API, branching on the path.

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
    set: async (k, v) => { m.set(k, v); },
    delete: async (k) => { m.delete(k); }
  };
}

var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
const json = (obj, status = 200, extra) => new Response(JSON.stringify(obj), { status, headers: extra ? Object.assign({}, HEADERS, extra) : HEADERS });

var SNAP_KEY = "val1/primary";
var WORK_KEY = "work/" + SNAP_KEY;
var SNAP_TTL = 300 * 1e3;   // serve a folded snapshot for ~5 minutes
var LEASE_TTL = 45 * 1e3;   // a build lease is stale after 45s

/* current AVAX/USD spot: binance primary (keyless), coingecko fallback — same as index.html/wallet.mjs */
async function avaxUsd() {
  try {
    const r = await fetch("https://api.binance.com/api/v3/ticker/price?symbol=AVAXUSDT");
    if (r.ok) { const j = await r.json(); const p = parseFloat(j && j.price); if (p > 0) return p; }
  } catch {}
  try {
    const r = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=avalanche-2&vs_currencies=usd");
    if (r.ok) { const j = await r.json(); const p = j && j["avalanche-2"] && j["avalanche-2"].usd; if (p > 0) return p; }
  } catch {}
  return null;
}

// Compute-on-demand + persist to Blobs, guarded by a short lease so a slow P-chain
// fetch isn't run by many requests at once. Returns { pending:true } if another
// request is already building and no snapshot is cached yet.
async function getSnapshot() {
  const store = storeOr("validators");
  if (store) {
    const cached = await store.get(SNAP_KEY, { type: "json" }).catch(() => null);
    if (cached && Number.isFinite(cached.asOf) && Date.now() - cached.asOf < SNAP_TTL) return cached;
  }
  const workStore = storeOr("validators", { consistency: "strong" }) || store;
  if (workStore) {
    const lease = await workStore.get(WORK_KEY, { type: "json" }).catch(() => null);
    if (lease && Number.isFinite(lease.t) && Date.now() - lease.t < LEASE_TTL) {
      if (store) { const stale = await store.get(SNAP_KEY, { type: "json" }).catch(() => null); if (stale) return stale; }
      return { pending: true };
    }
    await workStore.set(WORK_KEY, JSON.stringify({ t: Date.now() })).catch(() => {});
  }
  try {
    const [validators, supply, px] = await Promise.all([
      fetchCurrentValidators(),
      fetchCurrentSupply().catch(() => null),
      avaxUsd().catch(() => null)
    ]);
    const snap = Object.assign({}, foldValidators(validators, supply), { avaxUsd: px });
    if (store) await store.set(SNAP_KEY, JSON.stringify(snap)).catch(() => {});
    return snap;
  } finally {
    if (workStore) await workStore.delete(WORK_KEY).catch(() => {});
  }
}

var validators_default = async (req) => {
  const url = new URL(req.url);
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");

  if (!url.pathname.startsWith("/api/")) {
    return new Response(page(site), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
  }

  let snap;
  try { snap = await getSnapshot(); }
  catch (e) { return json({ error: "p-chain unavailable", reason: String((e && e.message) || e) }, 503); }
  if (snap && snap.pending) return json({ pending: true, retryAfter: 5 }, 202, { "retry-after": "5" });

  const node = url.searchParams.get("node");
  if (node) {
    const detail = snap.byNode[node] || snap.byNode[node.trim()] || null;
    if (!detail) return json({ none: true, node });
    return json({ node: detail, avaxUsd: snap.avaxUsd, asOf: snap.asOf });
  }

  const p = queryDirectory(snap.directory, {
    sort: url.searchParams.get("sort") || "stake",
    dir: url.searchParams.get("dir") || "desc",
    q: url.searchParams.get("q") || "",
    limit: url.searchParams.get("limit") || 50,
    offset: url.searchParams.get("offset") || 0
  });
  return json({
    stats: snap.stats,
    directory: p.rows,
    page: { total: p.total, offset: p.offset, limit: p.limit, sort: p.sort, dir: p.dir, q: p.q },
    avaxUsd: snap.avaxUsd,
    asOf: snap.asOf
  });
};

function page(site) {
  const title = "validators \xB7 avax100m.xyz";
  const desc = "Live Avalanche P-Chain validators — network staking stats, the full validator directory, single-node lookup, and per-validator rewards. No connect, just a read.";
  const pageUrl = site + "/p-chain";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16.png">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="description" content="${desc}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="website">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${title}">
<meta property="og:description" content="${desc}">
<meta property="og:image" content="${site}/og.png">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${title}">
<meta name="twitter:description" content="${desc}">
<meta name="twitter:image" content="${site}/og.png">
<style>
:root{--bg:#0a0a0a;--ink:#f2f2f2;--dim:#7a7a7a;--faint:#2a2a2a;--red:#e84142;
--mono:ui-monospace,"SF Mono","Cascadia Mono",Menlo,Consolas,monospace}
*{margin:0;padding:0;box-sizing:border-box}
body{background:var(--bg);color:var(--ink);font-family:var(--mono);font-size:14px;line-height:1.6}
a{color:var(--ink)}
::selection{background:var(--red);color:#000}
.wrap{max-width:1000px;margin:0 auto;padding:0 20px}
header{border-bottom:1px solid var(--faint)}
.hbar{display:flex;justify-content:space-between;align-items:center;height:52px}
.logo{font-weight:700;letter-spacing:.08em;text-decoration:none;display:inline-flex;align-items:center;gap:9px;color:var(--ink)}
.logo b{color:var(--red)}
.logo img{display:block}
.nav{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);text-decoration:none}
.nav:hover{color:var(--red)}
.hero{padding:56px 0 36px;border-bottom:1px solid var(--faint)}
.eyebrow{font-size:11px;letter-spacing:.24em;color:var(--dim);text-transform:uppercase;margin-bottom:14px}
.eyebrow b{color:var(--red)}
h1{font-size:clamp(40px,8vw,72px);line-height:1;color:var(--red);letter-spacing:-.01em}
.tagline{color:var(--dim);margin-top:12px;max-width:660px}
section{padding:40px 0;border-bottom:1px solid var(--faint)}
h2{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--red);font-weight:700;margin-bottom:8px}
.sub{color:var(--dim);margin-bottom:22px;max-width:700px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--faint);border:1px solid var(--faint);min-height:84px}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}}
.cell{background:var(--bg);padding:16px 14px;min-height:84px}
.cell .k{font-size:10px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}
.cell .v{font-size:22px;font-weight:700;margin-top:6px;word-break:break-word}
.cell .v.red{color:var(--red)}
.cell .v small{font-size:11px;color:var(--dim);font-weight:400}
.check-row{display:flex;gap:10px;flex-wrap:wrap}
.check-row input{flex:1;min-width:240px;background:var(--bg);border:1px solid var(--faint);color:var(--ink);font-family:var(--mono);font-size:14px;padding:11px 13px}
.check-row input:focus{outline:none;border-color:var(--red)}
.btn{background:var(--red);border:1px solid var(--red);color:#000;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:11px 20px;cursor:pointer}
.btn:hover{background:var(--ink);border-color:var(--ink)}
.btn.ghost{background:transparent;color:var(--dim);border-color:var(--faint);font-weight:400}
.btn.ghost:hover{color:var(--red);border-color:var(--red)}
.msg{margin-top:14px;font-size:12px;color:var(--dim);min-height:18px;letter-spacing:.04em}
.detail{margin-top:18px;border:1px solid var(--faint);display:none}
.r-row{display:flex;justify-content:space-between;gap:16px;padding:10px 14px;border-bottom:1px solid var(--faint)}
.r-row:last-child{border-bottom:none}
.r-row .k{font-size:10px;letter-spacing:.16em;text-transform:uppercase;color:var(--dim);white-space:nowrap}
.r-row .v{text-align:right;word-break:break-all}
.r-row .v b{color:var(--red)}
.tablewrap{overflow-x:auto;border:1px solid var(--faint)}
table.vtable{width:100%;border-collapse:collapse;font-size:12px;min-width:660px}
.vtable th{text-align:right;padding:10px 12px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);border-bottom:1px solid var(--faint);white-space:nowrap;user-select:none}
.vtable th[data-sort]{cursor:pointer}
.vtable th:first-child{text-align:left}
.vtable th[data-sort]:hover{color:var(--red)}
.vtable th.act{color:var(--red)}
.vtable td{text-align:right;padding:10px 12px;border-bottom:1px solid var(--faint);white-space:nowrap}
.vtable td:first-child{text-align:left}
.vtable tbody tr{cursor:pointer}
.vtable tbody tr:hover{background:#141414}
.vtable .node{color:var(--ink)}
.vtable .off{color:var(--dim)}
.morerow{display:flex;justify-content:space-between;align-items:center;margin-top:14px;gap:12px;flex-wrap:wrap}
.count{font-size:11px;color:var(--dim);letter-spacing:.06em}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--faint);vertical-align:middle}
.dot.on{background:#3fb950}
footer{padding:36px 0 64px;color:var(--dim);font-size:12px}
footer .frow{display:flex;justify-content:space-between;gap:20px;flex-wrap:wrap}
footer a{color:var(--dim);text-decoration:none;border-bottom:1px solid var(--faint)}
footer a:hover{color:var(--red);border-color:var(--red)}
</style>
</head>
<body>
<header><div class="wrap hbar">
  <a class="logo" href="${site}"><img src="/favicon.svg" alt="Milli" width="24" height="24" decoding="async"><b>AVAX</b>/100M</a>
  <a class="nav" href="${site}/c-chain">check a wallet →</a>
</div></header>

<main class="wrap">
  <div class="hero">
    <div class="eyebrow">avalanche <b>p-chain</b> \xB7 validators</div>
    <h1>the validators</h1>
    <div class="tagline">Who secures Avalanche. Live from the P-Chain — every primary-network validator, what they stake, what they earn, and the health of the staking set. No connect. Just a read.</div>
  </div>

  <section>
    <h2>network staking</h2>
    <p class="sub">The primary network, right now.</p>
    <div class="grid" id="stats"></div>
    <div class="msg" id="asof"></div>
  </section>

  <section>
    <h2>validator lookup</h2>
    <p class="sub">Paste a NodeID to pull its live stake, delegations, uptime and rewards.</p>
    <div class="check-row">
      <input id="nid" type="text" spellcheck="false" autocomplete="off" placeholder="NodeID-…" aria-label="Validator NodeID">
      <button class="btn" id="lookup">Look up</button>
    </div>
    <div class="msg" id="lmsg"></div>
    <div class="detail" id="detail"></div>
  </section>

  <section>
    <h2>validator directory</h2>
    <p class="sub">Every current primary-network validator. Click a column to sort, click a row to inspect.</p>
    <div class="check-row" style="margin-bottom:16px">
      <input id="q" type="text" spellcheck="false" autocomplete="off" placeholder="filter by NodeID…" aria-label="Filter validators">
    </div>
    <div class="tablewrap"><table class="vtable">
      <thead><tr>
        <th>Node</th>
        <th data-sort="stake" class="act">Stake</th>
        <th data-sort="delegated">Delegated</th>
        <th data-sort="delegators">Delegs</th>
        <th data-sort="uptime">Uptime</th>
        <th data-sort="apr">Est APR</th>
        <th data-sort="remaining">Ends</th>
      </tr></thead>
      <tbody id="rows"></tbody>
    </table></div>
    <div class="morerow">
      <span class="count" id="count"></span>
      <button class="btn ghost" id="more" style="display:none">Load more</button>
    </div>
  </section>
</main>

<footer><div class="wrap frow">
  <span>avax100m \xB7 p-chain validators</span>
  <span><a href="${site}">home</a> \xB7 data: avalanche p-chain rpc</span>
</div></footer>

<script>
(function(){
  var API="/api/validators";
  var px=null, asOf=null;
  var state={sort:"stake",dir:"desc",q:"",limit:50,offset:0};
  var $=function(id){return document.getElementById(id);};

  function nf(n,d){ if(n==null||!isFinite(n)) return "—"; return Number(n).toLocaleString("en-US",{maximumFractionDigits:d==null?0:d}); }
  function usd(avax){ if(px==null||avax==null||!isFinite(avax)) return ""; var v=avax*px;
    if(v>=1e9) return "$"+nf(v/1e9,2)+"B"; if(v>=1e6) return "$"+nf(v/1e6,2)+"M";
    if(v>=1e3) return "$"+nf(v/1e3,1)+"K"; return "$"+nf(v,0); }
  function pct(f,d){ if(f==null||!isFinite(f)) return "—"; return nf(f*100,d==null?1:d)+"%"; }
  function shortNode(id){ id=String(id||""); return id.length>20? id.slice(0,13)+"…"+id.slice(-4): id; }
  function esc(s){ return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;"); }
  function cell(k,v,red){ return '<div class="cell"><div class="k">'+k+'</div><div class="v'+(red?" red":"")+'">'+v+'</div></div>'; }

  function renderStats(s){
    if(!s){ $("stats").innerHTML=""; return; }
    var stakedUsd=usd(s.totalStaked), activeUsd=usd(s.totalActive);
    var h="";
    h+=cell("total staked", nf(s.totalStaked)+' <small>AVAX'+(stakedUsd?" \xB7 "+stakedUsd:"")+'</small>', true);
    h+=cell("validators", nf(s.validatorCount)+' <small>'+nf(s.connectedCount)+' connected</small>');
    h+=cell("delegators", nf(s.delegatorCount));
    h+=cell("delegated", nf(s.totalDelegated)+' <small>AVAX</small>');
    h+=cell("staking ratio", s.stakingRatio!=null?pct(s.stakingRatio,1):"—", true);
    h+=cell("est. staking apr", s.estApr!=null?pct(s.estApr,2):"—");
    h+=cell("avg uptime", s.avgUptime!=null?pct(s.avgUptime,2):"—");
    h+=cell("total active stake", nf(s.totalActive)+' <small>AVAX'+(activeUsd?" \xB7 "+activeUsd:"")+'</small>');
    h+=cell("largest validator", nf(s.maxStake)+' <small>AVAX</small>');
    $("stats").innerHTML=h;
  }

  function rowHtml(r){
    var dot='<span class="dot'+(r.connected?" on":"")+'"></span> ';
    return '<tr data-node="'+esc(r.nodeID)+'">'+
      '<td class="node">'+dot+esc(shortNode(r.nodeID))+'</td>'+
      '<td>'+nf(r.stake)+'</td>'+
      '<td class="'+(r.delegated>0?"":"off")+'">'+nf(r.delegated)+'</td>'+
      '<td class="'+(r.delegatorCount>0?"":"off")+'">'+nf(r.delegatorCount)+'</td>'+
      '<td>'+(r.uptime!=null?pct(r.uptime,1):"—")+'</td>'+
      '<td>'+(r.estApr?pct(r.estApr,2):"—")+'</td>'+
      '<td class="off">'+nf(r.remainingDays)+'d</td>'+
    '</tr>';
  }

  function bindRows(){
    var trs=$("rows").querySelectorAll("tr[data-node]");
    for(var i=0;i<trs.length;i++){ trs[i].onclick=function(){
      var n=this.getAttribute("data-node"); $("nid").value=n; lookup();
      var d=$("detail"); window.scrollTo({top:Math.max(0,d.getBoundingClientRect().top+window.pageYOffset-90),behavior:"smooth"});
    }; }
  }

  function load(reset){
    if(reset) state.offset=0;
    var u=API+"?sort="+state.sort+"&dir="+state.dir+"&limit="+state.limit+"&offset="+state.offset+"&q="+encodeURIComponent(state.q);
    $("count").textContent="loading…";
    fetch(u).then(function(r){ if(r.status===202) return {pending:true}; return r.json(); }).then(function(j){
      if(j.pending){ $("count").textContent="warming up the p-chain snapshot…"; setTimeout(function(){load(reset);},2500); return; }
      if(j.error){ $("count").textContent="p-chain unavailable — try again shortly."; return; }
      px=j.avaxUsd; asOf=j.asOf;
      if(state.offset===0){
        renderStats(j.stats);
        $("asof").textContent=asOf? ("snapshot "+new Date(asOf).toISOString().replace("T"," ").slice(0,19)+" UTC \xB7 refreshes ~5 min") : "";
      }
      var tb=$("rows"), html=(j.directory||[]).map(rowHtml).join("");
      if(state.offset===0) tb.innerHTML=html; else tb.insertAdjacentHTML("beforeend",html);
      state.offset+=(j.directory||[]).length;
      var total=j.page.total;
      $("count").textContent=nf(state.offset)+" of "+nf(total)+" validators";
      $("more").style.display= state.offset<total ? "" : "none";
      bindRows();
    }).catch(function(){ $("count").textContent="network error."; });
  }

  var ths=document.querySelectorAll(".vtable th[data-sort]");
  function setActive(){ for(var i=0;i<ths.length;i++){ ths[i].classList.toggle("act", ths[i].getAttribute("data-sort")===state.sort); } }
  for(var i=0;i<ths.length;i++){ (function(th){ th.onclick=function(){
    var s=th.getAttribute("data-sort");
    if(state.sort===s){ state.dir=state.dir==="desc"?"asc":"desc"; }
    else { state.sort=s; state.dir=(s==="remaining")?"asc":"desc"; }
    setActive(); load(true);
  }; })(ths[i]); }

  var qt;
  $("q").oninput=function(){ clearTimeout(qt); var v=this.value; qt=setTimeout(function(){ state.q=v.trim(); load(true); },300); };
  $("more").onclick=function(){ load(false); };

  function drow(k,v){ return '<div class="r-row"><span class="k">'+k+'</span><span class="v">'+v+'</span></div>'; }
  function renderDetail(d){
    var rewUsd=usd(d.potentialReward), stakeUsd=usd(d.stake);
    var day=function(sec){ return sec? new Date(sec*1000).toISOString().slice(0,10):"—"; };
    var h="";
    h+=drow("node id","<b>"+esc(d.nodeID)+"</b>");
    h+=drow("status", d.connected?"connected":"not connected");
    h+=drow("own stake", nf(d.stake)+" AVAX"+(stakeUsd?" \xB7 "+stakeUsd:""));
    h+=drow("delegated", nf(d.delegated)+' AVAX <span style="color:var(--dim)">('+nf(d.delegatorCount)+" delegators)</span>");
    h+=drow("total stake", nf(d.stake+d.delegated)+" AVAX");
    h+=drow("uptime", d.uptime!=null?pct(d.uptime,2):"—");
    h+=drow("delegation fee", d.feePct!=null?nf(d.feePct,2)+"%":"—");
    h+=drow("potential reward", "<b>"+nf(d.potentialReward,2)+" AVAX</b>"+(rewUsd?" \xB7 "+rewUsd:""));
    h+=drow("est. apr", d.estApr?pct(d.estApr,2):"—");
    h+=drow("stake period", day(d.startTime)+" → "+day(d.endTime));
    h+=drow("ends in", nf(d.remainingDays)+" days");
    if(d.delegators && d.delegators.length){
      var top=d.delegators.slice().sort(function(a,b){return b.stake-a.stake;}).slice(0,5);
      h+=drow("top delegations", top.map(function(x){return nf(x.stake)+" AVAX";}).join(" \xB7 "));
    }
    $("detail").innerHTML=h; $("detail").style.display="block";
  }

  function lookup(){
    var n=$("nid").value.trim();
    if(!n){ $("lmsg").textContent="enter a NodeID."; return; }
    $("lmsg").textContent = n.indexOf("NodeID-")===0 ? "looking up…" : "a NodeID looks like NodeID-… — looking anyway…";
    fetch(API+"?node="+encodeURIComponent(n)).then(function(r){ return r.json(); }).then(function(j){
      if(j.pending){ $("lmsg").textContent="warming up…"; setTimeout(lookup,2500); return; }
      if(j.none||!j.node){ $("lmsg").textContent="no current validator with that NodeID."; $("detail").style.display="none"; return; }
      if(j.avaxUsd!=null) px=j.avaxUsd;
      $("lmsg").textContent=""; renderDetail(j.node);
    }).catch(function(){ $("lmsg").textContent="network error."; });
  }
  $("lookup").onclick=lookup;
  $("nid").addEventListener("keydown",function(e){ if(e.key==="Enter") lookup(); });

  setActive();
  load(true);
})();
</script>
</body>
</html>`;
}

var config = { path: ["/p-chain", "/validators", "/api/validators"] };
export {
  _mem,
  config,
  validators_default as default
};
