// Auto-derived P-chain validator badges. Pure functions over a folded validator
// row + light context (stake rank, set size). No network. Shared by the fold
// (lib/pchain.mjs) and the page/card so names + glyphs have one source of truth.
//
// This keeps avax100m's "no connect, just a read" ethos: every badge here is
// derived from public P-chain data. Manually-granted program badges (Builder,
// Educator, …) live in VGRANTED and only appear when a validator profile record
// supplies them (Stage 2: self-claim + portal sync).

const CAP_MULT = 4; // Avalanche caps total stake at 5x own -> delegations <= 4x own

// Tier thresholds, one source of truth for badgesFor + nextUp. Values are the
// minimum to hold tier i/ii/iii (rank is "at most", everything else "at least").
export const TIERS = {
  flawless: [0.99, 0.995, 0.999],     // uptime fraction
  heavyweight: [100, 50, 10],         // stake rank (lower is better)
  magnet: [25, 100, 250],             // delegators
  trusted: [0.50, 0.75, 0.90],        // delegation cap filled
  seasons: [2, 5, 10],                // completed + current seasons
  elder: [180, 365, 730]              // days since first validation
};

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
  const capFill = stake > 0 ? deleg / (stake * CAP_MULT) : 0;
  const rank = ctx.stakeRank;

  if (Number.isFinite(up)) {
    const pctStr = (up * 100).toFixed(2) + "%";
    if (up >= TIERS.flawless[2]) push("flawless", 3, "uptime <b>" + pctStr + "</b>");
    else if (up >= TIERS.flawless[1]) push("flawless", 2, "uptime <b>" + pctStr + "</b>");
    else if (up >= TIERS.flawless[0]) push("flawless", 1, "uptime <b>" + pctStr + "</b>");
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

  if (periodDays >= 300) push("committed", 0, "<b>" + Math.round(periodDays) + "d</b> stake commitment");
  if (dcount === 0 && stake > 0) push("solo", 0, "runs on <b>own stake only</b>");

  return out;
}

/**
 * History-derived badges (from Glacier lifetime data, not the live snapshot).
 * Appended per-lookup, so these carry no global rarity. `foundingWindow` is an
 * optional [startSec, endSec]; omit until a program launch window is set.
 * @param hist { seasons, firstStart, cumulativeDays } from foldHistory
 */
export function historyBadges(hist, foundingWindow = null, now = Date.now()) {
  const out = [];
  if (!hist) return out;
  const push = (id, tier, ev) => out.push({ id, tier: tier || 0, ev });

  const s = hist.seasons || 0;
  if (s >= 10) push("seasons", 3, "<b>" + s + "</b> validation seasons");
  else if (s >= 5) push("seasons", 2, "<b>" + s + "</b> validation seasons");
  else if (s >= 2) push("seasons", 1, "<b>" + s + "</b> validation seasons");

  if (hist.firstStart) {
    const days = (now / 1000 - hist.firstStart) / 86400;
    if (days >= 730) push("elder", 3, "validating <b>" + (Math.round(days / 365.25 * 10) / 10) + "y</b>");
    else if (days >= 365) push("elder", 2, "validating <b>" + Math.round(days) + "d</b>");
    else if (days >= 180) push("elder", 1, "validating <b>" + Math.round(days) + "d</b>");
  }

  if (foundingWindow && hist.firstStart && hist.firstStart >= foundingWindow[0] && hist.firstStart <= foundingWindow[1]) {
    push("founding", 0, "among the founding validators");
  }
  return out;
}

/**
 * The nearest unearned badge tiers, with progress toward each. Pure, no
 * network. Feeds the "next up" strip on the card so a badge shelf reads as a
 * goal list instead of a trophy case.
 * @param row folded row (see badgesFor)
 * @param ctx { stakeRank, total, rankStake: {10,50,100 -> own stake (AVAX) held at that rank} }
 * @param hist { seasons, firstStart } from foldHistory (optional)
 * @returns [{ id, tier, frac(0..1), have, need, unit, label }] sorted closest-first, max 3
 */
