import { getStore } from "@netlify/blobs";
import {
  fetchCurrentSupply,
  fetchCurrentValidators,
  foldValidators,
  queryDirectory
} from "./lib/pchain.mjs";
import { VNAMES, VGLYPH, VGRANTED, historyBadges } from "./lib/vbadges.mjs";
import { fetchCompletedValidations, foldHistory } from "./lib/pchain-history.mjs";
import { foldCohort, TIER_LABEL, UPTIME_GATE } from "./lib/cohort.mjs";

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

// Per-validator identity/tier/granted-badges. Written in Stage 2 (self-claim +
// portal sync); read-only merge here. Returns null when a node has no record yet.
async function readProfile(nodeID) {
  const store = storeOr("vprofile");
  if (!store) return null;
  return await store.get("v/" + nodeID, { type: "json" }).catch(() => null);
}

var HISTORY_TTL = 6 * 3600 * 1e3; // completed periods only change when a stake ends
// Lifetime history via Glacier: cache the (stable) completed-period list, fold it
// with the live current period each request. Returns null if Glacier is unreachable.
async function getHistory(nodeID, detail) {
  const store = storeOr("vhistory");
  let completed = null;
  if (store) {
    const c = await store.get("h/" + nodeID, { type: "json" }).catch(() => null);
    if (c && Number.isFinite(c.t) && Date.now() - c.t < HISTORY_TTL) completed = c.v;
  }
  if (!completed) {
    completed = await fetchCompletedValidations(nodeID);
    if (store) await store.set("h/" + nodeID, JSON.stringify({ t: Date.now(), v: completed })).catch(() => {});
  }
  return foldHistory(completed, { startTime: detail.startTime, endTime: detail.endTime });
}

var COHORT_TTL = 5 * 60 * 1e3;
// Cohort leaderboards: list all profile records, merge live snapshot stats, fold.
// Cached in the validators store since listing + reading every record is heavy.
async function getCohort() {
  const store = storeOr("vprofile");
  if (!store || typeof store.list !== "function") return foldCohort([], {});
  const cache = storeOr("validators");
  if (cache) {
    const c = await cache.get("cohort/v1", { type: "json" }).catch(() => null);
    if (c && Number.isFinite(c.t) && Date.now() - c.t < COHORT_TTL) return c.data;
  }
  let listed = { blobs: [] };
  try { listed = await store.list({ prefix: "v/" }); } catch {}
  const records = [];
  for (const b of (listed.blobs || [])) {
    const rec = await store.get(b.key, { type: "json" }).catch(() => null);
    if (rec) records.push(Object.assign({ nodeID: b.key.slice(2) }, rec));
  }
  let snap = null;
  try { snap = await getSnapshot(); } catch {}
  const data = foldCohort(records, (snap && snap.byNode) || {});
  data.avaxUsd = (snap && snap.avaxUsd) || null;
  data.asOf = Date.now();
  if (cache) await cache.set("cohort/v1", JSON.stringify({ t: Date.now(), data })).catch(() => {});
  return data;
}

// Build the merged node payload (on-chain + auto-badges + rarity + lifetime
// history + any profile record). Shared by the JSON API and the profile page.
async function buildNode(snap, key) {
  const detail = snap.byNode[key];
  const total = snap.stats.badgeTotal || snap.stats.validatorCount;
  const badges = (detail.badges || [])
    .map((b) => Object.assign({}, b, { rarity: { count: (snap.stats.badgeCounts || {})[b.id] || 0, total } }))
    .sort((a, b) => (a.rarity.count - b.rarity.count) || (b.tier - a.tier));
  let history = null;
  try { history = await getHistory(key, detail); } catch {}
  const profile = await readProfile(key);
  return {
    node: detail,
    rank: detail.stakeRank || null,
    count: snap.stats.validatorCount,
    badges: badges.concat(historyBadges(history)),
    history,
    profile
  };
}

