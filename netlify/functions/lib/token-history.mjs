const DEFAULT_ROUTESCAN = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
const DEFAULT_AVAX_RPC = "https://api.avax.network/ext/bc/C/rpc";

export const TOKEN_REGISTRY = Object.freeze({
  "0xffff003a6bad9b743d658048742935fffe2b6ed7": Object.freeze({ symbol: "KET", aliases: Object.freeze(["KET", "YELLOW KET"]), decimals: 18 }),
  "0x7698a5311da174a95253ce86c21ca7272b9b05f8": Object.freeze({ symbol: "WINK", aliases: Object.freeze(["WINK"]), decimals: 18 }),
  "0x0f669808d88b2b0b3d23214dcd2a1cc6a8b1b5cd": Object.freeze({ symbol: "BLUB", aliases: Object.freeze(["BLUB"]), decimals: 18 })
});

export function normalizeTokenQuery(value) {
  return String(value || "").trim().replace(/^\$/, "").toUpperCase();
}

export function registeredToken(contract) {
  return TOKEN_REGISTRY[String(contract || "").toLowerCase()] || null;
}

export function registeredContractsForQuery(value) {
  const query = normalizeTokenQuery(value);
  if (!query) return [];
  return Object.entries(TOKEN_REGISTRY)
    .filter(([, token]) => token.symbol === query || token.aliases.includes(query))
    .map(([contract]) => contract);
}

export function tokenSymbol({ row, transfers, contract, priceSymbol, query } = {}) {
  const candidates = [
    row && (row.s || row.sym),
    ...(transfers || []).map((transfer) => transfer && transfer.tokenSymbol),
    registeredToken(contract) && registeredToken(contract).symbol,
    priceSymbol,
    normalizeTokenQuery(query)
  ];
  for (const candidate of candidates) {
    const symbol = normalizeTokenQuery(candidate);
    if (symbol && !/^0X[0-9A-F]{40}$/.test(symbol)) return symbol.slice(0, 24);
  }
  return String(contract || "TOKEN").slice(0, 8).toUpperCase();
}

function routescanUrl({ routescanBase, routescanKey, action, address, contract, startBlock, endBlock, sort, page, offset }) {
  const url = new URL(routescanBase || DEFAULT_ROUTESCAN);
  url.searchParams.set("module", "account");
  url.searchParams.set("action", action);
  url.searchParams.set("address", address);
  if (contract) url.searchParams.set("contractaddress", contract);
  url.searchParams.set("startblock", String(startBlock ?? 0));
  url.searchParams.set("endblock", String(endBlock ?? 999999999));
  url.searchParams.set("sort", sort || "asc");
  url.searchParams.set("page", String(page));
  url.searchParams.set("offset", String(offset));
  if (routescanKey) url.searchParams.set("apikey", routescanKey);
  return url;
}

/**
 * Routescan's Etherscan-compatible API silently defaults to 25 rows. Keep every
 * request explicit and refuse to call a capped ledger complete. The page/offset
 * product is bounded by Routescan at 10,000, hence eight 1,200-row pages.
 */
export async function fetchRoutescanRows({
  action = "tokentx",
  address,
  contract = null,
  startBlock = 0,
  endBlock = 999999999,
  sort = "asc",
  pageSize = 1200,
  maxPages = 8,
  routescanBase = DEFAULT_ROUTESCAN,
  routescanKey = "",
  fetchImpl = fetch
}) {
  const rows = [];
  for (let page = 1; page <= maxPages; page++) {
    const url = routescanUrl({ routescanBase, routescanKey, action, address, contract, startBlock, endBlock, sort, page, offset: pageSize });
    let response;
    try {
      response = await fetchImpl(url);
    } catch {
      return { rows, complete: false, reason: "network" };
    }
    if (!response || !response.ok) return { rows, complete: false, reason: "http" };
    let body;
    try {
      body = await response.json();
    } catch {
      return { rows, complete: false, reason: "schema" };
    }
    const batch = Array.isArray(body && body.result) ? body.result : [];
    if (!batch.length) {
      const noRows = body && body.status === "0" && /no (transactions|records) found/i.test(String(body.message || body.result || ""));
      return { rows, complete: noRows || page > 1 || body && body.status === "1", reason: noRows ? null : body && body.status === "0" ? "upstream" : null };
    }
    rows.push(...batch);
    if (batch.length < pageSize) return { rows, complete: true, reason: null };
  }
  return { rows, complete: false, reason: "row_limit" };
}

