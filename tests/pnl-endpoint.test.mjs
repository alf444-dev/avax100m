import test from "node:test";
import assert from "node:assert/strict";

import pnl from "../netlify/functions/pnl.mjs";

const ADDR = "0x1111111111111111111111111111111111111111";
const TOKEN = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function withRuntime({ moralis, zerion, admin, fetchImpl }, run) {
  const old = {
    MORALIS_KEY: process.env.MORALIS_KEY,
    ZERION_API_KEY: process.env.ZERION_API_KEY,
    ZERION_KEY: process.env.ZERION_KEY,
    ADMIN_KEY: process.env.ADMIN_KEY,
    fetch: globalThis.fetch
  };
  if (moralis) process.env.MORALIS_KEY = moralis; else delete process.env.MORALIS_KEY;
  if (zerion) process.env.ZERION_API_KEY = zerion; else delete process.env.ZERION_API_KEY;
  delete process.env.ZERION_KEY;
  if (admin) process.env.ADMIN_KEY = admin; else delete process.env.ADMIN_KEY;
  if (fetchImpl) globalThis.fetch = fetchImpl;
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(old)) {
      if (key === "fetch") globalThis.fetch = value;
      else if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("maintenance and debug cache bypasses fail closed without admin authentication", async () => {
  await withRuntime({ moralis: "mk", admin: "a-secure-admin-key" }, async () => {
    for (const query of ["backfill=claimed", "backfill=records", `addr=${ADDR}&debug=1`]) {
      const response = await pnl(new Request(`https://example.test/api/pnl?${query}`));
      assert.equal(response.status, 404);
    }
  });
});

test("Moralis fallback keeps complete realized P&L but skips stories when balances fail", async () => {
  const calls = [];
  await withRuntime({
    moralis: "mk",
    fetchImpl: async (input) => {
      const url = new URL(input);
      calls.push(url.pathname);
      if (url.pathname.endsWith("/profitability")) {
        return jsonResponse({
          result: [{
            symbol: '<img src=x onerror="boom">COQ',
            token_address: TOKEN,
            realized_profit_usd: "25.5",
            total_usd_invested: "100",
            total_sold_usd: "125.5",
            avg_buy_price_usd: "2",
            avg_sell_price_usd: "2.51"
          }],
          cursor: null
        });
      }
      if (url.pathname.endsWith("/tokens")) return jsonResponse({ error: "down" }, 500);
      throw new Error(`unexpected upstream call ${url}`);
    }
  }, async () => {
    const response = await pnl(new Request(`https://example.test/api/pnl?addr=${ADDR}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.available, true);
    assert.equal(body.stats.summary.total, "+$26");
    assert.equal(body.stats.quality.provider, "moralis");
    assert.equal(body.stats.quality.ledgerComplete, true);
    assert.equal(body.stats.quality.balancesComplete, false);
    assert.equal(body.stats.quality.aggregateAuthoritative, false);
    assert.equal(body.stats.quality.retryable, true);
    assert.equal(body.stats.partial, true);
    assert.equal(body.stats.roundtrip, null);
    assert.match(body.stats.biggestW.sym, /^[A-Z0-9._+\-]{1,16}$/);
    assert.ok(!body.stats.biggestW.sym.includes("<"));
    assert.deepEqual(calls, [
      `/api/v2.2/wallets/${ADDR}/profitability`,
      `/api/v2.2/wallets/${ADDR}/tokens`
    ]);
  });
});

test("retired public deeper scans fail closed before provider work", async () => {
  let calls = 0;
  await withRuntime({
    moralis: "mk",
    fetchImpl: async () => {
      calls++;
      throw new Error("must not fetch");
    }
  }, async () => {
    const response = await pnl(new Request(`https://example.test/api/pnl?addr=${ADDR}&deeper=1`));
    assert.equal(response.status, 404);
    assert.equal(calls, 0);
  });
});

test("Zerion cold-wallet bootstrap is a bounded 202 retry response", async () => {
  await withRuntime({
    zerion: "zk",
    fetchImpl: async () => jsonResponse({}, 503, { "retry-after": "9" })
  }, async () => {
    const response = await pnl(new Request(`https://example.test/api/pnl?addr=${ADDR}`));
    assert.equal(response.status, 202);
    assert.equal(response.headers.get("retry-after"), "9");
    assert.deepEqual(await response.json(), { available: false, pending: true, retryAfter: 9 });
  });
});

test("transient Zerion fallback is short-lived and explicitly partial", async () => {
  await withRuntime({
    zerion: "zk",
    moralis: "mk",
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "api.zerion.io") return jsonResponse({}, 500);
      if (url.hostname === "deep-index.moralis.io" && url.pathname.endsWith("/profitability")) {
        return jsonResponse({ result: [], cursor: null });
      }
      if (url.hostname === "deep-index.moralis.io" && url.pathname.endsWith("/tokens")) {
        return jsonResponse({ result: [], cursor: null });
      }
      throw new Error(`unexpected upstream call ${url}`);
    }
  }, async () => {
    const response = await pnl(new Request(`https://example.test/api/pnl?addr=${ADDR}`));
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.stats.quality.provider, "moralis");
    assert.equal(body.stats.quality.fallbackFrom, "zerion");
    assert.equal(body.stats.quality.retryable, true);
    assert.equal(body.stats.partial, true);
  });
});
