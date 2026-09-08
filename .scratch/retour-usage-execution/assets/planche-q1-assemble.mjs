// Assemble planche-q1-lensblur.html (autonome, images en dataURL) depuis les PNG
// q1-*.png et q1-manifest.json produits par planche-q1-lensblur-render.mjs.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
const DIR = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const b = (f) => { const p = path.join(DIR, f); return existsSync(p) ? "data:image/png;base64," + readFileSync(p).toString("base64") : null; };
const man = JSON.parse(readFileSync(path.join(DIR, "q1-manifest.json"), "utf8"));

const VARIANTES = [
  { id: "defaut", label: "Défaut — lames 0 (diaphragme rond)" },
  { id: "blades6", label: "Lames 6 (hexagone)" },
  { id: "blades6-rot30", label: "Lames 6 + orientation 30°" },
  { id: "blades6-curv", label: "Lames 6 + courbure 0,6" },
  { id: "boost0", label: "Intensité bokeh 0 — gaussien, il lave" },
  { id: "boost6", label: "Intensité bokeh 6 (défaut)" },
  { id: "iris", label: "Champ Iris — étendue nette 0,3" },
];
const SCENES = [
  { id: "grille", titre: "Scène A — mireBokeh (points isolés, teintes et rayons variés)", crop: "un point blanc (colonne r=3)" },
  { id: "nuit", titre: "Scène B — nuit urbaine synthétique (points brillants + immeubles de ton moyen)", crop: "le point blanc HERO isolé" },
];
const leg = (st) => st ? `moyenne ${st.moyenne} &middot; écart-type ${st.ecartType}` : "&mdash;";

const blocScene = (sc) => {
  let rows = "";
  for (const v of VARIANTES) {
    const full = b(`q1-${sc.id}-${v.id}.png`);
    const crop = b(`q1-${sc.id}-${v.id}-crop.png`);
    rows += `<tr><th>${v.label}</th>
      <td>${full ? `<img class="vig" src="${full}"><div class="leg">${leg(man[sc.id]?.[v.id])}</div>` : "&mdash;"}</td>
      <td>${crop ? `<img class="crop" src="${crop}"><div class="croplbl">crop 1:1 &mdash; ${sc.crop}</div>` : "&mdash;"}</td></tr>`;
  }
  return `<section><h2>${sc.titre}</h2>
    <table><thead><tr><th></th><th>vignette réduite (vue d'ensemble)</th><th>crop 1:1 (le bokeh, phénomène par point)</th></tr></thead>
    <tbody>${rows}</tbody></table></section>`;
};

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<title>Planche Q1 &mdash; lensBlur, le bokeh se lit sur les points</title>
<style>
  body { font-family: system-ui, sans-serif; background:#14161a; color:#e8eaed; margin:0; padding:24px; }
  h1 { font-size:20px; } h2 { font-size:15px; border-bottom:1px solid #333; padding-bottom:6px; margin-top:30px; }
  .intro, .note { max-width:1080px; line-height:1.55; font-size:13px; color:#c8ccd2; }
  .intro b, .note b { color:#fff; }
  .note { margin:8px 0 0; padding:10px 12px; background:#1b1e24; border-left:3px solid #3a4250; font-size:12px; }
  table { border-collapse:collapse; margin-top:10px; }
  th { font-size:12px; font-weight:600; text-align:left; padding:6px 10px; color:#c2c7ce; vertical-align:middle; max-width:230px; }
  thead th { text-align:center; color:#e8eaed; }
  td { padding:8px; text-align:center; vertical-align:top; border:1px solid #23262c; }
  img.vig { display:block; width:320px; height:auto; background:#000; }
  img.crop { display:block; width:256px; height:256px; image-rendering:pixelated; background:#000; outline:1px solid #3a3f47; }
  .leg { font-size:11px; color:#9aa0a8; margin-top:3px; }
  .croplbl { font-size:10px; color:#7b818a; margin-top:4px; }
</style></head><body>
<h1>Planche Q1 &mdash; lensBlur : le bokeh ne se lit que sur des points lumineux</h1>
<div class="intro">
<p>Prototype jetable, aucun commit (rendu par un Renderer offscreen via l'iframe du harnais ; modules servis depuis le disque).
Rayon 24 px partout, seuil des hautes lumières au défaut (0,6). Chaque vignette porte moyenne / écart-type de luminance
(écart-type &gt;&gt; 1 = capture non aplat). Les crops sont à l'échelle 1:1 (pixels natifs, agrandis sans interpolation) :
une tache de bokeh est un phénomène <b>par point</b> &mdash; réduite, elle redevient du flou indistinct.</p>
<p class="note"><b>Ce qu'il faut regarder.</b> La forme du diaphragme (rond &rarr; hexagone), son orientation, sa courbure et
l'intensité du bokeh ne se manifestent que sur les <b>points brillants isolés</b> : c'est là, dans le crop, que l'hexagone
apparaît et tourne. Sur les immeubles de ton moyen (scène B) et partout où il n'y a pas de haute lumière, tous ces réglages
rendent le même flou &mdash; d'où l'impression, sur une photo sans hautes lumières isolées, que &laquo; c'est juste flou peu
importe les réglages &raquo;. La paire &laquo; intensité 0 vs 6 &raquo; est celle qui explique l'effet : à 0 le flou est une
simple moyenne (un gaussien qui lave), à 6 la haute lumière pèse davantage et la tache se détache. Aucune conclusion n'est
tirée ici &mdash; les images sont posées pour être jugées.</p>
</div>
${SCENES.map(blocScene).join("\n")}
<div class="note">Note de fabrication : les vignettes réduites servent la vue d'ensemble (masses) ; le jugement de la forme du
bokeh se fait sur les crops 1:1. Scène A = mireBokeh canonique de <code>scripts/render-check.mjs</code>. Scène B = mire
synthétique construite dans le script de rendu (fond sombre, immeubles de ton moyen, lumières blanches saturées / chaudes /
froides, un point blanc HERO très isolé pour le crop).</div>
</body></html>`;
const outFile = path.join(DIR, "planche-q1-lensblur.html");
writeFileSync(outFile, html, "utf8");
console.log("écrit " + outFile + " (" + (html.length / 1024).toFixed(0) + " Ko)");
