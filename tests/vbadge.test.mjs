import test from "node:test";
import assert from "node:assert/strict";
import { renderBadgeSvg, renderEmptyBadgeSvg, BADGE_W, BADGE_H } from "../netlify/functions/lib/vbadge-svg.mjs";

const nd = { node: { nodeID: "NodeID-7Xhw2mDxuDS3zVN7g4iDLxvEHfP1n8s6W", uptime: 0.9987, stake: 2000 }, rank: 73, count: 594, badges: [{ id: "flawless", tier: 2 }, { id: "solo", tier: 0 }], profile: null };

test("renderBadgeSvg emits a self-contained SVG with the live numbers", () => {
  const svg = renderBadgeSvg(nd);
  assert.ok(svg.startsWith("<svg xmlns"));
  assert.ok(svg.includes(`width="${BADGE_W}" height="${BADGE_H}"`));
  assert.ok(svg.includes("99.87%"));
  assert.ok(svg.includes("#73 of 594"));
  assert.ok(svg.includes("FLAWLESS II  ·  SOLO"));
  assert.ok(svg.includes("NodeID-7Xhw2m…8s6W"));
  assert.ok(!/href=|<image|<script|url\(/.test(svg), "no external resources or scripts");
});

test("renderBadgeSvg escapes a hostile handle", () => {
  const svg = renderBadgeSvg(Object.assign({}, nd, { profile: { handle: '<script>x</script>"&' } }));
  assert.ok(!svg.includes("<script>"));
  assert.ok(svg.includes("&lt;script&gt;"));
  assert.ok(svg.includes("&quot;&amp;"));
});

test("renderEmptyBadgeSvg is a valid placeholder", () => {
  const svg = renderEmptyBadgeSvg("no current validator");
  assert.ok(svg.startsWith("<svg xmlns") && svg.includes("no current validator") && svg.endsWith("</svg>"));
});
