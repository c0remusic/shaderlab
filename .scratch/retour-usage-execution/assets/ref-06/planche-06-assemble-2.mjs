// Assemble la planche de mecanisme 2 du ticket 06 (aquarelle v2 ADVECTION) a partir
// des PNG aq2-col*.png et de aq2-stats.json rendus par planche-06-rendu-2.mjs. La
// colonne 8 RAPPELLE la col. 4 de la planche 1 (v1 rejetee) via aq-col4-*.png +
// aq-stats.json, etiquetee pour la comparaison cote a cote. Une seule photo
// (vram-test = 4 copies identiques). Deux echelles : vignette (par masses) + crop
// 1:1 (par pixel), au meme point (2496,2496) que la planche 1.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stats = JSON.parse(readFileSync(path.join(OUT, "aq2-stats.json"), "utf8"));
const stats1 = JSON.parse(readFileSync(path.join(OUT, "aq-stats.json"), "utf8"));
const v1col = stats1.cols.find((c) => c.key === "dentelle") ?? stats1.cols[4];
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const fr = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");

const META = {
  temoin:     ["0 · Témoin", "La photo nue, aucun effet.", "Le repère de départ — frontières nettes, grain de la source."],
  advection:  ["1 · Advection seule (Moyenne) — LE NAÏF", "Le pigment est porté par un curl noise (7 passes). Tout mouillé, mélange arithmétique, ni front ni lavis.", "Vignette : la couleur file en streaks DIRIGÉS le long du flux, pas un flou rond. C'est le témoin de ce mécanisme."],
  absorbance: ["2 · + Absorbance", "Même chose, mélange géométrique (absorbance) au lieu de la moyenne.", "À mouillé plein les deux modes valent l'advectée ; seul l'éclaircissement (bloom) diffère ici. Le mode se lit sur les PLAGES (col. 3+)."],
  plages:     ["3 · + Plages mouillées", "Le mouillé tombe à 0,6 : la bave est par plages, le reste net. Front sans assombrissement.", "Vignette : des plaques nettes réapparaissent (champ de mouillé), frontière dentelée."],
  front:      ["4 · + Front de pigment", "Le pigment s'accumule au bord des plages (backrun) : assombrit et sature une bande.", "Crop : un liseré sombre et saturé le long du bord (pooling)."],
  dentelle:   ["5 · + Dentelle du front", "Front et bords de plages découpés par un bruit haute fréquence.", "Crop : le liseré éclate en anneaux / cellules irréguliers (backrun)."],
  lavis:      ["6 · + Lavis", "La 1re passe abstrait la source en aplats (quantif. douce + désaturation des mi-tons).", "Vignette : les tons se regroupent en bandes plus plates avant de baver."],
  portee2x:   ["7 · Portée ×2 (bave massive)", "La portée de la bave double (flow 8→16). Idem col. 5.", "Vignette : la couleur file beaucoup plus loin, les formes se dissolvent en langues."],
  v1:         ["8 · v1 REJETÉE (rappel)", "Ancien mécanisme (planche 1, col. 4) : flou pyramidal isotrope + ondulation + front par gradient.", "Côte à côte : flou rond, bord assombri, la silhouette vire au gris-brun. Le mécanisme à BATTRE."],
};

const MODE = ["Absorbance", "Moyenne"];
const ligneParams = (p) => {
  if (!p) return "photo nue";
  return `portée ${p.flow}px · fibres ${fr(p.fibers, 2)} · mouillé ${fr(p.wetness, 1)} · front ${fr(p.edgeDarkening, 1)} (lgr ${p.frontWidth}px) · dentelle ${fr(p.lace, 1)} · lavis ${fr(p.wash, 1)} · ${MODE[p.mode]}`;
};

// Colonnes 0-7 (v2) + une 9e carte : rappel v1.
const carte = (titre, change, regarder, vignName, cropName, reglages, mesure) => `
    <article class="col">
      <h2>${titre}</h2>
      <p class="change">${change}</p>
      <figure class="vign">
        <img src="data:image/png;base64,${b64(vignName)}" alt="${titre} — vignette">
        <figcaption>Vignette (par masses)</figcaption>
      </figure>
      <figure class="crop">
        <img src="data:image/png;base64,${b64(cropName)}" alt="${titre} — crop 1:1">
        <figcaption>Crop 1:1 — 256px natifs (par pixel)</figcaption>
      </figure>
      <p class="regarder"><span>Regarder :</span> ${regarder}</p>
      <p class="reglages">${reglages}</p>
      <p class="mesure">${mesure}</p>
    </article>`;

const cartes = stats.cols.map((c) => {
  const [titre, change, regarder] = META[c.key];
  const mesure = `moy ${fr(c.mean)} · écart ${fr(c.std)} · <b>noirs ${fr(c.dark10)}</b><br>md5 vign ${c.md5vign.slice(0, 8)}<br>md5 crop ${c.md5crop.slice(0, 8)}`;
  return carte(titre, change, regarder, `aq2-col${c.i}-vign.png`, `aq2-col${c.i}-crop.png`, ligneParams(c.params), mesure);
});
// carte v1
{
  const [titre, change, regarder] = META.v1;
  const mesure = `moy ${fr(v1col.mean)} · écart ${fr(v1col.std)} · noirs —<br>md5 vign ${v1col.md5vign.slice(0, 8)}<br>md5 crop ${v1col.md5crop.slice(0, 8)}`;
  cartes.push(carte(titre, change, regarder, "aq-col4-vign.png", "aq-col4-crop.png", "v1 · flou pyramidal (planche 1, col. 4)", mesure));
}

