// Fold the validator profile records (vprofile store, written by /api/vgrant +
// /api/vclaim) into the cohort leaderboards. Pure — the caller lists the records
// and passes the live snapshot byNode for uptime/stake. Program data (score,
// tier, categories, delta) is portal-supplied; everything degrades to empty
// until the portal syncs.

export const TIER_LABEL = { A: "Core Contributor", B: "Active Contributor", C: "Reliable Validator" };
export const UPTIME_GATE = 0.98; // program eligibility gate (~97-98%)

function toRow(m, byNode) {
  const d = byNode[m.nodeID] || {};
  return {
    nodeID: m.nodeID,
    handle: m.handle || null,
    tier: /^[ABC]$/.test(String(m.tier || "").toUpperCase()) ? String(m.tier).toUpperCase() : null,
    score: Number.isFinite(m.score) ? m.score : null,
    scoreDelta: Number.isFinite(m.scoreDelta) ? m.scoreDelta : null,
    rank: Number.isFinite(m.rank) ? m.rank : null,
    categories: (m.categories && typeof m.categories === "object") ? m.categories : null,
    grantedBadges: Array.isArray(m.grantedBadges) ? m.grantedBadges : [],
    uptime: d.uptime != null ? d.uptime : null,
    stake: d.stake != null ? d.stake : null,
    connected: !!d.connected
  };
}

/** A record counts as a cohort member if the portal assigned it a tier or score. */
export function isMember(m) {
  return !!(m && (/^[ABC]$/.test(String(m.tier || "").toUpperCase()) || Number.isFinite(m.score)));
}

const catLeaders = (rows, key) =>
  rows.filter((r) => r.categories && r.categories[key] > 0)
    .sort((a, b) => b.categories[key] - a.categories[key])
    .slice(0, 5)
    .map((r) => ({ nodeID: r.nodeID, handle: r.handle, pts: r.categories[key] }));

export function foldCohort(records, byNode = {}) {
  const rows = (records || []).map((m) => toRow(m, byNode));
  const members = rows.filter((r) => r.tier || r.score != null);

  const scored = members.filter((r) => r.score != null).sort((a, b) => b.score - a.score);
  scored.forEach((r, i) => { r.boardRank = i + 1; });

  const rising = members.filter((r) => r.scoreDelta != null && r.scoreDelta > 0)
    .sort((a, b) => b.scoreDelta - a.scoreDelta).slice(0, 5);

  const tierCounts = { A: 0, B: 0, C: 0 };
  for (const r of members) if (r.tier) tierCounts[r.tier]++;

  return {
    memberCount: members.length,
    scoredCount: scored.length,
    tierCounts,
    top20: scored.slice(0, 20),
    categories: {
      builder: catLeaders(members, "builder"),
      educator: catLeaders(members, "educator"),
      support: catLeaders(members, "support")
    },
    rising,
    members
  };
}
