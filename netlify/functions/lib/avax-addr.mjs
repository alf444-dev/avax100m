// Derive an Avalanche address (bech32, hrp "avax") from a signature, so a
// validator can prove control of its NodeID by signing with the key that owns
// the validation reward. We recover the secp256k1 pubkey from a personal_sign
// signature, then addr = bech32("avax", ripemd160(sha256(compressedPubkey))) —
// the same derivation the P/X-chains use. Compared exact-match against the
// on-chain reward owner, so a wrong derivation fails safe (never a false match).

import { sha256, ripemd160, getBytes, hashMessage, SigningKey } from "ethers";

const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
const GEN = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];

function polymod(values) {
  let chk = 1;
  for (const v of values) {
    const b = chk >> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((b >> i) & 1) chk ^= GEN[i];
  }
  return chk;
}
function hrpExpand(hrp) {
  const ret = [];
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) >> 5);
  ret.push(0);
  for (let i = 0; i < hrp.length; i++) ret.push(hrp.charCodeAt(i) & 31);
  return ret;
}
function createChecksum(hrp, data) {
  const values = hrpExpand(hrp).concat(data).concat([0, 0, 0, 0, 0, 0]);
  const mod = polymod(values) ^ 1;
  const ret = [];
  for (let i = 0; i < 6; i++) ret.push((mod >> (5 * (5 - i))) & 31);
  return ret;
}
function convertBits(data, from, to, pad) {
  let acc = 0, bits = 0;
  const ret = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) { bits -= to; ret.push((acc >> bits) & maxv); }
  }
  if (pad && bits > 0) ret.push((acc << (to - bits)) & maxv);
  return ret;
}

/** Encode already-5-bit words. */
export function bech32Encode(hrp, words) {
  const combined = words.concat(createChecksum(hrp, words));
  let ret = hrp + "1";
  for (const d of combined) ret += CHARSET[d];
  return ret;
}

/** Bytes (Uint8Array/hex) -> bech32 address string with the given hrp. */
export function bytesToBech32(bytes, hrp = "avax") {
  return bech32Encode(hrp, convertBits([...getBytes(bytes)], 8, 5, true));
}

/** Compressed secp256k1 pubkey -> Avalanche address (avax1…). */
export function pubkeyToAvaxAddr(compressedPubKey, hrp = "avax") {
  const pub = getBytes(compressedPubKey);
  return bytesToBech32(getBytes(ripemd160(sha256(pub))), hrp);
}

/** Recover the Avalanche address that produced an EIP-191 personal_sign signature. */
export function recoverAvaxAddr(message, sig, hrp = "avax") {
  const uncompressed = SigningKey.recoverPublicKey(hashMessage(message), sig);
  const compressed = SigningKey.computePublicKey(uncompressed, true);
  return pubkeyToAvaxAddr(compressed, hrp);
}

/** Normalize an on-chain reward owner ("P-avax1…" / "avax1…") to the bare bech32. */
export function bareAvaxAddr(addr) {
  const s = String(addr || "").trim();
  const i = s.lastIndexOf("avax1");
  return i >= 0 ? s.slice(i) : s;
}
