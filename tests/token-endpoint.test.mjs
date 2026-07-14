import test from "node:test";
import assert from "node:assert/strict";

import token, { _mem } from "../netlify/functions/token.mjs";

const WALLET = "0x88896886f994def40213ea82af840c32b8b1942c";
const KET = "0xffff003a6bad9b743d658048742935fffe2b6ed7";
const RAW_BALANCE = 159348227451259947n;

const TRANSFERS = [
  { blockNumber: "55847069", timeStamp: "1736958240", hash: "0xd424", from: "0xb64292e86990184381b1c117d6edf1cbd3d0ef73", to: WALLET, value: "2710131000000000000000000", contractAddress: KET, tokenName: "yellow ket", tokenSymbol: "KET", tokenDecimal: "18", functionName: "disperseToken(address,address[],uint256[])" },
  { blockNumber: "56284401", timeStamp: "1737717800", hash: "0xc1e3", from: "0x88de50b233052e4fb783d4f6db78cc34fea3e9fc", to: WALLET, value: "38766689526918932020679", contractAddress: KET, tokenName: "yellow ket", tokenSymbol: "KET", tokenDecimal: "18", functionName: "swapCompact()" },
  { blockNumber: "56284421", timeStamp: "1737717839", hash: "0x4f08", from: "0x88de50b233052e4fb783d4f6db78cc34fea3e9fc", to: WALLET, value: "77439032101025906183099", contractAddress: KET, tokenName: "yellow ket", tokenSymbol: "KET", tokenDecimal: "18", functionName: "swapCompact()" },
  { blockNumber: "82724004", timeStamp: "1775966602", hash: "0x528f", from: WALLET, to: "0xb92f00000000000000000000000000000000ff4f", value: "159188879223808687824", contractAddress: KET, tokenName: "yellow ket", tokenSymbol: "KET", tokenDecimal: "18", functionName: "mergeOrbs(uint256)" }
];

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("ket, $ket, and contract lookup share complete history, ticker, dust balance, and qualified P&L state", async () => {
  for (const key of Object.keys(_mem)) delete _mem[key];
  _mem.claim = new Map([["c/" + WALLET, JSON.stringify({ claimed: true })]]);
  _mem.pnl = new Map([["v25/" + WALLET, JSON.stringify({
    rowsIdx: [{ s: "OTHER", a: "0x1111111111111111111111111111111111111111", p: 1, i: 1, so: 2 }]
  })]]);
  const oldFetch = globalThis.fetch;
  const routescanCalls = [];
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    if (url.hostname === "api.routescan.io") {
      routescanCalls.push(url);
      assert.equal(url.searchParams.get("offset"), "1200");
      return json({ status: "1", message: "OK", result: TRANSFERS });
    }
    if (url.hostname === "api.avax.network") {
      const body = JSON.parse(init.body);
      assert.equal(body.method, "eth_call");
      return json({ jsonrpc: "2.0", id: 1, result: "0x" + RAW_BALANCE.toString(16) });
    }
    if (url.hostname === "coins.llama.fi" && url.pathname.startsWith("/prices/current/")) {
      return json({ coins: { ["avax:" + KET]: { decimals: 18, symbol: "KET", price: 0.0011639456 } } });
    }
    if (url.hostname === "coins.llama.fi" && url.pathname.startsWith("/chart/")) {
      assert.ok(Number(url.searchParams.get("span")) <= 500);
      const start = Number(url.searchParams.get("start"));
      return json({ coins: { ["avax:" + KET]: { prices: [{ timestamp: start, price: 0.01 }, { timestamp: start + 86400, price: 0.1 }] } } });
    }
    throw new Error("unexpected fetch " + url);
  };

  try {
    for (const query of ["ket", "$ket", KET]) {
      const response = await token(new Request("https://example.test/api/token?addr=" + WALLET + "&q=" + encodeURIComponent(query)));
      assert.equal(response.status, 200);
      const body = await response.json();
      assert.equal(body.sym, "KET");
      assert.equal(body.contract, KET);
      assert.equal(body.transfers, 4);
      assert.equal(body.lastActivity, "2026-04-12");
      assert.equal(body.holdingNow, false);
      assert.equal(body.holdingDust, true);
      assert.ok(body.holdingUsd < 0.001);
      assert.equal(body.realized, null);
      assert.match(body.pnlUnavailable, /not covered/);
      assert.equal(body.updated, null);
    }
    assert.equal(routescanCalls.length, 1, "the canonical contract dossier should be shared by every alias");
  } finally {
    globalThis.fetch = oldFetch;
  }
});
