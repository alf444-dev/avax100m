const ZERION_BASE = "https://api.zerion.io/v1";
const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";
const MAX_REQUEST_MS = 10_000;
const MAX_RETRY_AFTER_SECONDS = 30;
const MAX_MORALIS_PAGES = 100;
const MAX_ZERION_ROWS = 2_500;
const MAX_METADATA_ROWS = 100;
const METADATA_BATCH_SIZE = 25;
const METADATA_CACHE_MS = 30 * 24 * 60 * 60 * 1_000;
const MAX_SYMBOL_LENGTH = 16;
const MAX_USD_VALUE = 1e15;
const MAX_TOKEN_VALUE = 1e60;

export class PnlProviderError extends Error {
  constructor(message, {
    code = "provider_error",
    provider = null,
    status = null,
    retryAfter = null,
    cause = null
  } = {}) {
    super(message, cause ? { cause } : undefined);
    this.name = "PnlProviderError";
    this.code = code;
    this.provider = provider;
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

/**
 * Symbols are rendered in generated cards, so keep this deliberately narrower
 * than arbitrary Unicode text. The address fallback is deterministic and safe.
 */
export function normalizeSymbol(value, fallbackAddress) {
  const normalized = typeof value === "string"
    ? value.replace(/<[^>]*>/g, "").trim().toUpperCase().replace(/[^A-Z0-9._+\-]/g, "").slice(0, MAX_SYMBOL_LENGTH)
    : "";
  if (normalized) return normalized;

  const address = typeof fallbackAddress === "string" ? fallbackAddress.trim() : "";
  if (/^0x[0-9a-f]{40}$/i.test(address)) return address.slice(0, 8).toUpperCase();
  return "TOKEN";
}

function finiteNumber(value, { min = -Infinity, max = Infinity } = {}) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) && number >= min && number <= max ? number : null;
}

function validAddress(value) {
  return typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value)
    ? value.toLowerCase()
    : null;
}

