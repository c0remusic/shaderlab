// Assemble la planche de mecanisme 4 (aquarelle v3 ACTUEL) sur DEUX photos d'Antoine.
// Neuf colonnes (ablation cumulative), DEUX lignes par colonne : Photo A (lys/roses)
// puis Photo B (main sur bandes). Par ligne : vignette (par masses) + deux crops 1:1
// (par pixel, sur des frontieres entre deux teintes, coords en legende). Legende :
// reglages, moyenne/ecart-type, md5 (identiques / ecart<1 signales), dark10 pour B.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const S = JSON.parse(readFileSync(path.join(OUT, "aq4-stats.json"), "utf8"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const fr = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");

// doublons md5 (images identiques) et aplats (std<1) sur toute la planche.
const allMd5 = [];
for (const tag of ["A", "B"]) for (const c of S.photos[tag].cols) allMd5.push(c.md5vign, c.md5crop1, c.md5crop2);
const dupMd5 = new Set(allMd5.filter((m, i) => allMd5.indexOf(m) !== i));
const aplats = [];
for (const tag of ["A", "B"]) for (const c of S.photos[tag].cols) if (c.std < 1) aplats.push(`${tag}${c.i}`);

const META = {
  temoin:    ["0 · Témoin", "Les deux photos nues — grain de la SOURCE compris (visible aux crops)."],
  lavis:     ["1 · Lavis seul", "wash 1, mouillé 0. Abstraction en aplats (Kuwahara 4 secteurs) ; le grain disparaît, les bords restent nets. Pas un flou."],
  bave:      ["2 · + Bave", "mouillé 1 : la pyramide de diffusion étale le lavis, les couleurs FUSENT. Sur A, le rouge entre dans le blanc (crop 1)."],
  fibres:    ["3 · + Fibres", "fibres au défaut : 3 passes d'advection HF, les bords s'effilochent en tendrilles courtes."],
  plages:    ["4 · + Plages", "mouillé tombe à 0,6 : la bave est par plages (seuil d'un champ fbm), le reste net."],
  front:     ["5 · + Front de pigment", "edgeDarkening au défaut, lace 0 : le pigment s'accumule au bord (backrun), assombrit et sature."],
  tout:      ["6 · + Dentelle — TOUT", "lace au défaut : front et bords découpés en dentelle. La colonne « tout » aux défauts du fichier."],
  portee2x:  ["7 · Tout, portée ×2", "Idem col. 6, spread 1,5→3,0 : la couleur file deux fois plus loin."],
  bavemax:   ["8 · Bave maximale", "mouillé 1 ET portée ×2 : jusqu'où le mécanisme va — toute l'image fuse."],
};

const ligneParams = (p) => {
  if (!p) return "photo nue";
  return `lavis ${fr(p.wash, 1)} (grain ${p.washRadius}px) · portée ${fr(p.spread, 1)} · mouillé ${fr(p.wetness, 1)} · fibres ${fr(p.fibers, 0)}px · front ${fr(p.edgeDarkening, 1)} (lgr ${p.frontWidth}px) · dentelle ${fr(p.lace, 1)}`;
};

const flagMd5 = (m) => dupMd5.has(m) ? `<b class="dup">${m.slice(0, 8)}</b>` : m.slice(0, 8);

const ligne = (tag, i) => {
  const ph = S.photos[tag];
  const c = ph.cols[i];
  const aplat = c.std < 1 ? ' <b class="dup">APLAT</b>' : "";
  const darkTxt = tag === "B" ? ` · <b>noirs ${fr(c.dark10, 1)}</b>` : "";
  return `
      <div class="ligne">
        <div class="tagcol"><span class="tg tg${tag}">${tag}</span></div>
        <div class="imgs">
          <figure class="vign"><img src="data:image/png;base64,${b64(`aq4-${tag}-col${i}-vign.png`)}" alt="${tag} ${i} vignette"><figcaption>vignette</figcaption></figure>
          <figure class="crop"><img src="data:image/png;base64,${b64(`aq4-${tag}-col${i}-crop1.png`)}" alt="${tag} ${i} crop1"><figcaption>${ph.crop1.label}<br>${ph.crop1.x},${ph.crop1.y}</figcaption></figure>
          <figure class="crop"><img src="data:image/png;base64,${b64(`aq4-${tag}-col${i}-crop2.png`)}" alt="${tag} ${i} crop2"><figcaption>${ph.crop2.label}<br>${ph.crop2.x},${ph.crop2.y}</figcaption></figure>
        </div>
        <p class="mesure">moy ${fr(c.mean)} · écart ${fr(c.std)}${darkTxt}${aplat}<br>md5 v ${flagMd5(c.md5vign)} · c1 ${flagMd5(c.md5crop1)} · c2 ${flagMd5(c.md5crop2)}</p>
      </div>`;
};

