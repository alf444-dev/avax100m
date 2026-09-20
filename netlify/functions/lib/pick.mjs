// Delegator picker: rank the current validator set for a delegation of
// `amount` AVAX that must run at least `days`. Pure over directory rows.
//
// Rules baked in (Avalanche primary network):
//  - a delegation must end no later than the validator's own end, and run
//    at least 14 days -> remainingDays >= max(days, 14)
//  - total delegations are capped at 4x the validator's own stake -> free
//    space must cover the amount (with a small headroom so a race for the
//    last slots does not bounce the tx)
//  - rewards require the validator to keep >= 80% uptime; we filter far
//    above that because the delegator carries the risk, not the validator
//  - the delegator earns the period's staking rate minus the validator's fee

export const MIN_DELEGATION = 25;   // AVAX
export const MIN_DAYS = 14;
export const HEADROOM = 0.02;       // keep 2% of free space unclaimed

const CAP_MULT = 4;

/**
 * @param directory folded rows (see foldValidators)
 * @param opts { amount, days, maxFee (percent), minUptime (0..1), limit }
 * @returns { rows: [{ nodeID, fee, netApr, uptime, free, remainingDays, delegators, connected, why[] }], considered, matched }
 */
export function pickValidators(directory, opts = {}) {
  const amount = Math.max(MIN_DELEGATION, Number(opts.amount) || MIN_DELEGATION);
  const days = Math.max(MIN_DAYS, Number(opts.days) || MIN_DAYS);
  const maxFee = Number.isFinite(Number(opts.maxFee)) && opts.maxFee !== "" && opts.maxFee != null ? Number(opts.maxFee) : null;
  const minUptime = Number.isFinite(Number(opts.minUptime)) && opts.minUptime !== "" && opts.minUptime != null ? Number(opts.minUptime) : 0.99;
  const limit = Math.min(50, Math.max(1, Number(opts.limit) || 10));

  const out = [];
  for (const r of directory || []) {
    if (!(r.stake > 0)) continue;
    const cap = r.stake * CAP_MULT;
    const free = Math.max(0, cap - (r.delegated || 0));
    if (free * (1 - HEADROOM) < amount) continue;
    if (!(r.remainingDays >= days)) continue;
    if (!Number.isFinite(r.uptime) || r.uptime < minUptime) continue;
    if (!Number.isFinite(r.feePct)) continue;
    if (maxFee != null && r.feePct > maxFee) continue;
    if (!(r.estApr > 0)) continue;
    const netApr = r.estApr * (1 - r.feePct / 100);
    out.push({
      nodeID: r.nodeID,
      fee: r.feePct,
      grossApr: r.estApr,
      netApr,
      uptime: r.uptime,
      free,
      fill: cap > 0 ? (r.delegated || 0) / cap : 0,
      remainingDays: r.remainingDays,
      delegators: r.delegatorCount || 0,
      connected: !!r.connected,
      stakeRank: r.stakeRank || null
    });
  }
  // best net yield first; ties broken by uptime, then by more room (less chance of a bounce)
  out.sort((a, b) => (b.netApr - a.netApr) || (b.uptime - a.uptime) || (b.free - a.free));
  const rows = out.slice(0, limit).map((x, i) => Object.assign({ pick: i + 1, why: whyOf(x, amount) }, x));
  return { amount, days, maxFee, minUptime, considered: (directory || []).length, matched: out.length, rows };
}

function whyOf(x, amount) {
  const w = [];
  w.push(x.fee <= 2 ? "minimum 2% fee" : x.fee.toFixed(0) + "% fee");
  if (x.uptime >= 0.999) w.push("flawless uptime"); else if (x.uptime >= 0.995) w.push("near-flawless uptime");
  if (x.free >= amount * 10) w.push("plenty of room"); else if (x.free < amount * 1.5) w.push("tight on room");
  if (x.remainingDays >= 300) w.push("long runway"); else if (x.remainingDays < 30) w.push("ends soon");
  if (!x.connected) w.push("not connected right now");
  return w;
}
