// Assemble la planche de mecanisme du ticket 06 (aquarelle) a partir des PNG et
// stats rendus par planche-06-rendu.mjs. Une seule photo (vram-test = 4 copies
// identiques, verifie par md5) donc une seule ligne ; deux echelles par colonne :
// vignette (par masses) + crop 1:1 (par pixel).
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const stats = JSON.parse(readFileSync(path.join(OUT, "aq-stats.json"), "utf8"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const fr = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");

// titre + ce qui CHANGE + quoi regarder (sans verdict).
const META = {
  temoin:    ["0 · Témoin", "La photo nue, aucun effet.", "Le repère de départ — frontières nettes, grain de la source."],
  diffusion: ["1 · Diffusion seule — LE NAÏF", "La couleur bave partout (mouillé plein), rien d'autre.", "Vignette : l'image fond en un flou. C'est le témoin qu'il faut BATTRE."],
  wobble:    ["2 · + Ondulation", "Les UV de lecture ondulent (fbm moyenne fréquence).", "Crop : la frontière orange/noir ondule au lieu d'être droite."],
  front:     ["3 · + Front de pigment (lisse)", "Un front s'accumule au bord de la bave : il assombrit et sature.", "Crop : un liseré sombre le long du bord (pooling)."],
  dentelle:  ["4 · + Front dentelé", "Le front est découpé par un bruit haute fréquence (backrun).", "Crop : le liseré éclate en dentelle irrégulière."],
  densite:   ["5 · Mode Densité", "Mélange soustractif (Kubelka-Munk) au lieu de la moyenne. Idem 4.", "Crop : la bave est un peu plus sombre/saturée là où deux couleurs se mêlent."],
  portee2x:  ["6 · Portée ×2 (bave massive)", "La portée de la bave double. Idem 5.", "Vignette : la couleur bave beaucoup plus loin, les formes se dissolvent."],
  plages:    ["7 · Mouillé 0,5 (par plages)", "Le mouillé tombe à mi-course. Idem 5.", "Vignette : la bave est par plages (champ de mouillé), le reste net."],
};

const MODE = ["Couleur", "Densité"];
const ligneParams = (p) => {
  if (!p) return "photo nue";
  return `portée ${fr(p.spread, 1)} · mouillé ${fr(p.wetness, 1)} · ondul. ${p.wobble}px · front ${fr(p.edgeDarkening, 1)} · dentelle ${fr(p.lace, 1)} · ${MODE[p.densityMode]}`;
};

const cartes = stats.cols.map((c) => {
  const [titre, change, regarder] = META[c.key];
  return `
    <article class="col">
      <h2>${titre}</h2>
      <p class="change">${change}</p>
      <figure class="vign">
        <img src="data:image/png;base64,${b64(`aq-col${c.i}-vign.png`)}" alt="${titre} — vignette">
        <figcaption>Vignette (par masses)</figcaption>
      </figure>
      <figure class="crop">
        <img src="data:image/png;base64,${b64(`aq-col${c.i}-crop.png`)}" alt="${titre} — crop 1:1">
        <figcaption>Crop 1:1 — 256px natifs (par pixel)</figcaption>
      </figure>
      <p class="regarder"><span>Regarder :</span> ${regarder}</p>
      <p class="reglages">${ligneParams(c.params)}</p>
      <p class="mesure">moy ${fr(c.mean)} · écart ${fr(c.std)}<br>md5 vign ${c.md5vign.slice(0, 8)}<br>md5 crop ${c.md5crop.slice(0, 8)}</p>
    </article>`;
}).join("\n");

const html = `<title>Aquarelle — planche de mécanisme</title>
<style>
  :root { --fond:#15161a; --carte:#1e2026; --filet:#2c2e35; --texte:#e8e6e1;
    --sourd:#9a9891; --accent:#d9a441; --pointe:#8fae7a; }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3","Segoe UI",sans-serif; font-size:15px; line-height:1.5; }
  main { padding: 32px 24px 72px; }
  h1 { font-family:"Archivo","Segoe UI",sans-serif; font-size:28px; margin:0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 90ch; margin: 0 0 4px; }
  .chapeau b { color: var(--texte); }
  .bandeau { border-left: 3px solid var(--pointe); background: var(--carte);
    padding: 12px 16px; margin: 18px 0 8px; max-width: 90ch; }
  .bandeau strong { color: var(--pointe); }
  .rail { display: flex; gap: 16px; overflow-x: auto; padding: 18px 2px 8px; align-items: start; }
  .col { flex: 0 0 300px; background: var(--carte); border: 1px solid var(--filet);
    border-radius: 6px; padding: 12px; }
  .col h2 { font-family:"Archivo","Segoe UI",sans-serif; font-size:15px; margin:0 0 4px; text-wrap:balance; }
  .change { color: var(--sourd); font-size:13px; margin:0 0 10px; min-height:3.2em; }
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
  .piednote { color: var(--sourd); font-size:12.5px; margin-top:26px; max-width: 90ch; }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<main>
  <h1>Aquarelle — planche de mécanisme</h1>
  <p class="chapeau">Ticket 06. Un prototype JETABLE d'un effet plein cadre qui fait
  <b>baver les couleurs de la photo</b> (wet-on-wet). Chaque colonne AJOUTE un facteur au précédent
  (ablation, un facteur à la fois) — la première est le naïf (photo bavée), la dernière la plus
  travaillée. Rendu par le pipeline réel, pleine résolution (${stats.native}px natifs), non commité.</p>
  <p class="chapeau">Deux échelles par colonne, et elles ne montrent pas la même chose : la
  <b>vignette</b> juge la BAVE (par masses), le <b>crop 1:1</b> juge le FRONT et l'ONDULATION
  (par pixel). Le crop est FIXE d'une colonne à l'autre — une frontière lame d'agave / ciel orange.</p>
  <div class="bandeau"><strong>Pointez la colonne préférée</strong> — celle dont la bave et le
  bord ressemblent le plus à ce que l'effet doit faire. Le design du mécanisme se fige APRÈS votre
  pointage, jamais avant. Aucun verdict n'est porté ici.</div>
  <div class="rail">
${cartes}
  </div>
  <p class="piednote">Une seule photo : les quatre <code>photo-N.jpg</code> de vram-test ont le même
  md5, donc une seule ligne (la « deux photos » du brief n'existe pas sur disque). Le grain fin dans
  les orange vient de la SOURCE (~12 niveaux luma, posé à l'export), PAS de l'effet — visible dès le
  crop du témoin (colonne 0). L'écart-type de luminance est de ${fr(Math.min(...stats.cols.map(c=>c.std)))}
  à ${fr(Math.max(...stats.cols.map(c=>c.std)))} (aucun aplat). Crops 5 et 7 partagent leur md5 : ce
  crop tombe dans une plage pleinement mouillée, où mouillé 0,5 et 1,0 donnent le même poids — leur
  différence est par MASSES, dans la vignette. Prototype du ${new Date().toISOString().slice(0,10)},
  aquarelle.ts + registry.ts + catalog.ts NON commités. Scripts : ref-06/planche-06-*.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-06-mecanisme.html"), html);
console.log("ecrit planche-06-mecanisme.html (" + html.length + " octets)");
