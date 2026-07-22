// Per-validator history. The base P-chain RPC only returns the *current*
// validation period, so lifetime facts (how many times a node has restaked, its
// first-ever start, cumulative tenure, realized rewards) come from the Avalanche
// Data API (Glacier), which lists completed validations by NodeID. Keyless;
// cached per node upstream since it only changes when a period ends.

import { navaxToAvax } from "./pchain.mjs";

const GLACIER = process.env.GLACIER_API || "https://glacier-api.avax.network";

/** All completed (historical) validation periods for a NodeID, paginated. */
export async function fetchCompletedValidations(nodeID, { fetchImpl = fetch, base = GLACIER, maxPages = 12 } = {}) {
  const out = [];
  let pageToken = null, pages = 0;
  do {
    const u = new URL(base + "/v1/networks/mainnet/validators");
    u.searchParams.set("nodeIds", nodeID);
    u.searchParams.set("validationStatus", "completed");
    u.searchParams.set("pageSize", "100");
    if (pageToken) u.searchParams.set("pageToken", pageToken);
    const r = await fetchImpl(u);
    if (!r.ok) throw new Error("glacier http " + r.status);
    const j = await r.json();
    for (const v of (j.validators || [])) out.push(v);
    pageToken = j.nextPageToken || null;
    pages++;
  } while (pageToken && pages < maxPages);
  return out;
}

function rewardOf(rec) {
  const r = rec && rec.rewards;
  const raw = (r && (r.validationRewardAmount ?? r.amount)) ?? rec.validationRewardAmount ?? 0;
  return navaxToAvax(raw);
}

/**
 * Fold completed periods (+ the live current period from our snapshot) into a
 * lifetime summary. Pure. `current` = { startTime, endTime } in seconds (optional).
 * Returns { seasons, completedCount, firstStart, cumulativeDays, lifetimeRewards }.
 */
export function foldHistory(completed, current = null, now = Date.now()) {
  const nowSec = now / 1000;
  const periods = (Array.isArray(completed) ? completed : []).map((c) => ({
    start: Number(c.startTimestamp),
    end: Number(c.endTimestamp),
    reward: rewardOf(c)
  })).filter((p) => Number.isFinite(p.start));

  const starts = periods.map((p) => p.start);
  let cumulativeSecs = periods.reduce((s, p) => s + Math.max(0, p.end - p.start), 0);
  const lifetimeRewards = periods.reduce((s, p) => s + p.reward, 0);

  if (current && Number.isFinite(Number(current.startTime))) {
    starts.push(Number(current.startTime));
    cumulativeSecs += Math.max(0, nowSec - Number(current.startTime));
  }

  return {
    seasons: periods.length + (current ? 1 : 0),
    completedCount: periods.length,
    firstStart: starts.length ? Math.min(...starts) : null,
    cumulativeDays: cumulativeSecs / 86400,
    lifetimeRewards
  };
}
