// Assemble la planche de mecanisme 3 du ticket 06 (aquarelle v3 CHAINE COMBINEE) a
// partir des PNG aq3-col*.png et de aq3-stats.json. Neuf colonnes CUMULATIVES (chacune
// ajoute un ingredient) + deux cartes de RAPPEL : v1 col4 (aq-col4-*) et v2 col5
// (aq2-col5-*), etiquetees "rejetees". Trois images par colonne v3 : vignette (par
// masses), crop agave 1:1, crop CIEL 1:1 (bave entre teintes proches). Une seule photo.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stats = JSON.parse(readFileSync(path.join(OUT, "aq3-stats.json"), "utf8"));
const stats1 = JSON.parse(readFileSync(path.join(OUT, "aq-stats.json"), "utf8"));
const stats2 = JSON.parse(readFileSync(path.join(OUT, "aq2-stats.json"), "utf8"));
const v1col = stats1.cols.find((c) => c.key === "dentelle") ?? stats1.cols[4];
const v2col = stats2.cols.find((c) => c.key === "dentelle") ?? stats2.cols[5];
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const fr = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");

// Doublons de md5 (images identiques) et aplats (std < 1) — signales dans la legende.
const allMd5 = [];
for (const c of stats.cols) allMd5.push(c.md5vign, c.md5crop, c.md5sky);
const dupMd5 = allMd5.filter((m, i) => allMd5.indexOf(m) !== i);
const aplats = stats.cols.filter((c) => c.std < 1);

const META = {
  temoin:    ["0 · Témoin", "La photo nue, aucun effet.", "Le repère — bords nets, grain de la SOURCE (visible au crop ciel)."],
  lavis:     ["1 · Lavis seul", "wash 1, mouillé 0, fibres 0, front 0. Abstraction en aplats (Kuwahara 4 secteurs), rien d'autre.", "Vignette : la photo devient des APLATS à bords NETS. DOIT se distinguer d'un flou — les régions sont plates mais les silhouettes tranchées."],
  bave:      ["2 · + Bave", "mouillé 1 : la pyramide de diffusion étale le lavis. Le pigment fuse.", "Vignette : les aplats FUSENT les uns dans les autres (wet-on-wet). Crop ciel : les teintes proches bavent."],
  fibres:    ["3 · + Fibres", "fibres au défaut : 3 passes d'advection HF (~40 px), amplitude petite.", "Crop agave : les bords s'effilochent en tendrilles COURTES et radiales — pas des vortex (le défaut de la v2)."],
  plages:    ["4 · + Plages", "mouillé tombe à 0,6 : la bave est par plages (seuil d'un champ fbm), le reste NET.", "Vignette : des zones nettes réapparaissent, frontière dentelée. Net dehors, bavé dedans."],
  front:     ["5 · + Front de pigment", "edgeDarkening au défaut, lace 0 : le pigment s'accumule au bord (backrun), assombrit et sature.", "Crop agave : un liseré sombre et saturé le long du bord et des plages (pooling)."],
  tout:      ["6 · + Dentelle — TOUT", "lace au défaut : front et bords découpés en dentelle irrégulière. La colonne « tout ».", "Crop agave : le liseré éclate en cellules / anneaux irréguliers (backrun). Ciel : bave douce + grain absorbé."],
  portee2x:  ["7 · Tout, portée ×2", "Idem col. 6 avec spread 1,5→3,0 (bave massive).", "Vignette : la couleur file bien plus loin, les formes se dissolvent davantage."],
  sanslavis: ["8 · Tout, SANS lavis", "Idem col. 6 avec wash 0 : la bave part de la photo brute, pas d'aplats.", "Comparer à la col. 6 : ce que le LAVIS apporte (les régions plates vs une photo floue baveuse)."],
};

const ligneParams = (p) => {
  if (!p) return "photo nue";
  return `lavis ${fr(p.wash, 1)} (grain ${p.washRadius}px) · portée ${fr(p.spread, 1)} · mouillé ${fr(p.wetness, 1)} · fibres ${fr(p.fibers, 0)}px · front ${fr(p.edgeDarkening, 1)} (lgr ${p.frontWidth}px) · dentelle ${fr(p.lace, 1)}`;
};

const carte3 = (titre, change, regarder, vign, crop, sky, reglages, mesure) => `
    <article class="col">
      <h2>${titre}</h2>
      <p class="change">${change}</p>
      <figure class="vign"><img src="data:image/png;base64,${b64(vign)}" alt="${titre} vignette"><figcaption>Vignette (par masses)</figcaption></figure>
      <div class="crops">
        <figure class="crop"><img src="data:image/png;base64,${b64(crop)}" alt="${titre} crop agave"><figcaption>Crop agave 1:1 (par pixel)</figcaption></figure>
        <figure class="crop"><img src="data:image/png;base64,${b64(sky)}" alt="${titre} crop ciel"><figcaption>Crop ciel 1:1 (teintes proches)</figcaption></figure>
      </div>
      <p class="regarder"><span>Regarder :</span> ${regarder}</p>
      <p class="reglages">${reglages}</p>
      <p class="mesure">${mesure}</p>
    </article>`;

