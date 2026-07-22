import test from "node:test";
import assert from "node:assert/strict";
import { Wallet, SigningKey } from "ethers";

import { bech32Encode, pubkeyToAvaxAddr, recoverAvaxAddr, bareAvaxAddr } from "../netlify/functions/lib/avax-addr.mjs";

// force the in-memory store path in vclaim
delete process.env.NETLIFY;
delete process.env.URL;
const { default: vclaim, _mem } = await import("../netlify/functions/vclaim.mjs");

const NODE = "NodeID-TestQ1ZzBXtcP9xUMTEUEks5cpx9f1q3tTjT5";
const avaxOf = (w) => pubkeyToAvaxAddr(SigningKey.computePublicKey(w.signingKey.publicKey, true));
const msgFor = (v, nonce) => "avax100m.xyz\nset validator profile " + NODE +
  "\nhandle: " + v.handle + "\npfp: " + v.pfp + "\nx: " + v.x + "\ndiscord: " + v.discord + "\nsite: " + v.site + "\nnonce: " + nonce;
const post = (body) => vclaim(new Request("http://x/api/vclaim", { method: "POST", body: JSON.stringify(body) }));
function seed(nonce, vals, owners) { _mem.vprofile = new Map(); _mem.vprofile.set("vn/" + NODE, JSON.stringify({ nonce, t: Date.now(), vals, owners })); }

test("bech32 matches the BIP-173 vector", () => {
  assert.equal(bech32Encode("abcdef", Array.from({ length: 32 }, (_, i) => i)), "abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw");
});

test("recover-from-signature equals derive-from-key", async () => {
  const w = Wallet.createRandom();
  const msg = "hello avalanche";
  assert.equal(recoverAvaxAddr(msg, await w.signMessage(msg)), avaxOf(w));
});

test("bareAvaxAddr strips the chain prefix", () => {
  assert.equal(bareAvaxAddr("P-avax196s8enhhy70kr2vpu67m33vucxpv9g9p8k9zmw"), "avax196s8enhhy70kr2vpu67m33vucxpv9g9p8k9zmw");
});

test("reward-owner signature is accepted and profile stored", async () => {
  const w = Wallet.createRandom();
  const owner = avaxOf(w);
  const vals = { handle: "Frosty Node", pfp: "https://ex.com/a.png", x: "https://x.com/frosty", discord: "frosty#1", site: "" };
  const nonce = "n1";
  seed(nonce, vals, [owner]);
  const r = await post({ node: NODE, sig: await w.signMessage(msgFor(vals, nonce)) });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  const rec = JSON.parse(_mem.vprofile.get("v/" + NODE));
  assert.equal(rec.handle, "Frosty Node");
  assert.equal(rec.owner, owner);
  assert.equal(rec.source, "self");
  assert.equal(_mem.vprofile.get("vn/" + NODE), undefined, "nonce consumed");
});

test("a signature from a non-owner is rejected", async () => {
  const owner = avaxOf(Wallet.createRandom());   // some other reward owner
  const attacker = Wallet.createRandom();          // not the owner
  const vals = { handle: "Hijack", pfp: "", x: "", discord: "", site: "" };
  const nonce = "n2";
  seed(nonce, vals, [owner]);
  const r = await post({ node: NODE, sig: await attacker.signMessage(msgFor(vals, nonce)) });
  assert.equal(r.status, 401);
  assert.equal(_mem.vprofile.get("v/" + NODE), undefined, "nothing written");
});

test("expired / missing nonce is refused", async () => {
  _mem.vprofile = new Map();
  const r = await post({ node: NODE, sig: "0x" + "11".repeat(65) });
  assert.equal(r.status, 400);
});

test("vgrant: key-gated, sets tier + granted badges, preserves self fields", async () => {
  process.env.PORTAL_KEY = "portal-key-abc-1234567890";
  const { default: vgrant, _mem: gmem } = await import("../netlify/functions/vgrant.mjs");
  const greq = (headers, body) => vgrant(new Request("http://x/api/vgrant", { method: "POST", headers, body: JSON.stringify(body) }));

  // no key -> invisible (404)
  assert.equal((await greq({}, { node: NODE, tier: "A" })).status, 404);

  // with key: preserves a self-claimed handle, sets tier + valid badges only
  gmem.vprofile = new Map();
  gmem.vprofile.set("v/" + NODE, JSON.stringify({ handle: "Frosty Node", owner: "avax1x", socials: { x: "https://x.com/frosty" } }));
  const r = await greq({ "x-portal-key": process.env.PORTAL_KEY }, { node: NODE, tier: "a", grantedBadges: ["builder", "educator", "not-a-badge"] });
  const j = await r.json();
  assert.equal(r.status, 200);
  assert.equal(j.tier, "A");
  assert.deepEqual(j.grantedBadges, ["builder", "educator"]);
  const rec = JSON.parse(gmem.vprofile.get("v/" + NODE));
  assert.equal(rec.handle, "Frosty Node", "self-set handle preserved");
  assert.equal(rec.socials.x, "https://x.com/frosty", "socials preserved");
});