// Shared stylesheet for the /p-chain page and the /v/ profile page (one source).
var STYLE = `:root{--bg:#0a0a0a;--ink:#f2f2f2;--dim:#7a7a7a;--faint:#2a2a2a;--red:#e84142;
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
h1{font-size:clamp(34px,7vw,66px);line-height:1;color:var(--red);letter-spacing:-.01em;word-break:break-all}
.tagline{color:var(--dim);margin-top:12px;max-width:660px}
section{padding:40px 0;border-bottom:1px solid var(--faint)}
h2{font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:var(--red);font-weight:700;margin-bottom:8px}
.sub{color:var(--dim);margin-bottom:22px;max-width:700px}
.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--faint);border:1px solid var(--faint)}
@media(max-width:760px){.grid{grid-template-columns:repeat(2,1fr)}}
.cell{background:var(--bg);padding:16px 14px;min-height:84px}
.cell .k{font-size:10px;letter-spacing:.18em;color:var(--dim);text-transform:uppercase}
.cell .v{font-size:22px;font-weight:700;margin-top:6px;word-break:break-word}
.cell .v.red{color:var(--red)}
.cell .v small{font-size:11px;color:var(--dim);font-weight:400}
.cell.full{grid-column:1/-1;min-height:84px;display:flex;flex-direction:column;justify-content:center}
.cell.full a{color:var(--red);border-bottom:1px solid var(--red);text-decoration:none}
.check-row{display:flex;gap:10px;flex-wrap:wrap}
.check-row input{flex:1;min-width:240px;background:var(--bg);border:1px solid var(--faint);color:var(--ink);font-family:var(--mono);font-size:14px;padding:11px 13px}
.check-row input:focus{outline:none;border-color:var(--red)}
.btn{background:var(--red);border:1px solid var(--red);color:#000;font-family:var(--mono);font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;padding:11px 20px;cursor:pointer;text-decoration:none;display:inline-block}
.btn:hover{background:var(--ink);border-color:var(--ink)}
.btn.primary{background:var(--red);border-color:var(--red);color:#000}
.btn.ghost{background:transparent;color:var(--dim);border-color:var(--faint);font-weight:400}
.btn.ghost:hover{color:var(--red);border-color:var(--red)}
.pshare{display:flex;gap:10px;margin-top:20px;flex-wrap:wrap}
.pclaim{margin-top:26px;border-top:1px solid var(--faint);padding-top:22px}
.frow2{display:flex;gap:12px;align-items:center;margin-bottom:10px}
.frow2 label{width:110px;font-size:10px;letter-spacing:.14em;text-transform:uppercase;color:var(--dim);flex:none}
.frow2 input{flex:1;min-width:0;background:var(--bg);border:1px solid var(--faint);color:var(--ink);font-family:var(--mono);font-size:13px;padding:9px 11px}
.frow2 input:focus{outline:none;border-color:var(--red)}
@media(max-width:600px){.frow2{flex-direction:column;align-items:stretch;gap:4px}.frow2 label{width:auto}}
.msg{margin-top:14px;font-size:12px;color:var(--dim);min-height:18px;letter-spacing:.04em}
.detail{margin-top:18px;display:none}
.vcard{border:1px solid var(--faint)}
.vc-head{display:flex;gap:16px;align-items:center;padding:16px 14px;border-bottom:1px solid var(--faint)}
.vc-pfp{width:56px;height:56px;flex:none;border:1px solid var(--faint);overflow:hidden;background:#141414}
.vc-pfp svg,.vc-pfp img{display:block;width:100%;height:100%;object-fit:cover}
.vc-id{min-width:0}
.vc-handle{font-size:18px;font-weight:700;display:flex;align-items:center;gap:10px;flex-wrap:wrap;word-break:break-all}
.vc-node{margin-top:5px;font-size:11px;color:var(--dim);display:flex;align-items:center;gap:9px;flex-wrap:wrap;word-break:break-all}
.vc-node .mono{color:var(--ink)}
.tier{font-size:10px;font-weight:700;letter-spacing:.1em;padding:2px 8px;border:1px solid;text-transform:uppercase;flex:none}
.tier.A{color:#e8b341;border-color:#e8b341}
.tier.B{color:#c9c9c9;border-color:#c9c9c9}
.tier.C{color:#c8813f;border-color:#c8813f}
.copy{background:transparent;border:1px solid var(--faint);color:var(--dim);font-family:var(--mono);font-size:10px;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;cursor:pointer}
.copy:hover{border-color:var(--red);color:var(--red)}
.vc-badges{display:flex;flex-wrap:wrap;gap:8px;padding:14px;border-bottom:1px solid var(--faint)}
.vc-badges .empty{color:var(--dim);font-size:11px;letter-spacing:.08em}
.btile{position:relative;width:40px;height:40px;border:1px solid var(--faint);display:flex;align-items:center;justify-content:center;background:var(--bg);color:var(--ink);cursor:default;outline:none}
.btile:hover,.btile:focus-visible{border-color:var(--red)}
.btile svg{width:22px;height:22px;display:block}
.btile .emo{font-size:20px;line-height:1}
.btile .rn{position:absolute;bottom:1px;right:3px;font-size:8px;color:var(--dim);letter-spacing:.04em}
.btile.medal{background:var(--red);border-color:var(--red);color:#0a0a0a}
.btile.medal .rn{color:#0a0a0a}
.btile .tip{display:none;position:absolute;bottom:calc(100% + 8px);left:50%;transform:translateX(-50%);width:220px;z-index:9;background:var(--bg);border:1px solid var(--red);padding:9px 11px;text-align:left;white-space:normal}
.btile:hover .tip,.btile:focus-visible .tip{display:block}
.btile .tl{color:var(--red);letter-spacing:.2em;font-size:9px;display:block;margin-bottom:3px;text-transform:uppercase}
.btile .tn{font-size:11px;font-weight:700;color:var(--ink);display:block}
.btile .tr{font-size:9px;color:var(--dim);letter-spacing:.06em;display:block;margin:2px 0 5px}
.btile .tv{font-size:10px;color:var(--dim);line-height:1.5;display:block}
.btile .tv b{color:var(--ink)}
.vc-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--faint)}
.vc-strip .s{background:var(--bg);padding:12px 14px}
.vc-strip .s .k{font-size:9px;letter-spacing:.16em;color:var(--dim);text-transform:uppercase}
.vc-strip .s .v{font-size:16px;font-weight:700;margin-top:3px;word-break:break-word}
.vc-strip .s .v small{font-size:10px;color:var(--dim);font-weight:400}
.vc-socials{display:flex;gap:16px;padding:12px 14px;flex-wrap:wrap;font-size:11px;border-top:1px solid var(--faint)}
.vc-socials a,.vc-socials span{color:var(--dim)}
.vc-socials a{border-bottom:1px solid var(--faint);text-decoration:none}
.vc-socials a:hover{color:var(--red);border-color:var(--red)}
.vc-rows{border-top:1px solid var(--faint)}
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
footer a:hover{color:var(--red);border-color:var(--red)}`;

