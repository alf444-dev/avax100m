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

// src/lib.js
var GENESIS = Date.UTC(2020, 8, 21);
var ERAS = [
  [Date.UTC(2021, 1, 9), "GENESIS", "before the first dex. before everything."],
  [Date.UTC(2021, 7, 18), "PANGOLIN SPRING", "first native dex. first c-chain boom."],
  [Date.UTC(2021, 10, 21), "AVALANCHE RUSH", "$180m in incentives. aave and curve move in."],
  [Date.UTC(2022, 1, 1), "WONDERLAND", "$146 ath. time (9,9). you saw the top."],
  [Date.UTC(2022, 4, 9), "SUBNET SZN", "summit barcelona. dfk crystalvale. crabada."],
  [Date.UTC(2023, 0, 1), "THE LONG WINTER", "terra. cryptoleaks. ftx. banff shipped anyway."],
  [Date.UTC(2023, 9, 1), "THE DESERT", "aws handshake. single digits. blocks anyway."],
  [Date.UTC(2023, 11, 5), "STARS ARENA", "socialfi mania, exploit, comeback. wild month."],
  [Date.UTC(2024, 2, 6), "COQ SZN", "memecoins and inscriptions. $9 to $48."],
  [Date.UTC(2024, 11, 16), "DURANGO", "warp messaging live. the rebuild begins."],
  [Date.UTC(2025, 0, 25), "AVALANCHE9000", "etna. subnets become l1s. costs drop 99%."],
  [Date.UTC(2025, 5, 1), "PRESALE SZN", "ket 720x. wink. blub shamefi. forms closed fast."],
  [Date.UTC(2025, 10, 19), "ARENA SUMMER", "1,800 tokens a day. lambo. wolfi. fifa moves in."],
  [Infinity, "GRANITE", "sub-second finality. world cup on-chain."]
];
var RANKS = [
  [2e3, "PERMAFROST", "here before most chains existed."],
  [1600, "OG", "watched the ath from the inside."],
  [1200, "VETERAN", "held through the long winter."],
  [800, "SURVIVOR", "outlasted the desert."],
  [400, "RESIDENT", "settled in for the rebuild."],
  [120, "SETTLER", "arrived when it got fast."],
  [0, "FRESH SNOW", "welcome. blocks don't wait."]
];
function eraFor(ts) {
  for (const e of ERAS) {
    if (ts < e[0]) return e;
  }
  return ERAS[ERAS.length - 1];
}
function rankFor(days) {
  for (const r of RANKS) {
    if (days >= r[0]) return r;
  }
  return RANKS[RANKS.length - 1];
}
var TOS = {
  "0x60ae616a28f1f202060ccb7207f87c051f4e5b3b": "swapped on trader joe",
  "0xe54ca86531e17ef3616d22ca28b0d458b6c89106": "swapped on pangolin",
  "0x794a61358d6845594f94dc1db02a252b5b4814ad": "deposited into aave",
  "0x1111111254eeb25477b68fb85ed929f73a960582": "swapped via 1inch",
  "0x3c2269811836af69497e5f486a85d7316753cf62": "crossed chains via layerzero",
  "0x45a01e4e04f14f7a4a6702c74187c5f6222033cd": "bridged via stargate",
  "0x8eb8a3b98659cce290402893d0123abb75e3ab28": "bridged out via avalanche bridge"
};
var FROMS = { "0x8eb8a3b98659cce290402893d0123abb75e3ab28": "bridged in from ethereum" };
var SCAM_RE = /claim|visit|reward|bonus|airdrop|gift|prize|www|http|\.com|\.io|\.xyz|\.net|\.org/i;
var SKIP_TOKENS = { WAVAX: 1, USDC: 1, USDT: 1, DAI: 1, BUSD: 1, FRAX: 1, MIM: 1, TUSD: 1, USDP: 1, UST: 1, USDD: 1, EURC: 1, AUSD: 1, USD1: 1 };
function classifyTx(tx, addr) {
  const a = addr.toLowerCase(), to = (tx.to || "").toLowerCase(), from = (tx.from || "").toLowerCase();
  if (!to) return "deployed a contract";
  if (to === a) return FROMS[from] || null;
  return TOS[to] || null;
}
function cleanSymbol(t) {
  let s = (t.tokenSymbol || "").trim();
  const n = t.tokenName || "";
  if (!/^[A-Za-z0-9$]{1,12}$/.test(s)) return null;
  if (SCAM_RE.test(s) || SCAM_RE.test(n)) return null;
  s = s.toUpperCase();
  if (SKIP_TOKENS[s]) return null;
  return s;
}
function firstInteresting(txs, toks, addr) {
  for (const t of toks) {
    const s = cleanSymbol(t);
    if (s) return { key: "FIRST TOKEN", val: "$" + s, contract: (t.contractAddress || "").toLowerCase() || null };
  }
  const events = [];
  for (const tx of txs) {
    const lbl = classifyTx(tx, addr);
    if (lbl) events.push({ ts: parseInt(tx.timeStamp, 10), key: "FIRST MOVE", val: lbl });
  }
  if (!events.length) return { key: "FIRST MOVE", val: "just avax" };
  events.sort((a, b) => a.ts - b.ts);
  return events[0];
}
var API = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
async function fetchWallet(addr) {
  const base = API + "?module=account&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=25&sort=asc";
  const [txj, tokj, intj, cntj, blkj] = await Promise.all([
    fetch(base + "&action=txlist").then((r) => r.json()),
    fetch(base + "&action=tokentx").then((r) => r.json()).catch(() => ({ result: [] })),
    fetch(base + "&action=txlistinternal").then((r) => r.json()).catch(() => ({ result: [] })),
    fetch(API + "?module=proxy&action=eth_getTransactionCount&address=" + addr + "&tag=latest").then((r) => r.json()).catch(() => null),
    fetch(API + "?module=proxy&action=eth_blockNumber").then((r) => r.json()).catch(() => null)
  ]);
  const heads = [];
  if (txj.result && txj.result.length) heads.push(txj.result[0]);
  if (tokj && Array.isArray(tokj.result) && tokj.result.length) heads.push(tokj.result[0]);
  if (intj && Array.isArray(intj.result) && intj.result.length) heads.push(intj.result[0]);
  if (!heads.length) return null;
  const first = heads.reduce((a, b) => parseInt(a.timeStamp, 10) <= parseInt(b.timeStamp, 10) ? a : b);
  const ts = parseInt(first.timeStamp, 10) * 1e3;
  const blk = parseInt(first.blockNumber, 10);
  const now = Date.now();
  const days = Math.floor((now - ts) / 864e5);
  const pct = Math.min(100, (now - ts) / (now - GENESIS) * 100);
  const curBlock = blkj && blkj.result ? parseInt(blkj.result, 16) : 1e8;
  const early = blk / curBlock * 100;
  const earlyStr = (early < 0.01 ? "<0.01" : early < 1 ? early.toFixed(2) : early.toFixed(1)) + "% of all blocks";
  const txc = cntj && cntj.result ? parseInt(cntj.result, 16) : null;
  const mv = firstInteresting(txj && txj.result || [], tokj && tokj.result || [], addr);
  const dateStr = new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase();
  return { addr, ts, blk, days, pct, era: eraFor(ts), rank: rankFor(days), mv, txc, earlyStr, dateStr };
}

