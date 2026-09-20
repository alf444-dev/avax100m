// Weekly movers: what changed across the validator set over the last ~7 days.
// Pure functions over two compact daily captures of the folded snapshot. No
// network, no store access — validators.mjs owns the Blobs read/write.
//
// A capture is deliberately small (one short array per node) so a week of them
// is a few hundred KB, and diffing two is a single pass.

export const WINDOW_DAYS = 7;   // compare against the capture closest to 7 days back
export const KEEP_DAYS = 10;    // captures older than this are pruned from the index
export const TOP_N = 5;

/** UTC day key for a timestamp, e.g. "2026-09-21". */
export function dayKey(ms = Date.now()) { return new Date(ms).toISOString().slice(0, 10); }

/** Compact capture of a folded snapshot: { t, byNode: { id: [stake, delegated, delegators, uptime, rank, badgeTiers] } }. */
export function captureOf(snap, now = Date.now()) {
  const byNode = {};
  for (const r of (snap && snap.directory) || []) {
    const tiers = {};
    for (const b of ((snap.byNode && snap.byNode[r.nodeID] && snap.byNode[r.nodeID].badges) || r.badges || [])) tiers[b.id] = b.tier || 0;
    byNode[r.nodeID] = [r.stake, r.delegated, r.delegatorCount, r.uptime, r.stakeRank || null, tiers];
  }
  return { t: now, day: dayKey(now), byNode };
}

/**
 * Pick the baseline day from an index of capture days (ISO strings): the oldest
 * capture within the window, so the comparison spans as close to 7 days as the
 * history allows. Returns null when there are no captures at all.
 */
export function pickBase(days, now = Date.now()) {
  const floor = dayKey(now - WINDOW_DAYS * 86400e3);
  const eligible = (days || []).filter((d) => d >= floor).sort();
  if (eligible.length) return eligible[0];
  const all = (days || []).slice().sort();
  return all.length ? all[all.length - 1] : null; // stale history: use the newest we have
}

/** Prune the capture index to the most recent KEEP_DAYS entries. */
export function pruneIndex(days) {
  return Array.from(new Set(days || [])).sort().slice(-KEEP_DAYS);
}

/** Change for one node between a base capture entry and its current row. */
export function deltaFor(row, baseEntry, badgesNow, base, now = Date.now()) {
  if (!row || !baseEntry) return null;
  const [s0, d0, c0, u0, r0, t0] = baseEntry;
  const unlocked = [];
  for (const b of badgesNow || []) {
    const had = (t0 && t0[b.id] != null) ? t0[b.id] : -1;
    if ((b.tier || 0) > had) unlocked.push({ id: b.id, tier: b.tier || 0 });
  }
  return {
    since: base ? base.t : null,
    days: base ? Math.max(0, Math.round((now - base.t) / 86400e3)) : null,
    stake: (row.stake + row.delegated) - (s0 + d0),
    own: row.stake - s0,
    delegated: row.delegated - d0,
    delegators: row.delegatorCount - c0,
    uptime: (Number.isFinite(row.uptime) && Number.isFinite(u0)) ? row.uptime - u0 : null,
    rank: (row.stakeRank && r0) ? r0 - row.stakeRank : null, // positive = climbed
    unlocked
  };
}

/**
 * Diff the live snapshot against a base capture.
 * @returns { since, days, joined:{count,list}, left:{count}, delegatorGainers, stakeGainers, rankClimbers, unlocked, quiet }
 */
export function foldMovers(snap, base, now = Date.now()) {
  const rows = (snap && snap.directory) || [];
  const byNode = (snap && snap.byNode) || {};
  const b = (base && base.byNode) || {};
  const joined = [], deltas = [];
  for (const r of rows) {
    const e = b[r.nodeID];
    if (!e) { joined.push({ nodeID: r.nodeID, stake: r.stake }); continue; }
    const d = deltaFor(r, e, (byNode[r.nodeID] && byNode[r.nodeID].badges) || r.badges || [], base, now);
    d.nodeID = r.nodeID; d.stakeNow = r.stake + r.delegated; d.delegatorsNow = r.delegatorCount; d.rankNow = r.stakeRank || null; d.uptimeNow = r.uptime;
    deltas.push(d);
  }
  const present = new Set(rows.map((r) => r.nodeID));
  let left = 0;
  for (const id of Object.keys(b)) if (!present.has(id)) left++;

  const top = (key, min) => deltas.filter((d) => d[key] != null && d[key] > (min || 0)).sort((x, y) => y[key] - x[key]).slice(0, TOP_N);
  const unlocked = deltas.filter((d) => d.unlocked.length)
    .map((d) => ({ nodeID: d.nodeID, badges: d.unlocked.slice().sort((x, y) => y.tier - x.tier) }))
    .sort((x, y) => (y.badges[0].tier - x.badges[0].tier) || (y.badges.length - x.badges.length))
    .slice(0, TOP_N);
  joined.sort((x, y) => y.stake - x.stake);

  const out = {
    since: base ? base.t : null,
    days: base ? Math.max(0, Math.round((now - base.t) / 86400e3)) : null,
    tracked: base ? Object.keys(b).length : 0,
    joined: { count: joined.length, list: joined.slice(0, TOP_N) },
    left: { count: left },
    delegatorGainers: top("delegators").map((d) => ({ nodeID: d.nodeID, delta: d.delegators, now: d.delegatorsNow })),
    stakeGainers: top("stake", 1).map((d) => ({ nodeID: d.nodeID, delta: d.stake, now: d.stakeNow })),
    rankClimbers: top("rank").map((d) => ({ nodeID: d.nodeID, delta: d.rank, now: d.rankNow })),
    unlocked
  };
  out.quiet = !out.joined.count && !out.left.count && !out.delegatorGainers.length && !out.stakeGainers.length && !out.rankClimbers.length && !out.unlocked.length;
  return out;
}

/**
 * Permanent badge unlock ledger: { nodeID: { badgeId: { tier, t } } }. Folded
 * once a day from the daily capture. `t` is the capture time the tier first
 * appeared; null means "held since before tracking began" (the seed run), so
 * nothing is ever shown as unlocked on a day it was not.
 * Nodes absent from the capture are dropped; a tier that fell keeps its
 * original date so a dip and recovery is not a fresh unlock.
 */
export function foldUnlocks(prev, capture, now = Date.now()) {
  const seed = !prev;
  const out = {};
  for (const [id, entry] of Object.entries((capture && capture.byNode) || {})) {
    const tiers = entry[5] || {};
    const was = (prev && prev[id]) || {};
    const rec = {};
    for (const [bid, tier] of Object.entries(tiers)) {
      const w = was[bid];
      if (!w) rec[bid] = { tier, t: seed ? null : now };
      else if (tier > w.tier) rec[bid] = { tier, t: now };
      else rec[bid] = { tier, t: w.t == null ? null : w.t };
    }
    out[id] = rec;
  }
  return out;
}
