// Auto-derived P-chain validator badges. Pure functions over a folded validator
// row + light context (stake rank, set size). No network. Shared by the fold
// (lib/pchain.mjs) and the page/card so names + glyphs have one source of truth.
//
// This keeps avax100m's "no connect, just a read" ethos: every badge here is
// derived from public P-chain data. Manually-granted program badges (Builder,
// Educator, …) live in VGRANTED and only appear when a validator profile record
// supplies them (Stage 2: self-claim + portal sync).

const CAP_MULT = 4; // Avalanche caps total stake at 5x own -> delegations <= 4x own

/**
 * Derive the on-chain badges a validator row has earned.
 * @param row folded directory row: { stake, delegated, delegatorCount, uptime(0..1),
 *            feePct(percent), startTime, endTime, remainingDays }
 * @param ctx { stakeRank (1-based), total }
 * @returns [{ id, tier(0..3), ev(html) }]
 */
export function badgesFor(row, ctx = {}) {
  const out = [];
  const push = (id, tier, ev) => out.push({ id, tier: tier || 0, ev });
  const stake = row.stake, deleg = row.delegated, dcount = row.delegatorCount;
  const up = row.uptime, fee = row.feePct;
  const periodDays = (row.endTime - row.startTime) / 86400;
  const elapsed = Math.max(0, periodDays - row.remainingDays);
  const capFill = stake > 0 ? deleg / (stake * CAP_MULT) : 0;
  const rank = ctx.stakeRank;

  if (Number.isFinite(up)) {
    const pctStr = (up * 100).toFixed(2) + "%";
    if (up >= 0.999) push("flawless", 3, "uptime <b>" + pctStr + "</b>");
    else if (up >= 0.995) push("flawless", 2, "uptime <b>" + pctStr + "</b>");
    else if (up >= 0.99) push("flawless", 1, "uptime <b>" + pctStr + "</b>");
  }
  if (rank) {
    if (rank <= 10) push("heavyweight", 3, "top <b>10</b> by stake (#" + rank + ")");
    else if (rank <= 50) push("heavyweight", 2, "top <b>50</b> by stake (#" + rank + ")");
    else if (rank <= 100) push("heavyweight", 1, "top <b>100</b> by stake (#" + rank + ")");
  }
  if (dcount >= 250) push("magnet", 3, "<b>" + dcount + "</b> delegators");
  else if (dcount >= 100) push("magnet", 2, "<b>" + dcount + "</b> delegators");
  else if (dcount >= 25) push("magnet", 1, "<b>" + dcount + "</b> delegators");

  if (capFill >= 0.90) push("trusted", 3, "<b>" + Math.round(capFill * 100) + "%</b> of delegation cap filled");
  else if (capFill >= 0.75) push("trusted", 2, "<b>" + Math.round(capFill * 100) + "%</b> of delegation cap filled");
  else if (capFill >= 0.50) push("trusted", 1, "<b>" + Math.round(capFill * 100) + "%</b> of delegation cap filled");

  if (Number.isFinite(fee) && fee <= 2) push("generous", 0, "charges the <b>2% minimum</b> delegation fee");

  if (elapsed >= 300) push("veteran", 3, "<b>" + Math.round(elapsed) + "d</b> into the current stake");
  else if (elapsed >= 180) push("veteran", 2, "<b>" + Math.round(elapsed) + "d</b> into the current stake");
  else if (elapsed >= 90) push("veteran", 1, "<b>" + Math.round(elapsed) + "d</b> into the current stake");

  if (periodDays >= 300) push("committed", 0, "<b>" + Math.round(periodDays) + "d</b> stake commitment");
  if (dcount === 0 && stake > 0) push("solo", 0, "runs on <b>own stake only</b>");

  return out;
}

export const VNAMES = {
  flawless: "Flawless",
  heavyweight: "Heavyweight",
  magnet: "Delegator Magnet",
  trusted: "Trusted",
  generous: "Generous",
  veteran: "Veteran",
  committed: "Committed",
  solo: "Solo"
};

// Monochrome 24x24 glyphs; use currentColor so the tile controls ink vs. medal.
export const VGLYPH = {
  flawless: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5 11-12"/></svg>',
  heavyweight: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="15" width="16" height="4"/><rect x="6" y="9" width="12" height="4"/><rect x="8" y="3" width="8" height="4"/></svg>',
  magnet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 4v7a6 6 0 0012 0V4"/><path d="M4 4h4M16 4h4"/></svg>',
  trusted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  generous: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="9.2" cy="9.2" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="14.8" r="1.3" fill="currentColor" stroke="none"/><path d="M8.5 15.5l7-7" stroke-linecap="round"/></svg>',
  veteran: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2.5l2.6 6.3 6.9.5-5.3 4.4 1.7 6.7L12 17.2 6.1 20.9l1.7-6.7L2.5 9.8l6.9-.5z"/></svg>',
  committed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5"/><path d="M4 10h16M8.5 3v5M15.5 3v5" stroke-linecap="round"/></svg>',
  solo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0113 0"/></svg>'
};

// Manually-granted program badges (the brief). Rendered only when a validator
// profile record lists them; populated in Stage 2 via self-claim / portal sync.
export const VGRANTED = {
  builder: { name: "Builder", emoji: "🔨", ev: "shipped 3+ tools" },
  educator: { name: "Educator", emoji: "🎓", ev: "hosted 5+ workshops" },
  pillar: { name: "Community Pillar", emoji: "👫", ev: "50+ support cases resolved" },
  streaker: { name: "Streaker", emoji: "🔥", ev: "Tier A/B held 4 consecutive quarters" },
  founding: { name: "Founding Cohort", emoji: "🚀", ev: "registered in the launch window" }
};
