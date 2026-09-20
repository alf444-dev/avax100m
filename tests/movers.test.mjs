import test from "node:test";
import assert from "node:assert/strict";
import { captureOf, pickBase, pruneIndex, deltaFor, foldMovers, dayKey, KEEP_DAYS, foldUnlocks } from "../netlify/functions/lib/movers.mjs";

const DAY = 86400e3;
const NOW = Date.UTC(2026, 8, 28, 12); // 2026-09-28T12:00Z
const row = (id, o) => Object.assign({ nodeID: id, stake: 2000, delegated: 0, delegatorCount: 0, uptime: 0.99, stakeRank: 50 }, o);
const snapOf = (rows, badges = {}) => ({
  directory: rows,
  byNode: Object.fromEntries(rows.map((r) => [r.nodeID, Object.assign({}, r, { badges: badges[r.nodeID] || [] })])),
  asOf: NOW
});

test("captureOf is compact and keeps badge tiers", () => {
  const snap = snapOf([row("A", { delegated: 500, delegatorCount: 3 })], { A: [{ id: "flawless", tier: 1 }, { id: "solo", tier: 0 }] });
  const cap = captureOf(snap, NOW);
  assert.equal(cap.day, "2026-09-28");
  assert.deepEqual(cap.byNode.A, [2000, 500, 3, 0.99, 50, { flawless: 1, solo: 0 }]);
});

test("pickBase prefers the oldest capture inside the 7-day window", () => {
  const d = (n) => dayKey(NOW - n * DAY);
  assert.equal(pickBase([d(0), d(3), d(6), d(9)], NOW), d(6));   // 9 days back is outside the window
  assert.equal(pickBase([d(0), d(2)], NOW), d(2));               // young history: best available
  assert.equal(pickBase([d(12), d(9)], NOW), d(9));              // stale history: newest we have
  assert.equal(pickBase([], NOW), null);
  assert.equal(pruneIndex([d(1), d(1), d(0)]).length, 2);
  assert.equal(pruneIndex(Array.from({ length: 20 }, (_, i) => d(i))).length, KEEP_DAYS);
});

test("deltaFor signs every metric and lists newly unlocked tiers", () => {
  const base = { t: NOW - 7 * DAY, byNode: { A: [2000, 100, 2, 0.98, 60, { flawless: 1 }] } };
  const r = row("A", { delegated: 900, delegatorCount: 12, uptime: 0.996, stakeRank: 41 });
  const d = deltaFor(r, base.byNode.A, [{ id: "flawless", tier: 2 }, { id: "magnet", tier: 0 }, { id: "solo", tier: 0 }], base, NOW);
  assert.equal(d.days, 7);
  assert.equal(d.stake, 800); assert.equal(d.delegated, 800); assert.equal(d.own, 0);
  assert.equal(d.delegators, 10);
  assert.equal(d.rank, 19);
  assert.ok(Math.abs(d.uptime - 0.016) < 1e-9);
  assert.deepEqual(d.unlocked, [{ id: "flawless", tier: 2 }, { id: "magnet", tier: 0 }, { id: "solo", tier: 0 }]);
  assert.equal(deltaFor(r, null, [], base), null);
});

test("foldMovers ranks gainers, counts joins/leaves, flags a quiet week", () => {
  const base = { t: NOW - 7 * DAY, byNode: {
    A: [2000, 0, 0, 0.99, 10, {}],
    B: [2000, 1000, 5, 0.99, 20, { magnet: 0 }],
    GONE: [2000, 0, 0, 0.99, 30, {}]
  } };
  const snap = snapOf([
    row("A", { delegated: 3000, delegatorCount: 30, stakeRank: 8 }),
    row("B", { delegated: 1200, delegatorCount: 7, stakeRank: 21 }),
    row("NEW", { stake: 5000, stakeRank: 5 })
  ], { A: [{ id: "magnet", tier: 1 }, { id: "trusted", tier: 1 }] });
  const m = foldMovers(snap, base, NOW);
  assert.equal(m.days, 7);
  assert.equal(m.tracked, 3);
  assert.deepEqual(m.joined, { count: 1, list: [{ nodeID: "NEW", stake: 5000 }] });
  assert.equal(m.left.count, 1);
  assert.deepEqual(m.delegatorGainers.map((x) => x.nodeID + ":" + x.delta), ["A:30", "B:2"]);
  assert.deepEqual(m.stakeGainers.map((x) => x.nodeID + ":" + x.delta), ["A:3000", "B:200"]);
  assert.deepEqual(m.rankClimbers, [{ nodeID: "A", delta: 2, now: 8 }]);   // B slipped one, not a climber
  assert.equal(m.unlocked.length, 1); assert.equal(m.unlocked[0].nodeID, "A"); assert.equal(m.unlocked[0].badges.length, 2);
  assert.equal(m.quiet, false);

  const same = foldMovers(snapOf([row("A", { stakeRank: 10 })]), { t: NOW - DAY, byNode: { A: [2000, 0, 0, 0.99, 10, {}] } }, NOW);
  assert.equal(same.quiet, true); assert.equal(same.days, 1);
});

test("foldUnlocks seeds with null dates, then stamps only real upgrades", () => {
  const cap = (tiersByNode) => ({ t: NOW, byNode: Object.fromEntries(Object.entries(tiersByNode).map(([id, t]) => [id, [1, 0, 0, 0.99, 1, t]])) });
  const seed = foldUnlocks(null, cap({ A: { flawless: 1, solo: 0 }, B: { magnet: 2 } }), NOW - 3 * DAY);
  assert.deepEqual(seed.A, { flawless: { tier: 1, t: null }, solo: { tier: 0, t: null } });   // pre-tracking: no date claimed
  const later = foldUnlocks(seed, cap({ A: { flawless: 2, solo: 0, generous: 0 }, C: { trusted: 1 } }), NOW);
  assert.deepEqual(later.A.flawless, { tier: 2, t: NOW });      // upgraded: stamped
  assert.deepEqual(later.A.solo, { tier: 0, t: null });         // unchanged: stays undated
  assert.deepEqual(later.A.generous, { tier: 0, t: NOW });      // new badge after seed: stamped
  assert.deepEqual(later.C, { trusted: { tier: 1, t: NOW } });  // new node after seed: stamped
  assert.equal(later.B, undefined);                              // left the set: dropped
  const dip = foldUnlocks(later, cap({ A: { flawless: 1, solo: 0, generous: 0 } }), NOW + DAY);
  assert.deepEqual(dip.A.flawless, { tier: 1, t: NOW });        // fell a tier: keeps its date
  const back = foldUnlocks(dip, cap({ A: { flawless: 2, solo: 0, generous: 0 } }), NOW + 2 * DAY);
  assert.deepEqual(back.A.flawless, { tier: 2, t: NOW + 2 * DAY }); // regained: that is a new unlock
});
