import test from "node:test";
import assert from "node:assert/strict";

import {
  PnlProviderError,
  fetchPnlData,
  normalizeSymbol,
  parseMoralisRows
} from "../netlify/functions/lib/pnl-provider.mjs";

const ADDR = "0x1111111111111111111111111111111111111111";
const TOKEN_A = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const TOKEN_B = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";

function jsonResponse(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers }
  });
}

function memoryStore(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    values,
    async get(key) {
      const value = values.get(key);
      if (typeof value === "string") return JSON.parse(value);
      return value ?? null;
    },
    async set(key, value) {
      values.set(key, value);
    }
  };
}

test("normalizeSymbol only emits bounded safe uppercase ASCII", () => {
  const symbol = normalizeSymbol('<img src=x onerror="alert(1)">coq🔥-long-long-long', ADDR);
  assert.match(symbol, /^[A-Z0-9._+\-]{1,16}$/);
  assert.equal(symbol.length, 16);
  assert.ok(!symbol.includes("<"));
  assert.equal(normalizeSymbol("🔥", ADDR), "0X111111");
  assert.equal(normalizeSymbol(null, "javascript:alert(1)"), "TOKEN");
  assert.equal(normalizeSymbol(" usdc.e ", ADDR), "USDC.E");
});

test("parseMoralisRows normalizes symbols, derives quantities, and rejects malformed numbers", () => {
  const rows = parseMoralisRows([
    {
      symbol: "<b>coq</b>",
      token_address: TOKEN_A.toUpperCase(),
      realized_profit_usd: "25",
      total_usd_invested: "100",
      total_sold_usd: "150",
      avg_buy_price_usd: "2",
      avg_sell_price_usd: "3",
      total_tokens_bought: "0",
      total_tokens_sold: "0"
    },
    { symbol: "BAD", realized_profit_usd: "Infinity" }
  ]);

  assert.deepEqual(rows, [{
    sym: "COQ",
    profit: 25,
    invested: 100,
    sold: 150,
    boughtTk: 50,
    soldTk: 50,
    tokenAddress: TOKEN_A
  }]);
});

test("parseMoralisRows rejects arithmetically impossible upstream P&L", () => {
  const rows = parseMoralisRows([
    { symbol: "FAKE", realized_profit_usd: "1000000000000000", total_usd_invested: "0", total_sold_usd: "0" },
    { symbol: "LOSS", realized_profit_usd: "-101", total_usd_invested: "100", total_sold_usd: "0" },
    { symbol: "AIRDROP", realized_profit_usd: "10", total_usd_invested: "0", total_sold_usd: "10" }
  ]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].sym, "AIRDROP");
});