export function nextUp(row, ctx = {}, hist = null, now = Date.now()) {
  const out = [];
  const add = (id, tier, frac, have, need, unit, label) => {
    if (!Number.isFinite(frac)) return;
    out.push({ id, tier, frac: Math.max(0, Math.min(0.999, frac)), have, need, unit, label });
  };
  const stake = row.stake, deleg = row.delegated, dcount = row.delegatorCount, up = row.uptime;
  const capFill = stake > 0 ? deleg / (stake * CAP_MULT) : 0;
  const rank = ctx.stakeRank;

  // Next tier index for a "more is better" metric; null when tier iii is held.
  const nextIdx = (arr, v, lowerBetter) => {
    for (let i = 0; i < arr.length; i++) if (lowerBetter ? !(v <= arr[i]) : !(v >= arr[i])) return i;
    return null;
  };

  if (Number.isFinite(up)) {
    const i = nextIdx(TIERS.flawless, up);
    if (i != null) {
      const need = TIERS.flawless[i], floor = i === 0 ? 0.95 : TIERS.flawless[i - 1];
      const gap = ((need - up) * 100);
      add("flawless", i + 1, (up - floor) / (need - floor), up * 100, need * 100, "% uptime",
        gap.toFixed(2) + "% more uptime");
    }
  }
  if (rank && ctx.rankStake) {
    const i = nextIdx(TIERS.heavyweight, rank, true);
    if (i != null) {
      const needRank = TIERS.heavyweight[i], needStake = ctx.rankStake[needRank];
      if (Number.isFinite(needStake) && needStake > stake) {
        add("heavyweight", i + 1, stake / needStake, stake, needStake, " AVAX own stake",
          fmtN(needStake - stake) + " AVAX more own stake for #" + needRank);
      }
    }
  }
  if (Number.isFinite(dcount)) {
    const i = nextIdx(TIERS.magnet, dcount);
    if (i != null) {
      const need = TIERS.magnet[i];
      add("magnet", i + 1, dcount / need, dcount, need, " delegators", (need - dcount) + " more delegator" + (need - dcount === 1 ? "" : "s"));
    }
  }
  if (stake > 0) {
    const i = nextIdx(TIERS.trusted, capFill);
    if (i != null) {
      const need = TIERS.trusted[i];
      const avaxGap = need * stake * CAP_MULT - deleg;
      add("trusted", i + 1, capFill / need, Math.round(capFill * 100), Math.round(need * 100), "% of cap",
        fmtN(avaxGap) + " AVAX more delegated");
    }
  }
  if (hist) {
    const s = hist.seasons || 0;
    const i = nextIdx(TIERS.seasons, s);
    if (i != null) {
      const need = TIERS.seasons[i];
      add("seasons", i + 1, s / need, s, need, " seasons", (need - s) + " more season" + (need - s === 1 ? "" : "s"));
    }
    if (hist.firstStart) {
      const days = (now / 1000 - hist.firstStart) / 86400;
      const j = nextIdx(TIERS.elder, days);
      if (j != null) {
        const need = TIERS.elder[j];
        add("elder", j + 1, days / need, Math.round(days), need, " days", Math.ceil(need - days) + " more day" + (Math.ceil(need - days) === 1 ? "" : "s"));
      }
    }
  }
  return out.sort((a, b) => b.frac - a.frac).slice(0, 3);
}

function fmtN(n) { return Math.round(n).toLocaleString("en-US"); }

export const VNAMES = {
  flawless: "Flawless",
  heavyweight: "Heavyweight",
  magnet: "Delegator Magnet",
  trusted: "Trusted",
  generous: "Generous",
  committed: "Committed",
  solo: "Solo",
  seasons: "Seasons",
  elder: "Elder",
  founding: "Founding Cohort"
};

// Monochrome 24x24 glyphs; use currentColor so the tile controls ink vs. medal.
export const VGLYPH = {
  flawless: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12.5l5 5 11-12"/></svg>',
  heavyweight: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="15" width="16" height="4"/><rect x="6" y="9" width="12" height="4"/><rect x="8" y="3" width="8" height="4"/></svg>',
  magnet: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 4v7a6 6 0 0012 0V4"/><path d="M4 4h4M16 4h4"/></svg>',
  trusted: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9"/><path d="M8 11V8a4 4 0 018 0v3"/></svg>',
  generous: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="8.5"/><circle cx="9.2" cy="9.2" r="1.3" fill="currentColor" stroke="none"/><circle cx="14.8" cy="14.8" r="1.3" fill="currentColor" stroke="none"/><path d="M8.5 15.5l7-7" stroke-linecap="round"/></svg>',
  committed: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="4" y="5.5" width="16" height="14.5"/><path d="M4 10h16M8.5 3v5M15.5 3v5" stroke-linecap="round"/></svg>',
  solo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="3.4"/><path d="M5.5 20a6.5 6.5 0 0113 0"/></svg>',
  seasons: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 10a8 8 0 0113-3.5L20 9"/><path d="M20 14a8 8 0 01-13 3.5L4 15"/><path d="M20 4v5h-5M4 20v-5h5"/></svg>',
  elder: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 8l4.2 3.4L12 4l4.8 7.4L21 8v10H3z"/></svg>',
  founding: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 20c0-6 3-13 7-16 4 3 7 10 7 16"/><path d="M9 13h6"/><circle cx="12" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>'
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
