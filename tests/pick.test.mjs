import test from "node:test";
import assert from "node:assert/strict";
import { pickValidators, MIN_DELEGATION, MIN_DAYS } from "../netlify/functions/lib/pick.mjs";

const row = (id, o) => Object.assign({ nodeID: id, stake: 2000, delegated: 0, delegatorCount: 0, uptime: 0.999, feePct: 2, estApr: 0.08, remainingDays: 200, connected: true, stakeRank: 50 }, o);
const DIR = [
  row("CHEAP", { feePct: 2, estApr: 0.08 }),                          // net 7.84%
  row("PRICEY", { feePct: 10, estApr: 0.09 }),                        // net 8.10% -> best yield despite fee
  row("FULL", { delegated: 8000 }),                                   // no room at all
  row("ALMOST", { delegated: 7990 }),                                 // 10 AVAX free: fails headroom for 25
  row("ENDING", { remainingDays: 10 }),                               // below 14-day minimum
  row("FLAKY", { uptime: 0.97 }),                                     // below default 99% uptime
  row("NOAPR", { estApr: 0 })
];

test("pickValidators applies the protocol rules and ranks by net yield", () => {
  const p = pickValidators(DIR, { amount: 25, days: 14 });
  assert.equal(p.considered, 7);
  assert.deepEqual(p.rows.map((r) => r.nodeID), ["PRICEY", "CHEAP"]);
  assert.equal(p.rows[0].pick, 1);
  assert.ok(Math.abs(p.rows[0].netApr - 0.081) < 1e-9);
  assert.ok(Math.abs(p.rows[1].netApr - 0.0784) < 1e-9);
  assert.ok(p.rows[1].why.includes("minimum 2% fee") && p.rows[1].why.includes("flawless uptime"));
});

test("pickValidators respects fee, uptime, days and amount filters", () => {
  assert.deepEqual(pickValidators(DIR, { amount: 25, days: 14, maxFee: 5 }).rows.map((r) => r.nodeID), ["CHEAP"]);
  assert.deepEqual(pickValidators(DIR, { amount: 25, days: 14, minUptime: 0.96, maxFee: 2 }).rows.map((r) => r.nodeID), ["CHEAP", "FLAKY"]);
  assert.equal(pickValidators(DIR, { amount: 25, days: 365 }).matched, 0);
  // 2000 own stake -> 8000 cap; asking for 7900 fails the 2% headroom, 7800 passes
  assert.equal(pickValidators([row("X")], { amount: 7900, days: 14 }).matched, 0);
  assert.equal(pickValidators([row("X")], { amount: 7800, days: 14 }).matched, 1);
});

test("pickValidators floors inputs at protocol minimums and caps the list", () => {
  const p = pickValidators(DIR, { amount: 1, days: 1, limit: 1 });
  assert.equal(p.amount, MIN_DELEGATION); assert.equal(p.days, MIN_DAYS);
  assert.equal(p.rows.length, 1); assert.equal(p.matched, 2);
  assert.deepEqual(pickValidators([], {}).rows, []);
});