export function parseMoralisRows(tokens) {
  if (!Array.isArray(tokens)) return [];

  const rows = [];
  for (const token of tokens) {
    if (!token || typeof token !== "object" || token.realized_profit_usd === undefined) continue;

    const profit = finiteNumber(token.realized_profit_usd, { min: -MAX_USD_VALUE, max: MAX_USD_VALUE });
    const invested = finiteNumber(token.total_usd_invested ?? 0, { min: 0, max: MAX_USD_VALUE });
    const sold = finiteNumber(token.total_sold_usd ?? 0, { min: 0, max: MAX_USD_VALUE });
    const avgBuy = finiteNumber(token.avg_buy_price_usd ?? 0, { min: 0, max: MAX_USD_VALUE });
    const avgSell = finiteNumber(token.avg_sell_price_usd ?? 0, { min: 0, max: MAX_USD_VALUE });
    let boughtTk = finiteNumber(token.total_tokens_bought ?? 0, { min: 0, max: MAX_TOKEN_VALUE });
    let soldTk = finiteNumber(token.total_tokens_sold ?? 0, { min: 0, max: MAX_TOKEN_VALUE });

    if ([profit, invested, sold, avgBuy, avgSell, boughtTk, soldTk].some((value) => value === null)) continue;
    // Realized gain cannot exceed gross sale proceeds (zero-basis assets) and
    // realized loss cannot exceed the dollars invested. Reject impossible
    // upstream arithmetic before it reaches summaries or public rankings.
    const tolerance = Math.max(0.01, Math.max(invested, sold) * 1e-6);
    if (profit > sold + tolerance || profit < -invested - tolerance) continue;
    if (!boughtTk && avgBuy > 0) boughtTk = invested / avgBuy;
    if (!soldTk && avgSell > 0) soldTk = sold / avgSell;
    if (!Number.isFinite(boughtTk) || !Number.isFinite(soldTk)) continue;

    const tokenAddress = validAddress(token.token_address ?? token.tokenAddress);
    rows.push({
      sym: normalizeSymbol(token.symbol ?? token.token_symbol, tokenAddress),
      profit,
      invested,
      sold,
      boughtTk,
      soldTk,
      tokenAddress
    });
  }
  return rows;
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deadlineValue(deadline) {
  const value = deadline instanceof Date ? deadline.getTime() : Number(deadline);
  return Number.isFinite(value) ? value : Infinity;
}

function deadlineExpired(deadline) {
  return Date.now() >= deadlineValue(deadline);
}

async function boundedFetch(fetchImpl, url, options, deadline, provider) {
  const absoluteDeadline = deadlineValue(deadline);
  const remaining = absoluteDeadline - Date.now();
  if (remaining <= 0) {
    throw new PnlProviderError(`${provider} request deadline exceeded`, {
      code: "deadline_exceeded",
      provider
    });
  }

  const timeoutMs = Math.max(1, Math.min(MAX_REQUEST_MS, remaining));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();
  try {
    return await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (cause) {
    const timedOut = controller.signal.aborted;
    throw new PnlProviderError(
      timedOut ? `${provider} request deadline exceeded` : `${provider} request failed`,
      { code: timedOut ? "deadline_exceeded" : "network_error", provider, cause }
    );
  } finally {
    clearTimeout(timer);
  }
}

async function responseJson(response, provider) {
  try {
    return await response.json();
  } catch (cause) {
    throw new PnlProviderError(`${provider} returned invalid JSON`, {
      code: "invalid_schema",
      provider,
      status: response.status,
      cause
    });
  }
}

function responseHeader(response, name) {
  if (response?.headers && typeof response.headers.get === "function") return response.headers.get(name);
  const headers = response?.headers;
  if (!headers || typeof headers !== "object") return null;
  return headers[name] ?? headers[name.toLowerCase()] ?? null;
}

function boundedRetryAfter(value) {
  let seconds = Number(value);
  if (!Number.isFinite(seconds) && typeof value === "string") {
    const at = Date.parse(value);
    if (Number.isFinite(at)) seconds = Math.ceil((at - Date.now()) / 1_000);
  }
  if (!Number.isFinite(seconds) || seconds <= 0) seconds = 5;
  return Math.max(1, Math.min(MAX_RETRY_AFTER_SECONDS, Math.ceil(seconds)));
}

function basicAuthorization(key) {
  return `Basic ${Buffer.from(`${key}:`, "utf8").toString("base64")}`;
}

function providerHttpError(provider, response) {
  return new PnlProviderError(`${provider} returned HTTP ${response.status}`, {
    code: "upstream_http",
    provider,
    status: response.status
  });
}

function optionalAggregateNumber(attributes, key, min = -MAX_USD_VALUE) {
  if (attributes[key] === null || attributes[key] === undefined) return null;
  const value = finiteNumber(attributes[key], { min, max: MAX_USD_VALUE });
  if (value === null) {
    throw new PnlProviderError(`zerion aggregate field ${key} is invalid`, {
      code: "invalid_schema",
      provider: "zerion"
    });
  }
  return value;
}

function parseZerionAggregate(attributes) {
  for (const key of ["total_gain", "realized_gain", "unrealized_gain"]) {
    if (finiteNumber(attributes[key], { min: -MAX_USD_VALUE, max: MAX_USD_VALUE }) === null) {
      throw new PnlProviderError(`zerion aggregate field ${key} is invalid`, {
        code: "invalid_schema",
        provider: "zerion"
      });
    }
  }

  const totalGain = Number(attributes.total_gain);
  const realizedGain = Number(attributes.realized_gain);
  const unrealizedGain = Number(attributes.unrealized_gain);
  const tolerance = Math.max(0.01, Math.max(Math.abs(totalGain), Math.abs(realizedGain), Math.abs(unrealizedGain)) * 1e-6);
  if (Math.abs(totalGain - realizedGain - unrealizedGain) > tolerance) {
    throw new PnlProviderError("zerion aggregate P&L arithmetic is inconsistent", {
      code: "invalid_schema",
      provider: "zerion"
    });
  }

  return {
    accountingMethod: "fifo",
    authoritative: true,
    totalGain,
    realizedGain,
    unrealizedGain,
    totalFee: optionalAggregateNumber(attributes, "total_fee", 0),
    totalInvested: optionalAggregateNumber(attributes, "total_invested", 0),
    realizedCostBasis: optionalAggregateNumber(attributes, "realized_cost_basis", 0),
    netInvested: optionalAggregateNumber(attributes, "net_invested"),
    receivedExternal: optionalAggregateNumber(attributes, "received_external", 0),
    sentExternal: optionalAggregateNumber(attributes, "sent_external", 0),
    sentForNfts: optionalAggregateNumber(attributes, "sent_for_nfts", 0),
    receivedForNfts: optionalAggregateNumber(attributes, "received_for_nfts", 0)
  };
}

function sanitizeExcluded(values) {
  if (!Array.isArray(values)) return [];
  return values
    .filter((value) => typeof value === "string" && value.length > 0)
    .slice(0, 1_000)
    .map((value) => value.slice(0, 256));
}

function zerionRow(id, stats, metadata) {
  if (!isObject(stats)) return null;
  const profit = finiteNumber(stats.realized_gain, { min: -MAX_USD_VALUE, max: MAX_USD_VALUE });
  const invested = finiteNumber(stats.total_invested ?? 0, { min: 0, max: MAX_USD_VALUE });
  const netInvested = finiteNumber(stats.net_invested ?? invested, { min: -MAX_USD_VALUE, max: MAX_USD_VALUE });
  const realizedCostBasis = stats.realized_cost_basis === null || stats.realized_cost_basis === undefined
    ? null
    : finiteNumber(stats.realized_cost_basis, { min: 0, max: MAX_USD_VALUE });
  const avgBuy = finiteNumber(stats.average_buy_price ?? 0, { min: 0, max: MAX_USD_VALUE });
  const avgSell = finiteNumber(stats.average_sell_price ?? 0, { min: 0, max: MAX_USD_VALUE });
  if ([profit, invested, netInvested, avgBuy, avgSell].some((value) => value === null) ||
      stats.realized_cost_basis !== null && stats.realized_cost_basis !== undefined && realizedCostBasis === null) return null;

  // FIFO realized gain is exact proceeds minus the basis of the disposed lots.
  // Older payloads lack realized_cost_basis, so retain the documented net-invested fallback.
  const grossProceeds = realizedCostBasis === null ? invested - netInvested : realizedCostBasis + profit;
  const tolerance = Math.max(0.01, Math.max(invested, realizedCostBasis ?? 0, Math.abs(profit)) * 1e-6);
  if (grossProceeds < -tolerance) return null;
  const sold = Math.max(0, grossProceeds);
  const boughtTk = avgBuy > 0 ? invested / avgBuy : 0;
  const soldTk = avgSell > 0 ? sold / avgSell : 0;
  if (![sold, boughtTk, soldTk].every(Number.isFinite)) return null;

  const tokenAddress = validAddress(metadata?.address);
  return {
    sym: normalizeSymbol(metadata?.symbol ?? id, tokenAddress),
    profit,
    invested,
    sold,
    boughtTk,
    soldTk,
    tokenAddress
  };
}

function metadataCacheKey(id) {
  return `zerion-fungible/${encodeURIComponent(id)}`;
}

async function getCachedMetadata(store, id) {
  if (!store || typeof store.get !== "function") return null;
  try {
    const cached = await store.get(metadataCacheKey(id), { type: "json" });
    if (!isObject(cached)) return null;
    if (isObject(cached.v) && finiteNumber(cached.t) !== null && Date.now() - cached.t < METADATA_CACHE_MS) {
      return cached.v;
    }
    // Also accept a direct value from older cache writers.
    if (typeof cached.symbol === "string" || validAddress(cached.address)) return cached;
  } catch {
    // Cache availability must not affect P&L availability.
  }
  return null;
}

async function setCachedMetadata(store, id, value) {
  if (!store || typeof store.set !== "function" || !value) return;
  try {
    await store.set(metadataCacheKey(id), JSON.stringify({ t: Date.now(), v: value }));
  } catch {
    // Best-effort cache.
  }
}

function implementationAddress(item) {
  const implementations = item?.attributes?.implementations ?? item?.implementations;
  if (Array.isArray(implementations)) {
    for (const implementation of implementations) {
      if (!isObject(implementation)) continue;
      const chain = implementation.chain_id ?? implementation.chainId ?? implementation.chain;
      if (chain === "avalanche") {
        const address = validAddress(implementation.address ?? implementation.contract_address);
        if (address) return address;
      }
    }
  }

  const relationshipData = item?.relationships?.implementations?.data;
  if (Array.isArray(relationshipData)) {
    for (const implementation of relationshipData) {
      if (!isObject(implementation) || typeof implementation.id !== "string") continue;
      const match = /^avalanche:(0x[0-9a-f]{40})$/i.exec(implementation.id);
      if (match) return match[1].toLowerCase();
    }
  }
  return null;
}

function parseFungibleMetadata(item) {
  if (!isObject(item) || typeof item.id !== "string") return null;
  return {
    id: item.id,
    symbol: normalizeSymbol(item.attributes?.symbol, implementationAddress(item)),
    address: implementationAddress(item)
  };
}

async function fetchZerionMetadata(ids, { key, store, deadline, fetchImpl }) {
  const metadata = new Map();
  const cachedValues = await Promise.all(ids.map((id) => getCachedMetadata(store, id)));
  const missing = [];
  ids.forEach((id, index) => {
    if (cachedValues[index]) metadata.set(id, cachedValues[index]);
    else missing.push(id);
  });

  let complete = true;
  const warnings = [];
  for (let offset = 0; offset < missing.length; offset += METADATA_BATCH_SIZE) {
    if (deadlineExpired(deadline)) {
      complete = false;
      warnings.push("metadata_deadline");
      break;
    }

    const batch = missing.slice(offset, offset + METADATA_BATCH_SIZE);
    const url = new URL(`${ZERION_BASE}/fungibles/`);
    url.searchParams.set("filter[fungible_ids]", batch.join(","));
    url.searchParams.set("page[size]", String(METADATA_BATCH_SIZE));
    try {
      const response = await boundedFetch(fetchImpl, url, {
        headers: { authorization: basicAuthorization(key), accept: "application/json" }
      }, deadline, "zerion");
      if (!response.ok) throw providerHttpError("zerion", response);
      const body = await responseJson(response, "zerion");
      if (!isObject(body) || !Array.isArray(body.data)) {
        throw new PnlProviderError("zerion fungible metadata schema is invalid", {
          code: "invalid_schema",
          provider: "zerion"
        });
      }
      const writes = [];
      for (const item of body.data) {
        const value = parseFungibleMetadata(item);
        if (!value || !batch.includes(value.id)) continue;
        metadata.set(value.id, { symbol: value.symbol, address: value.address });
        writes.push(setCachedMetadata(store, value.id, { symbol: value.symbol, address: value.address }));
      }
      await Promise.all(writes);
      if (batch.some((id) => !metadata.has(id))) {
        complete = false;
        warnings.push("metadata_missing");
      }
    } catch (error) {
      complete = false;
      warnings.push(error instanceof PnlProviderError ? `metadata_${error.code}` : "metadata_error");
    }
  }

  return { metadata, complete, warnings: [...new Set(warnings)] };
}

async function fetchZerion({ addr, key, store, deadline, fetchImpl }) {
  const url = new URL(`${ZERION_BASE}/wallets/${addr}/pnl`);
  url.searchParams.set("currency", "usd");
  url.searchParams.set("filter[chain_ids]", "avalanche");
  const response = await boundedFetch(fetchImpl, url, {
    headers: { authorization: basicAuthorization(key), accept: "application/json" }
  }, deadline, "zerion");

  if (response.status === 503) {
    throw new PnlProviderError("zerion is bootstrapping this wallet", {
      code: "bootstrapping",
      provider: "zerion",
      status: 503,
      retryAfter: boundedRetryAfter(responseHeader(response, "retry-after"))
    });
  }
  if (!response.ok) throw providerHttpError("zerion", response);

  const body = await responseJson(response, "zerion");
  const attributes = body?.data?.attributes;
  const byId = attributes?.breakdown?.by_id;
  if (!isObject(body) || !isObject(attributes) || !isObject(byId)) {
    throw new PnlProviderError("zerion P&L schema is invalid", {
      code: "invalid_schema",
      provider: "zerion"
    });
  }

  const allEntries = Object.entries(byId);
  const entries = allEntries.slice(0, MAX_ZERION_ROWS);
  const ids = entries.map(([id]) => id).filter((id) => typeof id === "string" && id.length > 0 && id.length <= 256);
  const idSet = new Set(ids);
  // Metadata is presentation/enrichment data, not accounting data. Resolve it
  // only for the rows most likely to be displayed or enriched; the complete
  // FIFO aggregate and every valid row remain available without an unbounded
  // per-token fan-out.
  const metadataIds = entries
    .filter(([id]) => idSet.has(id))
    .sort((a, b) => {
      const score = (entry) => Math.max(
        Math.abs(finiteNumber(entry?.realized_gain) ?? 0),
        finiteNumber(entry?.total_invested, { min: 0 }) ?? 0
      );
      return score(b[1]) - score(a[1]);
    })
    .slice(0, MAX_METADATA_ROWS)
    .map(([id]) => id);
  const metadataResult = await fetchZerionMetadata(metadataIds, { key, store, deadline, fetchImpl });
  const rows = [];
  let invalidRows = allEntries.length - entries.length;
  for (const [id, stats] of entries) {
    if (!idSet.has(id)) {
      invalidRows++;
      continue;
    }
    const row = zerionRow(id, stats, metadataResult.metadata.get(id));
    if (row) rows.push(row);
    else invalidRows++;
  }

  const excludedAssets = {
    fungibleIds: sanitizeExcluded(body.meta?.excluded_fungible_ids),
    fungibleImplementations: sanitizeExcluded(body.meta?.excluded_fungible_implementations)
  };
  const hasExcludedAssets = excludedAssets.fungibleIds.length > 0 || excludedAssets.fungibleImplementations.length > 0;
  const complete = invalidRows === 0 && !hasExcludedAssets && allEntries.length <= MAX_ZERION_ROWS;
  const warnings = [...metadataResult.warnings];
  if (ids.length > metadataIds.length) warnings.push("metadata_limited");
  if (invalidRows) warnings.push("invalid_rows");
  if (hasExcludedAssets) warnings.push("excluded_assets");
  if (allEntries.length > MAX_ZERION_ROWS) warnings.push("row_limit");

  return {
    provider: "zerion",
    rows,
    balances: {},
    complete,
    aggregate: parseZerionAggregate(attributes),
    quality: {
      accountingMethod: "fifo",
      aggregateAuthoritative: true,
      balancesComplete: false,
      metadataComplete: metadataResult.complete,
      coverage: {
        chain: "avalanche",
        rowCount: rows.length,
        invalidRows,
        metadataRows: metadataIds.length,
        metadataDeferred: Math.max(0, ids.length - metadataIds.length),
        excludedAssets
      },
      warnings: [...new Set(warnings)]
    }
  };
}

async function fetchMoralisJson(path, { key, deadline, fetchImpl }) {
  const response = await boundedFetch(fetchImpl, `${MORALIS_BASE}${path}`, {
    headers: { "X-API-Key": key, accept: "application/json" }
  }, deadline, "moralis");
  if (!response.ok) throw providerHttpError("moralis", response);
  return responseJson(response, "moralis");
}

function moralisBatch(body) {
  if (!isObject(body)) return null;
  const batch = body.result ?? body.data;
  return Array.isArray(batch) ? batch : null;
}

async function fetchMoralisBalances(addr, options) {
  const balances = {};
  let cursor = null;
  const seen = new Set();
  let pages = 0;

  try {
    while (pages < MAX_MORALIS_PAGES) {
      if (deadlineExpired(options.deadline)) return { balances, complete: false, stopReason: "deadline" };
      const query = new URLSearchParams({ chain: "avalanche", limit: "100" });
      if (cursor) query.set("cursor", cursor);
      const body = await fetchMoralisJson(`/wallets/${addr}/tokens?${query}`, options);
      const batch = moralisBatch(body);
      if (!batch) return { balances, complete: false, stopReason: "schema_error" };
      pages++;

      for (const token of batch) {
        if (!isObject(token)) continue;
        const address = validAddress(token.token_address ?? token.tokenAddress);
        const balance = finiteNumber(token.balance_formatted ?? token.balanceFormatted, { min: 0, max: MAX_TOKEN_VALUE });
        const usd = finiteNumber(token.usd_value ?? token.usdValue ?? 0, { min: 0, max: MAX_USD_VALUE });
        if (address && balance !== null && usd !== null && balance > 0) balances[address] = { tk: balance, usd };
      }

      const next = body.cursor;
      if (next === null || next === undefined || next === "") return { balances, complete: true, stopReason: null };
      if (typeof next !== "string") return { balances, complete: false, stopReason: "schema_error" };
      if (seen.has(next)) return { balances, complete: false, stopReason: "cursor_loop" };
      seen.add(next);
      cursor = next;
    }
    return { balances, complete: false, stopReason: "max_pages" };
  } catch (error) {
    return {
      balances,
      complete: false,
      stopReason: error instanceof PnlProviderError ? error.code : "fetch_error"
    };
  }
}

async function fetchMoralis({ addr, key, deadline, fetchImpl, fallbackError = null }) {
  const rawRows = [];
  let cursor = null;
  const seen = new Set();
  let pages = 0;
  let complete = true;
  let stopReason = null;

  while (pages < MAX_MORALIS_PAGES) {
    if (deadlineExpired(deadline)) {
      complete = false;
      stopReason = "deadline";
      break;
    }

    const query = new URLSearchParams({ chain: "avalanche", limit: "100" });
    if (cursor) query.set("cursor", cursor);
    let body;
    try {
      body = await fetchMoralisJson(`/wallets/${addr}/profitability?${query}`, { key, deadline, fetchImpl });
    } catch (error) {
      if (pages === 0) throw error;
      complete = false;
      stopReason = error instanceof PnlProviderError ? error.code : "fetch_error";
      break;
    }

    const batch = moralisBatch(body);
    if (!batch) {
      complete = false;
      stopReason = "schema_error";
      break;
    }
    rawRows.push(...batch);
    pages++;

    const next = body.cursor;
    if (next === null || next === undefined || next === "") break;
    if (typeof next !== "string") {
      complete = false;
      stopReason = "schema_error";
      break;
    }
    if (seen.has(next)) {
      complete = false;
      stopReason = "cursor_loop";
      break;
    }
    seen.add(next);
    cursor = next;
  }

  if (pages >= MAX_MORALIS_PAGES && cursor) {
    complete = false;
    stopReason = "max_pages";
  }

  const rows = parseMoralisRows(rawRows);
  const invalidRows = rawRows.length - rows.length;
  if (invalidRows > 0) {
    complete = false;
    stopReason ||= "invalid_rows";
  }

  const balanceResult = await fetchMoralisBalances(addr, { key, deadline, fetchImpl });
  const realizedGain = rows.reduce((sum, row) => sum + row.profit, 0);
  const warnings = [];
  if (stopReason) warnings.push(stopReason);
  if (!balanceResult.complete) warnings.push(`balances_${balanceResult.stopReason || "incomplete"}`);
  if (fallbackError) warnings.push(`zerion_${fallbackError.code || "error"}`);

  return {
    provider: "moralis",
    rows,
    balances: balanceResult.balances,
    complete,
    aggregate: {
      accountingMethod: "weighted_average",
      authoritative: false,
      totalGain: realizedGain,
      realizedGain,
      unrealizedGain: null,
      totalFee: null,
      totalInvested: rows.reduce((sum, row) => sum + row.invested, 0),
      realizedCostBasis: null,
      netInvested: null,
      receivedExternal: null,
      sentExternal: null,
      sentForNfts: null,
      receivedForNfts: null
    },
    quality: {
      accountingMethod: "weighted_average",
      aggregateAuthoritative: false,
      balancesComplete: balanceResult.complete,
      metadataComplete: true,
      coverage: {
        chain: "avalanche",
        pages,
        maxPages: MAX_MORALIS_PAGES,
        stopReason,
        balanceStopReason: balanceResult.stopReason,
        invalidRows,
        excludedAssets: { fungibleIds: [], fungibleImplementations: [] }
      },
      fallbackFrom: fallbackError ? "zerion" : null,
      warnings: [...new Set(warnings)]
    }
  };
}

export async function fetchPnlData({
  addr,
  zerionKey,
  moralisKey,
  store = null,
  deadline = Infinity,
  fetchImpl = fetch
}) {
  const normalizedAddress = validAddress(addr);
  if (!normalizedAddress) {
    throw new PnlProviderError("invalid wallet address", { code: "bad_address" });
  }
  if (typeof fetchImpl !== "function") {
    throw new PnlProviderError("fetch implementation is required", { code: "bad_configuration" });
  }

  const zerion = typeof zerionKey === "string" ? zerionKey.trim() : "";
  const moralis = typeof moralisKey === "string" ? moralisKey.trim() : "";
  if (!zerion && !moralis) {
    throw new PnlProviderError("no P&L provider is configured", { code: "not_configured" });
  }

  if (zerion) {
    try {
      const result = await fetchZerion({
        addr: normalizedAddress,
        key: zerion,
        store,
        deadline,
        fetchImpl
      });
      if (moralis) {
        const balanceResult = await fetchMoralisBalances(normalizedAddress, {
          key: moralis,
          deadline,
          fetchImpl
        });
        result.balances = balanceResult.balances;
        result.quality.balancesComplete = balanceResult.complete;
        result.quality.balanceProvider = "moralis";
        result.quality.coverage.balanceStopReason = balanceResult.stopReason;
        if (!balanceResult.complete) {
          result.quality.warnings = [...new Set([
            ...result.quality.warnings,
            `balances_${balanceResult.stopReason || "incomplete"}`
          ])];
        }
      }
      return result;
    } catch (error) {
      const normalizedError = error instanceof PnlProviderError
        ? error
        : new PnlProviderError("zerion provider failed", {
          code: "provider_error",
          provider: "zerion",
          cause: error
        });
      if (normalizedError.code === "bootstrapping" || normalizedError.code === "deadline_exceeded" || !moralis) {
        throw normalizedError;
      }
      return fetchMoralis({
        addr: normalizedAddress,
        key: moralis,
        deadline,
        fetchImpl,
        fallbackError: normalizedError
      });
    }
  }

  return fetchMoralis({
    addr: normalizedAddress,
    key: moralis,
    deadline,
    fetchImpl
  });
}
