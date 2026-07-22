import test from "node:test";
import assert from "node:assert/strict";

import { foldValidators, queryDirectory, navaxToAvax } from "../netlify/functions/lib/pchain.mjs";

const YEAR = 365.25 * 24 * 3600;
const NOW = 3_000_000_000; // fixed clock (ms) so remainingDays is deterministic

// Two validators, both engineered to yield exactly 9% annualized APR so the
// stake-weighted network APR is a clean assertion.
const VALIDATORS = [
  {
    nodeID: "NodeID-AAA",
    startTime: "1000000",
    endTime: String(1000000 + YEAR),          // 1-year stake
    stakeAmount: "2000000000000000",           // 2,000,000 AVAX
    potentialReward: "180000000000000",        // 180,000 AVAX  -> 9%/yr
    delegatorWeight: "1000000000000000",       // 1,000,000 AVAX delegated
    delegatorCount: "2",
    uptime: "99.0000",
    delegationFee: "2.0000",
    connected: true,
    delegators: [
      { txID: "d1", stakeAmount: "600000000000000", startTime: "1000000", endTime: "1500000", potentialReward: "1000000000" },
      { txID: "d2", stakeAmount: "400000000000000", startTime: "1000000", endTime: "1500000", potentialReward: "2000000000" }
    ]
  },
  {
    nodeID: "NodeID-BBB",
    startTime: "2000000",
    endTime: String(2000000 + 2 * YEAR),       // 2-year stake
    stakeAmount: "2000000000000",               // 2,000 AVAX
    potentialReward: "360000000000",            // 360 AVAX over 2yr -> 9%/yr
    delegatorWeight: "0",
    delegatorCount: "0",
    uptime: "97.0000",
    delegationFee: "2.0000",
    connected: false,
    delegators: []
  }
];

const SUPPLY_NAVAX = "450000000000000000"; // 450,000,000 AVAX

test("navaxToAvax converts nAVAX to AVAX", () => {
  assert.equal(navaxToAvax("2000000000000000"), 2_000_000);
  assert.equal(navaxToAvax("0"), 0);
});

test("foldValidators aggregates network staking stats", () => {
  const { stats } = foldValidators(VALIDATORS, SUPPLY_NAVAX, NOW);
  assert.equal(stats.validatorCount, 2);
  assert.equal(stats.delegatorCount, 2);
  assert.equal(stats.connectedCount, 1);
  assert.equal(stats.totalStaked, 2_002_000);
  assert.equal(stats.totalDelegated, 1_000_000);
  assert.equal(stats.totalActive, 3_002_000);
  assert.equal(stats.supply, 450_000_000);
  assert.ok(Math.abs(stats.stakingRatio - 3_002_000 / 450_000_000) < 1e-9);
  assert.ok(Math.abs(stats.estApr - 0.09) < 1e-9, "stake-weighted APR is 9%");
  assert.ok(Math.abs(stats.avgUptime - (0.99 * 2_000_000 + 0.97 * 2000) / 2_002_000) < 1e-9);
  assert.equal(stats.minStake, 2000);
  assert.equal(stats.maxStake, 2_000_000);
});

test("directory rows are trimmed; byNode keeps delegator detail", () => {
  const { directory, byNode } = foldValidators(VALIDATORS, SUPPLY_NAVAX, NOW);
  const a = directory.find((r) => r.nodeID === "NodeID-AAA");
  assert.equal(a.stake, 2_000_000);
  assert.equal(a.delegated, 1_000_000);
  assert.equal(a.delegatorCount, 2);
  assert.equal(a.feePct, 2);
  assert.ok(Math.abs(a.uptime - 0.99) < 1e-9);
  assert.ok(Math.abs(a.estApr - 0.09) < 1e-9);
  assert.equal("delegators" in a, false, "directory rows drop the heavy delegators array");

  // single-validator lookup keeps (capped, stake-sorted) delegator detail
  assert.equal(byNode["NodeID-AAA"].delegators.length, 2);
  assert.equal(byNode["NodeID-AAA"].delegators[0].stake, 600_000, "delegators sorted by stake desc");
  assert.equal(byNode["NodeID-BBB"].delegators.length, 0);
});

test("foldValidators is safe on empty input", () => {
  const { stats, directory } = foldValidators([], null, NOW);
  assert.equal(stats.validatorCount, 0);
  assert.equal(stats.stakingRatio, null);
  assert.equal(stats.estApr, null);
  assert.equal(directory.length, 0);
});

test("queryDirectory sorts, filters and paginates", () => {
  const { directory } = foldValidators(VALIDATORS, SUPPLY_NAVAX, NOW);

  const byStake = queryDirectory(directory, { sort: "stake", dir: "desc" });
  assert.deepEqual(byStake.rows.map((r) => r.nodeID), ["NodeID-AAA", "NodeID-BBB"]);
  assert.equal(byStake.total, 2);

  const byRemaining = queryDirectory(directory, { sort: "remaining", dir: "asc" });
  assert.deepEqual(byRemaining.rows.map((r) => r.nodeID), ["NodeID-AAA", "NodeID-BBB"]);

  const filtered = queryDirectory(directory, { q: "bbb" });
  assert.deepEqual(filtered.rows.map((r) => r.nodeID), ["NodeID-BBB"]);
  assert.equal(filtered.total, 1);

  const paged = queryDirectory(directory, { sort: "stake", dir: "desc", limit: 1, offset: 1 });
  assert.deepEqual(paged.rows.map((r) => r.nodeID), ["NodeID-BBB"]);
  assert.equal(paged.total, 2);
});
