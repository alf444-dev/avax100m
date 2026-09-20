// Head-to-head: two merged node payloads (the /api/validators?node= shape) in,
// a scored row list out. Pure; shared by the compare page and the compare PNG
// so both agree on who leads and by how much.

const nf = (n, d) => (n == null || !isFinite(n)) ? "—" : Number(n).toLocaleString("en-US", { maximumFractionDigits: d == null ? 0 : d });
const pct = (f, d) => (f == null || !isFinite(f)) ? "—" : nf(f * 100, d == null ? 1 : d) + "%";
const day = (sec) => sec ? new Date(sec * 1000).toISOString().slice(0, 10) : "—";

/** Display handle for a node payload: claimed handle, else a shortened NodeID. */
export function handleOf(nd) {
  const p = nd && nd.profile;
  if (p && p.handle) return p.handle;
  const id = String((nd && nd.node && nd.node.nodeID) || "");
  return id.length > 20 ? id.slice(0, 13) + "…" + id.slice(-4) : id;
}

/** "top 9%" style label from a beats-fraction; null when the set is too small to mean anything. */
export function topPct(frac, count) {
  if (!Number.isFinite(frac) || !(count >= 20)) return null;
  return "top " + Math.max(1, Math.round((1 - frac) * 100)) + "%";
}

// Each metric: key, label, extractor, direction (+1 higher wins, -1 lower wins), formatter.
const METRICS = [
  { k: "uptime", label: "uptime", dir: 1, get: (n) => n.node.uptime, fmt: (v) => pct(v, 2) },
  { k: "stake", label: "own stake", dir: 1, get: (n) => n.node.stake, fmt: (v) => nf(v) + " AVAX" },
  { k: "delegated", label: "delegated", dir: 1, get: (n) => n.node.delegated, fmt: (v) => nf(v) + " AVAX" },
  { k: "delegators", label: "delegators", dir: 1, get: (n) => n.node.delegatorCount, fmt: (v) => nf(v) },
  { k: "fee", label: "delegation fee", dir: -1, get: (n) => n.node.feePct, fmt: (v) => nf(v, 2) + "%" },
  { k: "apr", label: "est. apr", dir: 1, get: (n) => n.node.estApr || null, fmt: (v) => pct(v, 2) },
  { k: "rank", label: "stake rank", dir: -1, get: (n) => n.rank, fmt: (v) => "#" + nf(v) },
  { k: "badges", label: "badges", dir: 1, get: (n) => (n.badges || []).length, fmt: (v) => nf(v) },
  { k: "seasons", label: "seasons", dir: 1, get: (n) => n.history ? (n.history.seasons || 0) : null, fmt: (v) => nf(v) },
  { k: "since", label: "first validated", dir: -1, get: (n) => (n.history && n.history.firstStart) || n.node.startTime, fmt: (v) => day(v) },
  { k: "rewards", label: "lifetime rewards", dir: 1, get: (n) => n.history && n.history.lifetimeRewards > 0 ? n.history.lifetimeRewards : null, fmt: (v) => nf(v, 2) + " AVAX" },
  { k: "d7", label: "delegators · 7d", dir: 1, get: (n) => n.delta ? n.delta.delegators : null, fmt: (v) => (v > 0 ? "+" : "") + nf(v) }
];

/**
 * @returns { rows: [{ k, label, a:{v,text}, b:{v,text}, win:"a"|"b"|null }], tally:{a,b,ties}, leader:"a"|"b"|null }
 * A row is skipped when neither side has the metric; a side with no value never wins.
 */
export function compareNodes(A, B) {
  const rows = [];
  const tally = { a: 0, b: 0, ties: 0 };
  for (const m of METRICS) {
    const va = m.get(A), vb = m.get(B);
    const ha = Number.isFinite(va), hb = Number.isFinite(vb);
    if (!ha && !hb) continue;
    let win = null;
    if (ha && hb) {
      if (va === vb) tally.ties++;
      else { win = (va - vb) * m.dir > 0 ? "a" : "b"; tally[win]++; }
    } else if (ha || hb) { win = ha ? "a" : "b"; tally[win]++; }
    rows.push({ k: m.k, label: m.label, a: { v: ha ? va : null, text: ha ? m.fmt(va) : "—" }, b: { v: hb ? vb : null, text: hb ? m.fmt(vb) : "—" }, win });
  }
  const leader = tally.a === tally.b ? null : (tally.a > tally.b ? "a" : "b");
  return { rows, tally, leader };
}