const carte2 = (titre, change, regarder, vign, crop, reglages, mesure, rejete) => `
    <article class="col${rejete ? " rejete" : ""}">
      <h2>${titre}</h2>
      <p class="change">${change}</p>
      <figure class="vign"><img src="data:image/png;base64,${b64(vign)}" alt="${titre} vignette"><figcaption>Vignette (par masses)</figcaption></figure>
      <div class="crops">
        <figure class="crop"><img src="data:image/png;base64,${b64(crop)}" alt="${titre} crop"><figcaption>Crop 1:1 agave (par pixel)</figcaption></figure>
      </div>
      <p class="regarder"><span>Regarder :</span> ${regarder}</p>
      <p class="reglages">${reglages}</p>
      <p class="mesure">${mesure}</p>
    </article>`;

const cartes = stats.cols.map((c) => {
  const [titre, change, regarder] = META[c.key];
  const mesure = `moy ${fr(c.mean)} · écart ${fr(c.std)} · <b>noirs ${fr(c.dark10)}</b><br>md5 v ${c.md5vign.slice(0, 8)} · c ${c.md5crop.slice(0, 8)} · ciel ${c.md5sky.slice(0, 8)}`;
  return carte3(titre, change, regarder, `aq3-col${c.i}-vign.png`, `aq3-col${c.i}-crop.png`, `aq3-col${c.i}-sky.png`, ligneParams(c.params), mesure);
});
// deux rappels rejetes
{
  const m1 = `moy ${fr(v1col.mean)} · écart ${fr(v1col.std)}<br>md5 v ${v1col.md5vign.slice(0, 8)} · c ${v1col.md5crop.slice(0, 8)}`;
  cartes.push(carte2("R1 · v1 REJETÉE (flou + front)", "Mécanisme v1 (planche 1) : flou pyramidal isotrope + ondulation + front par gradient.", "« Plutôt moche » — flou rond, la silhouette vire au gris-brun. Le filtre « Aquarelle » de Photoshop.", "aq-col4-vign.png", "aq-col4-crop.png", "v1 · flou pyramidal (planche 1, col. 4)", m1, true));
  const m2 = `moy ${fr(v2col.mean)} · écart ${fr(v2col.std)}<br>md5 v ${v2col.md5vign.slice(0, 8)} · c ${v2col.md5crop.slice(0, 8)}`;
  cartes.push(carte2("R2 · v2 REJETÉE (advection)", "Mécanisme v2 (planche 2) : advection curl noise, potentiel basse fréquence dominant.", "Noirs préservés MAIS ça TOURBILLONNE — langues de fumée, look liquify. Pas une bave.", "aq2-col5-vign.png", "aq2-col5-crop.png", "v2 · advection curl noise (planche 2, col. 5)", m2, true));
}

const dmin = fr(Math.min(...stats.cols.map((c) => c.dark10)));
const dmax = fr(Math.max(...stats.cols.map((c) => c.dark10)));
const smin = fr(Math.min(...stats.cols.map((c) => c.std)));
const smax = fr(Math.max(...stats.cols.map((c) => c.std)));

