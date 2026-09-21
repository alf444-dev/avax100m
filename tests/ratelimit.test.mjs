import test from "node:test";
import assert from "node:assert/strict";
import { clientIp, internalHeaders, internalToken, takeCold } from "../netlify/functions/lib/ratelimit.mjs";

const ENV = { ADMIN_KEY: "0123456789abcdef-admin" };
function memStore() {
  const m = new Map();
  return { get: async (k) => (m.has(k) ? JSON.parse(m.get(k)) : null), set: async (k, v) => { m.set(k, v); }, keys: () => [...m.keys()] };
}
const reqWith = (headers) => new Request("https://avax100m.xyz/api/pnl?addr=0x0", { headers });

test("cold computes are capped per ip per hour, then reset", async () => {
  const store = memStore(), now = 1e12;
  for (let i = 0; i < 3; i++) assert.equal(await takeCold(store, "1.2.3.4", { limit: 3, now }), true);
  assert.equal(await takeCold(store, "1.2.3.4", { limit: 3, now }), false);
  assert.equal(await takeCold(store, "5.6.7.8", { limit: 3, now }), true, "another visitor is unaffected");
  assert.equal(await takeCold(store, "1.2.3.4", { limit: 3, now: now + 36e5 }), true, "next hour resets");
  assert.ok(store.keys().every((k) => !k.includes("1.2.3.4")), "no raw ip is stored");
});

test("the limiter fails open without an ip, a store, or a working store", async () => {
  assert.equal(await takeCold(memStore(), null), true);
  assert.equal(await takeCold(null, "1.2.3.4"), true);
  assert.equal(await takeCold({ get: async () => { throw new Error("down"); } }, "1.2.3.4"), true);
});

test("a forwarded ip is honoured only with the internal token", () => {
  const ctx = { ip: "10.0.0.1" };
  const h = internalHeaders({ ip: "9.9.9.9" }, ENV);
  assert.equal(h["x-client-ip"], "9.9.9.9");
  assert.equal(clientIp(reqWith(h), ctx, ENV), "9.9.9.9");
  assert.equal(clientIp(reqWith({ "x-client-ip": "9.9.9.9" }), ctx, ENV), "10.0.0.1", "spoofed header ignored");
  assert.equal(clientIp(reqWith({ "x-client-ip": "9.9.9.9", "x-internal-key": "nope" }), ctx, ENV), "10.0.0.1");
  assert.equal(clientIp(reqWith({}), undefined, ENV), null);
});

test("no ADMIN_KEY means no token and nothing forwarded", () => {
  assert.equal(internalToken({}), null);
  assert.equal(internalToken({ ADMIN_KEY: "short" }), null);
  assert.deepEqual(internalHeaders({ ip: "9.9.9.9" }, {}), {});
  assert.equal(clientIp(reqWith({ "x-client-ip": "9.9.9.9", "x-internal-key": "" }), { ip: "10.0.0.1" }, {}), "10.0.0.1");
});
