// P-Chain (platform) read helpers. The rest of the app reads the C-chain; this
// is the only place that talks to Avalanche's platform chain. Keyless public RPC,
// same host the C-chain calls already use. Fold logic is pure + injectable so the
// tests can exercise it without a network.

export const P_RPC = process.env.AVAX_P_RPC || "https://api.avax.network/ext/bc/P";
const YEAR_SECONDS = 365.25 * 24 * 3600;
const NAVAX = 1e9; // 1 AVAX = 1e9 nAVAX
const MAX_DELEGATOR_DETAIL = 50; // cap per-node delegator detail kept for lookups

const num = (v) => {
  const n = typeof v === "bigint" ? Number(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
};
export const navaxToAvax = (v) => num(v) / NAVAX;

/** Minimal JSON-RPC POST against the P-chain. `fetchImpl` is injectable for tests. */
export async function rpc(method, params = {}, { fetchImpl = fetch, rpcUrl = P_RPC, signal } = {}) {
  const r = await fetchImpl(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "platform." + method, params }),
    signal
  });
  if (!r.ok) throw new Error("p-chain rpc " + method + " http " + r.status);
  const j = await r.json();
  if (j && j.error) throw new Error("p-chain rpc " + method + ": " + (j.error.message || "error"));
  return j && j.result;
}

/** Current primary-network validators (omit subnetID → primary network). */
export async function fetchCurrentValidators(opts = {}) {
  const res = await rpc("getCurrentValidators", {}, opts);
  return (res && res.validators) || [];
}

/** Total current AVAX supply, in nAVAX (string). Used for the staking ratio. */
export async function fetchCurrentSupply(opts = {}) {
  const res = await rpc("getCurrentSupply", {}, opts);
  return res && res.supply != null ? res.supply : null;
}

function annualizedApr(rewardAvax, stakeAvax, startTime, endTime) {
  const durYears = (num(endTime) - num(startTime)) / YEAR_SECONDS;
  if (!(stakeAvax > 0) || !(durYears > 0)) return 0;
  return rewardAvax / stakeAvax / durYears;
}

/**
 * Fold a raw `getCurrentValidators` list (+ optional nAVAX supply) into the
 * compact shape the section renders from. Pure — no network, no clock beyond `now`.
 * Returns { stats, directory (trimmed rows), byNode (full detail), asOf }.
 */
export function foldValidators(validators, supplyNavax = null, now = Date.now()) {
  const list = Array.isArray(validators) ? validators : [];
  const nowSec = Math.floor(now / 1000);
  const supply = supplyNavax != null ? navaxToAvax(supplyNavax) : null;

  const directory = [];
  const byNode = {};
  let totalStaked = 0, totalDelegated = 0, delegatorCount = 0, connectedCount = 0;
  let uptimeWeight = 0, uptimeSum = 0, aprWeight = 0, aprSum = 0;
  let minStake = Infinity, maxStake = 0;

  for (const v of list) {
    const stake = navaxToAvax(v.stakeAmount ?? v.weight);
    const delegated = navaxToAvax(v.delegatorWeight);
    const reward = navaxToAvax(v.potentialReward);
    const dCount = num(v.delegatorCount);
    const uptime = Number(v.uptime) / 100; // P-chain returns a percent ("99.87"); store as a 0..1 fraction
    const feePct = Number(v.delegationFee); // percent, e.g. "2.0000"
    const startTime = num(v.startTime);
    const endTime = num(v.endTime);
    const connected = v.connected === true;
    const estApr = annualizedApr(reward, stake, startTime, endTime);

    totalStaked += stake;
    totalDelegated += delegated;
    delegatorCount += dCount;
    if (connected) connectedCount++;
    if (stake > 0) { minStake = Math.min(minStake, stake); maxStake = Math.max(maxStake, stake); }
    if (Number.isFinite(uptime)) { uptimeWeight += stake; uptimeSum += uptime * stake; }
    if (estApr > 0) { aprWeight += stake; aprSum += estApr * stake; }

    const row = {
      nodeID: v.nodeID,
      stake,
      delegated,
      delegatorCount: dCount,
      uptime: Number.isFinite(uptime) ? uptime : null,
      connected,
      feePct: Number.isFinite(feePct) ? feePct : null,
      potentialReward: reward,
      estApr,
      startTime,
      endTime,
      remainingDays: Math.max(0, (endTime - nowSec) / 86400)
    };
    directory.push(row);
    // Keep only the largest delegators per node so the cached snapshot stays bounded
    // even for the handful of validators with thousands of delegations.
    const delegators = (Array.isArray(v.delegators) ? v.delegators : [])
      .map((d) => ({
        txID: d.txID,
        stake: navaxToAvax(d.stakeAmount ?? d.weight),
        startTime: num(d.startTime),
        endTime: num(d.endTime),
        potentialReward: navaxToAvax(d.potentialReward)
      }))
      .sort((a, b) => b.stake - a.stake)
      .slice(0, MAX_DELEGATOR_DETAIL);
    byNode[v.nodeID] = Object.assign({}, row, { delegators });
  }

  const totalActive = totalStaked + totalDelegated;
  const stats = {
    validatorCount: directory.length,
    delegatorCount,
    connectedCount,
    totalStaked,
    totalDelegated,
    totalActive,
    supply,
    stakingRatio: supply && supply > 0 ? totalActive / supply : null,
    avgUptime: uptimeWeight > 0 ? uptimeSum / uptimeWeight : null,
    estApr: aprWeight > 0 ? aprSum / aprWeight : null,
    minStake: Number.isFinite(minStake) ? minStake : 0,
    maxStake
  };

  return { stats, directory, byNode, asOf: now };
}

const SORTABLE = new Set(["stake", "delegated", "delegators", "uptime", "reward", "apr", "remaining"]);
const SORT_KEY = { delegators: "delegatorCount", reward: "potentialReward", apr: "estApr", remaining: "remainingDays" };

/** Sort / filter / paginate a folded directory for the API. Pure. */
export function queryDirectory(directory, { sort = "stake", dir = "desc", q = "", limit = 50, offset = 0 } = {}) {
  let rows = directory;
  const needle = String(q || "").trim().toLowerCase();
  if (needle) rows = rows.filter((r) => String(r.nodeID || "").toLowerCase().includes(needle));

  const key = SORTABLE.has(sort) ? (SORT_KEY[sort] || sort) : "stake";
  const mul = dir === "asc" ? 1 : -1;
  rows = rows.slice().sort((a, b) => ((a[key] ?? 0) - (b[key] ?? 0)) * mul);

  const total = rows.length;
  const off = Math.max(0, Number(offset) || 0);
  const lim = Math.min(200, Math.max(1, Number(limit) || 50));
  return { rows: rows.slice(off, off + lim), total, offset: off, limit: lim, sort, dir, q: needle };
}