const dmin = fr(Math.min(...stats.cols.map((c) => c.dark10)));
const dmax = fr(Math.max(...stats.cols.map((c) => c.dark10)));

const html = `<title>Aquarelle v2 — planche de mécanisme 2</title>
<style>
  :root { --fond:#15161a; --carte:#1e2026; --filet:#2c2e35; --texte:#e8e6e1;
    --sourd:#9a9891; --accent:#d9a441; --pointe:#8fae7a; }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3","Segoe UI",sans-serif; font-size:15px; line-height:1.5; }
  main { padding: 32px 24px 72px; }
  h1 { font-family:"Archivo","Segoe UI",sans-serif; font-size:28px; margin:0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 92ch; margin: 0 0 4px; }
  .chapeau b { color: var(--texte); }
  .bandeau { border-left: 3px solid var(--pointe); background: var(--carte);
    padding: 12px 16px; margin: 18px 0 8px; max-width: 92ch; }
  .bandeau strong { color: var(--pointe); }
  .rail { display: flex; gap: 16px; overflow-x: auto; padding: 18px 2px 8px; align-items: start; }
  .col { flex: 0 0 300px; background: var(--carte); border: 1px solid var(--filet);
    border-radius: 6px; padding: 12px; }
  .col h2 { font-family:"Archivo","Segoe UI",sans-serif; font-size:15px; margin:0 0 4px; text-wrap:balance; }
  .change { color: var(--sourd); font-size:13px; margin:0 0 10px; min-height:4.4em; }
  figure { margin: 0 0 10px; }
  .vign img { display:block; width:100%; height:auto; border-radius:3px; background:#000; }
  .crop img { display:block; width:256px; max-width:100%; height:auto; image-rendering: pixelated;
    border-radius:3px; background:#000; margin: 0 auto; }
  figcaption { color: var(--sourd); font-size:11px; margin-top:4px;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .regarder { font-size:13px; margin:8px 0; }
  .regarder span { color: var(--accent); font-weight:600; }
  .reglages { color: var(--sourd); font-size:11.5px; margin:6px 0 4px;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .mesure { color: var(--sourd); font-size:11px; margin:0;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .mesure b { color: var(--texte); }
  .piednote { color: var(--sourd); font-size:12.5px; margin-top:26px; max-width: 92ch; }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<main>
  <h1>Aquarelle v2 « ADVECTION » — planche de mécanisme 2</h1>
  <p class="chapeau">Ticket 06. Nouveau mécanisme, après le REJET de la v1 (« plutôt moche », flou
  isotrope + bord assombri, la silhouette virait au gris-brun). Ici le pigment est <b>porté par
  l'eau</b> — 7 passes d'advection le long d'un <b>curl noise</b> (flux sans divergence), pas un flou
  rond. Chaque colonne AJOUTE un facteur au précédent (ablation) ; la col. 1 est le naïf de CE
  mécanisme, la col. 8 rappelle la v1 rejetée pour comparer côte à côte. Pipeline réel, pleine
  résolution (${stats.native}px natifs), non commité.</p>
  <p class="chapeau">Deux échelles par colonne : la <b>vignette</b> juge la BAVE (par masses), le
  <b>crop 1:1</b> juge le FRONT et la dentelle (par pixel), fixe d'une colonne à l'autre (frontière
  lame d'agave / ciel). La mesure <b>noirs</b> = luminance moyenne des 10 % de pixels les plus
  sombres du témoin, à ces MÊMES positions : plus le chiffre est bas, plus la silhouette noire est
  préservée (témoin = 0, tout reste entre ${dmin} et ${dmax} sur 255).</p>
  <div class="bandeau"><strong>Pointez la colonne préférée — ou « aucune »</strong> : celle dont la
  bave et le bord ressemblent le plus à ce que l'effet doit faire (wet-on-wet, réf. A). Le design du
  mécanisme se fige APRÈS votre pointage. Aucun verdict n'est porté ici.</div>
  <div class="rail">
${cartes.join("\n")}
  </div>
  <p class="piednote">Une seule photo : les quatre <code>photo-N.jpg</code> de vram-test ont le même
  md5. Le grain fin dans les orange vient de la <b>SOURCE</b> (~12 niveaux luma, posé à l'export),
  PAS de l'effet — visible dès le crop du témoin (col. 0). Écart-type de luminance
  ${fr(Math.min(...stats.cols.map((c) => c.std)))} à ${fr(Math.max(...stats.cols.map((c) => c.std)))}
  (aucun aplat), tous les md5 distincts. À mouillé plein (col. 1 vs 2) le mélange vaut l'advectée
  dans les deux modes — mix(a,b,1)=b des deux côtés — donc Moyenne et Absorbance n'y diffèrent que
  par l'éclaircissement ; leur vraie différence est sur les plages partielles (col. 3+). Prototype du
  ${new Date().toISOString().slice(0, 10)}, aquarelle.ts NON commité. Scripts : ref-06/planche-06-*-2.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-06-mecanisme-2.html"), html);
console.log("ecrit planche-06-mecanisme-2.html (" + html.length + " octets)");
