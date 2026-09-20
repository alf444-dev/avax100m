import test from "node:test";
import assert from "node:assert/strict";
import { compareNodes, handleOf, topPct } from "../netlify/functions/lib/compare.mjs";
import { foldValidators } from "../netlify/functions/lib/pchain.mjs";

const nd = (o) => Object.assign({ node: { nodeID: "NodeID-X", uptime: 0.99, stake: 2000, delegated: 0, delegatorCount: 0, feePct: 2, estApr: 0.08, startTime: 1000 }, rank: 100, badges: [], history: null, profile: null, delta: null }, o);

test("handleOf prefers a claimed handle, else a shortened NodeID", () => {
  assert.equal(handleOf(nd({ profile: { handle: "Alpha" } })), "Alpha");
  assert.equal(handleOf(nd({ node: { nodeID: "NodeID-7Xhw2mDxuDS3zVN7g4iDLxvEHfP1n8s6W" } })), "NodeID-7Xhw2m…8s6W");
});

test("topPct labels the share beaten, floors at 1%, and needs a real set", () => {
  assert.equal(topPct(0.91, 600), "top 9%");
  assert.equal(topPct(0.999, 600), "top 1%");
  assert.equal(topPct(0.5, 10), null);
  assert.equal(topPct(null, 600), null);
});

test("compareNodes scores each metric in its own direction and tallies", () => {
  const A = nd({ node: { nodeID: "NodeID-A", uptime: 0.999, stake: 5000, delegated: 100, delegatorCount: 3, feePct: 2, estApr: 0.07, startTime: 1000 }, rank: 40, badges: [{ id: "flawless", tier: 3 }], history: { seasons: 3, firstStart: 500, lifetimeRewards: 900 } });
  const B = nd({ node: { nodeID: "NodeID-B", uptime: 0.99, stake: 5000, delegated: 800, delegatorCount: 10, feePct: 10, estApr: 0.09, startTime: 2000 }, rank: 60, badges: [], history: null, delta: { delegators: 4 } });
  const c = compareNodes(A, B);
  const win = Object.fromEntries(c.rows.map((r) => [r.k, r.win]));
  assert.equal(win.uptime, "a");
  assert.equal(win.stake, null);            // tie
  assert.equal(win.delegated, "b");
  assert.equal(win.fee, "a");               // lower fee wins
  assert.equal(win.apr, "b");
  assert.equal(win.rank, "a");              // lower rank number wins
  assert.equal(win.badges, "a");
  assert.equal(win.seasons, "a");           // B has no history: A wins by default
  assert.equal(win.since, "a");             // earlier first validation wins
  assert.equal(win.rewards, "a");
  assert.equal(win.d7, "b");                // only B has a 7-day delta
  assert.equal(c.tally.ties, 1);
  assert.equal(c.tally.a + c.tally.b + c.tally.ties, c.rows.length);
  assert.equal(c.leader, "a");
  assert.equal(c.rows.find((r) => r.k === "fee").b.text, "10%");
  assert.equal(c.rows.find((r) => r.k === "since").a.text, "1970-01-01");
});

test("compareNodes is symmetric under swapping sides", () => {
  const A = nd({ node: { nodeID: "NodeID-A", uptime: 0.999, stake: 1, delegated: 0, delegatorCount: 0, feePct: 2, estApr: 0.07, startTime: 1000 }, rank: 5 });
  const B = nd({ node: { nodeID: "NodeID-B", uptime: 0.9, stake: 9, delegated: 0, delegatorCount: 0, feePct: 3, estApr: 0.09, startTime: 1000 }, rank: 6 });
  const ab = compareNodes(A, B), ba = compareNodes(B, A);
  assert.equal(ab.tally.a, ba.tally.b); assert.equal(ab.tally.b, ba.tally.a);
  assert.equal(ab.leader === "a", ba.leader === "b");
});

test("foldValidators attaches beats-fraction percentiles to byNode only", () => {
  const YEAR = 365.25 * 86400;
  const mk = (i) => ({ nodeID: "NodeID-" + i, startTime: "0", endTime: String(YEAR), stakeAmount: String((i + 1) * 1e12), potentialReward: "1000000000000", delegatorWeight: "0", delegatorCount: "0", uptime: String(90 + i), delegationFee: "2.0000", connected: true, delegators: [] });
  const snap = foldValidators(Array.from({ length: 5 }, (_, i) => mk(i)), null, 1000);
  assert.equal(snap.byNode["NodeID-0"].pctl.stake, 0);
  assert.equal(snap.byNode["NodeID-4"].pctl.stake, 1);
  assert.equal(snap.byNode["NodeID-2"].pctl.uptime, 0.5);
  assert.equal(snap.directory[0].pctl, undefined);
  assert.equal(snap.stats.pctlCount, 5);
});
