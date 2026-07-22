import * as PImage from "pureimage";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

// Shareable P-chain Validator Card (PNG). Mirrors card.mjs's pureimage pipeline
// but pulls its data from /api/validators?node=… (on-chain stats + auto-badges +
// lifetime history + any profile record), so it stays in lockstep with the page.
// Route: /vcard/NodeID-….png — the og:image for a validator profile page.

var fontsReady = null;
function loadFonts() {
  if (!fontsReady) {
    fontsReady = Promise.all([
      PImage.registerFont(fileURLToPath(new URL("./assets/DejaVuSansMono.ttf", import.meta.url)), "Mono").load(),
      PImage.registerFont(fileURLToPath(new URL("./assets/DejaVuSansMono-Bold.ttf", import.meta.url)), "MonoB").load()
    ]);
  }
  return fontsReady;
}

const BADGE_NAMES = {
  flawless: "FLAWLESS", heavyweight: "HEAVYWEIGHT", magnet: "MAGNET", trusted: "TRUSTED",
  generous: "GENEROUS", committed: "COMMITTED", solo: "SOLO", seasons: "SEASONS",
  elder: "ELDER", founding: "FOUNDING", builder: "BUILDER", educator: "EDUCATOR",
  pillar: "COMMUNITY PILLAR", streaker: "STREAKER"
};

const nf = (n) => (n == null || !isFinite(n)) ? "—" : Math.round(Number(n)).toLocaleString("en-US");
function usd(avax, px) {
  if (px == null || avax == null || !isFinite(avax)) return "";
  const v = avax * px;
  if (v >= 1e9) return "$" + (v / 1e9).toFixed(2) + "B";
  if (v >= 1e6) return "$" + (v / 1e6).toFixed(2) + "M";
  if (v >= 1e3) return "$" + (v / 1e3).toFixed(1) + "K";
  return "$" + Math.round(v).toLocaleString("en-US");
}
const shortNode = (id) => { id = String(id || ""); return id.length > 24 ? id.slice(0, 15) + "…" + id.slice(-6) : id; };
const dateStr = (sec) => sec ? new Date(sec * 1000).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).toUpperCase() : "—";

function draw(data) {
  const d = data.node, px = data.avaxUsd, hist = data.history, prof = data.profile;
  const W = 1200, H = 630;
  const img = PImage.make(W, H);
  const x = img.getContext("2d");
  x.fillStyle = "#0a0a0a"; x.fillRect(0, 0, W, H);
  x.strokeStyle = "#e84142"; x.lineWidth = 5; x.strokeRect(20, 20, W - 40, H - 40);
  x.strokeStyle = "#2a2a2a"; x.lineWidth = 2; x.strokeRect(34, 34, W - 68, H - 68);

  const L = 76;
  x.fillStyle = "#7a7a7a"; x.font = "22px Mono";
  x.fillText("AVALANCHE P-CHAIN \xB7 VALIDATOR", L, 86);

  const handle = (prof && prof.handle) || shortNode(d.nodeID);
  x.fillStyle = "#e84142"; x.font = "64px MonoB";
  x.fillText(handle.length > 20 ? handle.slice(0, 20) : handle, L, 156);

  x.fillStyle = "#7a7a7a"; x.font = "18px Mono";
  x.fillText(shortNode(d.nodeID), L, 188);

  // badge names line (top 3)
  const names = (data.badges || []).slice(0, 3).map((b) => BADGE_NAMES[b.id] || b.id.toUpperCase());
  if (names.length) { x.fillStyle = "#e84142"; x.font = "18px MonoB"; x.fillText(names.join("  \xB7  "), L, 224); }

  x.fillStyle = "#2a2a2a"; x.fillRect(L, 248, W - 2 * L, 2);

  function cell(k, v, cx, cy, big) {
    x.fillStyle = "#7a7a7a"; x.font = "18px Mono"; x.fillText(k, cx, cy);
    x.fillStyle = big ? "#e84142" : "#f2f2f2"; x.font = big ? "36px MonoB" : "31px MonoB";
    x.fillText(v, cx, cy + (big ? 40 : 36));
  }
  const R = 646;
  cell("OWN STAKE", nf(d.stake) + " AVAX", L, 300, true);
  cell("STAKE RANK", "#" + nf(data.rank) + " of " + nf(data.count), L, 400);
  cell(hist && hist.firstStart ? "FIRST VALIDATED" : "VALIDATING SINCE",
    dateStr(hist && hist.firstStart ? hist.firstStart : d.startTime) + (hist && hist.seasons > 1 ? "  \xB7  " + hist.seasons + " SEASONS" : ""), L, 476);

  cell("UPTIME", d.uptime != null ? (d.uptime * 100).toFixed(2) + "%" : "—", R, 300);
  cell("FEE", d.feePct != null ? d.feePct.toFixed(0) + "%" : "—", R + 260, 300);
  cell("DELEGATED", nf(d.delegated) + " AVAX", R, 400);
  const lifetime = hist && hist.lifetimeRewards > 0;
  const rew = lifetime ? hist.lifetimeRewards : d.potentialReward;
  const ru = usd(rew, px);
  cell(lifetime ? "LIFETIME REWARDS" : "POTENTIAL REWARD", nf(rew) + " AVAX" + (ru ? "  \xB7  " + ru : ""), R, 476, true);

  x.fillStyle = "#2a2a2a"; x.fillRect(L, 556, W - 2 * L, 2);
  x.fillStyle = "#7a7a7a"; x.font = "18px Mono";
  x.fillText(prof && prof.tier ? "TIER " + String(prof.tier).toUpperCase() + " VALIDATOR" : "PRIMARY NETWORK VALIDATOR", L, 588);
  x.fillStyle = "#e84142"; x.font = "18px MonoB";
  const tag = "AVAX100M.XYZ \xB7 P-CHAIN";
  x.fillText(tag, W - L - tag.length * 11, 588);
  return img;
}

async function toPng(img) {
  const s = new PassThrough(); const chunks = [];
  const done = new Promise((res, rej) => {
    s.on("data", (c) => chunks.push(c));
    s.on("end", () => res(Buffer.concat(chunks)));
    s.on("error", rej);
  });
  await PImage.encodePNGToStream(img, s);
  return done;
}

var vcard_default = async (req) => {
  const url = new URL(req.url);
  const site = (process.env.URL || "https://avax100m.xyz").replace(/\/$/, "");
  const m = url.pathname.match(/^\/vcard\/(NodeID-[A-Za-z0-9]+)\.png$/);
  if (!m) return Response.redirect(site + "/og.png", 302);
  try {
    await loadFonts();
    const data = await fetch(site + "/api/validators?node=" + encodeURIComponent(m[1])).then((r) => r.json());
    if (!data || data.none || !data.node) return Response.redirect(site + "/og.png", 302);
    const png = await toPng(draw(data));
    return new Response(png, { headers: { "content-type": "image/png", "cache-control": "public, max-age=3600" } });
  } catch {
    return Response.redirect(site + "/og.png", 302);
  }
};
var config = { path: "/vcard/*" };
export {
  config,
  vcard_default as default
};
