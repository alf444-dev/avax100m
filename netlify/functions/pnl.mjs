// node_modules/@netlify/runtime-utils/dist/main.js
var getString = (input) => typeof input === "string" ? input : JSON.stringify(input);
var base64Decode = globalThis.Buffer ? (input) => Buffer.from(input, "base64").toString() : (input) => atob(input);
var base64Encode = globalThis.Buffer ? (input) => Buffer.from(getString(input)).toString("base64") : (input) => btoa(getString(input));
var getEnvironment = () => {
  const { Deno, Netlify, process: process2 } = globalThis;
  return Netlify?.env ?? Deno?.env ?? {
    delete: (key) => delete process2?.env[key],
    get: (key) => process2?.env[key],
    has: (key) => Boolean(process2?.env[key]),
    set: (key, value) => {
      if (process2?.env) {
        process2.env[key] = value;
      }
    },
    toObject: () => process2?.env ?? {}
  };
};

// node_modules/@netlify/otel/dist/main.js
var GET_TRACER = "__netlify__getTracer";
var getTracer = (name, version) => {
  return globalThis[GET_TRACER]?.(name, version);
};
function withActiveSpan(tracer, name, optionsOrFn, contextOrFn, fn) {
  const func = typeof contextOrFn === "function" ? contextOrFn : typeof optionsOrFn === "function" ? optionsOrFn : fn;
  if (!func) {
    throw new Error("function to execute with active span is missing");
  }
  if (!tracer) {
    return func();
  }
  return tracer.withActiveSpan(name, optionsOrFn, contextOrFn, func);
}

