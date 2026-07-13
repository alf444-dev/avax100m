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

// src/token.js
var mems = {};
var _mem = mems;
function storeOr(name, opts) {
  try {
    const s = getStore(opts ? Object.assign({ name }, opts) : name);
    if (s) return s;
  } catch {
  }
  if (process.env.NETLIFY || process.env.URL) return null;
  if (!mems[name]) mems[name] = /* @__PURE__ */ new Map();
  const m = mems[name];
  return {
    get: async (k, o) => {
      const v = m.get(k);
      return v === void 0 ? null : o && o.type === "json" ? JSON.parse(v) : v;
    },
    set: async (k, v) => {
      m.set(k, v);
    },
    delete: async (k) => {
      m.delete(k);
    }
  };
}
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
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
async function peakSince(contract, fromTs, store) {
  const bucket = Math.floor(fromTs / (30 * 864e5));
  const ck = "peak2/" + contract + "/" + bucket;
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
    let maxP = 0, maxTs = null, maxI = 0;
    for (let i = 0; i < prices.length; i++) {
      if (prices[i][1] > maxP) {
        maxP = prices[i][1];
        maxTs = prices[i][0];
        maxI = i;
      }
    }
    let series = prices;
    if (prices.length > 500) {
      const stride = Math.ceil(prices.length / 500);
      series = prices.filter((_, i) => i % stride === 0 || i === maxI || i === prices.length - 1);
    }
    series = series.map((p) => [Math.round(p[0]), +p[1].toPrecision(6)]);
    const v = { price: maxP, ts: maxTs, series };
    if (store) try {
      await store.set(ck, JSON.stringify({ t: Date.now(), v }));
    } catch {
    }
    return v;
  } catch {
    return null;
  }
}
function peakBagOver(series, rows, addr) {
  if (!series || !series.length || !rows || !rows.length) return null;
  let dec = null;
  const evs = [];
  for (const t of rows) {
    if (dec === null && t.tokenDecimal) dec = parseInt(t.tokenDecimal, 10);
    let v;
    try {
      v = BigInt(t.value || "0");
    } catch {
      continue;
    }
    const ts = parseInt(t.timeStamp, 10) * 1e3;
    if ((t.to || "").toLowerCase() === addr) evs.push([ts, v]);
    else if ((t.from || "").toLowerCase() === addr) evs.push([ts, -v]);
  }
  const d = dec === null || isNaN(dec) ? 18 : dec;
  const div = Math.pow(10, d);
  let bal = 0n, i = 0, lastPrice = 0;
  let best = { usd: 0, ts: null, bal: 0 };
  const check = (ts) => {
    const usd = Number(bal) / div * lastPrice;
    if (usd > best.usd) best = { usd, ts, bal: Number(bal) / div };
  };
  for (const p of series) {
    while (i < evs.length && evs[i][0] <= p[0]) {
      bal += evs[i][1];
      if (lastPrice > 0) check(evs[i][0]);
      i++;
    }
    lastPrice = p[1];
    check(p[0]);
  }
  while (i < evs.length) {
    bal += evs[i][1];
    check(evs[i][0]);
    i++;
  }
  return best.ts ? best : null;
}
async function fetchTokenTx(addr, contract) {
  try {
    const r = await fetch(RS + "?module=account&action=tokentx&contractaddress=" + contract + "&address=" + addr + "&startblock=0&endblock=999999999&sort=asc");
    const j = await r.json();
    if (!j.result || !Array.isArray(j.result) || !j.result.length) return null;
    return j.result;
  } catch {
    return null;
  }
}
async function fetchWalletTx(addr) {
  try {
    const r = await fetch(RS + "?module=account&action=tokentx&address=" + addr + "&startblock=0&endblock=999999999&sort=asc");
    const j = await r.json();
    if (!j.result || !Array.isArray(j.result)) return null;
    return j.result;
  } catch {
    return null;
  }
}
function foldTok(rows, addr, refTs) {
  if (!rows || !rows.length) return null;
  let bal = 0n, peakBag = 0n, peakBeforeRef = 0n, balAtRef = null, dec = null, firstTs = null, lastTs = null, transfers = 0;
  for (const t of rows) {
    if (dec === null && t.tokenDecimal) dec = parseInt(t.tokenDecimal, 10);
    const ts = parseInt(t.timeStamp, 10) * 1e3;
    if (firstTs === null) firstTs = ts;
    lastTs = ts;
    if (refTs && balAtRef === null && ts > refTs) balAtRef = bal;
    let v;
    try {
      v = BigInt(t.value || "0");
    } catch {
      continue;
    }
    if ((t.to || "").toLowerCase() === addr) bal += v;
    else if ((t.from || "").toLowerCase() === addr) bal -= v;
    if (bal > peakBag) peakBag = bal;
    if (refTs && ts <= refTs && bal > peakBeforeRef) peakBeforeRef = bal;
    transfers++;
  }
  if (refTs && balAtRef === null) balAtRef = bal;
  const d = dec === null || isNaN(dec) ? 18 : dec;
  const f = (x) => Number(x) / Math.pow(10, d);
  return { firstTs, lastTs, transfers, peakBag: f(peakBag), peakBeforeRef: f(peakBeforeRef), balNow: f(bal), balAtRef: balAtRef === null ? null : f(balAtRef) };
}
var WAVAX_C = "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7";
var STABLE_SYMS = { "USDT": 1, "USDC": 1, "DAI": 1, "MIM": 1, "FRAX": 1, "USDT.E": 1, "USDC.E": 1, "DAI.E": 1, "BUSD": 1, "TUSD": 1 };
async function avaxSeries(store) {
  const ck = "avaxusd/v1";
  if (store) try {
    const c = await store.get(ck, { type: "json" });
    if (c && Date.now() - c.t < 24 * 3600 * 1e3) return c.v;
  } catch {
  }
  try {
    const u = "https://api.coingecko.com/api/v3/coins/avalanche-2/market_chart/range?vs_currency=usd&from=1600000000&to=" + Math.floor(Date.now() / 1e3);
    let r = await fetch(u);
    if (r.status === 429) {
      await new Promise((res) => setTimeout(res, 2200));
      r = await fetch(u);
    }
    if (!r.ok) return null;
    const j = await r.json();
    let prices = j && j.prices || [];
    if (!prices.length) return null;
    if (prices.length > 500) {
      const stride = Math.ceil(prices.length / 500);
      prices = prices.filter((_, i) => i % stride === 0 || i === prices.length - 1);
    }
    const v = prices.map((p) => [Math.round(p[0]), +p[1].toPrecision(6)]);
    if (store) try {
      await store.set(ck, JSON.stringify({ t: Date.now(), v }));
    } catch {
    }
    return v;
  } catch {
    return null;
  }
}
function usdAtArrival(evs, series) {
  if (!evs || !evs.length || !series || !series.length) return null;
  const sorted = evs.slice().sort((a, b) => a[0] - b[0]);
  let i = 0, last = series[0][1], sum = 0;
  for (const [ts, amt] of sorted) {
    while (i < series.length && series[i][0] <= ts) {
      last = series[i][1];
      i++;
    }
    sum += amt * last;
  }
  return sum;
}
function classifyLp(all, targetRows, contract, addr) {
  const map = {};
  for (const x of all) (map[x.hash] = map[x.hash] || []).push(x);
  const isLpSym = (sy) => /^(JLP|PGL|ULP)$|(^|[^A-Z])LP([^A-Z]|$)/i.test(sy || "");
  const inCp = {}, outCp = {};
  for (const x of targetRows) {
    if ((x.to || "").toLowerCase() === addr) inCp[(x.from || "").toLowerCase()] = 1;
    else if ((x.from || "").toLowerCase() === addr) outCp[(x.to || "").toLowerCase()] = 1;
  }
  let dec = null;
  const out = { adds: 0, removes: 0, inSwap: 0, inXfer: 0, inLp: 0, outSwap: 0, outXfer: 0, outLp: 0, xferInEvs: [], putWavax: [], gotWavax: [], putStable: 0, gotStable: 0 };
  const moneyLegs = (sibs, ts) => {
    for (const y of sibs) {
      const ca = (y.contractAddress || "").toLowerCase();
      const sy = (y.tokenSymbol || "").toUpperCase();
      const ydec = parseInt(y.tokenDecimal || "18", 10);
      const yamt = Number(y.value || "0") / Math.pow(10, isNaN(ydec) ? 18 : ydec);
      const yIn = (y.to || "").toLowerCase() === addr;
      const yOut = (y.from || "").toLowerCase() === addr;
      if (ca === WAVAX_C) {
        if (yOut) out.putWavax.push([ts, yamt]);
        else if (yIn) out.gotWavax.push([ts, yamt]);
      } else if (STABLE_SYMS[sy]) {
        if (yOut) out.putStable += yamt;
        else if (yIn) out.gotStable += yamt;
      }
    }
  };
  for (const x of targetRows) {
    if (dec === null && x.tokenDecimal) dec = parseInt(x.tokenDecimal, 10);
    const amt = Number(x.value || "0") / Math.pow(10, dec === null || isNaN(dec) ? 18 : dec);
    const sibs = (map[x.hash] || []).filter((y) => (y.contractAddress || "").toLowerCase() !== contract);
    const inbound = (x.to || "").toLowerCase() === addr;
    const cp = inbound ? (x.from || "").toLowerCase() : (x.to || "").toLowerCase();
    const poolish = inCp[cp] && outCp[cp];
    const lpIn = sibs.some((y) => isLpSym(y.tokenSymbol) && (y.to || "").toLowerCase() === addr);
    const lpOut = sibs.some((y) => isLpSym(y.tokenSymbol) && (y.from || "").toLowerCase() === addr);
    const ts2 = parseInt(x.timeStamp, 10) * 1e3;
    if (!inbound && lpIn) {
      out.adds++;
      out.outLp += amt;
      moneyLegs(sibs, ts2);
    } else if (inbound && lpOut) {
      out.removes++;
      out.inLp += amt;
      moneyLegs(sibs, ts2);
    } else if (inbound && (sibs.some((y) => (y.from || "").toLowerCase() === addr) || poolish)) out.inSwap += amt;
    else if (!inbound && (sibs.some((y) => (y.to || "").toLowerCase() === addr) || poolish)) out.outSwap += amt;
    else if (inbound) {
      out.inXfer += amt;
      out.xferInEvs.push([parseInt(x.timeStamp, 10) * 1e3, amt]);
    }
    else out.outXfer += amt;
  }
  return out;
}
var token_default = async (req) => {
  const url = new URL(req.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  const q = (url.searchParams.get("q") || "").trim();
  if (!/^0x[0-9a-f]{40}$/.test(addr) || !q) {
    return new Response(JSON.stringify({ error: "bad request" }), { status: 400, headers: HEADERS });
  }
  const store = storeOr("pnl");
  let rowsIdx = [];
  if (store) try {
    const cached = await store.get("v22/" + addr, { type: "json" });
    if (cached && cached.rowsIdx) rowsIdx = cached.rowsIdx;
  } catch {
  }
  if (!rowsIdx.length) {
    const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
    try {
      await fetch(site + "/api/pnl?addr=" + addr);
    } catch {
    }
    if (store) try {
      const cached = await store.get("v22/" + addr, { type: "json" });
      if (cached && cached.rowsIdx) rowsIdx = cached.rowsIdx;
    } catch {
    }
  }
  let contract = null, row = null;
  if (/^0x[0-9a-f]{40}$/i.test(q)) {
    contract = q.toLowerCase();
    row = rowsIdx.find((r) => r.a === contract) || null;
  } else {
    const qq = q.toUpperCase().replace(/^\$/, "");
    const matches = rowsIdx.filter((r) => r.s === qq);
    if (matches.length > 1) {
      return new Response(JSON.stringify({ ambiguous: matches.map((m) => ({ sym: m.s, contract: m.a })) }), { headers: HEADERS });
    }
    if (matches.length === 1) {
      row = matches[0];
      contract = row.a;
    }
  }
  if (!contract) {
    return new Response(JSON.stringify({ none: true, q }), { headers: HEADERS });
  }
  const dk = "tok5/" + addr + "/" + contract;
  if (store) try {
    const c = await store.get(dk, { type: "json" });
    if (c && Date.now() - c.t < 7 * 24 * 3600 * 1e3) return new Response(JSON.stringify(c.d), { headers: HEADERS });
  } catch {
  }
  const all = await fetchWalletTx(addr);
  const truncated = !!(all && all.length >= 9999);
  let targetRows = all && !truncated ? all.filter((x) => (x.contractAddress || "").toLowerCase() === contract) : null;
  if (!targetRows || !targetRows.length) targetRows = await fetchTokenTx(addr, contract);
  const rp = foldTok(targetRows, addr, null);
  if (!rp) return new Response(JSON.stringify({ none: true, q }), { headers: HEADERS });
  const lp = all && !truncated && targetRows ? classifyLp(all, targetRows, contract, addr) : null;
  const cg = await cgToken(contract, store);
  const pk = cg ? await peakSince(contract, rp.firstTs, store) : null;
  const peakPrice = pk ? pk.price : cg ? cg.ath : null;
  const peakTs0 = pk ? pk.ts : cg ? cg.athDate : null;
  const peakTs = peakTs0 ? Math.max(peakTs0, rp.firstTs) : null;
  let verdict = null, balAtPeak = null;
  if (peakTs) {
    const rp2 = foldTok(targetRows, addr, peakTs);
    balAtPeak = rp2 ? rp2.balAtRef : null;
    if (balAtPeak !== null && rp.peakBag > 0) {
      const ratio = balAtPeak / rp.peakBag;
      if (rp.balNow > 0 && ratio >= 0.5) verdict = "still aboard";
      else if (ratio >= 0.5) verdict = "rode it down, then sold";
      else verdict = "sold before the top";
    }
  }
  const truePk = pk && pk.series ? peakBagOver(pk.series, targetRows, addr) : null;
  const recvUsd = lp && lp.xferInEvs.length && pk && pk.series ? usdAtArrival(lp.xferInEvs, pk.series) : null;
  let lpNetTk = null, lpPutUsd = null, lpGotUsd = null;
  if (lp && (lp.adds || lp.removes)) {
    lpNetTk = lp.outLp - lp.inLp;
    if (lp.putWavax.length || lp.gotWavax.length || lp.putStable || lp.gotStable) {
      const av = await avaxSeries(store);
      const pw = av && lp.putWavax.length ? usdAtArrival(lp.putWavax, av) : 0;
      const gw = av && lp.gotWavax.length ? usdAtArrival(lp.gotWavax, av) : 0;
      lpPutUsd = Math.round((pw || 0) + lp.putStable) || null;
      lpGotUsd = Math.round((gw || 0) + lp.gotStable) || null;
    }
  }
  if (lp && lpNetTk !== null && lpNetTk > 0 && lpNetTk > lp.outSwap && verdict !== "bag arrived after the party") {
    const mostlyGone = rp.peakBag > 0 && lpNetTk >= rp.peakBag * 0.5;
    if (verdict !== "still aboard" || mostlyGone) verdict = "never sold. the pool sold it for you.";
  }
  if (lp && verdict && verdict !== "still aboard") {
    const totalIn = lp.inSwap + lp.inXfer + lp.inLp;
    if (totalIn > 0 && (lp.inXfer + lp.inLp) / totalIn >= 0.8 && peakTs && peakTs - rp.firstTs < 7 * 864e5) verdict = "bag arrived after the party";
  }
  let updated = null;
  const NO_STORY = { "0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7": 1 };
  const NO_STORY_SYM = { "WAVAX": 1, "USDT": 1, "USDC": 1, "DAI": 1, "MIM": 1, "FRAX": 1, "USDT.E": 1, "USDC.E": 1, "DAI.E": 1, "BUSD": 1, "TUSD": 1, "UST": 1, "USDD": 1, "EURC": 1, "AUSD": 1, "USD1": 1, "USDP": 1 };
  const infraTok = NO_STORY[contract] || (row && NO_STORY_SYM[(row.s || "").toUpperCase()]);
  if (!infraTok && store && peakPrice && peakTs && balAtPeak !== null) {
    try {
      const cached = await store.get("v22/" + addr, { type: "json" });
      if (cached && cached.stats) {
        const st2 = cached.stats;
        const avgSell = row && row.st > 0 ? row.so / row.st : 0;
        const cur = cg ? cg.cur : 0;
        const usd2 = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
        const symU = row ? row.s : "?";
        const rp0 = rp;
        const exitRatio = rp0.peakBag > 0 ? balAtPeak / rp0.peakBag : 1;
        if (exitRatio >= 0.2 && balAtPeak > 0) {
          const pBal2 = truePk ? truePk.bal : balAtPeak;
          const peakValue = truePk ? truePk.usd : balAtPeak * peakPrice;
          const heldPart = Math.min(rp0.balNow, balAtPeak);
          const soldAfter = Math.max(0, balAtPeak - heldPart);
          const walked = soldAfter * avgSell + heldPart * cur;
          const rt = peakValue - walked;
          if (peakValue > 500 && rt > 250 && rt / peakValue > 0.5) {
            const best = st2.roundtrips && st2.roundtrips[0] && st2.roundtrips[0].rtUsd || 0;
            if (rt > best && !(st2.roundtrips || []).some((x) => x.sym === symU)) {
              const tail = soldAfter * avgSell > heldPart * cur ? "walked with ~" + usd2(walked) : usd2(heldPart * cur) + " now";
              const entry = { line: "-" + usd2(rt), sub: "$" + symU + " \xB7 " + usd2(peakValue) + " at peak \xB7 " + tail, sym: symU, rtUsd: Math.round(rt), peakUsd: Math.round(peakValue) };
              st2.roundtrips = [entry].concat(st2.roundtrips || []).slice(0, 5);
              st2.roundtrip = { line: entry.line, sub: entry.sub };
              updated = "roundtrip";
            }
          }
        } else if (row && row.so > 50) {
          const exitedTk = rp0.peakBeforeRef - balAtPeak;
          const proceeds = exitedTk * avgSell;
          const athValue = exitedTk * peakPrice;
          if (proceeds > 50 && athValue > 500 && athValue > proceeds * 3) {
            const missed = athValue - proceeds;
            const best = st2.soldEarly && st2.soldEarly[0] && st2.soldEarly[0].missedUsd || 0;
            if (missed > best && !(st2.soldEarly || []).some((x) => x.sym === symU)) {
              const entry = { line: "$" + symU, sub: "sold for ~" + usd2(proceeds) + " \xB7 " + usd2(athValue) + " at peak", sym: symU, missedUsd: Math.round(missed), missedX: proceeds > 0 ? +(athValue / proceeds).toFixed(1) : 0 };
              st2.soldEarly = [entry].concat(st2.soldEarly || []).slice(0, 5);
              st2.soldTooEarly = { line: entry.line, sub: entry.sub };
              updated = "sold too early";
            }
          }
        }
        if (updated) {
          await store.set("v22/" + addr, JSON.stringify(cached)).catch(() => {
          });
          try {
            const bs = storeOr("badges");
            if (bs) await bs.delete("w2/" + addr);
          } catch {
          }
        }
      }
    } catch {
    }
  }
  const sym = row ? row.s : q.startsWith("0x") ? contract.slice(0, 8) : q.toUpperCase().replace(/^\$/, "");
  const d = {
    sym,
    contract,
    realized: row ? row.p : null,
    invested: row ? row.i : null,
    soldUsd: row ? row.so : null,
    firstHeld: new Date(rp.firstTs).toISOString().slice(0, 10),
    lastActivity: new Date(rp.lastTs).toISOString().slice(0, 10),
    transfers: rp.transfers,
    peakBagTk: rp.peakBag,
    peakBagUsd: truePk ? Math.round(truePk.usd) : peakPrice ? Math.round(rp.peakBag * peakPrice) : null,
    peakDate: truePk ? new Date(truePk.ts).toISOString().slice(0, 10) : peakTs ? new Date(peakTs).toISOString().slice(0, 10) : null,
    holdingNow: rp.balNow > 0,
    holdingUsd: rp.balNow > 0 && cg && cg.cur ? Math.round(rp.balNow * cg.cur) : null,
    verdict,
    updated,
    lp: lp ? { adds: lp.adds, removes: lp.removes, netTk: lpNetTk !== null ? Math.round(lpNetTk) : null, putUsd: lpPutUsd, gotUsd: lpGotUsd } : null,
    recvTk: lp && lp.inXfer > 0 ? Math.round(lp.inXfer) : null,
    recvUsd: recvUsd ? Math.round(recvUsd) : null,
    truncated
  };
  if (store) try {
    await store.set(dk, JSON.stringify({ t: Date.now(), d }));
  } catch {
  }
  return new Response(JSON.stringify(d), { headers: HEADERS });
};
var config = { path: "/api/token" };
export {
  _mem,
  config,
  token_default as default
};
