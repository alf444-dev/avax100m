import test from "node:test";
import assert from "node:assert/strict";

import {
  appendRegisteredBalanceRows,
  fetchErc20Balance,
  fetchRoutescanRows,
  foldTokenTransfers,
  registeredContractsForQuery,
  tokenSymbol
} from "../netlify/functions/lib/token-history.mjs";

const WALLET = "0x88896886f994def40213ea82af840c32b8b1942c";
const KET = "0xffff003a6bad9b743d658048742935fffe2b6ed7";

function transfer({ hash, timestamp, from, to, value, block = "1" }) {
  return {
    blockNumber: block,
    timeStamp: timestamp,
    hash,
    from,
    to,
    value,
    contractAddress: KET,
    tokenName: "yellow ket",
    tokenSymbol: "KET",
    tokenDecimal: "18"
  };
}

test("Routescan pagination never mistakes a full page for a complete ledger", async () => {
  const rows = [
    transfer({ hash: "0xa", timestamp: "1736958240", from: "0x0000000000000000000000000000000000000001", to: WALLET, value: "1000000000000000000" }),
    transfer({ hash: "0xb", timestamp: "1737717800", from: "0x0000000000000000000000000000000000000002", to: WALLET, value: "2000000000000000000" }),
    transfer({ hash: "0xc", timestamp: "1737717839", from: WALLET, to: "0x0000000000000000000000000000000000000003", value: "1000000000000000000" }),
    transfer({ hash: "0xd", timestamp: "1775966602", from: WALLET, to: "0x0000000000000000000000000000000000000004", value: "1500000000000000000" })
  ];
  const calls = [];
  const result = await fetchRoutescanRows({
    address: WALLET,
    contract: KET,
    pageSize: 2,
    maxPages: 4,
    fetchImpl: async (input) => {
      const url = new URL(input);
      calls.push(url);
      const page = Number(url.searchParams.get("page"));
      const body = page <= 2 ? { status: "1", message: "OK", result: rows.slice((page - 1) * 2, page * 2) } : { status: "0", message: "No transactions found", result: [] };
      return new Response(JSON.stringify(body), { status: 200 });
    }
  });

  assert.equal(result.complete, true);
  assert.equal(result.rows.length, 4);
  assert.deepEqual(calls.map((url) => [url.searchParams.get("page"), url.searchParams.get("offset")]), [["1", "2"], ["2", "2"], ["3", "2"]]);
  const replay = foldTokenTransfers(result.rows, WALLET);
  assert.equal(replay.transfers, 4);
  assert.equal(replay.balNow, 0.5);
  assert.equal(new Date(replay.lastTs).toISOString().slice(0, 10), "2026-04-12");
});

test("KET aliases and metadata resolve to one canonical identity", () => {
  assert.deepEqual(registeredContractsForQuery("ket"), [KET]);
  assert.deepEqual(registeredContractsForQuery("$KET"), [KET]);
  assert.deepEqual(registeredContractsForQuery("yellow ket"), [KET]);
  assert.equal(tokenSymbol({ contract: KET, transfers: [{ tokenSymbol: "KET" }], query: KET }), "KET");

  const indexed = appendRegisteredBalanceRows([], { [KET]: 0.159348227451259947 });
  assert.deepEqual(indexed, [{ s: "KET", a: KET, p: null, i: null, so: null, bt: null, st: null, historyOnly: true }]);
});

test("balanceOf is authoritative even when transfer replay is stale", async () => {
  const raw = 159348227451259947n;
  const balance = await fetchErc20Balance({
    address: WALLET,
    contract: KET,
    decimals: 18,
    fetchImpl: async (_input, init) => {
      const body = JSON.parse(init.body);
      assert.equal(body.method, "eth_call");
      assert.match(body.params[0].data, /^0x70a08231/);
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: "0x" + raw.toString(16) }), { status: 200 });
    }
  });
  assert.equal(balance, 0.15934822745125993);
});
