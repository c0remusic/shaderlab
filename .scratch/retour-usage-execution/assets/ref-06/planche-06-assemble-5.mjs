// Assemble la planche de mecanisme 5 (aquarelle v4 REECRIT) sur DEUX photos d'Antoine.
// Neuf colonnes : 0 temoin, 1-3 tout v4 papier 0/defaut/1, 4 lavis seul, 5 sans front,
// 6 bave x2, 7 sans lavis, 8 RAPPEL v3 (planche 4 col6, aq4-*-col6). DEUX lignes par
// colonne : Photo A (lys/roses) puis Photo B (main sur bandes). Par ligne : vignette
// (par masses) + deux crops 1:1 (par pixel). Legende : reglages, moyenne/ecart-type,
// md5, dark10 pour B.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const S = JSON.parse(readFileSync(path.join(OUT, "aq5-stats.json"), "utf8"));
const S4 = JSON.parse(readFileSync(path.join(OUT, "aq4-stats.json"), "utf8"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const fr = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");

// Colonne 8 = rappel v3 (planche 4 col6). On resout images + stats par colonne.
const RAPPEL = 8;
const src = (tag, i) => {
  if (i < RAPPEL) return { pre: `aq5-${tag}-col${i}`, st: S.photos[tag].cols[i], crop1: S.photos[tag].crop1, crop2: S.photos[tag].crop2 };
  return { pre: `aq4-${tag}-col6`, st: S4.photos[tag].cols[6], crop1: S4.photos[tag].crop1, crop2: S4.photos[tag].crop2 };
};

// doublons md5 (images identiques) et aplats (std<1) sur les colonnes v4 (0-7).
const allMd5 = [];
for (const tag of ["A", "B"]) for (const c of S.photos[tag].cols) allMd5.push(c.md5vign, c.md5crop1, c.md5crop2);
const dupMd5 = new Set(allMd5.filter((m, i) => allMd5.indexOf(m) !== i));
const aplats = [];
for (const tag of ["A", "B"]) for (const c of S.photos[tag].cols) if (c.std < 1) aplats.push(`${tag}${c.i}`);

// Ordre d'affichage : les cles v4 (0-7) puis le rappel.
const COLKEYS = [...S.cols.map((c) => c.key), "rappel"];
const META = {
  temoin:    ["0 · Témoin", "Les deux photos nues — grain de la SOURCE compris (visible aux crops)."],
  papier0:   ["1 · Tout v4 · papier 0", "La chaîne complète v4 aux défauts, SANS papier. Tailles RELATIVES à l'image : lavis, bave et fibres se voient enfin en vignette (c'était le défaut n°1 de la planche 4)."],
  papierdef: ["2 · Tout v4 · papier 0,5", "Idem, papier au défaut : hautes lumières vers le blanc du papier, tons moyens éclaircis, noirs allégés mais TEINTÉS. Le rendu de référence de la v4."],
  papier1:   ["3 · Tout v4 · papier 1", "Papier à fond : l'image devient transparente sur blanc — un lys blanc-papier à ombres teintées, pas un lys photographié."],
  lavis:     ["4 · Lavis seul", "Idem 2 mais mouillé 0, fibres 0, front 0 : ce que le lavis à la bonne échelle fait seul — dégrain, aplats, bords NETS (Kuwahara pleine résolution recalculé pour le sec)."],
  sansfront: ["5 · Sans front", "Idem 2, front de pigment à 0 : la bave sans le rebord sombre au bord des lavis. À comparer avec la col. 2."],
  bave2x:    ["6 · Bave ×2", "Idem 2, portée 2,0→4,0 : la couleur file deux fois plus loin (~4 % de la largeur)."],
  sanslavis: ["7 · Sans lavis", "Idem 2, wash 0 : la bave part de la photo BRUTE, sans abstraction — plus proche d'un simple flou (montre ce que le lavis apporte)."],
  rappel:    ["8 · v3 — avant l'échelle", "RAPPEL planche 4 col. 6 (tout v3) : mêmes ingrédients mais en PIXELS ABSOLUS (lavis 5 px, front 8 px sur 6240) — invisibles en vignette. C'est le défaut que la v4 corrige."],
};

const ligneParamsV4 = (p) => {
  if (!p) return "photo nue";
  return `lavis ${fr(p.wash, 2)} (grain ${fr(p.washRadius * 100, 2)} % ≈ ${Math.round(p.washRadius * 6240)}px) · portée ${fr(p.spread, 1)} · mouillé ${fr(p.wetness, 1)} · fibres ${fr(p.fibers * 100, 1)} % · front ${fr(p.edgeDarkening, 1)} (${fr(p.frontWidth * 100, 1)} % ≈ ${Math.round(p.frontWidth * 6240)}px) · dentelle ${fr(p.lace, 1)} · papier ${fr(p.paper, 2)}`;
};
const RAPPEL_PARAMS = "v3 (px absolus) : lavis 1,0 (grain 5 px) · portée 1,5 · mouillé 0,6 · fibres 4 px · front 0,9 (8 px) · dentelle 0,6 · [pas de papier]";

const flagMd5 = (m) => dupMd5.has(m) ? `<b class="dup">${m.slice(0, 8)}</b>` : m.slice(0, 8);

const ligne = (tag, i) => {
  const s = src(tag, i);
  const c = s.st;
  const aplat = c.std < 1 ? ' <b class="dup">APLAT</b>' : "";
  const darkTxt = tag === "B" ? ` · <b>noirs ${fr(c.dark10, 1)}</b>` : "";
  return `
      <div class="ligne">
        <div class="tagcol"><span class="tg tg${tag}">${tag}</span></div>
        <div class="imgs">
          <figure class="vign"><img src="data:image/png;base64,${b64(`${s.pre}-vign.png`)}" alt="${tag} ${i} vignette"><figcaption>vignette</figcaption></figure>
          <figure class="crop"><img src="data:image/png;base64,${b64(`${s.pre}-crop1.png`)}" alt="${tag} ${i} crop1"><figcaption>${s.crop1.label}<br>${s.crop1.x},${s.crop1.y}</figcaption></figure>
          <figure class="crop"><img src="data:image/png;base64,${b64(`${s.pre}-crop2.png`)}" alt="${tag} ${i} crop2"><figcaption>${s.crop2.label}<br>${s.crop2.x},${s.crop2.y}</figcaption></figure>
        </div>
        <p class="mesure">moy ${fr(c.mean)} · écart ${fr(c.std)}${darkTxt}${aplat}<br>md5 v ${flagMd5(c.md5vign)} · c1 ${flagMd5(c.md5crop1)} · c2 ${flagMd5(c.md5crop2)}</p>
      </div>`;
};

const carte = (i) => {
  const key = COLKEYS[i];
  const [titre, phrase] = META[key];
  const reglages = key === "rappel" ? RAPPEL_PARAMS
    : (S.cols[i].params ? ligneParamsV4(S.cols[i].params) : "photo nue");
  const cls = key === "rappel" ? "col rappel" : "col";
  return `
    <article class="${cls}">
      <h2>${titre}</h2>
      <p class="change">${phrase}</p>
      <p class="reglages">${reglages}</p>
      ${ligne("A", i)}
      ${ligne("B", i)}
    </article>`;
};

const cartes = COLKEYS.map((_, i) => carte(i));

const dB = S.photos.B.cols.map((c) => c.dark10);
const smin = fr(Math.min(...["A", "B"].flatMap((t) => S.photos[t].cols.map((c) => c.std))));
const smax = fr(Math.max(...["A", "B"].flatMap((t) => S.photos[t].cols.map((c) => c.std))));
// papier : moyenne de luminance des colonnes 1/2/3 pour montrer la montee.
const mA = [1, 2, 3].map((i) => fr(S.photos.A.cols[i].mean, 0));
const mB = [1, 2, 3].map((i) => fr(S.photos.B.cols[i].mean, 0));
const dkB = [1, 2, 3].map((i) => fr(S.photos.B.cols[i].dark10, 1));

const html = `<title>Aquarelle v4 — planche sur photos d'Antoine</title>
<style>
  :root { --fond:#15161a; --carte:#1e2026; --filet:#2c2e35; --texte:#e8e6e1;
    --sourd:#9a9891; --accent:#d9a441; --pointe:#8fae7a; --a:#c98a86; --b:#6f9bd0; --rappel:#7a5a5a; }
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
  .col.rappel { border-color: var(--rappel); opacity: 0.9; }
  .col h2 { font-family:"Archivo","Segoe UI",sans-serif; font-size:15px; margin:0 0 4px; text-wrap:balance; }
  .col.rappel h2 { color: var(--a); }
  .change { color: var(--sourd); font-size:12.5px; margin:0 0 8px; min-height:6.4em; }
  .reglages { color: var(--sourd); font-size:10.5px; margin:0 0 10px;
    font-family:"JetBrains Mono",Consolas,monospace; border-bottom:1px solid var(--filet); padding-bottom:8px; min-height:3.4em; }
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
  <h1>Aquarelle v4 — planche de mécanisme sur DEUX photos d'Antoine</h1>
  <p class="chapeau">Ticket 06. La v4 corrige les <b>deux défauts de conception</b> de la planche 4 et ajoute
  un curseur <b>Papier blanc</b>. Rendu par le pipeline réel, pleine résolution native (6240×4160), sur
  <code>aquarelle.ts</code> tel qu'il est sur le disque (NON commité, prototype).</p>
  <p class="chapeau"><b>1 — Échelle relative.</b> Toutes les tailles sont des FRACTIONS de la largeur de
  l'image (lavis ≈ 0,5 %, bave ≈ 2 %, fibres ≈ 0,3 %, front ≈ 0,3 %), lues via
  <code>textureDimensions</code> comme <code>glow</code>. Le lavis qui alimente la bave est calculé à
  ¼ de résolution ; le côté SEC recalcule un Kuwahara PLEINE résolution (bords nets). <b>2 — Front au bord
  des lavis.</b> <code>frontThr</code> (l'iso-ligne du champ de mouillé, qui posait des anneaux au hasard)
  est SUPPRIMÉ ; le front ne vit plus qu'au gradient de densité de la version bavée. <b>3 — Papier blanc.</b>
  Réduction de densité en absorbance, à genou tonal.</p>
  <p class="chapeau"><b>Photo A</b> — lys blancs, roses rouges, feuillage. <b>Photo B</b> — main en
  silhouette sur des bandes de lumière (étalonnée <b>bleu / teal / noir</b>). Deux lignes par colonne :
  <span style="color:var(--a)">A</span> puis <span style="color:var(--b)">B</span>. La <b>vignette</b>
  (~620 px) juge la bave par masses ; les deux <b>crops 1:1</b> (256 px natifs) jugent le lavis et le
  front par pixel. <b>noirs</b> (B) = luminance moyenne des 10 % de pixels les plus sombres du témoin, aux
  mêmes positions (témoin B = 0,0).</p>
  <div class="bandeau"><strong>Pointez la colonne préférée — ou « aucune »</strong> : celle dont la bave,
  le lavis, le front et le papier ressemblent le plus à une aquarelle. Le design se fige APRÈS votre
  pointage ; aucun verdict n'est porté ici.</div>
  <div class="rail">
${cartes.join("\n")}
  </div>
  <p class="piednote">Photos d'Antoine, <b>orientation EXIF respectée</b> (dimensions rendues 6240×4160 ==
  source, vérifié). Le <b>grain fin</b> vient de la SOURCE (visible au crop du témoin), absorbé par le
  lavis. Écart-type de luminance ${smin} à ${smax}${aplats.length ? ` — aplats (&lt;1) : ${aplats.join(", ")}` : " (aucun aplat)"}.
  <b>Papier</b> (colonnes 1→2→3) : luminance moyenne A ${mA.join(" → ")}, B ${mB.join(" → ")} ; noirs de la
  main (B) ${dkB.join(" → ")} sur 255 — les hautes lumières filent au blanc, les noirs profonds ne
  s'allègent qu'un peu et gardent leur teinte. ${dupMd5.size ? `${dupMd5.size} crops identiques (md5, surlignés) : crops tombant dans une plage pleinement mouillée, où le seuil ne distingue pas les réglages. Attendu.` : "Toutes les images v4 ont un md5 distinct."}
  La colonne 8 est le <b>rappel v3</b> (planche 4 col. 6), mêmes ingrédients en px absolus.
  Prototype du ${new Date().toISOString().slice(0, 10)}, aquarelle.ts NON commité. Scripts :
  ref-06/planche-06-*-5.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-06-mecanisme-5.html"), html);
console.log("ecrit planche-06-mecanisme-5.html (" + html.length + " octets)");
console.log("doublons md5:", dupMd5.size, "| aplats std<1:", aplats.length);
