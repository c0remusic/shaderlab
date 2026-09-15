// Planche ASSEMBLE 02b (parite Lightroom du module reglagesDeBase) : construit
// planche-02b-reglages.html a partir des PNG et de reglages02b-stats.json ecrits
// par planche-02b-rendu.mjs. HTML et PNG ne sont PAS versionnes (regenerables) ;
// ce script l'est.
// Usage : node planche-02b-assemble.mjs
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stats = JSON.parse(readFileSync(path.join(OUT, "reglages02b-stats.json"), "utf-8"));

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

let body = "";
for (const [tag, ph] of Object.entries(stats.photos)) {
  body += `<h2>Photo ${tag} — ${esc(path.basename(ph.file))} <span class="dims">${ph.frameW}×${ph.frameH} (EXIF ${ph.exifOk ? "OK" : "DIVERGENT"})</span></h2>`;
  body += `<div class="crop-note">Vignette = image entiere (le voile se juge en masse) ; crop 1:1 (256 px natif) : ${esc(ph.crop.label)} @ (${ph.crop.x}, ${ph.crop.y})</div>`;
  body += `<div class="row">`;
  for (const col of ph.cols) {
    body += `<div class="col">
      <div class="label">${esc(col.label)}</div>
      <img class="vign" src="reglages02b-${tag}-col${col.i}-vign.png" alt="${esc(col.key)}">
      <img class="crop" src="reglages02b-${tag}-col${col.i}-crop.png" alt="${esc(col.key)} crop">
      <div class="stat">moy ${col.mean.toFixed(1)} · σ ${col.std.toFixed(1)}</div>
    </div>`;
  }
  body += `</div>`;
}

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Planche 02b — Reglages de base (parite Lightroom)</title>
<style>
  body { background: #1a1a1a; color: #ddd; font: 13px/1.4 system-ui, sans-serif; margin: 0; padding: 24px; }
  .banner { background: #2b2b2b; border: 1px solid #444; border-radius: 6px; padding: 14px 18px; margin-bottom: 20px; font-size: 14px; }
  .banner b { color: #fff; }
  h2 { font-size: 16px; margin: 28px 0 4px; }
  .dims { font-weight: normal; color: #888; font-size: 12px; }
  .crop-note { color: #999; font-size: 12px; margin-bottom: 10px; }
  .row { display: flex; gap: 12px; overflow-x: auto; padding-bottom: 12px; }
  .col { flex: 0 0 auto; width: 320px; }
  .label { font-size: 12px; margin-bottom: 4px; min-height: 30px; color: #cfcfcf; }
  img.vign { width: 320px; display: block; background: #000; }
  img.crop { width: 128px; height: 128px; image-rendering: pixelated; display: block; margin-top: 4px; border: 1px solid #333; }
  .stat { color: #999; font-size: 11px; margin-top: 4px; }
</style></head><body>
<div class="banner"><b>Parite Lightroom du module Reglages de base</b> — trois divergences prouvees de l'audit binaire 09, corrigees :
<b>Voile</b> (composante globale : LR estime un canal sombre, notre voile local etait inerte sur un ton plat — la brume doit VOILER) ·
<b>Balance des blancs</b> (espace camera sans renormalisation : les DEUX extremes de temperature eclaircissent) ·
<b>Blancs / Noirs</b> (portes par la luminance floutee sBlur, locaux comme LR). Comparer a Lightroom aux memes valeurs.</div>
${body}
</body></html>`;

writeFileSync(path.join(OUT, "planche-02b-reglages.html"), html);
console.log("planche-02b-reglages.html ecrit");
