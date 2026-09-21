import { renderBadgeSvg, renderEmptyBadgeSvg } from "./lib/vbadge-svg.mjs";

// Live embeddable validator badge: /badge/NodeID-….svg
// Reads the same node payload as the profile page so it never disagrees with
// it. Short public cache; an unknown node still returns an SVG (images cannot
// follow a redirect gracefully in a README).

const HEAD = { "content-type": "image/svg+xml; charset=utf-8", "access-control-allow-origin": "*" };

var vbadge_default = async (req) => {
  const url = new URL(req.url);
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
  const m = url.pathname.match(/^\/badge\/(NodeID-[A-Za-z0-9]+)\.svg$/);
  if (!m) return new Response(renderEmptyBadgeSvg("badge/NodeID-….svg"), { status: 404, headers: Object.assign({ "cache-control": "public, max-age=60" }, HEAD) });
  try {
    const data = await fetch(site + "/api/validators?node=" + encodeURIComponent(m[1]), { signal: AbortSignal.timeout(8e3) }).then((r) => r.json());
    if (!data || data.none || !data.node) return new Response(renderEmptyBadgeSvg("no current validator " + m[1].slice(0, 13) + "…"), { status: 200, headers: Object.assign({ "cache-control": "public, max-age=300" }, HEAD) });
    // one render per 5 minutes at the edge instead of one per README view; no stale serving, the badge is live
    return new Response(renderBadgeSvg(data), { headers: Object.assign({ "cache-control": "public, max-age=300", "netlify-cdn-cache-control": "public, durable, max-age=300" }, HEAD) });
  } catch {
    return new Response(renderEmptyBadgeSvg("p-chain unreachable — retry"), { status: 200, headers: Object.assign({ "cache-control": "public, max-age=60" }, HEAD) });
  }
};
var config = { path: "/badge/*" };
export { config, vbadge_default as default };