// src/badges.js
var HEADERS = { "content-type": "application/json", "access-control-allow-origin": "*", "cache-control": "no-store" };
var RS = "https://api.routescan.io/v2/network/mainnet/evm/43114/etherscan/api";
var CACHE_MS = 7 * 24 * 3600 * 1e3;
var SCAM = /claim|visit|reward|bonus|airdrop|gift|prize|www|http|\.com|\.io|\.xyz|\.net|\.org/i;
var usd = (n) => "$" + Math.round(Math.abs(n)).toLocaleString("en-US");
var badges_default = async (req) => {
  const url = new URL(req.url);
  const addr = (url.searchParams.get("addr") || "").toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(addr)) {
    return new Response(JSON.stringify({ badges: [] }), { status: 400, headers: HEADERS });
  }
  const debug = url.searchParams.get("debug") === "1";
  let store = null;
  try {
    store = getStore("badges");
  } catch {
  }
  if (store && !debug) try {
    const c = await store.get("w2/" + addr, { type: "json" });
    if (c && Date.now() - c.t < CACHE_MS) return new Response(JSON.stringify({ badges: c.b }), { headers: HEADERS });
  } catch {
  }
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
  const [w, pnlj, resj, tokj] = await Promise.all([
    fetchWallet(addr).catch(() => null),
    fetch(site + "/api/pnl?addr=" + addr).then((r) => r.json()).catch(() => null),
    fetch(site + "/api/resolve?addr=" + addr).then((r) => r.json()).catch(() => null),
    fetch(RS + "?module=account&action=tokentx&address=" + addr + "&startblock=0&endblock=999999999&page=1&offset=100&sort=asc").then((r) => r.json()).catch(() => ({ result: [] }))
  ]);
  if (!w) return new Response(JSON.stringify({ badges: [] }), { headers: HEADERS });
  const earned = [];
  const push = (id, tier, ev) => earned.push({ id, tier: tier || 0, ev });
  if (w.rank && w.rank[1] === "PERMAFROST")
    push("permafrost", 0, "first touch <b>" + w.dateStr.toLowerCase() + "</b>, block #" + w.blk.toLocaleString("en-US") + " \u2014 in the first " + w.earlyStr + ".");
  if (w.pct >= 75)
    push("furniture", w.pct >= 95 ? 3 : w.pct >= 90 ? 2 : 1, "survived <b>" + w.pct.toFixed(1) + "%</b> of mainnet's existence.");
  if (w.txc !== null && w.txc >= 1e3)
    push("thousand", w.txc >= 1e4 ? 3 : w.txc >= 5e3 ? 2 : 1, "<b>" + w.txc.toLocaleString("en-US") + "</b> transactions sent.");
  const mvVal = w.mv && w.mv.val || "";
  if (/bridged in from ethereum/i.test(mvVal))
    push("immigrant", 0, "first touch was a <b>bridge in from ethereum</b>. came here on purpose.");
  if (/pangolin/i.test(mvVal))
    push("pangolin", 0, "first swap was on <b>pangolin</b>. before the joe era.");
  if (w.era && w.era[1] === "AVALANCHE RUSH")
    push("rush", 0, "arrived during <b>avalanche rush</b> \u2014 the $180m summer.");
  if (w.mv && w.mv.key === "FIRST TOKEN" && w.mv.contract) {
    try {
      const bj = await fetch(RS + "?module=account&action=tokenbalance&contractaddress=" + w.mv.contract + "&address=" + addr + "&tag=latest").then((r) => r.json());
      if (bj && bj.result && BigInt(bj.result) > 0n)
        push("firstlove", 0, "first token <b>$" + mvVal + "</b>, " + w.dateStr.toLowerCase() + " \u2014 balance never reached zero. " + w.days.toLocaleString("en-US") + " days.");
    } catch {
    }
  }
  if (resj && resj.name)
    push("registry", 0, "reverse record set: <b>" + resj.name + "</b>. the chain knows your name.");
  try {
    const seen = {};
    let n = 0;
    for (const t of tokj && tokj.result || []) {
      if ((t.to || "").toLowerCase() !== addr) continue;
      const nm = (t.tokenName || "") + " " + (t.tokenSymbol || "");
      if (SCAM.test(nm) && !seen[t.contractAddress]) {
        seen[t.contractAddress] = 1;
        n++;
      }
    }
    if (n >= 25) push("spammagnet", 0, "<b>" + n + "</b> scam airdrops received. you did nothing. the chain chose you.");
  } catch {
  }
  const st = pnlj && pnlj.available && pnlj.stats || {};
  const f = st.flags || {};
  const era = w.era && w.era[1] || "";
  if (f.fullCircle) {
    const rt0 = st.roundtrips && st.roundtrips[0] || null;
    push("fullcircle", f.fullCircle.tier, rt0 ? "held <b>" + rt0.sub.split("\xB7")[1].trim() + "</b> of <b>$" + (rt0.sym || "") + "</b>. " + (rt0.sub.split("\xB7")[2] || "").trim() + "." : "roundtripped <b>" + usd(f.fullCircle.amt) + "</b>.");
  }
  if (f.exitThere) push("exitthere", 0, "exited <b>$" + f.exitThere.sym + "</b> before a <b>" + f.exitThere.x + "x</b>. the exit was right there.");
  if (f.boughtTop) push("boughttop", 0, "average entry within 20% of <b>$" + f.boughtTop.sym + "</b>'s peak-while-held.");
  if (f.captain) push("captain", 0, "still holding <b>$" + f.captain.sym + "</b>, down <b>" + f.captain.downPct + "%</b> from its peak. goes down with the ship.");
  if (f.soldTop) push("soldtop", 0, "exited <b>$" + f.soldTop.sym + "</b> within 7 days of its peak-while-held. verified by transfer replay.");
  if (f.netUp) push("netup", 0, "total realized: <b>+" + usd(f.netUp.total) + "</b> across " + (st.tokens || "20+") + " tokens.");
  if (f.sniper) push("sniper", 0, "<b>" + f.sniper.pct + "%</b> winrate on 20+ decided positions.");
  if (f.exitLiq) push("exitliq", 0, "<b>" + f.exitLiq.pct + "%</b> winrate on 20+ decided positions. worn openly.");
  if (f.caughtOne) push("caughtone", 0, "realized a <b>" + f.caughtOne.x + "x</b> on <b>$" + f.caughtOne.sym + "</b>. the chain confirms.");
  if (f.oneTrick) push("onetrick", 0, "<b>$" + f.oneTrick.sym + "</b> is <b>" + f.oneTrick.pct + "%</b> of all realized profit.");
  if (f.deepBench) push("deepbench", 0, "<b>" + f.deepBench.n + "</b> tokens each realized over $1,000. a rotation, not a lottery.");
  if (f.zoo) push("zoo", f.zoo.tier, "<b>" + f.zoo.n + "</b> tokens traded through dex swaps.");
  if (f.stableLoss) push("stableloss", 0, "realized <b>\u2212" + usd(f.stableLoss.amt) + "</b> trading <b>$" + f.stableLoss.sym + "</b>. a stablecoin. it holds still and you still lost.");
  if (f.graveyard) push("graveyard", 0, "<b>" + f.graveyard.n + "</b> tokens in the wallet each worth under a dollar. a museum of decisions.");
  if (f.roundVictim) push("roundvictim", 0, "<b>$" + f.roundVictim.sym + "</b> bag peaked at <b>" + usd(f.roundVictim.peak) + "</b> \u2014 " + usd(f.roundVictim.target - f.roundVictim.peak) + " short of " + usd(f.roundVictim.target) + ". never crossed.");
  if (f.wonderland) push("wonderland", 0, "held or traded <b>$TIME</b>. (9,9). no further questions.");
  if (f.coqVet) push("coq", 0, "traded <b>$COQ</b>. the memecoin spring left a mark.");
  if (era === "ARENA SUMMER" && f.arenaTraded) push("arena", 0, "arrived during <b>arena summer</b> with <b>$ARENA</b> in the history.");
  let counts = { total: 0, byId: {} };
  if (store) {
    try {
      counts = await store.get("counts", { type: "json" }) || counts;
    } catch {
    }
    let seen = null;
    try {
      seen = await store.get("seen/" + addr);
    } catch {
    }
    if (!seen) {
      counts.total++;
      for (const b of earned) counts.byId[b.id] = (counts.byId[b.id] || 0) + 1;
      try {
        await store.set("seen/" + addr, "1");
        await store.set("counts", JSON.stringify(counts));
      } catch {
      }
    }
  }
  for (const b of earned) b.rarity = { count: counts.byId[b.id] || 1, total: Math.max(counts.total, 1) };
  earned.sort((a, b) => a.rarity.count - b.rarity.count);
  if (store && !debug) try {
    await store.set("w2/" + addr, JSON.stringify({ t: Date.now(), b: earned }));
  } catch {
  }
  return new Response(JSON.stringify({ badges: earned }), { headers: HEADERS });
};
var config = { path: "/api/badges" };
export {
  config,
  badges_default as default
};