/* ---- server-side card render (mirrors the client renderDetail on /p-chain) ---- */
var esc2 = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
function nfmt(n, d) { if (n == null || !isFinite(n)) return "—"; return Number(n).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d }); }
function usdOf(avax, px) { if (px == null || avax == null || !isFinite(avax)) return ""; const v = avax * px; if (v >= 1e9) return "$" + nfmt(v / 1e9, 2) + "B"; if (v >= 1e6) return "$" + nfmt(v / 1e6, 2) + "M"; if (v >= 1e3) return "$" + nfmt(v / 1e3, 1) + "K"; return "$" + nfmt(v, 0); }
function pctOf(f, d) { if (f == null || !isFinite(f)) return "—"; return nfmt(f * 100, d == null ? 1 : d) + "%"; }
function durOf(days) { days = Math.max(0, Math.round(days)); if (days < 1) return "today"; if (days < 60) return days + " day" + (days === 1 ? "" : "s"); if (days < 730) { const mo = Math.round(days / 30.44); return mo + " month" + (mo === 1 ? "" : "s"); } const y = Math.floor(days / 365.25), rem = Math.round((days - y * 365.25) / 30.44); return y + "y" + (rem ? (" " + rem + "mo") : ""); }
var shortNodeOf = (id) => { id = String(id || ""); return id.length > 20 ? id.slice(0, 13) + "…" + id.slice(-4) : id; };
function hashStrS(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function identiconOf(id, size) { size = size || 56; const h = hashStrS(id), cells = 5, cs = size / cells, ce = Math.ceil(cs); let rects = ""; for (let y = 0; y < cells; y++) for (let xx = 0; xx < 3; xx++) if ((h >>> ((y * 3 + xx) % 29)) & 1) { const mm = cells - 1 - xx; rects += '<rect x="' + (xx * cs) + '" y="' + (y * cs) + '" width="' + ce + '" height="' + ce + '"/>'; if (mm !== xx) rects += '<rect x="' + (mm * cs) + '" y="' + (y * cs) + '" width="' + ce + '" height="' + ce + '"/>'; } return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '"><rect width="' + size + '" height="' + size + '" fill="#141414"/><g fill="var(--red)">' + rects + '</g></svg>'; }
function badgeTileS(b, i) { const name = VNAMES[b.id] || b.id, glyph = VGLYPH[b.id] || "", roman = ["", "i", "ii", "iii"][b.tier] || ""; const rar = b.rarity ? ('<span class="tr">' + nfmt(b.rarity.count) + " of " + nfmt(b.rarity.total) + " validators</span>") : ""; return '<span class="btile' + (i === 0 ? " medal" : "") + '" tabindex="0">' + glyph + (roman ? '<span class="rn">' + roman + '</span>' : '') + '<span class="tip"><span class="tl">badge</span><span class="tn">' + esc2(name) + '</span>' + rar + '<span class="tv">' + b.ev + '</span></span></span>'; }
function grantTileS(id) { const g = VGRANTED[id]; if (!g) return ""; return '<span class="btile grant" tabindex="0"><span class="emo">' + g.emoji + '</span><span class="tip"><span class="tl">awarded</span><span class="tn">' + esc2(g.name) + '</span><span class="tv">' + esc2(g.ev) + '</span></span></span>'; }

function serverCard(nd, px) {
  const d = nd.node, p = nd.profile || null, hist = nd.history || null;
  const badges = nd.badges || [], granted = (p && p.grantedBadges) || [];
  const day = (sec) => sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "—";
  const dim = (s) => '<span style="color:var(--dim)">' + s + "</span>";
  const bar = (f) => { f = Math.max(0, Math.min(1, isFinite(f) ? f : 0)); return '<span style="display:inline-block;width:104px;height:6px;background:var(--faint);vertical-align:middle;margin-left:10px"><span style="display:block;height:100%;width:' + (f * 100).toFixed(1) + '%;background:var(--red)"></span></span>'; };
  const drow = (k, v) => '<div class="r-row"><span class="k">' + k + '</span><span class="v">' + v + '</span></div>';
  const u = (a) => usdOf(a, px);
  const periodDays = (d.endTime - d.startTime) / 86400;
  const elapsed = Math.max(0, periodDays - d.remainingDays);
  const pElapsed = periodDays > 0 ? elapsed / periodDays : 0;
  const earned = d.potentialReward * Math.max(0, Math.min(1, pElapsed));
  const perDay = periodDays > 0 ? d.potentialReward / periodDays : 0;
  const maxDeleg = d.stake * 4, capFree = Math.max(0, maxDeleg - d.delegated), pCap = maxDeleg > 0 ? d.delegated / maxDeleg : 0;

  const handle = (p && p.handle) || shortNodeOf(d.nodeID);
  const tier = (p && p.tier) ? String(p.tier).toUpperCase() : null;
  const tierPill = (tier && /^[ABC]$/.test(tier)) ? '<span class="tier ' + tier + '">tier ' + tier + '</span>' : "";
  const pfp = (p && p.pfp) ? '<img src="' + esc2(p.pfp) + '" alt="">' : identiconOf(d.nodeID, 56);

  let h = '<div class="vcard"><div class="vc-head"><div class="vc-pfp">' + pfp + '</div><div class="vc-id">'
    + '<div class="vc-handle">' + esc2(handle) + tierPill + '</div>'
    + '<div class="vc-node"><span class="dot' + (d.connected ? " on" : "") + '"></span>'
    + '<span class="mono" id="vc-nodeid">' + esc2(d.nodeID) + '</span>'
    + '<button class="copy" id="vcopy">copy</button></div></div></div>';
  const tiles = badges.map(badgeTileS).join("") + granted.map(grantTileS).join("");
  h += '<div class="vc-badges">' + (tiles || '<span class="empty">no badges yet</span>') + '</div>';
  h += '<div class="vc-strip">'
    + '<div class="s"><div class="k">uptime</div><div class="v">' + (d.uptime != null ? pctOf(d.uptime, 2) : "—") + '</div></div>'
    + '<div class="s"><div class="k">delegation fee</div><div class="v">' + (d.feePct != null ? nfmt(d.feePct, 2) + "%" : "—") + '</div></div>'
    + '<div class="s"><div class="k">delegated stake</div><div class="v">' + nfmt(d.delegated) + ' <small>AVAX ' + dim("\xB7 " + nfmt(d.delegatorCount) + " delegators") + '</small></div></div>'
    + '</div>';
  if (p && p.socials) { const sc = p.socials, parts = [];
    if (sc.x) parts.push('<a href="' + esc2(sc.x) + '" target="_blank" rel="noopener nofollow">x/twitter</a>');
    if (sc.discord) parts.push('<span>' + esc2(sc.discord) + '</span>');
    if (sc.site) parts.push('<a href="' + esc2(sc.site) + '" target="_blank" rel="noopener nofollow">website</a>');
    if (parts.length) h += '<div class="vc-socials">' + parts.join("") + '</div>';
  }
  let r = "";
  if (p && (p.tier || p.score != null || p.grantedBadges)) {
    if (tier && TIER_LABEL[tier]) r += drow("cohort tier", "<b>Tier " + tier + "</b> " + dim("\xB7 " + TIER_LABEL[tier]));
    if (p.score != null) r += drow("cohort score", "<b>" + nfmt(p.score) + "</b> pts" + (p.scoreDelta != null ? " " + dim("\xB7 " + (p.scoreDelta >= 0 ? "+" : "") + nfmt(p.scoreDelta) + " this cycle") : ""));
    if (p.rank != null) r += drow("cohort rank", "#" + nfmt(p.rank));
    r += drow("uptime gate", d.uptime != null ? (d.uptime >= UPTIME_GATE ? "<b>met</b> " + dim("\xB7 ≥" + Math.round(UPTIME_GATE * 100) + "%") : dim("below ≥" + Math.round(UPTIME_GATE * 100) + "%")) : "—");
  }
  if (hist && hist.firstStart) { const lifeDays = (Date.now() / 1000 - hist.firstStart) / 86400;
    r += drow("first validated", day(hist.firstStart) + " " + dim("\xB7 " + durOf(lifeDays) + " ago \xB7 " + nfmt(hist.seasons) + (hist.seasons === 1 ? " season" : " seasons"))); }
  r += drow(hist && hist.firstStart ? "current stake since" : "validating since", day(d.startTime) + " " + dim("\xB7 " + durOf(elapsed) + " so far"));
  if (nd.rank) r += drow("stake rank", "#" + nfmt(nd.rank) + " " + dim("of " + nfmt(nd.count)));
  r += drow("own stake", nfmt(d.stake) + " AVAX" + (u(d.stake) ? " \xB7 " + u(d.stake) : ""));
  r += drow("total stake", nfmt(d.stake + d.delegated) + " AVAX");
  r += drow("delegation space", nfmt(d.delegated) + " / " + nfmt(maxDeleg) + " AVAX " + dim("\xB7 " + nfmt(capFree) + " free") + bar(pCap));
  r += drow("reward rate", nfmt(perDay, 2) + " AVAX/day");
  r += drow("earned so far (est.)", "<b>" + nfmt(earned, 2) + " AVAX</b>" + (u(earned) ? " \xB7 " + u(earned) : ""));
  if (hist && hist.lifetimeRewards > 0) r += drow("lifetime rewards", "<b>" + nfmt(hist.lifetimeRewards, 2) + " AVAX</b>" + (u(hist.lifetimeRewards) ? " \xB7 " + u(hist.lifetimeRewards) : "") + " " + dim("\xB7 across " + nfmt(hist.completedCount) + (hist.completedCount === 1 ? " season" : " seasons")));
  r += drow("potential reward \xB7 full period", nfmt(d.potentialReward, 2) + " AVAX" + (u(d.potentialReward) ? " \xB7 " + u(d.potentialReward) : ""));
  r += drow("est. apr", d.estApr ? pctOf(d.estApr, 2) : "—");
  r += drow("stake period", day(d.startTime) + " → " + day(d.endTime) + " " + dim("\xB7 " + nfmt(periodDays) + "d"));
  r += drow("period progress", nfmt(elapsed) + " / " + nfmt(periodDays) + " days" + bar(pElapsed));
  h += '<div class="vc-rows">' + r + '</div></div>';
  return h;
}

function profilePage(nd, px, site) {
  const d = nd.node, p = nd.profile || null, hist = nd.history || null;
  const handle = (p && p.handle) || shortNodeOf(d.nodeID);
  const title = handle + " \xB7 p-chain validator \xB7 avax100m";
  const bits = [];
  if (d.uptime != null) bits.push((d.uptime * 100).toFixed(1) + "% uptime");
  bits.push(nfmt(d.stake) + " AVAX staked");
  if (d.delegatorCount) bits.push(nfmt(d.delegatorCount) + " delegators");
  if (hist && hist.seasons) bits.push(hist.seasons + " season" + (hist.seasons === 1 ? "" : "s"));
  const desc = "Avalanche P-Chain validator " + shortNodeOf(d.nodeID) + " — " + bits.join(" \xB7 ") + ". Live on avax100m.";
  const pageUrl = site + "/v/" + d.nodeID;
  const img = site + "/vcard/" + d.nodeID + ".png";
  const shareText = handle + " — p-chain validator on avax100m";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc2(title)}</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="description" content="${esc2(desc)}">
<link rel="canonical" href="${pageUrl}">
<meta property="og:type" content="profile">
<meta property="og:url" content="${pageUrl}">
<meta property="og:title" content="${esc2(title)}">
<meta property="og:description" content="${esc2(desc)}">
<meta property="og:image" content="${img}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${esc2(title)}">
<meta name="twitter:description" content="${esc2(desc)}">
<meta name="twitter:image" content="${img}">
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap hbar">
  <a class="logo" href="${site}"><img src="/favicon.svg" alt="Milli" width="24" height="24" decoding="async"><b>AVAX</b>/100M</a>
  <a class="nav" href="${site}/p-chain">all validators →</a>
</div></header>
<main class="wrap">
  <div class="hero">
    <div class="eyebrow">avalanche <b>p-chain</b> \xB7 validator</div>
    <h1>${esc2(handle)}</h1>
  </div>
  <section>
    ${serverCard(nd, px)}
    <div class="pshare">
      <button class="btn" id="pcopy">copy link</button>
      <a class="btn primary" id="pshare" href="https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(pageUrl)}" target="_blank" rel="noopener">share on x</a>
      <a class="btn ghost" href="${img}" target="_blank" rel="noopener">view card image</a>
    </div>
    <div class="pclaim">
      <button class="btn ghost" id="editbtn">${p && p.owner ? "edit this validator" : "claim &amp; customize"} →</button>
      <div id="editform" style="display:none;margin-top:16px">
        <p class="sub" style="margin-bottom:16px">Prove you run this node by signing with the wallet that owns its staking rewards — then set your handle, avatar and socials. No transaction, no fees, no approvals.</p>
        <div class="frow2"><label>handle</label><input id="f-handle" maxlength="24" spellcheck="false" placeholder="your name" value="${p && p.handle ? esc2(p.handle) : ""}"></div>
        <div class="frow2"><label>avatar url</label><input id="f-pfp" spellcheck="false" placeholder="https://…/avatar.png" value="${p && p.pfp ? esc2(p.pfp) : ""}"></div>
        <div class="frow2"><label>x / twitter</label><input id="f-x" spellcheck="false" placeholder="@handle" value="${p && p.socials && p.socials.x ? esc2(p.socials.x) : ""}"></div>
        <div class="frow2"><label>discord</label><input id="f-discord" spellcheck="false" placeholder="name" value="${p && p.socials && p.socials.discord ? esc2(p.socials.discord) : ""}"></div>
        <div class="frow2"><label>website</label><input id="f-site" spellcheck="false" placeholder="https://…" value="${p && p.socials && p.socials.site ? esc2(p.socials.site) : ""}"></div>
        <button class="btn" id="signbtn">connect wallet &amp; sign</button>
        <div class="msg" id="cmsg"></div>
      </div>
    </div>
  </section>
</main>
<footer><div class="wrap frow">
  <span>avax100m \xB7 p-chain validators</span>
  <span>made by <a href="https://x.com/Alf444_" target="_blank" rel="noopener">@Alf444_</a> \xB7 <a href="${site}/p-chain">directory</a> \xB7 data: avalanche p-chain rpc + data api</span>
</div></footer>
<script>
(function(){
  var NODE=${JSON.stringify(d.nodeID)};
  var $=function(id){return document.getElementById(id);};
  var cb=$("vcopy"); if(cb) cb.onclick=function(){ var t=$("vc-nodeid").textContent;
    if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ cb.textContent="copied"; setTimeout(function(){cb.textContent="copy";},1200); }); };
  var pl=$("pcopy"); if(pl) pl.onclick=function(){ if(navigator.clipboard) navigator.clipboard.writeText(location.href).then(function(){ pl.textContent="copied"; setTimeout(function(){pl.textContent="copy link";},1200); }); };
  var eb=$("editbtn"); if(eb) eb.onclick=function(){ var f=$("editform"); f.style.display=(f.style.display==="none"?"block":"none"); };
  function api(body){ return fetch("/api/vclaim",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)}).then(function(r){return r.json();}); }
  var sb=$("signbtn"); if(sb) sb.onclick=async function(){
    var cm=$("cmsg");
    if(!window.ethereum){ cm.textContent="no wallet detected — install Core or MetaMask, then reload."; return; }
    var vals={node:NODE, handle:$("f-handle").value, pfp:$("f-pfp").value, x:$("f-x").value, discord:$("f-discord").value, site:$("f-site").value};
    sb.disabled=true; cm.textContent="preparing…";
    try{
      var prep=await api(vals);
      if(prep.error){ cm.textContent=prep.error; sb.disabled=false; return; }
      cm.textContent="approve the signature in your wallet — it must be the reward-owner ("+((prep.owners&&prep.owners[0])||"")+")";
      var acct=(await window.ethereum.request({method:"eth_requestAccounts"}))[0];
      var sig=await window.ethereum.request({method:"personal_sign",params:[prep.message, acct]});
      cm.textContent="verifying…";
      var res=await api({node:NODE, sig:sig});
      if(res.ok){ cm.textContent="saved ✓ reloading…"; setTimeout(function(){location.reload();},900); }
      else { cm.textContent=(res.error||"could not verify")+(res.signer?(" (you signed as "+res.signer.slice(0,16)+"…)"):""); sb.disabled=false; }
    }catch(e){ cm.textContent=(e&&e.message)||"cancelled."; sb.disabled=false; }
  };
})();
</script>
</body>
</html>`;
}

function cohortPage(c, site) {
  const nodeLink = (r) => { const name = r.handle ? esc2(r.handle) : shortNodeOf(r.nodeID);
    const pill = r.tier ? ' <span class="tier ' + r.tier + '">' + r.tier + '</span>' : "";
    return '<a href="/v/' + encodeURIComponent(r.nodeID) + '">' + name + '</a>' + pill; };
  const boardRow = (r, i) => '<tr>'
    + '<td class="off">#' + (r.boardRank || i + 1) + '</td>'
    + '<td class="node">' + nodeLink(r) + '</td>'
    + '<td>' + (r.score != null ? nfmt(r.score) : "—") + '</td>'
    + '<td>' + (r.uptime != null ? (r.uptime * 100).toFixed(1) + "%" : "—") + '</td>'
    + '<td class="off">' + (r.scoreDelta != null ? (r.scoreDelta >= 0 ? "+" : "") + nfmt(r.scoreDelta) : "") + '</td>'
    + '</tr>';
  const catList = (arr) => arr && arr.length
    ? '<ol class="clist">' + arr.map((x) => '<li><a href="/v/' + encodeURIComponent(x.nodeID) + '">' + (x.handle ? esc2(x.handle) : shortNodeOf(x.nodeID)) + '</a> <span class="dim">' + nfmt(x.pts) + " pts</span></li>").join("") + '</ol>'
    : '<p class="empty">—</p>';
  const board = c.scoredCount
    ? '<div class="tablewrap"><table class="vtable"><thead><tr><th>#</th><th>Validator</th><th>Score</th><th>Uptime</th><th>Δ cycle</th></tr></thead><tbody>' + c.top20.map(boardRow).join("") + '</tbody></table></div>'
    : '<p class="empty">No scored validators yet — the leaderboard fills in once the cohort portal syncs scores.</p>';
  const rising = (c.rising && c.rising.length)
    ? '<div class="tablewrap"><table class="vtable"><thead><tr><th>Validator</th><th>Tier</th><th>+ this cycle</th></tr></thead><tbody>'
      + c.rising.map((r) => '<tr><td class="node">' + nodeLink({ nodeID: r.nodeID, handle: r.handle }) + '</td><td>' + (r.tier || "—") + '</td><td>+' + nfmt(r.scoreDelta) + '</td></tr>').join("") + '</tbody></table></div>'
    : '<p class="empty">—</p>';
  const desc = "The validator contributor cohort on avax100m — tiers, scores, badges and leaderboards recognizing the operators who build, educate and support the Avalanche ecosystem.";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>the cohort \xB7 p-chain validators \xB7 avax100m</title>
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<meta name="description" content="${esc2(desc)}">
<link rel="canonical" href="${site}/cohort">
<meta property="og:type" content="website">
<meta property="og:url" content="${site}/cohort">
<meta property="og:title" content="the cohort \xB7 avax100m p-chain">
<meta property="og:description" content="${esc2(desc)}">
<meta property="og:image" content="${site}/og.png">
<meta name="twitter:card" content="summary_large_image">
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap hbar">
  <a class="logo" href="${site}"><img src="/favicon.svg" alt="Milli" width="24" height="24" decoding="async"><b>AVAX</b>/100M</a>
  <a class="nav" href="${site}/p-chain">all validators →</a>
</div></header>
<main class="wrap">
  <div class="hero">
    <div class="eyebrow">avalanche <b>p-chain</b> \xB7 validator cohort</div>
    <h1>the cohort</h1>
    <div class="tagline">Recognition for the validators who secure Avalanche and give back — shipping tooling, teaching, running events, and supporting other operators. Tiers &amp; scores are set by the cohort program; badges and stats are live.</div>
  </div>

  <section>
    <h2>the tiers</h2>
    <p class="sub">Earned each quarter from a contribution score, gated on an uptime floor (~${Math.round(UPTIME_GATE * 100)}%).</p>
    <div class="grid">
      <div class="cell"><div class="k"><span class="tier A" style="vertical-align:middle">A</span> core contributor</div><div class="v">${nfmt(c.tierCounts && c.tierCounts.A || 0)} <small>validators</small></div></div>
      <div class="cell"><div class="k"><span class="tier B" style="vertical-align:middle">B</span> active contributor</div><div class="v">${nfmt(c.tierCounts && c.tierCounts.B || 0)} <small>validators</small></div></div>
      <div class="cell"><div class="k"><span class="tier C" style="vertical-align:middle">C</span> reliable validator</div><div class="v">${nfmt(c.tierCounts && c.tierCounts.C || 0)} <small>validators</small></div></div>
    </div>
    <div class="msg">${nfmt(c.memberCount)} registered \xB7 ${nfmt(c.scoredCount)} scored</div>
  </section>

  <section>
    <h2>leaderboard \xB7 top 20</h2>
    <p class="sub">Highest contribution scores in the cohort.</p>
    ${board}
  </section>

  <section>
    <h2>category leaders</h2>
    <p class="sub">Top contributors by lane.</p>
    <div class="census-grid" style="display:grid;grid-template-columns:repeat(3,1fr);gap:24px">
      <div><div class="k" style="color:var(--red);font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px">top builder</div>${catList(c.categories && c.categories.builder)}</div>
      <div><div class="k" style="color:var(--red);font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px">top educator</div>${catList(c.categories && c.categories.educator)}</div>
      <div><div class="k" style="color:var(--red);font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:10px">top support</div>${catList(c.categories && c.categories.support)}</div>
    </div>
  </section>

  <section>
    <h2>rising stars</h2>
    <p class="sub">Biggest score gains this cycle.</p>
    ${rising}
  </section>
</main>
<footer><div class="wrap frow">
  <span>made by <a href="https://x.com/Alf444_" target="_blank" rel="noopener">@Alf444_</a> \xB7 <a href="${site}/p-chain">validators</a></span>
  <span>data: avalanche p-chain rpc + data api \xB7 cohort program</span>
</div></footer>
<style>.clist{list-style:none;counter-reset:c}.clist li{counter-increment:c;padding:7px 0;border-bottom:1px solid var(--faint);font-size:13px}.clist li::before{content:counter(c);color:var(--dim);margin-right:10px}.clist a{color:var(--ink)}.clist a:hover{color:var(--red)}.clist .dim{color:var(--dim);font-size:11px}.empty{color:var(--dim);font-size:12px;letter-spacing:.04em}.vtable td.node a{color:var(--ink)}.vtable td.node a:hover{color:var(--red)}</style>
</body>
</html>`;
}