export function foldTokenTransfers(rows, address, refTs = null) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const wallet = String(address || "").toLowerCase();
  let balance = 0n;
  let peakBalance = 0n;
  let peakBeforeRef = 0n;
  let balanceAtRef = null;
  let decimals = null;
  let firstTs = null;
  let lastTs = null;
  let transfers = 0;
  for (const transfer of rows) {
    if (decimals === null && transfer.tokenDecimal !== undefined) decimals = Number.parseInt(transfer.tokenDecimal, 10);
    const ts = Number.parseInt(transfer.timeStamp, 10) * 1000;
    if (!Number.isFinite(ts)) continue;
    if (firstTs === null) firstTs = ts;
    lastTs = ts;
    if (refTs && balanceAtRef === null && ts > refTs) balanceAtRef = balance;
    let value;
    try {
      value = BigInt(transfer.value || "0");
    } catch {
      continue;
    }
    if (String(transfer.to || "").toLowerCase() === wallet) balance += value;
    else if (String(transfer.from || "").toLowerCase() === wallet) balance -= value;
    else continue;
    if (balance > peakBalance) peakBalance = balance;
    if (refTs && ts <= refTs && balance > peakBeforeRef) peakBeforeRef = balance;
    transfers++;
  }
  if (refTs && balanceAtRef === null) balanceAtRef = balance;
  const d = Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : 18;
  const divisor = 10 ** d;
  const format = (value) => Number(value) / divisor;
  return {
    firstTs,
    lastTs,
    transfers,
    decimals: d,
    peakBag: format(peakBalance),
    peakBeforeRef: format(peakBeforeRef),
    balNow: format(balance),
    balAtRef: balanceAtRef === null ? null : format(balanceAtRef)
  };
}

function balanceOfData(address) {
  return "0x70a08231" + String(address || "").toLowerCase().replace(/^0x/, "").padStart(64, "0");
}

export async function fetchErc20Balance({ address, contract, decimals = 18, rpcUrl = DEFAULT_AVAX_RPC, fetchImpl = fetch }) {
  try {
    const response = await fetchImpl(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data: balanceOfData(address) }, "latest"] })
    });
    if (!response || !response.ok) return null;
    const body = await response.json();
    if (!body || !/^0x[0-9a-f]+$/i.test(body.result || "")) return null;
    return Number(BigInt(body.result)) / 10 ** decimals;
  } catch {
    return null;
  }
}

export async function fetchRegisteredBalances({ address, rpcUrl = DEFAULT_AVAX_RPC, fetchImpl = fetch }) {
  const entries = Object.entries(TOKEN_REGISTRY);
  const balances = await Promise.all(entries.map(async ([contract, token]) => {
    const balance = await fetchErc20Balance({ address, contract, decimals: token.decimals, rpcUrl, fetchImpl });
    return [contract, balance];
  }));
  return Object.fromEntries(balances.filter(([, balance]) => Number.isFinite(balance) && balance > 0));
}

export function appendRegisteredBalanceRows(rows, balances) {
  const out = Array.isArray(rows) ? rows.slice() : [];
  const seen = new Set(out.map((row) => String(row && (row.a || row.tokenAddress) || "").toLowerCase()).filter(Boolean));
  for (const [contract, balance] of Object.entries(balances || {})) {
    const token = registeredToken(contract);
    if (!token || seen.has(contract) || !(balance > 0)) continue;
    out.push({ s: token.symbol, a: contract, p: null, i: null, so: null, bt: null, st: null, historyOnly: true });
    seen.add(contract);
  }
  return out;
}
