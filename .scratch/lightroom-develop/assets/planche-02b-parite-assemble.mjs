// Planche ASSEMBLE du ticket 06 (module colorGrading) : construit planche-02b-parite.html a
// partir des PNG et de parite02b-stats.json ecrits par planche-02b-parite-rendu.mjs. HTML et
// PNG ne sont PAS versionnes (regenerables) ; ce script l'est.
// Usage : node planche-02b-parite-assemble.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stats = JSON.parse(readFileSync(path.join(OUT, "parite02b-stats.json"), "utf-8"));

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

let body = "";
for (const [tag, ph] of Object.entries(stats.photos)) {
  body += `<h2>Photo ${tag} — ${esc(path.basename(ph.file))} <span class="dims">${ph.frameW}×${ph.frameH} (EXIF ${ph.exifOk ? "OK" : "DIVERGENT"})</span></h2>`;
  body += `<div class="crop-note">Crop 1:1 (256 px natif) : ${esc(ph.crop.label)} @ (${ph.crop.x}, ${ph.crop.y}) — le teintage des ombres et des hautes lumieres se juge ici en 1:1</div>`;
  body += `<div class="row">`;
  for (const col of ph.cols) {
    body += `<div class="col">
      <div class="label">${esc(col.label)}</div>
      <img class="vign" src="parite02b-${tag}-col${col.i}-vign.png" alt="${esc(col.key)}">
      <img class="crop" src="parite02b-${tag}-col${col.i}-crop.png" alt="${esc(col.key)} crop">
      <div class="stat">moy ${col.mean.toFixed(1)} · σ ${col.std.toFixed(1)}</div>
      <div class="md5">${col.md5vign.slice(0, 8)} / ${col.md5crop.slice(0, 8)}</div>
    </div>`;
  }
  body += `</div>`;
}

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Planche 02b — Voile, balance des blancs, blancs/noirs locaux</title>
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
<div class="banner"><b>Compare à ton Lightroom, mêmes valeurs.</b> Panneau Color Grading, roues aux valeurs indiquées (teinte°/saturation). Témoin = photo sans réglage. Duo = teal-and-orange (ombres bleu 220/60 + hautes lumières orange 40/60), à comparer aussi au même look par Étalonnage. <span class="prov">Calibré sur mesures Lightroom : tons moyens et luminance globale. PROVISOIRE (modélisé, non mesurable dans les exports) : profils ombres/hautes lumières, Fusion, Balance.</span></div>
${body}
</body></html>`;

writeFileSync(path.join(OUT, "planche-02b-parite.html"), html);
console.log("ecrit planche-02b-parite.html");
