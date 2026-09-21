// Embeddable live validator badge (SVG). Pure: node payload in, SVG out.
// Meant for READMEs and websites, so it only uses fonts the viewer already
// has (system monospace) and no external resources at all.

import { VNAMES } from "./vbadges.mjs";

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const nf = (n) => (n == null || !isFinite(n)) ? "—" : Math.round(Number(n)).toLocaleString("en-US");
const shortNode = (id) => { id = String(id || ""); return id.length > 20 ? id.slice(0, 13) + "…" + id.slice(-4) : id; };

export const BADGE_W = 420, BADGE_H = 96;

/** SVG for a live node payload (the /api/validators?node= shape). */
export function renderBadgeSvg(nd) {
  const d = nd.node, p = nd.profile || null;
  const handle = (p && p.handle) || shortNode(d.nodeID);
  const uptime = d.uptime != null ? (d.uptime * 100).toFixed(2) + "%" : "—";
  const rank = nd.rank ? "#" + nf(nd.rank) + " of " + nf(nd.count) : "—";
  const top = (nd.badges || []).slice(0, 3).map((b) => (VNAMES[b.id] || b.id).toUpperCase() + (b.tier ? " " + ["", "I", "II", "III"][b.tier] : ""));
  const stake = nf(d.stake) + " AVAX";
  const font = 'ui-monospace,"SF Mono",Menlo,Consolas,monospace';
  const W = BADGE_W, H = BADGE_H;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(handle)} — Avalanche P-Chain validator, uptime ${esc(uptime)}, stake rank ${esc(rank)}">
<title>${esc(handle)} · avalanche p-chain validator · avax100m</title>
<rect x="0" y="0" width="${W}" height="${H}" fill="#0a0a0a"/>
<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="#e92733" stroke-width="3"/>
<rect x="8" y="8" width="${W - 16}" height="${H - 16}" fill="none" stroke="#2a2a2a" stroke-width="1"/>
<g font-family='${font}' fill="#f2f2f2">
  <text x="20" y="30" font-size="9" letter-spacing="2" fill="#7a7a7a">AVALANCHE P-CHAIN · VALIDATOR</text>
  <text x="20" y="54" font-size="18" font-weight="700" fill="#e92733">${esc(handle.length > 22 ? handle.slice(0, 22) : handle)}</text>
  <text x="20" y="76" font-size="10" fill="#7a7a7a">${esc(top.length ? top.join("  ·  ") : "PRIMARY NETWORK")}</text>
  <g font-size="9" letter-spacing="1.5" fill="#7a7a7a" text-anchor="end">
    <text x="${W - 20}" y="30">UPTIME</text>
    <text x="${W - 20}" y="58">STAKE RANK</text>
  </g>
  <g font-size="14" font-weight="700" text-anchor="end">
    <text x="${W - 20}" y="45">${esc(uptime)}</text>
    <text x="${W - 20}" y="73" font-size="12">${esc(rank)}</text>
  </g>
  <text x="${W - 20}" y="88" font-size="8" letter-spacing="1" fill="#e92733" text-anchor="end">${esc(stake)} · AVAX100M.XYZ</text>
</g>
</svg>`;
}

/** Fallback SVG when the node is unknown or the chain is unreachable. */
export function renderEmptyBadgeSvg(msg) {
  const W = BADGE_W, H = BADGE_H;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(msg)}">
<rect x="0" y="0" width="${W}" height="${H}" fill="#0a0a0a"/>
<rect x="1.5" y="1.5" width="${W - 3}" height="${H - 3}" fill="none" stroke="#2a2a2a" stroke-width="3"/>
<g font-family='ui-monospace,"SF Mono",Menlo,Consolas,monospace'>
  <text x="20" y="30" font-size="9" letter-spacing="2" fill="#7a7a7a">AVALANCHE P-CHAIN · VALIDATOR</text>
  <text x="20" y="58" font-size="14" font-weight="700" fill="#7a7a7a">${esc(msg)}</text>
  <text x="${W - 20}" y="88" font-size="8" letter-spacing="1" fill="#7a7a7a" text-anchor="end">AVAX100M.XYZ</text>
</g>
</svg>`;
}