// node_modules/@netlify/blobs/dist/chunk-YAGWSQMB.js
var getEnvironmentContext = () => {
  const context = globalThis.netlifyBlobsContext || getEnvironment().get("NETLIFY_BLOBS_CONTEXT");
  if (typeof context !== "string" || !context) {
    return {};
  }
  const data = base64Decode(context);
  try {
    return JSON.parse(data);
  } catch {
  }
  return {};
};
var MissingBlobsEnvironmentError = class extends Error {
  constructor(requiredProperties) {
    super(
      `The environment has not been configured to use Netlify Blobs. To use it manually, supply the following properties when creating a store: ${requiredProperties.join(
        ", "
      )}`
    );
    this.name = "MissingBlobsEnvironmentError";
  }
};
var BASE64_PREFIX = "b64;";
var METADATA_HEADER_INTERNAL = "x-amz-meta-user";
var METADATA_HEADER_EXTERNAL = "netlify-blobs-metadata";
var METADATA_MAX_SIZE = 2 * 1024;
var encodeMetadata = (metadata) => {
  if (!metadata) {
    return null;
  }
  const encodedObject = base64Encode(JSON.stringify(metadata));
  const payload = `b64;${encodedObject}`;
  if (METADATA_HEADER_EXTERNAL.length + payload.length > METADATA_MAX_SIZE) {
    throw new Error("Metadata object exceeds the maximum size");
  }
  return payload;
};
var decodeMetadata = (header) => {
  if (!header?.startsWith(BASE64_PREFIX)) {
    return {};
  }
  const encodedData = header.slice(BASE64_PREFIX.length);
  const decodedData = base64Decode(encodedData);
  const metadata = JSON.parse(decodedData);
  return metadata;
};
var getMetadataFromResponse = (response) => {
  if (!response.headers) {
    return {};
  }
  const value = response.headers.get(METADATA_HEADER_EXTERNAL) || response.headers.get(METADATA_HEADER_INTERNAL);
  try {
    return decodeMetadata(value);
  } catch {
    throw new Error(
      "An internal error occurred while trying to retrieve the metadata for an entry. Please try updating to the latest version of the Netlify Blobs client."
    );
  }
};
var NF_ERROR = "x-nf-error";
var NF_REQUEST_ID = "x-nf-request-id";
var BlobsInternalError = class extends Error {
  constructor(res) {
    let details = res.headers.get(NF_ERROR) || `${res.status} status code`;
    if (res.headers.has(NF_REQUEST_ID)) {
      details += `, ID: ${res.headers.get(NF_REQUEST_ID)}`;
    }
    super(`Netlify Blobs has generated an internal error (${details})`);
    this.name = "BlobsInternalError";
  }
};
var collectIterator = async (iterator) => {
  const result = [];
  for await (const item of iterator) {
    result.push(item);
  }
  return result;
};
function withSpan(span, name, fn) {
  if (span) return fn(span);
  return withActiveSpan(getTracer(), name, (span2) => {
    return fn(span2);
  });
}
var BlobsConsistencyError = class extends Error {
  constructor() {
    super(
      `Netlify Blobs has failed to perform a read using strong consistency because the environment has not been configured with a 'uncachedEdgeURL' property`
    );
    this.name = "BlobsConsistencyError";
  }
};
var regions = {
  "us-east-1": true,
  "us-east-2": true,
  "eu-central-1": true,
  "ap-southeast-1": true,
  "ap-southeast-2": true
};
var isValidRegion = (input) => Object.keys(regions).includes(input);
var InvalidBlobsRegionError = class extends Error {
  constructor(region) {
    super(
      `${region} is not a supported Netlify Blobs region. Supported values are: ${Object.keys(regions).join(", ")}.`
    );
    this.name = "InvalidBlobsRegionError";
  }
};
var DEFAULT_RETRY_DELAY = getEnvironment().get("NODE_ENV") === "test" ? 1 : 5e3;
var MIN_RETRY_DELAY = 1e3;
var MAX_RETRY = 5;
var RATE_LIMIT_HEADER = "X-RateLimit-Reset";
var fetchAndRetry = async (fetch2, url, options, attemptsLeft = MAX_RETRY) => {
  try {
    const res = await fetch2(url, options);
    if (attemptsLeft > 0 && (res.status === 429 || res.status >= 500)) {
      const delay = getDelay(res.headers.get(RATE_LIMIT_HEADER));
      await sleep(delay);
      return fetchAndRetry(fetch2, url, options, attemptsLeft - 1);
    }
    return res;
  } catch (error) {
    if (attemptsLeft === 0) {
      throw error;
    }
    const delay = getDelay();
    await sleep(delay);
    return fetchAndRetry(fetch2, url, options, attemptsLeft - 1);
  }
};
var getDelay = (rateLimitReset) => {
  if (!rateLimitReset) {
    return DEFAULT_RETRY_DELAY;
  }
  return Math.max(Number(rateLimitReset) * 1e3 - Date.now(), MIN_RETRY_DELAY);
};
var sleep = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});
var SIGNED_URL_ACCEPT_HEADER = "application/json;type=signed-url";
var Client = class {
  constructor({ apiURL, consistency, edgeURL, fetch: fetch2, region, siteID, token, uncachedEdgeURL }) {
    this.apiURL = apiURL;
    this.consistency = consistency ?? "eventual";
    this.edgeURL = edgeURL;
    this.fetch = fetch2 ?? globalThis.fetch;
    this.region = region;
    this.siteID = siteID;
    this.token = token;
    this.uncachedEdgeURL = uncachedEdgeURL;
    if (!this.fetch) {
      throw new Error(
        "Netlify Blobs could not find a `fetch` client in the global scope. You can either update your runtime to a version that includes `fetch` (like Node.js 18.0.0 or above), or you can supply your own implementation using the `fetch` property."
      );
    }
  }
  async getFinalRequest({
    consistency: opConsistency,
    key,
    metadata,
    method,
    parameters = {},
    storeName
  }) {
    const encodedMetadata = encodeMetadata(metadata);
    const consistency = opConsistency ?? this.consistency;
    let urlPath = `/${this.siteID}`;
    if (storeName) {
      urlPath += `/${storeName}`;
    }
    if (key) {
      urlPath += `/${key}`;
    }
    if (this.edgeURL) {
      if (consistency === "strong" && !this.uncachedEdgeURL) {
        throw new BlobsConsistencyError();
      }
      const headers = {
        authorization: `Bearer ${this.token}`
      };
      if (encodedMetadata) {
        headers[METADATA_HEADER_INTERNAL] = encodedMetadata;
      }
      if (this.region) {
        urlPath = `/region:${this.region}${urlPath}`;
      }
      const url2 = new URL(urlPath, consistency === "strong" ? this.uncachedEdgeURL : this.edgeURL);
      for (const key2 in parameters) {
        url2.searchParams.set(key2, parameters[key2]);
      }
      return {
        headers,
        url: url2.toString()
      };
    }
    const apiHeaders = { authorization: `Bearer ${this.token}` };
    const url = new URL(`/api/v1/blobs${urlPath}`, this.apiURL ?? "https://api.netlify.com");
    for (const key2 in parameters) {
      url.searchParams.set(key2, parameters[key2]);
    }
    if (this.region) {
      url.searchParams.set("region", this.region);
    }
    if (storeName === void 0 || key === void 0) {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    if (encodedMetadata) {
      apiHeaders[METADATA_HEADER_EXTERNAL] = encodedMetadata;
    }
    if (method === "head" || method === "delete") {
      return {
        headers: apiHeaders,
        url: url.toString()
      };
    }
    const res = await this.fetch(url.toString(), {
      headers: { ...apiHeaders, accept: SIGNED_URL_ACCEPT_HEADER },
      method
    });
    if (res.status !== 200) {
      throw new BlobsInternalError(res);
    }
    const { url: signedURL } = await res.json();
    const userHeaders = encodedMetadata ? { [METADATA_HEADER_INTERNAL]: encodedMetadata } : void 0;
    return {
      headers: userHeaders,
      url: signedURL
    };
  }
  async makeRequest({
    body,
    conditions = {},
    consistency,
    headers: extraHeaders,
    key,
    metadata,
    method,
    parameters,
    storeName
  }) {
    const { headers: baseHeaders = {}, url } = await this.getFinalRequest({
      consistency,
      key,
      metadata,
      method,
      parameters,
      storeName
    });
    const headers = {
      ...baseHeaders,
      ...extraHeaders
    };
    if (method === "put") {
      headers["cache-control"] = "max-age=0, stale-while-revalidate=60";
    }
    if ("onlyIfMatch" in conditions && conditions.onlyIfMatch) {
      headers["if-match"] = conditions.onlyIfMatch;
    } else if ("onlyIfNew" in conditions && conditions.onlyIfNew) {
      headers["if-none-match"] = "*";
    }
    const options = {
      body,
      headers,
      method
    };
    if (body instanceof ReadableStream) {
      options.duplex = "half";
    }
    return fetchAndRetry(this.fetch, url, options);
  }
};
var getClientOptions = (options, contextOverride) => {
  const context = contextOverride ?? getEnvironmentContext();
  const siteID = context.siteID ?? options.siteID;
  const token = context.token ?? options.token;
  if (!siteID || !token) {
    throw new MissingBlobsEnvironmentError(["siteID", "token"]);
  }
  if (options.region !== void 0 && !isValidRegion(options.region)) {
    throw new InvalidBlobsRegionError(options.region);
  }
  const clientOptions = {
    apiURL: context.apiURL ?? options.apiURL,
    consistency: options.consistency,
    edgeURL: context.edgeURL ?? options.edgeURL,
    fetch: options.fetch,
    region: options.region,
    siteID,
    token,
    uncachedEdgeURL: context.uncachedEdgeURL ?? options.uncachedEdgeURL
  };
  return clientOptions;
};

// node_modules/@netlify/blobs/dist/main.js
var DEPLOY_STORE_PREFIX = "deploy:";
var LEGACY_STORE_INTERNAL_PREFIX = "netlify-internal/legacy-namespace/";
var SITE_STORE_PREFIX = "site:";
var STATUS_OK = 200;
var STATUS_PRE_CONDITION_FAILED = 412;
var Store = class _Store {
  constructor(options) {
    this.client = options.client;
    if ("deployID" in options) {
      _Store.validateDeployID(options.deployID);
      let name = DEPLOY_STORE_PREFIX + options.deployID;
      if (options.name) {
        name += `:${options.name}`;
      }
      this.name = name;
    } else if (options.name.startsWith(LEGACY_STORE_INTERNAL_PREFIX)) {
      const storeName = options.name.slice(LEGACY_STORE_INTERNAL_PREFIX.length);
      _Store.validateStoreName(storeName);
      this.name = storeName;
    } else {
      _Store.validateStoreName(options.name);
      this.name = SITE_STORE_PREFIX + options.name;
    }
  }
  async delete(key) {
    const res = await this.client.makeRequest({ key, method: "delete", storeName: this.name });
    if (![200, 204, 404].includes(res.status)) {
      throw new BlobsInternalError(res);
    }
  }
  async deleteAll() {
    let totalDeletedBlobs = 0;
    let hasMore = true;
    while (hasMore) {
      const res = await this.client.makeRequest({ method: "delete", storeName: this.name });
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      const data = await res.json();
      if (typeof data.blobs_deleted !== "number") {
        throw new BlobsInternalError(res);
      }
      totalDeletedBlobs += data.blobs_deleted;
      hasMore = typeof data.has_more === "boolean" && data.has_more;
    }
    return {
      deletedBlobs: totalDeletedBlobs
    };
  }
  async get(key, options) {
    return withSpan(options?.span, "blobs.get", async (span) => {
      const { consistency, type } = options ?? {};
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.type": type,
        "blobs.method": "GET",
        "blobs.consistency": consistency
      });
      const res = await this.client.makeRequest({
        consistency,
        key,
        method: "get",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200) {
        throw new BlobsInternalError(res);
      }
      if (type === void 0 || type === "text") {
        return res.text();
      }
      if (type === "arrayBuffer") {
        return res.arrayBuffer();
      }
      if (type === "blob") {
        return res.blob();
      }
      if (type === "json") {
        return res.json();
      }
      if (type === "stream") {
        return res.body;
      }
      throw new BlobsInternalError(res);
    });
  }
  async getMetadata(key, options = {}) {
    return withSpan(options?.span, "blobs.getMetadata", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "HEAD",
        "blobs.consistency": options.consistency
      });
      const res = await this.client.makeRequest({
        consistency: options.consistency,
        key,
        method: "head",
        storeName: this.name
      });
      span?.setAttributes({
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const etag = res?.headers.get("etag") ?? void 0;
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag,
        metadata
      };
      return result;
    });
  }
  async getWithMetadata(key, options) {
    return withSpan(options?.span, "blobs.getWithMetadata", async (span) => {
      const { consistency, etag: requestETag, type } = options ?? {};
      const headers = requestETag ? { "if-none-match": requestETag } : void 0;
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "GET",
        "blobs.consistency": options?.consistency,
        "blobs.type": type,
        "blobs.request.etag": requestETag
      });
      const res = await this.client.makeRequest({
        consistency,
        headers,
        key,
        method: "get",
        storeName: this.name
      });
      const responseETag = res?.headers.get("etag") ?? void 0;
      span?.setAttributes({
        "blobs.response.body.size": res.headers.get("content-length") ?? void 0,
        "blobs.response.etag": responseETag,
        "blobs.response.status": res.status
      });
      if (res.status === 404) {
        return null;
      }
      if (res.status !== 200 && res.status !== 304) {
        throw new BlobsInternalError(res);
      }
      const metadata = getMetadataFromResponse(res);
      const result = {
        etag: responseETag,
        metadata
      };
      if (res.status === 304 && requestETag) {
        return { data: null, ...result };
      }
      if (type === void 0 || type === "text") {
        return { data: await res.text(), ...result };
      }
      if (type === "arrayBuffer") {
        return { data: await res.arrayBuffer(), ...result };
      }
      if (type === "blob") {
        return { data: await res.blob(), ...result };
      }
      if (type === "json") {
        return { data: await res.json(), ...result };
      }
      if (type === "stream") {
        return { data: res.body, ...result };
      }
      throw new Error(`Invalid 'type' property: ${type}. Expected: arrayBuffer, blob, json, stream, or text.`);
    });
  }
  list(options = {}) {
    return withSpan(options.span, "blobs.list", (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.method": "GET",
        "blobs.list.paginate": options.paginate ?? false
      });
      const iterator = this.getListIterator(options);
      if (options.paginate) {
        return iterator;
      }
      return collectIterator(iterator).then(
        (items) => items.reduce(
          (acc, item) => ({
            blobs: [...acc.blobs, ...item.blobs],
            directories: [...acc.directories, ...item.directories]
          }),
          { blobs: [], directories: [] }
        )
      );
    });
  }
  async set(key, data, options = {}) {
    return withSpan(options.span, "blobs.set", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.size": typeof data == "string" ? data.length : data instanceof Blob ? data.size : data.byteLength,
        "blobs.data.type": typeof data == "string" ? "string" : data instanceof Blob ? "blob" : "arrayBuffer",
        "blobs.atomic": Boolean(options.onlyIfMatch ?? options.onlyIfNew)
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const res = await this.client.makeRequest({
        conditions,
        body: data,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res);
    });
  }
  async setJSON(key, data, options = {}) {
    return withSpan(options.span, "blobs.setJSON", async (span) => {
      span?.setAttributes({
        "blobs.store": this.name,
        "blobs.key": key,
        "blobs.method": "PUT",
        "blobs.data.type": "json"
      });
      _Store.validateKey(key);
      const conditions = _Store.getConditions(options);
      const payload = JSON.stringify(data);
      const headers = {
        "content-type": "application/json"
      };
      const res = await this.client.makeRequest({
        ...conditions,
        body: payload,
        headers,
        key,
        metadata: options.metadata,
        method: "put",
        storeName: this.name
      });
      const etag = res.headers.get("etag") ?? "";
      span?.setAttributes({
        "blobs.response.etag": etag,
        "blobs.response.status": res.status
      });
      if (conditions) {
        return res.status === STATUS_PRE_CONDITION_FAILED ? { modified: false } : { etag, modified: true };
      }
      if (res.status === STATUS_OK) {
        return {
          etag,
          modified: true
        };
      }
      throw new BlobsInternalError(res);
    });
  }
  static formatListResultBlob(result) {
    if (!result.key) {
      return null;
    }
    return {
      etag: result.etag,
      key: result.key
    };
  }
  static getConditions(options) {
    if ("onlyIfMatch" in options && "onlyIfNew" in options) {
      throw new Error(
        `The 'onlyIfMatch' and 'onlyIfNew' options are mutually exclusive. Using 'onlyIfMatch' will make the write succeed only if there is an entry for the key with the given content, while 'onlyIfNew' will make the write succeed only if there is no entry for the key.`
      );
    }
    if ("onlyIfMatch" in options && options.onlyIfMatch) {
      if (typeof options.onlyIfMatch !== "string") {
        throw new Error(`The 'onlyIfMatch' property expects a string representing an ETag.`);
      }
      return {
        onlyIfMatch: options.onlyIfMatch
      };
    }
    if ("onlyIfNew" in options && options.onlyIfNew) {
      if (typeof options.onlyIfNew !== "boolean") {
        throw new Error(
          `The 'onlyIfNew' property expects a boolean indicating whether the write should fail if an entry for the key already exists.`
        );
      }
      return {
        onlyIfNew: true
      };
    }
  }
  static validateKey(key) {
    if (key === "") {
      throw new Error("Blob key must not be empty.");
    }
    if (key.startsWith("/") || key.startsWith("%2F")) {
      throw new Error("Blob key must not start with forward slash (/).");
    }
    if (new TextEncoder().encode(key).length > 600) {
      throw new Error(
        "Blob key must be a sequence of Unicode characters whose UTF-8 encoding is at most 600 bytes long."
      );
    }
  }
  static validateDeployID(deployID) {
    if (!/^\w{1,24}$/.test(deployID)) {
      throw new Error(`'${deployID}' is not a valid Netlify deploy ID.`);
    }
  }
  static validateStoreName(name) {
    if (name.includes("/") || name.includes("%2F")) {
      throw new Error("Store name must not contain forward slashes (/).");
    }
    if (new TextEncoder().encode(name).length > 64) {
      throw new Error(
        "Store name must be a sequence of Unicode characters whose UTF-8 encoding is at most 64 bytes long."
      );
    }
  }
  getListIterator(options) {
    const { client, name: storeName } = this;
    const parameters = {};
    if (options?.prefix) {
      parameters.prefix = options.prefix;
    }
    if (options?.directories) {
      parameters.directories = "true";
    }
    return {
      [Symbol.asyncIterator]() {
        let currentCursor = null;
        let done = false;
        return {
          async next() {
            return withSpan(options?.span, "blobs.list.next", async (span) => {
              span?.setAttributes({
                "blobs.store": storeName,
                "blobs.method": "GET",
                "blobs.list.paginate": options?.paginate ?? false,
                "blobs.list.done": done,
                "blobs.list.cursor": currentCursor ?? void 0
              });
              if (done) {
                return { done: true, value: void 0 };
              }
              const nextParameters = { ...parameters };
              if (currentCursor !== null) {
                nextParameters.cursor = currentCursor;
              }
              const res = await client.makeRequest({
                method: "get",
                parameters: nextParameters,
                storeName
              });
              span?.setAttributes({
                "blobs.response.status": res.status
              });
              let blobs = [];
              let directories = [];
              if (![200, 204, 404].includes(res.status)) {
                throw new BlobsInternalError(res);
              }
              if (res.status === 404) {
                done = true;
              } else {
                const page = await res.json();
                if (page.next_cursor) {
                  currentCursor = page.next_cursor;
                } else {
                  done = true;
                }
                blobs = (page.blobs ?? []).map(_Store.formatListResultBlob).filter(Boolean);
                directories = page.directories ?? [];
              }
              return {
                done: false,
                value: {
                  blobs,
                  directories
                }
              };
            });
          }
        };
      }
    };
  }
};
var getStore = (input, options) => {
  if (typeof input === "string") {
    const contextOverride = options?.siteID && options?.token ? { siteID: options?.siteID, token: options?.token } : void 0;
    const clientOptions = getClientOptions(options ?? {}, contextOverride);
    const client = new Client(clientOptions);
    return new Store({ client, name: input });
  }
  if (typeof input?.name === "string") {
    const { name } = input;
    const contextOverride = input?.siteID && input?.token ? { siteID: input?.siteID, token: input?.token } : void 0;
    const clientOptions = getClientOptions(input, contextOverride);
    if (!name) {
      throw new MissingBlobsEnvironmentError(["name"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, name });
  }
  if (typeof input?.deployID === "string") {
    const clientOptions = getClientOptions(input);
    const { deployID } = input;
    if (!deployID) {
      throw new MissingBlobsEnvironmentError(["deployID"]);
    }
    const client = new Client(clientOptions);
    return new Store({ client, deployID });
  }
  throw new Error(
    "The `getStore` method requires the name of the store as a string or as the `name` property of an options object"
  );
};

// src/pnl.js
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var CACHE_MS = 7 * 24 * 3600 * 1e3;
var MORALIS = "https://deep-index.moralis.io/api/v2.2";
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var usd = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
var signedUsd = (n) => (n < 0 ? "-" : "+") + usd(n);
async function mfetch(path, key) {
  const r = await fetch(MORALIS + path, { headers: { "X-API-Key": key, accept: "application/json" } });
  if (!r.ok) throw new Error("moralis " + r.status);
  return r.json();
}
async function cgToken(addr, store) {
  if (store) try {
    const c = await store.get("cg/" + addr, { type: "json" });
    if (c && Date.now() - c.t < 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  try {
    let r = await fetch("https://api.coingecko.com/api/v3/coins/avalanche/contract/" + addr);
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 2200));
      r = await fetch("https://api.coingecko.com/api/v3/coins/avalanche/contract/" + addr);
    }
    if (!r.ok) return null;
    const j = await r.json();
    const md = j && j.market_data;
    if (!md) return null;
    const ath = md.ath && md.ath.usd;
    const cur = md.current_price && md.current_price.usd;
    const athDate = md.ath_date && md.ath_date.usd ? Date.parse(md.ath_date.usd) : null;
    const v = ath && ath > 0 ? { ath, cur: cur || 0, athDate } : null;
    if (store && v) try {
      await store.set("cg/" + addr, JSON.stringify({ t: Date.now(), v }));
    } catch {
    }
    return v;
  } catch {
    return null;
  }
}
async function replayBag(addr, contract, athTs, athTs2) {
  try {
    const r = await fetch(RS + "?module=account&action=tokentx&contractaddress=" + contract + "&address=" + addr + "&startblock=0&endblock=999999999&sort=asc");
    const j = await r.json();
    if (!j.result || !Array.isArray(j.result) || !j.result.length) return null;
    let bal = 0n, peakBeforeAth = 0n, peakEver = 0n, balAtAth = null, balAtAth2 = null, dec = null, firstTs = null, nearOut = 0n;
    const W = 7 * 864e5;
    for (const t of j.result) {
      if (dec === null && t.tokenDecimal) dec = parseInt(t.tokenDecimal, 10);
      const ts = parseInt(t.timeStamp, 10) * 1e3;
      if (firstTs === null) firstTs = ts;
      if (athTs && balAtAth === null && ts > athTs) balAtAth = bal;
      if (athTs2 && balAtAth2 === null && ts > athTs2) balAtAth2 = bal;
      let v;
      try {
        v = BigInt(t.value || "0");
      } catch {
        continue;
      }
      if ((t.to || "").toLowerCase() === addr) bal += v;
      else if ((t.from || "").toLowerCase() === addr) {
        bal -= v;
        if (athTs && Math.abs(ts - athTs) <= W) nearOut += v;
      }
      if (bal > peakEver) peakEver = bal;
      if (athTs && ts <= athTs && bal > peakBeforeAth) peakBeforeAth = bal;
    }
    if (athTs && balAtAth === null) balAtAth = bal;
    if (athTs2 && balAtAth2 === null) balAtAth2 = bal;
    const d = dec === null || isNaN(dec) ? 18 : dec;
    const f = (x) => Number(x) / Math.pow(10, d);
    return { peakEver: f(peakEver), peakBeforeAth: f(peakBeforeAth), balAtAth: balAtAth === null ? null : f(balAtAth), balAtAth2: balAtAth2 === null ? null : f(balAtAth2), firstTs, nearOut: f(nearOut) };
  } catch {
    return null;
  }
}
async function peakSince(contract, fromTs, store) {
  const bucket = Math.floor(fromTs / (30 * 864e5));
  const ck = "peak/" + contract + "/" + bucket;
  if (store) try {
    const c = await store.get(ck, { type: "json" });
    if (c && Date.now() - c.t < 7 * 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  try {
    const u = "https://api.coingecko.com/api/v3/coins/avalanche/contract/" + contract + "/market_chart/range?vs_currency=usd&from=" + Math.floor(fromTs / 1e3) + "&to=" + Math.floor(Date.now() / 1e3);
    let r = await fetch(u);
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 2200));
      r = await fetch(u);
    }
    if (!r.ok) return null;
    const j = await r.json();
    const prices = j && j.prices || [];
    if (!prices.length) return null;
    let maxP = 0, maxTs = null;
    for (const p of prices) {
      if (p[1] > maxP) {
        maxP = p[1];
        maxTs = p[0];
      }
    }
    const v = maxP > 0 ? { price: maxP, ts: maxTs } : null;
    if (store && v) try {
      await store.set(ck, JSON.stringify({ t: Date.now(), v }));
    } catch {
    }
    return v;
  } catch {
    return null;
  }
}
async function fetchAllProfitability(addr, key) {
  let rows = [], cursor = null, pages = 0, capped = false;
  do {
    const q = "/wallets/" + addr + "/profitability?chain=avalanche" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
    const data = await mfetch(q, key);
    const batch = data && (data.result || data.data) || [];
    rows = rows.concat(batch);
    cursor = data && data.cursor;
    pages++;
    if (pages >= 3 && cursor) {
      capped = true;
      break;
    }
  } while (cursor);
  return { rows, capped };
}
async function fetchBalances(addr, key) {
  try {
    const data = await mfetch("/wallets/" + addr + "/tokens?chain=avalanche", key);
    const map = {};
    for (const t of data && data.result || []) {
      const a = (t.token_address || "").toLowerCase();
      const tk = parseFloat(t.balance_formatted) || 0;
      const usd2 = parseFloat(t.usd_value) || 0;
      if (a && tk > 0) map[a] = { tk, usd: usd2 };
    }
    return map;
  } catch {
    return {};
  }
}
function parseRows(tokens) {
  return (tokens || []).filter((t) => t && typeof t.realized_profit_usd !== "undefined").map((t) => {
    const invested = parseFloat(t.total_usd_invested) || 0;
    const sold = parseFloat(t.total_sold_usd) || 0;
    const avgBuy = parseFloat(t.avg_buy_price_usd) || 0;
    const avgSell = parseFloat(t.avg_sell_price_usd) || 0;
    let boughtTk = parseFloat(t.total_tokens_bought) || 0;
    let soldTk = parseFloat(t.total_tokens_sold) || 0;
    if (!boughtTk && avgBuy > 0) boughtTk = invested / avgBuy;
    if (!soldTk && avgSell > 0) soldTk = sold / avgSell;
    return {
      sym: (t.symbol || t.token_symbol || "").toUpperCase() || (t.token_address || "").slice(0, 8),
      profit: parseFloat(t.realized_profit_usd) || 0,
      invested,
      sold,
      boughtTk,
      soldTk,
      tokenAddress: (t.token_address || "").toLowerCase() || null
    };
  }).filter((r) => {
    if (!isFinite(r.profit) || !isFinite(r.sold) || !isFinite(r.invested)) return false;
    if (Math.abs(r.profit) > 1e9 || r.sold > 1e12 || r.invested > 1e12) return false;
    if (r.profit > 0 && r.profit > r.sold * 1.05 + 100) return false;
    return true;
  });
}
async function pool(items, n, fn) {
  let i = 0;
  const workers = Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) {
      const k = i++;
      await fn(items[k]);
    }
  });
  await Promise.all(workers);
}
async function enrich(rows, balances, ADDR, store, diag) {
  const flags = {};
  const heldByInvested = rows.filter((r) => r.tokenAddress && r.invested > 100 && balances[r.tokenAddress] && balances[r.tokenAddress].tk > 0).sort((a, b) => b.invested - a.invested).slice(0, 4);
  const byInvested = rows.filter((r) => r.tokenAddress && r.invested > 100).sort((a, b) => b.invested - a.invested).slice(0, 4);
  const bySold = rows.filter((r) => r.tokenAddress && r.sold > 50).sort((a, b) => b.sold - a.sold).slice(0, 9);
  const seen = {};
  const cands = [];
  for (const c of heldByInvested.concat(byInvested, bySold)) {
    if (!seen[c.tokenAddress]) {
      seen[c.tokenAddress] = 1;
      cands.push(c);
    }
  }
  const rts = [], stes = [];
  await pool(cands.slice(0, 13), 3, async (c) => {
    const d = { sym: c.sym, sold: Math.round(c.sold) };
    if (diag) diag.push(d);
    const cg = await cgToken(c.tokenAddress, store);
    if (!cg) {
      d.skip = "no coingecko data";
      return;
    }
    const heldTk = balances[c.tokenAddress] && balances[c.tokenAddress].tk || 0;
    const wantsSte = c.soldTk > 0 && c.sold > 50;
    if (heldTk <= 0 && !wantsSte) return;
    const rp = await replayBag(ADDR, c.tokenAddress, null);
    if (!rp || !rp.firstTs) {
      d.skip = "replay failed";
      return;
    }
    d.firstHeld = new Date(rp.firstTs).toISOString().slice(0, 10);
    const pk = await peakSince(c.tokenAddress, rp.firstTs, store);
    const peakPrice = pk ? pk.price : cg.ath;
    const peakTs = pk ? pk.ts : cg.athDate;
    d.peakSinceHeld = peakPrice;
    if (!peakTs) return;
    const rp2 = await replayBag(ADDR, c.tokenAddress, peakTs, peakTs - 7 * 864e5);
    if (!rp2 || rp2.balAtAth === null) {
      d.skip = "replay failed";
      return;
    }
    const balAtPeak = rp2.balAtAth;
    d.balAtPeak = balAtPeak;
    const avgSell = c.soldTk > 0 ? c.sold / c.soldTk : 0;
    if (heldTk > 0 && heldTk * peakPrice > 500 && cg.cur <= peakPrice * 0.1) {
      if (!flags.captain) flags.captain = { sym: c.sym, downPct: Math.round((1 - cg.cur / peakPrice) * 100) };
    }
    if (c.invested > 100 && c.boughtTk > 0) {
      const avgBuy = c.invested / c.boughtTk;
      if (avgBuy >= peakPrice * 0.8 && avgBuy <= peakPrice * 1.5) {
        if (!flags.boughtTop) flags.boughtTop = { sym: c.sym };
      }
    }
    if (balAtPeak > 0 && !flags.roundVictim) {
      const pv = balAtPeak * peakPrice;
      for (const T of [1e4, 1e5, 1e6]) {
        if (pv >= T * 0.95 && pv < T) {
          flags.roundVictim = { sym: c.sym, peak: Math.round(pv), target: T };
          break;
        }
      }
    }
    if (rp2.balAtAth2 !== null && rp2.balAtAth2 > 0 && rp2.peakBeforeAth > 0 && rp2.balAtAth2 >= rp2.peakBeforeAth * 0.5 && balAtPeak < rp2.peakBeforeAth * 0.1 && rp2.balAtAth2 * peakPrice > 500) {
      if (!flags.soldTop) flags.soldTop = { sym: c.sym };
    }
    const exitRatio = rp2.peakBeforeAth > 0 ? balAtPeak / rp2.peakBeforeAth : balAtPeak > 0 ? 1 : 0;
    d.exitRatio = +exitRatio.toFixed(3);
    if (wantsSte && rp2.peakBeforeAth > 0 && exitRatio < 0.2) {
      const exitedTk = rp2.peakBeforeAth - balAtPeak;
      const proceeds = exitedTk * avgSell;
      const athValue = exitedTk * peakPrice;
      d.proceeds = Math.round(proceeds);
      d.athValue = Math.round(athValue);
      if (proceeds > 50 && athValue > 500 && athValue > proceeds * 3) {
        d.steQualified = true;
        if (athValue > proceeds * 5 && !flags.exitThere) flags.exitThere = { sym: c.sym, x: Math.round(athValue / Math.max(1, proceeds)) };
        stes.push({ missed: athValue - proceeds, sym: c.sym, line: "$" + c.sym, sub: "sold for ~" + usd(proceeds) + " \xB7 " + usd(athValue) + " at peak" });
      }
    } else if (balAtPeak > 0) {
      const peakValue = balAtPeak * peakPrice;
      const heldPart = Math.min(heldTk, balAtPeak);
      const soldAfter = Math.max(0, balAtPeak - heldPart);
      const walked = soldAfter * avgSell + heldPart * cg.cur;
      const rt = peakValue - walked;
      d.peakValue = Math.round(peakValue);
      d.walked = Math.round(walked);
      if (peakValue > 500 && rt > 250 && rt / peakValue > 0.5) {
        d.rtQualified = true;
        const tail = soldAfter * avgSell > heldPart * cg.cur ? "walked with ~" + usd(walked) : usd(heldPart * cg.cur) + " now";
        rts.push({ rt, sym: c.sym, line: "-" + usd(rt), sub: "$" + c.sym + " \xB7 " + usd(peakValue) + " at peak \xB7 " + tail });
      }
    }
  });
  rts.sort((a, b) => b.rt - a.rt);
  stes.sort((a, b) => b.missed - a.missed);
  const clean = (arr) => arr.slice(0, 5).map((x) => ({ line: x.line, sub: x.sub }));
  if (rts[0]) {
    const amt = rts[0].rt;
    flags.fullCircle = { amt: Math.round(amt), tier: amt >= 1e6 ? 3 : amt >= 1e5 ? 2 : amt >= 1e4 ? 1 : 0 };
    if (!flags.fullCircle.tier) delete flags.fullCircle;
  }
  return {
    flags,
    roundtrip: rts[0] ? { line: rts[0].line, sub: rts[0].sub } : null,
    soldTooEarly: stes[0] ? { line: stes[0].line, sub: stes[0].sub } : null,
    roundtrips: clean(rts),
    soldEarly: clean(stes)
  };
}
var STABLES = { "USDT": 1, "USDC": 1, "DAI": 1, "BUSD": 1, "FRAX": 1, "MIM": 1, "TUSD": 1, "USDP": 1, "UST": 1, "USDD": 1, "EURC": 1, "AUSD": 1, "USD1": 1, "USDT.E": 1, "USDC.E": 1, "DAI.E": 1 };
function rowFlags(rows, balances) {
  const f = {};
  const n = rows.length;
  const wins = rows.filter((r) => r.profit > 0), losses = rows.filter((r) => r.profit < 0);
  const decided = wins.length + losses.length;
  const total = rows.reduce((s, r) => s + r.profit, 0);
  if (n >= 100) f.zoo = { n, tier: n >= 300 ? 2 : 1 };
  const sl = rows.filter((r) => STABLES[r.sym] && r.profit < 0).sort((a, b) => a.profit - b.profit)[0];
  if (sl) f.stableLoss = { sym: sl.sym, amt: Math.round(sl.profit) };
  if (total > 0 && n >= 20) f.netUp = { total: Math.round(total) };
  if (decided >= 20 && wins.length / decided > 0.6) f.sniper = { pct: Math.round(wins.length / decided * 100) };
  if (decided >= 20 && wins.length / decided < 0.3) f.exitLiq = { pct: Math.round(wins.length / decided * 100) };
  const c1 = rows.filter((r) => r.invested > 50 && r.profit / r.invested >= 10).sort((a, b) => b.profit / b.invested - a.profit / a.invested)[0];
  if (c1) f.caughtOne = { sym: c1.sym, x: Math.round(c1.profit / c1.invested) + 1 };
  const posSum = wins.reduce((s, r) => s + r.profit, 0);
  if (wins.length >= 3 && posSum > 1e3 && wins[0] && rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit)[0].profit / posSum > 0.9) {
    const top = rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit)[0];
    f.oneTrick = { sym: top.sym, pct: Math.round(top.profit / posSum * 100) };
  }
  const bench = rows.filter((r) => r.profit > 1e3);
  if (bench.length >= 5) f.deepBench = { n: bench.length };
  if (rows.some((r) => r.sym === "TIME")) f.wonderland = true;
  if (rows.some((r) => r.sym === "COQ")) f.coqVet = true;
  if (rows.some((r) => r.sym === "ARENA")) f.arenaTraded = true;
  const grave = Object.values(balances).filter((b) => b.usd > 0 && b.usd < 1).length;
  if (grave >= 10) f.graveyard = { n: grave };
  return f;
}
function summarize(rows, capped) {
  const base = { tokens: capped ? rows.length + "+" : rows.length, biggestW: null, biggestL: null, topW: [], topL: [], summary: null };
  if (!rows.length) return base;
  const wins = rows.filter((r) => r.profit > 0).sort((a, b) => b.profit - a.profit);
  const losses = rows.filter((r) => r.profit < 0).sort((a, b) => a.profit - b.profit);
  const total = rows.reduce((s, r) => s + r.profit, 0);
  const decided = wins.length + losses.length;
  base.biggestW = wins[0] ? { line: signedUsd(wins[0].profit), sub: "$" + wins[0].sym } : null;
  base.biggestL = losses[0] ? { line: signedUsd(losses[0].profit), sub: "$" + losses[0].sym } : null;
  base.topW = wins.slice(0, 5).map((r) => ({ line: signedUsd(r.profit), sub: "$" + r.sym }));
  base.topL = losses.slice(0, 5).map((r) => ({ line: signedUsd(r.profit), sub: "$" + r.sym }));
  base.summary = {
    total: signedUsd(total),
    winrate: decided >= 3 ? Math.round(wins.length / decided * 100) + "%" : null,
    wins: wins.length,
    losses: losses.length
  };
  base.thin = decided < 3;
  return base;
}
var pnl_default = async (req) => {
  const key = process.env.MORALIS_KEY;
  const url = new URL(req.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return new Response(JSON.stringify({ available: false, error: "bad address" }), { status: 400, headers: HEADERS });
  }
  if (!key) return new Response(JSON.stringify({ available: false }), { headers: HEADERS });
  let store = null;
  try {
    store = getStore("pnl");
  } catch {
  }
  const cacheKey = "v14/" + addr;
  const debug = url.searchParams.get("debug") === "1";
  const refresh = url.searchParams.get("refresh") === "1";
  if (store && !debug && !refresh) try {
    const cached = await store.get(cacheKey, { type: "json" });
    if (cached) {
      const fresh = Date.now() - cached.t < CACHE_MS;
      return new Response(JSON.stringify({ available: true, stats: cached.stats, cached: true, stale: !fresh }), { headers: HEADERS });
    }
  } catch {
  }
  try {
    const diag = debug ? [] : null;
    const [{ rows: raw, capped }, balances] = await Promise.all([fetchAllProfitability(addr, key), fetchBalances(addr, key)]);
    let rows = parseRows(raw);
    const suspects = rows.filter((r) => Math.abs(r.profit) > 25e4 && r.tokenAddress);
    if (suspects.length) {
      const verified = {};
      await pool(suspects, 3, async (r) => {
        verified[r.tokenAddress] = !!await cgToken(r.tokenAddress, store);
      });
      rows = rows.filter((r) => Math.abs(r.profit) <= 25e4 || !r.tokenAddress || verified[r.tokenAddress]);
      if (diag) suspects.forEach((r) => {
        if (!verified[r.tokenAddress]) diag.push({ sym: r.sym, skip: "big claim, not cg-listed \u2014 dropped", profit: r.profit });
      });
    }
    if (diag) diag.push({ rowsAfterFilters: rows.length, rows: rows.slice(0, 30).map((r) => ({ sym: r.sym, profit: Math.round(r.profit), invested: Math.round(r.invested), sold: Math.round(r.sold) })) });
    const stats = summarize(rows, capped);
    const extra = await enrich(rows, balances, addr, store, diag);
    stats.flags = Object.assign(rowFlags(rows, balances), extra.flags || {});
    stats.roundtrip = extra.roundtrip;
    stats.soldTooEarly = extra.soldTooEarly;
    stats.roundtrips = extra.roundtrips;
    stats.soldEarly = extra.soldEarly;
    if (store && !debug) await store.set(cacheKey, JSON.stringify({ t: Date.now(), stats })).catch(() => {
    });
    const out = { available: true, stats };
    if (debug) out.diag = diag;
    return new Response(JSON.stringify(out), { headers: HEADERS });
  } catch (e) {
    return new Response(JSON.stringify({ available: false }), { headers: HEADERS });
  }
};
var config = { path: "/api/pnl" };
export {
  config,
  pnl_default as default
};
