// Planche ASSEMBLE du ticket 05 (module hsl) : construit planche-05-hsl.html a
// partir des PNG et de hsl-stats.json ecrits par planche-05-hsl-rendu.mjs. HTML et
// PNG ne sont PAS versionnes (regenerables) ; ce script l'est.
// Usage : node planche-05-hsl-assemble.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stats = JSON.parse(readFileSync(path.join(OUT, "hsl-stats.json"), "utf-8"));

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

let body = "";
for (const [tag, ph] of Object.entries(stats.photos)) {
  body += `<h2>Photo ${tag} — ${esc(path.basename(ph.file))} <span class="dims">${ph.frameW}×${ph.frameH} (EXIF ${ph.exifOk ? "OK" : "DIVERGENT"})</span></h2>`;
  body += `<div class="crop-note">Crop 1:1 (256 px natif) : ${esc(ph.crop.label)} @ (${ph.crop.x}, ${ph.crop.y}) — la Saturation de l'orange se juge sur la peau ICI</div>`;
  body += `<div class="row">`;
  for (const col of ph.cols) {
    body += `<div class="col">
      <div class="label">${esc(col.label)}</div>
      <img class="vign" src="hsl-${tag}-col${col.i}-vign.png" alt="${esc(col.key)}">
      <img class="crop" src="hsl-${tag}-col${col.i}-crop.png" alt="${esc(col.key)} crop">
      <div class="stat">moy ${col.mean.toFixed(1)} · σ ${col.std.toFixed(1)}</div>
      <div class="md5">${col.md5vign.slice(0, 8)} / ${col.md5crop.slice(0, 8)}</div>
    </div>`;
  }
  body += `</div>`;
}

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Planche 05 — HSL / Couleur / Noir et blanc</title>
<style>
  body { background: #1a1a1a; color: #ddd; font: 13px/1.4 system-ui, sans-serif; margin: 0; padding: 24px; }
  .banner { background: #2b2b2b; border: 1px solid #444; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; font-size: 15px; }
  .banner b { color: #fff; }
  .prov { color: #d9a441; }
  h2 { font-size: 16px; margin: 28px 0 4px; }
  .dims { font-weight: normal; color: #888; font-size: 12px; }
  .crop-note { color: #999; font-size: 12px; margin-bottom: 10px; }
  .row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px; }
  .col { flex: 0 0 auto; width: 320px; background: #222; border: 1px solid #383838; border-radius: 5px; padding: 8px; }
  .label { font-weight: 600; color: #fff; margin-bottom: 6px; min-height: 2.4em; }
  img.vign { width: 100%; display: block; border-radius: 3px; }
  img.crop { width: 256px; height: 256px; image-rendering: pixelated; display: block; margin: 6px auto 0; border: 1px solid #444; }
  .stat { color: #bbb; font-size: 12px; margin-top: 6px; }
  .md5 { color: #666; font-size: 11px; font-family: ui-monospace, monospace; }
</style></head><body>
<div class="banner"><b>Compare à ton Lightroom, mêmes valeurs.</b> Panneau TSL / Couleur / Noir et blanc, curseurs aux valeurs indiquées. Le témoin est la photo sans réglage. Une bande sélectionne une teinte (produit scalaire OKLab, sans atan2) et un gris ne bouge pas. <span class="prov">Table de bandes PROVISOIRE (centres/largeurs/amplitudes usuels de Lightroom, pas encore mesurés) — c'est justement ce que cette planche sert à juger.</span></div>
${body}
</body></html>`;

writeFileSync(path.join(OUT, "planche-05-hsl.html"), html);
console.log("ecrit planche-05-hsl.html");