test("Zerion uses Avalanche chain filter, FIFO aggregate, metadata batches, and cache", async () => {
  const calls = [];
  const store = memoryStore();
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    calls.push({ url, options });
    if (url.pathname.endsWith(`/wallets/${ADDR}/pnl`)) {
      return jsonResponse({
        data: {
          attributes: {
            total_gain: 45,
            realized_gain: 30,
            unrealized_gain: 15,
            total_fee: 2,
            total_invested: 500,
            realized_cost_basis: 150,
            net_invested: 250,
            received_external: 10,
            sent_external: 5,
            sent_for_nfts: 0,
            received_for_nfts: 0,
            breakdown: {
              by_id: {
                alpha: {
                  average_buy_price: 2,
                  average_sell_price: 3,
                  realized_gain: 30,
                  total_invested: 200,
                  realized_cost_basis: 120,
                  net_invested: 50
                },
                beta: {
                  average_buy_price: 1,
                  average_sell_price: 1,
                  realized_gain: 0,
                  total_invested: 100,
                  net_invested: 100
                }
              }
            }
          }
        },
        meta: {
          excluded_fungible_ids: [],
          excluded_fungible_implementations: []
        }
      });
    }
    if (url.pathname.replace(/\/$/, "").endsWith("/fungibles")) {
      assert.equal(url.searchParams.get("filter[fungible_ids]"), "alpha,beta");
      return jsonResponse({
        data: [
          { id: "alpha", attributes: { symbol: "avax<script>", implementations: [{ chain_id: "avalanche", address: TOKEN_A }] } },
          { id: "beta", attributes: { symbol: "USDC.e", implementations: [{ chain_id: "avalanche", address: TOKEN_B }] } }
        ]
      });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await fetchPnlData({
    addr: ADDR,
    zerionKey: "zk",
    store,
    deadline: Date.now() + 5_000,
    fetchImpl
  });

  assert.equal(calls[0].url.searchParams.get("currency"), "usd");
  assert.equal(calls[0].url.searchParams.get("filter[chain_ids]"), "avalanche");
  assert.equal(calls[0].options.headers.authorization, `Basic ${Buffer.from("zk:").toString("base64")}`);
  assert.equal(result.provider, "zerion");
  assert.equal(result.complete, true);
  assert.equal(result.aggregate.accountingMethod, "fifo");
  assert.equal(result.aggregate.authoritative, true);
  assert.equal(result.aggregate.realizedGain, 30);
  assert.equal(result.aggregate.unrealizedGain, 15);
  assert.deepEqual(result.rows[0], {
    sym: "AVAX",
    profit: 30,
    invested: 200,
    sold: 150,
    boughtTk: 100,
    soldTk: 50,
    tokenAddress: TOKEN_A
  });
  assert.equal(result.quality.balancesComplete, false);
  assert.equal(result.quality.coverage.excludedAssets.fungibleIds.length, 0);
  assert.equal([...store.values.keys()].filter((key) => key.startsWith("zerion-fungible/")).length, 2);
});

test("Zerion metadata requests never exceed 25 ids", async () => {
  const byId = {};
  for (let i = 0; i < 26; i++) {
    byId[`token-${i}`] = {
      average_buy_price: 1,
      average_sell_price: 1,
      realized_gain: 0,
      total_invested: 1,
      net_invested: 1
    };
  }
  const metadataBatchSizes = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/pnl")) {
      return jsonResponse({
        data: { attributes: { total_gain: 0, realized_gain: 0, unrealized_gain: 0, breakdown: { by_id: byId } } }
      });
    }
    const ids = url.searchParams.get("filter[fungible_ids]").split(",");
    metadataBatchSizes.push(ids.length);
    return jsonResponse({ data: ids.map((id) => ({ id, attributes: { symbol: id } })) });
  };

  await fetchPnlData({ addr: ADDR, zerionKey: "zk", deadline: Date.now() + 5_000, fetchImpl });
  assert.deepEqual(metadataBatchSizes, [25, 1]);
});

test("Zerion bounds metadata work to the 100 most relevant rows", async () => {
  const byId = {};
  for (let i = 0; i < 130; i++) {
    byId[`token-${i}`] = {
      average_buy_price: 1,
      average_sell_price: 1,
      realized_gain: i,
      total_invested: i + 1,
      realized_cost_basis: 1,
      net_invested: 0
    };
  }
  const batches = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/pnl")) {
      return jsonResponse({ data: { attributes: { total_gain: 0, realized_gain: 0, unrealized_gain: 0, breakdown: { by_id: byId } } } });
    }
    const ids = url.searchParams.get("filter[fungible_ids]").split(",");
    batches.push(ids);
    return jsonResponse({ data: ids.map((id) => ({ id, attributes: { symbol: id } })) });
  };

  const result = await fetchPnlData({ addr: ADDR, zerionKey: "zk", deadline: Date.now() + 5_000, fetchImpl });
  assert.deepEqual(batches.map((batch) => batch.length), [25, 25, 25, 25]);
  assert.equal(result.rows.length, 130);
  assert.equal(result.quality.coverage.metadataRows, 100);
  assert.equal(result.quality.coverage.metadataDeferred, 30);
  assert.ok(result.quality.warnings.includes("metadata_limited"));
});

test("Zerion can attach complete Avalanche balances from Moralis for optional stories", async () => {
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.hostname === "api.zerion.io" && url.pathname.endsWith("/pnl")) {
      return jsonResponse({
        data: { attributes: { total_gain: 0, realized_gain: 0, unrealized_gain: 0, breakdown: { by_id: {} } } }
      });
    }
    if (url.hostname === "deep-index.moralis.io" && url.pathname.endsWith("/tokens")) {
      return jsonResponse({ result: [{ token_address: TOKEN_A, balance_formatted: "2", usd_value: "4" }], cursor: null });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await fetchPnlData({
    addr: ADDR,
    zerionKey: "zk",
    moralisKey: "mk",
    deadline: Date.now() + 5_000,
    fetchImpl
  });
  assert.equal(result.provider, "zerion");
  assert.equal(result.quality.balanceProvider, "moralis");
  assert.equal(result.quality.balancesComplete, true);
  assert.deepEqual(result.balances[TOKEN_A], { tk: 2, usd: 4 });
});

