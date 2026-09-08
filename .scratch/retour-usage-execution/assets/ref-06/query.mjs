// Interroge l'API Wikimedia Commons. Zero dep.
//   node query.mjs "search term" [limit]   -> recherche plein-texte (bitmap only)
//   node query.mjs --cat "Category name" [limit] -> membres d'une categorie
const args = process.argv.slice(2);
let params;
if (args[0] === "--cat") {
  const cat = args[1]; const limit = args[2] || 20;
  params = {
    action: "query", format: "json", generator: "categorymembers",
    gcmtitle: "Category:" + cat, gcmtype: "file", gcmlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1600",
  };
} else {
  const term = args[0]; const limit = args[1] || 12;
  params = {
    action: "query", format: "json", generator: "search",
    gsrsearch: term + " filetype:bitmap", gsrnamespace: "6", gsrlimit: String(limit),
    prop: "imageinfo", iiprop: "url|size|extmetadata|mime", iiurlwidth: "1600",
  };
}
const url = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams(params);
const r = await fetch(url, { headers: { "User-Agent": "shaderlab-refboard/1.0 (research; contact rawrnie@gmail.com)" } });
const j = await r.json();
const pages = j?.query?.pages ? Object.values(j.query.pages) : [];
for (const p of pages) {
  const ii = p.imageinfo?.[0];
  if (!ii) continue;
  const em = ii.extmetadata || {};
  const lic = em.LicenseShortName?.value || "?";
  const artist = (em.Artist?.value || "?").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim().slice(0, 70);
  console.log(JSON.stringify({
    title: p.title, w: ii.width, h: ii.height, mime: ii.mime,
    lic, artist,
    thumb: ii.thumburl, full: ii.url,
    descurl: ii.descriptionurl,
  }));
}