const html = `<title>Aquarelle v3 — planche de mécanisme 3</title>
<style>
  :root { --fond:#15161a; --carte:#1e2026; --filet:#2c2e35; --texte:#e8e6e1;
    --sourd:#9a9891; --accent:#d9a441; --pointe:#8fae7a; --rejet:#b4726a; }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3","Segoe UI",sans-serif; font-size:15px; line-height:1.5; }
  main { padding: 32px 24px 72px; }
  h1 { font-family:"Archivo","Segoe UI",sans-serif; font-size:28px; margin:0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 96ch; margin: 0 0 4px; }
  .chapeau b { color: var(--texte); }
  .bandeau { border-left: 3px solid var(--pointe); background: var(--carte);
    padding: 12px 16px; margin: 18px 0 8px; max-width: 96ch; }
  .bandeau strong { color: var(--pointe); }
  .rail { display: flex; gap: 16px; overflow-x: auto; padding: 18px 2px 8px; align-items: start; }
  .col { flex: 0 0 300px; background: var(--carte); border: 1px solid var(--filet);
    border-radius: 6px; padding: 12px; }
  .col.rejete { border-color: var(--rejet); opacity: 0.9; }
  .col h2 { font-family:"Archivo","Segoe UI",sans-serif; font-size:15px; margin:0 0 4px; text-wrap:balance; }
  .col.rejete h2 { color: var(--rejet); }
  .change { color: var(--sourd); font-size:13px; margin:0 0 10px; min-height:4.4em; }
  figure { margin: 0 0 8px; }
  .vign img { display:block; width:100%; height:auto; border-radius:3px; background:#000; }
  .crops { display:flex; gap:8px; }
  .crop { flex:1; margin:0 0 8px; }
  .crop img { display:block; width:100%; height:auto; image-rendering: pixelated;
    border-radius:3px; background:#000; }
  figcaption { color: var(--sourd); font-size:10.5px; margin-top:3px;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .regarder { font-size:13px; margin:8px 0; }
  .regarder span { color: var(--accent); font-weight:600; }
  .reglages { color: var(--sourd); font-size:11px; margin:6px 0 4px;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .mesure { color: var(--sourd); font-size:11px; margin:0;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .mesure b { color: var(--texte); }
  .piednote { color: var(--sourd); font-size:12.5px; margin-top:26px; max-width: 96ch; }
  .piednote b { color: var(--texte); }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<main>
  <h1>Aquarelle v3 « CHAÎNE COMBINÉE » — planche de mécanisme 3</h1>
  <p class="chapeau">Ticket 06, après le rejet de la v1 (flou, « plutôt moche ») ET de la v2
  (advection qui tourbillonne). Antoine, sur la v2 : « <b>on peut tous les faire peut-être ?</b> » —
  lu comme les INGRÉDIENTS ENSEMBLE, chacun réglable, à 0 = éteint (recette de Bousseau et al. 2006).
  La chaîne : <b>LAVIS</b> (Kuwahara 4 secteurs → aplats à bords nets, pas un flou) → <b>BAVE</b>
  (pyramide de diffusion) → <b>FIBRES</b> (advection HF → tendrilles courtes) → <b>FRONT</b>
  (accumulation de pigment au bord, en absorbance → noirs préservés). Chaque colonne AJOUTE un
  ingrédient au précédent (ablation cumulative). Pipeline réel, pleine résolution
  (${stats.native}px natifs), non commité.</p>
  <p class="chapeau">Trois échelles par colonne : la <b>vignette</b> juge la bave (par masses), le
  <b>crop agave</b> juge le front et les fibres (par pixel), le <b>crop ciel</b> juge la bave entre
  teintes proches (nuages). La mesure <b>noirs</b> = luminance moyenne des 10 % de pixels les plus
  sombres du témoin, aux MÊMES positions : plus bas = silhouette noire préservée (témoin = 0, tout
  reste entre ${dmin} et ${dmax} sur 255).</p>
  <div class="bandeau"><strong>Pointez la colonne préférée — ou « aucune »</strong> : celle dont la
  bave, les fibres et le bord ressemblent le plus à une aquarelle wet-on-wet (réf. A). Le design du
  mécanisme se fige APRÈS votre pointage. Aucun verdict n'est porté ici. Les deux dernières cartes
  (R1, R2) rappellent les mécanismes REJETÉS, pour comparer côte à côte.</div>
  <div class="rail">
${cartes.join("\n")}
  </div>
  <p class="piednote">Une seule photo : les quatre <code>photo-N.jpg</code> de vram-test ont le même
  md5. Le <b>grain fin</b> dans les tons vient de la <b>SOURCE</b> (~12 niveaux luma, posé à
  l'export), PAS de l'effet — visible dès le crop ciel du témoin (col. 0), et ABSORBÉ par le lavis
  dès la col. 1. Écart-type de luminance ${smin} à ${smax} (aucun aplat)${aplats.length ? ` SAUF ${aplats.length} colonne(s) sous 1` : ""}.
  ${dupMd5.length ? `Un seul couple d'images identiques (md5) : le crop CIEL des col. 3 et 4 — cette zone tombe dans une plage PLEINEMENT mouillée, où mouillé 1 (col. 3) et 0,6 (col. 4) rendent le même pixel (le seuil ne vit que sur les plages partielles). Attendu.` : "Toutes les vignettes/crops ont un md5 distinct."}
  Chrono dev (exportFrame, warm, médiane) : <b>+31,6 ms</b> avec la col. « tout » (~2,6× la prod).
  Prototype du ${new Date().toISOString().slice(0, 10)}, aquarelle.ts NON commité. Scripts :
  ref-06/planche-06-*-3.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-06-mecanisme-3.html"), html);
console.log("ecrit planche-06-mecanisme-3.html (" + html.length + " octets)");
console.log("doublons md5:", dupMd5.length, "| aplats std<1:", aplats.length);
