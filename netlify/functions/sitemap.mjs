import { getStore } from "@netlify/blobs";

// src/sitemap.js
var SITE = "https://avax100m.xyz";
var sitemap_default = async () => {
  const urls = [SITE + "/", SITE + "/c-chain", SITE + "/p-chain", SITE + "/cohort"];
  try {
    const cs = getStore("claim");
    let cursor;
    let pages = 0;
    do {
      const res = await cs.list({ prefix: "c/", cursor });
      for (const b of res.blobs || []) {
        const a = b.key.slice(2);
        if (/^0x[0-9a-f]{40}$/.test(a)) urls.push(SITE + "/w/" + a);
      }
      cursor = res.cursor;
      pages++;
    } while (cursor && urls.length < 5e3 && pages < 10);
  } catch {
  }
  const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.map((u) => "<url><loc>" + u + "</loc></url>").join("\n") + "\n</urlset>";
  return new Response(xml, { headers: { "content-type": "application/xml", "cache-control": "public, max-age=3600" } });
};
var config = { path: "/sitemap.xml" };
export {
  config,
  sitemap_default as default
};
