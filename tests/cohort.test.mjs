import test from "node:test";
import assert from "node:assert/strict";
import { foldCohort, isMember, TIER_LABEL } from "../netlify/functions/lib/cohort.mjs";

const RECORDS = [
  { nodeID: "NodeID-A", tier: "A", score: 500, scoreDelta: 120, categories: { builder: 300, support: 50 }, handle: "Alpha" },
  { nodeID: "NodeID-B", tier: "B", score: 300, scoreDelta: 20, categories: { educator: 200 } },
  { nodeID: "NodeID-C", tier: "C", score: 100, categories: { builder: 80 } },
  { nodeID: "NodeID-D", handle: "Just Claimed" } // self-claimed only — not a cohort member
];
const BYNODE = { "NodeID-A": { uptime: 0.99, stake: 1000, connected: true }, "NodeID-B": { uptime: 0.95 } };

test("tier labels are defined", () => {
  assert.equal(TIER_LABEL.A, "Core Contributor");
  assert.equal(TIER_LABEL.C, "Reliable Validator");
});

test("isMember requires a portal-assigned tier or score", () => {
  assert.equal(isMember({ tier: "A" }), true);
  assert.equal(isMember({ score: 0 }), true);
  assert.equal(isMember({ handle: "x" }), false);
});

test("foldCohort builds top20, tier counts, category leaders and rising", () => {
  const c = foldCohort(RECORDS, BYNODE);
  assert.equal(c.memberCount, 3);             // D excluded (no tier/score)
  assert.equal(c.scoredCount, 3);
  assert.deepEqual(c.top20.map((r) => r.nodeID), ["NodeID-A", "NodeID-B", "NodeID-C"]);
  assert.deepEqual(c.top20.map((r) => r.boardRank), [1, 2, 3]);
  assert.equal(c.top20[0].uptime, 0.99);      // merged from snapshot
  assert.deepEqual(c.tierCounts, { A: 1, B: 1, C: 1 });
  assert.deepEqual(c.categories.builder.map((x) => x.nodeID), ["NodeID-A", "NodeID-C"]);
  assert.deepEqual(c.categories.educator.map((x) => x.nodeID), ["NodeID-B"]);
  assert.deepEqual(c.categories.support.map((x) => x.pts), [50]);
  assert.deepEqual(c.rising.map((r) => r.nodeID), ["NodeID-A", "NodeID-B"]); // delta>0, desc
});

test("foldCohort is empty-safe", () => {
  const c = foldCohort([], {});
  assert.equal(c.memberCount, 0);
  assert.equal(c.scoredCount, 0);
  assert.deepEqual(c.top20, []);
});
