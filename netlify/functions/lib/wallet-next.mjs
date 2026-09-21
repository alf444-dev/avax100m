// "Next up" for a wallet: what it is closest to earning, from facts the chain
// already gives us. Only goals that move on their own or by the owner's hand and
// that can be measured exactly: the next rank (days on mainnet), mainnet
// furniture (share of mainnet's life survived) and the thousand club (txs sent).
// One-off badges (first swap, sold the top, …) have no honest progress bar.

const GENESIS = Date.UTC(2020, 8, 21);
const DAY = 864e5;

// Tier floors, lowest first. badges.mjs awards from these same numbers.
export const WTIERS = {
  furniture: [75, 90, 95],     // % of mainnet's existence survived
  thousand: [1e3, 5e3, 1e4]    // transactions sent
};

// 0 when below the first floor, else the tier held (1-based).
export function tierOf(id, v) {
  const t = WTIERS[id];
  let held = 0;
  for (let i = 0; i < t.length; i++) if (v >= t[i]) held = i + 1;
  return held;
}

const plural = (n, word) => n.toLocaleString("en-US") + " more " + word + (n === 1 ? "" : "s");

// ranks: [[minDays, NAME, line], …] highest first, as wallet.mjs declares them.
export function nextUpWallet({ ts, txc, ranks = [] }, now = Date.now()) {
  const out = [];
  const add = (kind, id, tier, name, frac, label) => {
    if (!Number.isFinite(frac)) return;
    out.push({ kind, id, tier, name, frac: Math.max(0, Math.min(0.999, frac)), label });
  };
  if (!Number.isFinite(ts) || ts > now) return out;
  const age = now - ts, days = Math.floor(age / DAY);

  // next rank: the lowest threshold still above this wallet's days
  const above = ranks.filter((r) => r[0] > days).sort((a, b) => a[0] - b[0])[0];
  if (above) {
    const floor = Math.max(0, ...ranks.filter((r) => r[0] <= days).map((r) => r[0]));
    add("rank", "rank", 0, above[1], (days - floor) / (above[0] - floor), plural(above[0] - days, "day"));
  }

  // mainnet furniture: pct = age / mainnetAge, and both grow a day per day, so
  // reaching T takes d days where (age + d) / (mainnetAge + d) = T
  const life = now - GENESIS, pct = Math.min(100, age / life * 100);
  const fi = tierOf("furniture", pct);
  if (fi < WTIERS.furniture.length) {
    const need = WTIERS.furniture[fi], T = need / 100, floor = fi === 0 ? 0 : WTIERS.furniture[fi - 1];
    const d = Math.ceil((T * life - age) / (1 - T) / DAY);
    add("badge", "furniture", fi + 1, null, (pct - floor) / (need - floor), plural(Math.max(1, d), "day"));
  }

  if (Number.isFinite(txc) && txc >= 0) {
    const ti = tierOf("thousand", txc);
    if (ti < WTIERS.thousand.length) {
      const need = WTIERS.thousand[ti];
      add("badge", "thousand", ti + 1, null, txc / need, plural(need - txc, "transaction"));
    }
  }
  return out.sort((a, b) => b.frac - a.frac).slice(0, 3);
}