test("Zerion 503 is a bounded bootstrapping error and does not fall back", async () => {
  let calls = 0;
  await assert.rejects(
    fetchPnlData({
      addr: ADDR,
      zerionKey: "zk",
      moralisKey: "mk",
      deadline: Date.now() + 5_000,
      fetchImpl: async () => {
        calls++;
        return jsonResponse({}, { status: 503, headers: { "retry-after": "9999" } });
      }
    }),
    (error) => {
      assert.ok(error instanceof PnlProviderError);
      assert.equal(error.code, "bootstrapping");
      assert.equal(error.provider, "zerion");
      assert.equal(error.retryAfter, 30);
      return true;
    }
  );
  assert.equal(calls, 1);
});

test("Moralis paginates profitability to cursor exhaustion and fetches balances", async () => {
  const profitabilityCursors = [];
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/profitability")) {
      const cursor = url.searchParams.get("cursor");
      profitabilityCursors.push(cursor);
      if (!cursor) {
        return jsonResponse({ result: [{ symbol: "A", token_address: TOKEN_A, realized_profit_usd: "4", total_usd_invested: "10", total_sold_usd: "14" }], cursor: "next" });
      }
      return jsonResponse({ result: [{ symbol: "B", token_address: TOKEN_B, realized_profit_usd: "-2", total_usd_invested: "5", total_sold_usd: "3" }], cursor: null });
    }
    if (url.pathname.endsWith("/tokens")) {
      return jsonResponse({ result: [{ token_address: TOKEN_A, balance_formatted: "2.5", usd_value: "7.5" }], cursor: null });
    }
    throw new Error(`unexpected URL ${url}`);
  };

  const result = await fetchPnlData({ addr: ADDR, moralisKey: "mk", deadline: Date.now() + 5_000, fetchImpl });
  assert.deepEqual(profitabilityCursors, [null, "next"]);
  assert.equal(result.provider, "moralis");
  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 2);
  assert.deepEqual(result.balances[TOKEN_A], { tk: 2.5, usd: 7.5 });
  assert.equal(result.quality.balancesComplete, true);
  assert.equal(result.quality.coverage.pages, 2);
});

test("Moralis detects profitability cursor loops and marks data incomplete", async () => {
  let profitabilityCalls = 0;
  const fetchImpl = async (input) => {
    const url = new URL(input);
    if (url.pathname.endsWith("/profitability")) {
      profitabilityCalls++;
      return jsonResponse({ result: [{ symbol: "A", token_address: TOKEN_A, realized_profit_usd: "1" }], cursor: "loop" });
    }
    return jsonResponse({ result: [], cursor: null });
  };

  const result = await fetchPnlData({ addr: ADDR, moralisKey: "mk", deadline: Date.now() + 5_000, fetchImpl });
  assert.equal(profitabilityCalls, 2);
  assert.equal(result.complete, false);
  assert.equal(result.quality.coverage.stopReason, "cursor_loop");
  assert.ok(result.quality.warnings.includes("cursor_loop"));
});

test("Moralis schema errors and balance failures are explicit", async (t) => {
  await t.test("profitability schema error", async () => {
    const result = await fetchPnlData({
      addr: ADDR,
      moralisKey: "mk",
      deadline: Date.now() + 5_000,
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/profitability")) return jsonResponse({ result: { not: "an array" } });
        return jsonResponse({ result: [], cursor: null });
      }
    });
    assert.equal(result.complete, false);
    assert.equal(result.quality.coverage.stopReason, "schema_error");
  });

  await t.test("balance request failure", async () => {
    const result = await fetchPnlData({
      addr: ADDR,
      moralisKey: "mk",
      deadline: Date.now() + 5_000,
      fetchImpl: async (input) => {
        const url = new URL(input);
        if (url.pathname.endsWith("/profitability")) return jsonResponse({ result: [], cursor: null });
        return jsonResponse({ error: "down" }, { status: 500 });
      }
    });
    assert.equal(result.complete, true);
    assert.deepEqual(result.balances, {});
    assert.equal(result.quality.balancesComplete, false);
    assert.ok(result.quality.warnings.includes("balances_upstream_http"));
  });
});

test("non-bootstrapping Zerion errors fall back to Moralis", async () => {
  const result = await fetchPnlData({
    addr: ADDR,
    zerionKey: "zk",
    moralisKey: "mk",
    deadline: Date.now() + 5_000,
    fetchImpl: async (input) => {
      const url = new URL(input);
      if (url.hostname === "api.zerion.io") return jsonResponse({ error: "down" }, { status: 500 });
      return jsonResponse({ result: [], cursor: null });
    }
  });
  assert.equal(result.provider, "moralis");
  assert.equal(result.quality.fallbackFrom, "zerion");
  assert.ok(result.quality.warnings.includes("zerion_upstream_http"));
});
