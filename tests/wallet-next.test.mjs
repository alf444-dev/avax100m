import test from "node:test";
import assert from "node:assert/strict";
import { nextUpWallet, tierOf, WTIERS } from "../netlify/functions/lib/wallet-next.mjs";

const GENESIS = Date.UTC(2020, 8, 21), DAY = 864e5;
const RANKS = [[2e3, "PERMAFROST"], [1600, "OG"], [1200, "VETERAN"], [800, "SURVIVOR"], [400, "RESIDENT"], [120, "SETTLER"], [0, "FRESH SNOW"]];
const NOW = GENESIS + 2191 * DAY; // mainnet is 2,191 days old
const by = (list, id) => list.find((x) => x.id === id);

test("tierOf reads the shared floors", () => {
  assert.equal(tierOf("thousand", 999), 0);
  assert.equal(tierOf("thousand", 1000), 1);
  assert.equal(tierOf("thousand", 5000), 2);
  assert.equal(tierOf("thousand", 12000), 3);
  assert.equal(tierOf("furniture", 74.9), 0);
  assert.equal(tierOf("furniture", 95), 3);
  assert.deepEqual(WTIERS.furniture, [75, 90, 95]);
});

test("a 921-day wallet is a survivor heading for veteran", () => {
  const next = nextUpWallet({ ts: NOW - 921 * DAY, txc: 610, ranks: RANKS }, NOW);
  const rank = by(next, "rank");
  assert.equal(rank.name, "VETERAN");
  assert.equal(rank.label, "279 more days");
  assert.ok(Math.abs(rank.frac - (921 - 800) / 400) < 1e-9, "progress is measured inside the current rank");
  assert.equal(by(next, "thousand").tier, 1);
  assert.equal(by(next, "thousand").label, "390 more transactions");
});

test("furniture days solve (age + d) / (mainnet + d) = T exactly", () => {
  const age = 921, next = nextUpWallet({ ts: NOW - age * DAY, txc: null, ranks: RANKS }, NOW);
  const f = by(next, "furniture");
  assert.equal(f.tier, 1);
  const d = Number(f.label.replace(/[^0-9]/g, ""));
  assert.ok((age + d) / (2191 + d) >= 0.75, "after d days the floor is met");
  assert.ok((age + d - 1) / (2191 + d - 1) < 0.75, "and not a day sooner");
});

test("an early wallet works toward the higher furniture tiers, measured from the tier it holds", () => {
  const next = nextUpWallet({ ts: NOW - 2000 * DAY, txc: 7000, ranks: RANKS }, NOW); // 91.3% survived
  const f = by(next, "furniture");
  assert.equal(f.tier, 3);
  assert.ok(f.frac > 0.2 && f.frac < 0.3, "91.3% sits a quarter of the way from 90 to 95");
  assert.equal(by(next, "thousand").tier, 3);
  assert.equal(by(next, "thousand").label, "3,000 more transactions");
  assert.equal(by(next, "rank"), undefined, "permafrost is the top rank: nothing above it");
});

test("nothing is invented: top of every ladder, unknown tx count, bad input", () => {
  assert.deepEqual(nextUpWallet({ ts: NOW - 2150 * DAY, txc: 20000, ranks: RANKS }, NOW), []);
  assert.equal(by(nextUpWallet({ ts: NOW - 50 * DAY, txc: null, ranks: RANKS }, NOW), "thousand"), undefined);
  assert.deepEqual(nextUpWallet({ ts: NaN, txc: 5, ranks: RANKS }, NOW), []);
  assert.deepEqual(nextUpWallet({ ts: NOW + DAY, txc: 5, ranks: RANKS }, NOW), []);
});

test("closest goal first, never 100%, singular units", () => {
  const next = nextUpWallet({ ts: NOW - 799 * DAY, txc: 999, ranks: RANKS }, NOW);
  assert.equal(next[0].id, "thousand");
  assert.equal(next[0].label, "1 more transaction");
  assert.equal(by(next, "rank").label, "1 more day");
  assert.ok(next.every((n) => n.frac < 1));
  for (let i = 1; i < next.length; i++) assert.ok(next[i - 1].frac >= next[i].frac);
});