const carte = (i) => {
  const key = S.cols[i].key;
  const [titre, phrase] = META[key];
  const p = S.cols[i].params;
  return `
    <article class="col">
      <h2>${titre}</h2>
      <p class="change">${phrase}</p>
      <p class="reglages">${ligneParams(p)}</p>
      ${ligne("A", i)}
      ${ligne("B", i)}
    </article>`;
};

const cartes = S.cols.map((_, i) => carte(i));

const dA = S.photos.A.cols.map((c) => c.dark10);
const dB = S.photos.B.cols.map((c) => c.dark10);
const smin = fr(Math.min(...["A", "B"].flatMap((t) => S.photos[t].cols.map((c) => c.std))));
const smax = fr(Math.max(...["A", "B"].flatMap((t) => S.photos[t].cols.map((c) => c.std))));

const html = `<title>Aquarelle v3 — planche sur photos d'Antoine</title>
<style>
  :root { --fond:#15161a; --carte:#1e2026; --filet:#2c2e35; --texte:#e8e6e1;
    --sourd:#9a9891; --accent:#d9a441; --pointe:#8fae7a; --a:#c98a86; --b:#6f9bd0; }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3","Segoe UI",sans-serif; font-size:15px; line-height:1.5; }
  main { padding: 32px 24px 72px; }
  h1 { font-family:"Archivo","Segoe UI",sans-serif; font-size:28px; margin:0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 100ch; margin: 0 0 6px; }
  .chapeau b { color: var(--texte); }
  .bandeau { border-left: 3px solid var(--pointe); background: var(--carte);
    padding: 12px 16px; margin: 18px 0 8px; max-width: 100ch; }
  .bandeau strong { color: var(--pointe); }
  .rail { display: flex; gap: 16px; overflow-x: auto; padding: 18px 2px 8px; align-items: start; }
  .col { flex: 0 0 344px; background: var(--carte); border: 1px solid var(--filet);
    border-radius: 6px; padding: 12px; }
  .col h2 { font-family:"Archivo","Segoe UI",sans-serif; font-size:15px; margin:0 0 4px; text-wrap:balance; }
  .change { color: var(--sourd); font-size:12.5px; margin:0 0 8px; min-height:5.2em; }
  .reglages { color: var(--sourd); font-size:10.5px; margin:0 0 10px;
    font-family:"JetBrains Mono",Consolas,monospace; border-bottom:1px solid var(--filet); padding-bottom:8px; }
  .ligne { margin-bottom: 10px; }
  .tagcol { margin-bottom: 3px; }
  .tg { display:inline-block; font-family:"JetBrains Mono",monospace; font-size:11px; font-weight:600;
    padding:1px 7px; border-radius:3px; }
  .tgA { background: rgba(201,138,134,0.18); color: var(--a); }
  .tgB { background: rgba(111,155,208,0.18); color: var(--b); }
  .imgs { display:flex; gap:6px; }
  figure { margin: 0; }
  .vign { flex: 0 0 190px; }
  .vign img { display:block; width:190px; height:auto; border-radius:3px; background:#000; }
  .crop { flex: 1; }
  .crop img { display:block; width:100%; height:auto; image-rendering: pixelated;
    border-radius:3px; background:#000; }
  figcaption { color: var(--sourd); font-size:9.5px; margin-top:2px; line-height:1.25;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .mesure { color: var(--sourd); font-size:10.5px; margin:4px 0 0;
    font-family:"JetBrains Mono",Consolas,monospace; }
  .mesure b { color: var(--texte); }
  .mesure b.dup { color: var(--accent); }
  .piednote { color: var(--sourd); font-size:12.5px; margin-top:26px; max-width: 100ch; }
  .piednote b { color: var(--texte); }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<main>
  <h1>Aquarelle v3 — planche de mécanisme sur DEUX photos d'Antoine</h1>
  <p class="chapeau">Ticket 06. Le mécanisme v3 « chaîne combinée » (<b>aquarelle.ts</b> tel qu'il est sur
  le disque, non réécrit) rendu par le pipeline réel, pleine résolution native (6240×4160), sur deux
  photos choisies par Antoine — au lieu de <code>photo-1</code>, dont la silhouette et le ciel lisse
  n'avaient presque aucune frontière entre deux teintes (constat de la planche 3).</p>
  <p class="chapeau"><b>Photo A</b> — lys blancs, roses rouges, feuillage, fond clair : plusieurs
  teintes qui se touchent, le sujet d'une bave. <b>Photo B</b> — main en silhouette sur des bandes de
  lumière. ⚠️ Le fichier <code>-edited-2</code> est étalonné en <b>bleu / teal / noir</b> : aucune bande
  jaune ni orange (le titre « jaune/bleu/orange » décrit l'original, pas ce fichier). Les frontières de
  B sont donc <b>bord de bande bleue</b> et <b>main noire / bande</b>.</p>
  <p class="chapeau">Chaque colonne AJOUTE un ingrédient au précédent (ablation cumulative), aux
  réglages de la planche 3. Deux lignes par colonne : <span style="color:var(--a)">A</span> puis
  <span style="color:var(--b)">B</span>. Par ligne : la <b>vignette</b> juge la bave par masses, les
  deux <b>crops 1:1</b> (256 px natifs) jugent le front et la bave par pixel, sur des frontières entre
  deux teintes (coords en légende). <b>noirs</b> (B) = luminance moyenne des 10 % de pixels les plus
  sombres du témoin, aux mêmes positions : plus bas = la main reste noire (témoin B = 0,0).</p>
  <div class="bandeau"><strong>Pointez la colonne préférée — ou « aucune »</strong> : celle dont la
  bave, les fibres et le bord ressemblent le plus à une aquarelle wet-on-wet. Le design se fige APRÈS
  votre pointage ; aucun verdict n'est porté ici.</div>
  <div class="rail">
${cartes.join("\n")}
  </div>
  <p class="piednote">Ces deux images sont les <b>photos d'Antoine</b> ; <b>orientation EXIF
  respectée</b> (A = orientation 1, B sans EXIF, aucune rotation ; dimensions rendues 6240×4160 ==
  source, vérifié). Le <b>grain fin</b> des tons vient de la SOURCE, pas de l'effet — visible au crop du
  témoin, absorbé par le lavis dès la col. 1. Écart-type de luminance ${smin} à ${smax}${aplats.length ? ` — aplats (&lt;1) : ${aplats.join(", ")}` : " (aucun aplat)"}.
  Noirs de la main (B) : témoin 0,0 ; toutes colonnes entre ${fr(Math.min(...dB.slice(1)),1)} et ${fr(Math.max(...dB),1)} sur 255 (silhouette préservée par la composite en absorbance).
  ${dupMd5.size ? `${dupMd5.size} crops identiques (md5, surlignés) : les paires mouillé 1 vs 0,6 (A cols 3/4 et 7/8 crop 2, B cols 3/4 et 7/8 crop 1) — ce crop tombe dans une plage PLEINEMENT mouillée, où le seuil ne distingue pas 1 de 0,6 (il ne vit que sur les plages partielles). Attendu.` : "Toutes les images ont un md5 distinct."}
  Prototype du ${new Date().toISOString().slice(0, 10)}, aquarelle.ts NON commité. Scripts :
  ref-06/planche-06-*-4.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-06-mecanisme-4.html"), html);
console.log("ecrit planche-06-mecanisme-4.html (" + html.length + " octets)");
console.log("doublons md5:", dupMd5.size, "| aplats std<1:", aplats.length);
