import test from "node:test";
import assert from "node:assert/strict";
import { ethers } from "ethers";

test("claim signature recovery uses the Ethers v6 API", async () => {
  const wallet = ethers.Wallet.createRandom();
  const message = "avax100m.xyz\nclaim signature dependency smoke";
  const signature = await wallet.signMessage(message);
  assert.equal(ethers.verifyMessage(message, signature).toLowerCase(), wallet.address.toLowerCase());
});
