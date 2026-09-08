// Telecharge un sous-ensemble des candidats (par index de la liste unique) en 1600px.
// Usage: node download.mjs 3 5 7 ...
import { writeFileSync, readFileSync } from "node:fs";
const seen = new Map();
for (const l of readFileSync("candidates.jsonl", "utf8").trim().split("\n")) {
  if (!l) continue;
  try { const o = JSON.parse(l); if (o.mime !== "image/jpeg" && o.mime !== "image/png") continue; if (!seen.has(o.title)) seen.set(o.title, o); } catch {}
}
const list = [...seen.values()];
const idxs = process.argv.slice(2).map(Number);
const UA = { "User-Agent": "shaderlab-refboard/1.0 (research; contact rawrnie@gmail.com)" };
const manifest = [];
for (const i of idxs) {
  const o = list[i];
  if (!o) { console.log(`?? index ${i} absent`); continue; }
  // thumb = 1600px scaled JPEG (meme pour les .png/.tiff -> Commons rend du jpeg)
  let src = o.thumb;
  // Nettoie les params utm mais garde le chemin de rendu
  const url = src;
  const slug = `r${String(i).padStart(2, "0")}_` + o.title.replace(/^File:/, "").replace(/\.[a-z]+$/i, "").replace(/[^a-zA-Z0-9]+/g, "-").slice(0, 40);
  const res = await fetch(url, { headers: UA });
  if (!res.ok) { console.log(`FAIL ${i} ${res.status} ${o.title}`); continue; }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `raw/${slug}.jpg`;
  writeFileSync(file, buf);
  manifest.push({ idx: i, file, title: o.title, origW: o.w, origH: o.h, lic: o.lic, artist: o.artist, descurl: o.descurl, bytes: buf.length });
  console.log(`OK ${i} ${(buf.length/1024|0)}KB ${file}`);
}
writeFileSync("manifest.json", JSON.stringify(manifest, null, 2));
console.log(`\n${manifest.length} images -> manifest.json`);