var validators_default = async (req) => {
  const url = new URL(req.url);
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");

  // Cohort hub — leaderboards + tiers.
  if (url.pathname === "/cohort") {
    const c = await getCohort();
    return new Response(cohortPage(c, site), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120" } });
  }

  // Per-validator shareable profile page.
  if (url.pathname.startsWith("/v/")) {
    const nodeID = decodeURIComponent(url.pathname.slice(3)).trim();
    if (!/^NodeID-[A-Za-z0-9]+$/.test(nodeID)) return Response.redirect(site + "/p-chain", 302);
    let snap = null;
    try { snap = await getSnapshot(); } catch {}
    if (!snap || snap.pending || !snap.byNode || !snap.byNode[nodeID]) return Response.redirect(site + "/p-chain", 302);
    const nd = await buildNode(snap, nodeID);
    return new Response(profilePage(nd, snap.avaxUsd, site), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }

  if (!url.pathname.startsWith("/api/")) {
    return new Response(page(site), { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=60" } });
  }

  let snap;
  try { snap = await getSnapshot(); }
  catch (e) { return json({ error: "p-chain unavailable", reason: String((e && e.message) || e) }, 503); }
  if (snap && snap.pending) return json({ pending: true, retryAfter: 5 }, 202, { "retry-after": "5" });

  const node = url.searchParams.get("node");
  if (node) {
    const key = snap.byNode[node] ? node : node.trim();
    if (!snap.byNode[key]) return json({ none: true, node });
    const nd = await buildNode(snap, key);
    return json(Object.assign(nd, { avaxUsd: snap.avaxUsd, asOf: snap.asOf }));
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
  const desc = "Live Avalanche P-Chain validators — network staking stats, the full validator directory, and a card per validator with badges, uptime, delegations, and lifetime history & rewards. No connect, just a read.";
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
<style>${STYLE}</style>
</head>
<body>
<header><div class="wrap hbar">
  <a class="logo" href="${site}"><img src="/favicon.svg" alt="Milli" width="24" height="24" decoding="async"><b>AVAX</b>/100M</a>
  <span style="display:inline-flex;gap:18px;align-items:center">
    <a class="nav" href="${site}/cohort">cohort</a>
    <a class="nav" href="${site}/c-chain">check a wallet →</a>
  </span>
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
    <div class="grid" id="stats"><div class="cell full"><span class="k">loading network stats…</span></div></div>
    <div class="msg" id="asof"></div>
  </section>

  <section>
    <h2>validator lookup</h2>
    <p class="sub">Paste a NodeID for its full card — stake, delegations, uptime, badges, and lifetime history &amp; rewards.</p>
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
  <span>made by <a href="https://x.com/Alf444_" target="_blank" rel="noopener">@Alf444_</a> \xB7 <a href="${site}">home</a> \xB7 data: avalanche p-chain rpc + data api</span>
</div></footer>

<script>
(function(){
  var API="/api/validators";
  var px=null, asOf=null;
  var state={sort:"stake",dir:"desc",q:"",limit:50,offset:0};
  var $=function(id){return document.getElementById(id);};
  var VNAMES=${JSON.stringify(VNAMES)}, VGLYPH=${JSON.stringify(VGLYPH)}, VGRANTED=${JSON.stringify(VGRANTED)};
  var TIER_LABEL=${JSON.stringify(TIER_LABEL)}, UPTIME_GATE=${UPTIME_GATE};

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

  // fetch with one automatic retry — CDN/cold-start blips shouldn't surface as a dead page
  function apiGet(u,tries){
    return fetch(u).then(function(r){ if(r.status===202) return {pending:true}; return r.json(); })
      .catch(function(err){ if(tries>0) return new Promise(function(res){setTimeout(res,1200);}).then(function(){return apiGet(u,tries-1);}); throw err; });
  }
  function statsError(){
    $("stats").innerHTML='<div class="cell full"><div class="k">network staking</div><div class="v" style="font-size:14px;color:var(--red)">no response from the p-chain — <a href="#" id="statsretry">retry</a></div></div>';
    var b=$("statsretry"); if(b) b.onclick=function(e){ e.preventDefault(); $("stats").innerHTML='<div class="cell full"><span class="k">loading network stats…</span></div>'; load(true); };
  }
  function load(reset){
    if(reset) state.offset=0;
    var u=API+"?sort="+state.sort+"&dir="+state.dir+"&limit="+state.limit+"&offset="+state.offset+"&q="+encodeURIComponent(state.q);
    $("count").textContent="loading…";
    apiGet(u,1).then(function(j){
      if(j.pending){ $("count").textContent="warming up the p-chain snapshot…"; setTimeout(function(){load(reset);},2500); return; }
      if(j.error){ if(state.offset===0) statsError(); $("count").textContent="p-chain unavailable — retrying…"; setTimeout(function(){load(reset);},5000); return; }
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
    }).catch(function(){ if(state.offset===0) statsError(); $("count").textContent="network error — retrying…"; setTimeout(function(){load(reset);},5000); });
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
  function dur(days){
    days=Math.max(0,Math.round(days));
    if(days<1) return "today";
    if(days<60) return days+" day"+(days===1?"":"s");
    if(days<730){ var mo=Math.round(days/30.44); return mo+" month"+(mo===1?"":"s"); }
    var y=Math.floor(days/365.25), rem=Math.round((days-y*365.25)/30.44);
    return y+"y"+(rem?(" "+rem+"mo"):"");
  }
  function bar(f){ f=Math.max(0,Math.min(1,isFinite(f)?f:0));
    return '<span style="display:inline-block;width:104px;height:6px;background:var(--faint);vertical-align:middle;margin-left:10px"><span style="display:block;height:100%;width:'+(f*100).toFixed(1)+'%;background:var(--red)"></span></span>'; }
  var dim=function(s){ return '<span style="color:var(--dim)">'+s+"</span>"; };

  function hashStr(s){ var h=2166136261>>>0; for(var i=0;i<s.length;i++){ h^=s.charCodeAt(i); h=Math.imul(h,16777619); } return h>>>0; }
  function identicon(id,size){
    size=size||56; var h=hashStr(id), cells=5, cs=size/cells, rects="", ce=Math.ceil(cs);
    for(var y=0;y<cells;y++){ for(var x=0;x<3;x++){
      if((h>>>((y*3+x)%29))&1){ var m=cells-1-x;
        rects+='<rect x="'+(x*cs)+'" y="'+(y*cs)+'" width="'+ce+'" height="'+ce+'"/>';
        if(m!==x) rects+='<rect x="'+(m*cs)+'" y="'+(y*cs)+'" width="'+ce+'" height="'+ce+'"/>';
      }
    }}
    return '<svg width="'+size+'" height="'+size+'" viewBox="0 0 '+size+' '+size+'"><rect width="'+size+'" height="'+size+'" fill="#141414"/><g fill="var(--red)">'+rects+'</g></svg>';
  }
  function badgeTile(b,i){
    var name=VNAMES[b.id]||b.id, glyph=VGLYPH[b.id]||"", roman=["","i","ii","iii"][b.tier]||"";
    var rar=b.rarity? ('<span class="tr">'+nf(b.rarity.count)+" of "+nf(b.rarity.total)+" validators</span>") : "";
    return '<span class="btile'+(i===0?" medal":"")+'" tabindex="0">'+glyph+(roman?'<span class="rn">'+roman+'</span>':'')+
      '<span class="tip"><span class="tl">badge</span><span class="tn">'+esc(name)+'</span>'+rar+'<span class="tv">'+b.ev+'</span></span></span>';
  }
  function grantTile(id){
    var g=VGRANTED[id]; if(!g) return "";
    return '<span class="btile grant" tabindex="0"><span class="emo">'+g.emoji+'</span>'+
      '<span class="tip"><span class="tl">awarded</span><span class="tn">'+esc(g.name)+'</span><span class="tv">'+esc(g.ev)+'</span></span></span>';
  }

  function renderDetail(d, meta){
    var p = (meta && meta.profile) || null;
    var badges = (meta && meta.badges) || d.badges || [];
    var granted = (p && p.grantedBadges) || [];
    var stakeUsd=usd(d.stake), rewUsd=usd(d.potentialReward);
    var day=function(sec){ return sec? new Date(sec*1000).toISOString().slice(0,10):"—"; };
    var periodDays=(d.endTime-d.startTime)/86400;
    var elapsed=Math.max(0, periodDays-d.remainingDays);
    var pElapsed=periodDays>0? elapsed/periodDays : 0;
    var earned=d.potentialReward*Math.max(0,Math.min(1,pElapsed)), earnedUsd=usd(earned);
    var perDay=periodDays>0? d.potentialReward/periodDays : 0;
    var maxDeleg=d.stake*4, capFree=Math.max(0,maxDeleg-d.delegated), pCap=maxDeleg>0?d.delegated/maxDeleg:0;

    var handle=(p&&p.handle)||shortNode(d.nodeID);
    var tier=(p&&p.tier)? String(p.tier).toUpperCase():null;
    var tierPill=(tier&&/^[ABC]$/.test(tier))? '<span class="tier '+tier+'">tier '+tier+'</span>':"";
    var pfp=(p&&p.pfp)? '<img src="'+esc(p.pfp)+'" alt="">' : identicon(d.nodeID,56);

    var h='<div class="vcard"><div class="vc-head"><div class="vc-pfp">'+pfp+'</div><div class="vc-id">'+
      '<div class="vc-handle">'+esc(handle)+tierPill+'</div>'+
      '<div class="vc-node"><span class="dot'+(d.connected?" on":"")+'"></span>'+
      '<span class="mono" id="vc-nodeid">'+esc(d.nodeID)+'</span>'+
      '<button class="copy" id="vcopy">copy</button>'+
      '<a class="copy" href="/v/'+encodeURIComponent(d.nodeID)+'">page →</a></div></div></div>';

    var tiles=badges.map(badgeTile).join("")+granted.map(grantTile).join("");
    h+='<div class="vc-badges">'+(tiles||'<span class="empty">no badges yet</span>')+'</div>';

    h+='<div class="vc-strip">'+
      '<div class="s"><div class="k">uptime</div><div class="v">'+(d.uptime!=null?pct(d.uptime,2):"—")+'</div></div>'+
      '<div class="s"><div class="k">delegation fee</div><div class="v">'+(d.feePct!=null?nf(d.feePct,2)+"%":"—")+'</div></div>'+
      '<div class="s"><div class="k">delegated stake</div><div class="v">'+nf(d.delegated)+' <small>AVAX '+dim("· "+nf(d.delegatorCount)+" delegators")+'</small></div></div>'+
      '</div>';

    if(p&&p.socials){ var sc=p.socials, parts=[];
      if(sc.x) parts.push('<a href="'+esc(sc.x)+'" target="_blank" rel="noopener nofollow">x/twitter</a>');
      if(sc.discord) parts.push('<span>'+esc(sc.discord)+'</span>');
      if(sc.site) parts.push('<a href="'+esc(sc.site)+'" target="_blank" rel="noopener nofollow">website</a>');
      if(parts.length) h+='<div class="vc-socials">'+parts.join("")+'</div>';
    }

    var hist = (meta && meta.history) || null;
    var r="";
    if(p && (p.tier || p.score!=null || p.grantedBadges)){
      if(tier && TIER_LABEL[tier]) r+=drow("cohort tier", "<b>Tier "+tier+"</b> "+dim("· "+TIER_LABEL[tier]));
      if(p.score!=null) r+=drow("cohort score", "<b>"+nf(p.score)+"</b> pts"+(p.scoreDelta!=null?" "+dim("· "+(p.scoreDelta>=0?"+":"")+nf(p.scoreDelta)+" this cycle"):""));
      if(p.rank!=null) r+=drow("cohort rank", "#"+nf(p.rank));
      r+=drow("uptime gate", d.uptime!=null?(d.uptime>=UPTIME_GATE?"<b>met</b> "+dim("· ≥"+Math.round(UPTIME_GATE*100)+"%"):dim("below ≥"+Math.round(UPTIME_GATE*100)+"%")):"—");
    }
    if(hist && hist.firstStart){
      var lifeDays=(Date.now()/1000 - hist.firstStart)/86400;
      r+=drow("first validated", day(hist.firstStart)+" "+dim("· "+dur(lifeDays)+" ago · "+nf(hist.seasons)+(hist.seasons===1?" season":" seasons")));
    }
    r+=drow(hist&&hist.firstStart?"current stake since":"validating since", day(d.startTime)+" "+dim("· "+dur(elapsed)+" so far"));
    if(meta&&meta.rank) r+=drow("stake rank", "#"+nf(meta.rank)+" "+dim("of "+nf(meta.count)));
    r+=drow("own stake", nf(d.stake)+" AVAX"+(stakeUsd?" \xB7 "+stakeUsd:""));
    r+=drow("total stake", nf(d.stake+d.delegated)+" AVAX");
    r+=drow("delegation space", nf(d.delegated)+" / "+nf(maxDeleg)+" AVAX "+dim("· "+nf(capFree)+" free")+bar(pCap));
    r+=drow("reward rate", nf(perDay,2)+" AVAX/day");
    r+=drow("earned so far (est.)", "<b>"+nf(earned,2)+" AVAX</b>"+(earnedUsd?" \xB7 "+earnedUsd:""));
    if(hist && hist.lifetimeRewards>0){ var lifeUsd=usd(hist.lifetimeRewards);
      r+=drow("lifetime rewards", "<b>"+nf(hist.lifetimeRewards,2)+" AVAX</b>"+(lifeUsd?" \xB7 "+lifeUsd:"")+" "+dim("· across "+nf(hist.completedCount)+(hist.completedCount===1?" season":" seasons")));
    }
    r+=drow("potential reward \xB7 full period", nf(d.potentialReward,2)+" AVAX"+(rewUsd?" \xB7 "+rewUsd:""));
    r+=drow("est. apr", d.estApr?pct(d.estApr,2):"—");
    r+=drow("stake period", day(d.startTime)+" → "+day(d.endTime)+" "+dim("· "+nf(periodDays)+"d"));
    r+=drow("period progress", nf(elapsed)+" / "+nf(periodDays)+" days"+bar(pElapsed));
    if(d.delegators && d.delegators.length){
      var top=d.delegators.slice().sort(function(a,b){return b.stake-a.stake;}).slice(0,5);
      r+=drow("top delegations", top.map(function(x){return nf(x.stake)+" AVAX";}).join(" \xB7 "));
    }
    h+='<div class="vc-rows">'+r+'</div></div>';

    $("detail").innerHTML=h; $("detail").style.display="block";
    var cb=$("vcopy"); if(cb) cb.onclick=function(){ var t=$("vc-nodeid").textContent;
      if(navigator.clipboard) navigator.clipboard.writeText(t).then(function(){ cb.textContent="copied"; setTimeout(function(){cb.textContent="copy";},1200); }); };
  }

  function lookup(){
    var n=$("nid").value.trim();
    if(!n){ $("lmsg").textContent="enter a NodeID."; return; }
    $("lmsg").textContent = n.indexOf("NodeID-")===0 ? "looking up…" : "a NodeID looks like NodeID-… — looking anyway…";
    apiGet(API+"?node="+encodeURIComponent(n),1).then(function(j){
      if(j.pending){ $("lmsg").textContent="warming up…"; setTimeout(lookup,2500); return; }
      if(j.none||!j.node){ $("lmsg").textContent="no current validator with that NodeID."; $("detail").style.display="none"; return; }
      if(j.avaxUsd!=null) px=j.avaxUsd;
      $("lmsg").textContent=""; renderDetail(j.node, j);
    }).catch(function(){ $("lmsg").textContent="could not reach the p-chain — try again."; });
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

var config = { path: ["/p-chain", "/validators", "/v/*", "/cohort", "/api/validators"] };
export {
  _mem,
  config,
  validators_default as default
};
