// Assemble la planche de mecanisme 6 (aquarelle v5, bave LOCALE aux frontieres) sur
// DEUX photos d'Antoine. Dix colonnes : 0 temoin, 1 lavis seul (reference), 2-4 bave
// aux frontieres 1/2/4 %, 5 + fibres, 6 + front, 7 + papier 0,5, 8 + papier 1,
// 9 RAPPEL v4 (planche 5 col2, bave GLOBALE, aq5-*-col2).
// Rail principal : vignette (par masses) + deux crops 1:1 (par pixel), lignes A/B.
// Puis DEUX rails MI-ECHELLE (Photo A, Photo B) : les colonnes 0-8 a ~1200 px de
// large (crop central), c'est la que la bave locale se lit. La col 9 (rappel v4)
// n'a pas de mi-echelle (rendue par la planche 5) : sa vignette suffit a montrer le
// flou global. Legende : reglages, moyenne/ecart-type, md5, dark10 pour B.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const OUT = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const S = JSON.parse(readFileSync(path.join(OUT, "aq6-stats.json"), "utf8"));
const S5 = JSON.parse(readFileSync(path.join(OUT, "aq5-stats.json"), "utf8"));
const b64 = (nom) => readFileSync(path.join(OUT, nom)).toString("base64");
const fr = (x, d = 2) => Number(x).toFixed(d).replace(".", ",");

const RAPPEL = 9;
// Source images + stats par colonne (0-8 = aq6 ; 9 = aq5 col2, bave GLOBALE v4).
const src = (tag, i) => {
  if (i < RAPPEL) return { pre: `aq6-${tag}-col${i}`, st: S.photos[tag].cols[i], crop1: S.photos[tag].crop1, crop2: S.photos[tag].crop2, hasMid: true };
  return { pre: `aq5-${tag}-col2`, st: S5.photos[tag].cols[2], crop1: S5.photos[tag].crop1, crop2: S5.photos[tag].crop2, hasMid: false };
};

// doublons md5 (images identiques) et aplats (std<1) sur les colonnes v5 (0-8).
const allMd5 = [];
for (const tag of ["A", "B"]) for (const c of S.photos[tag].cols) allMd5.push(c.md5vign, c.md5mid, c.md5crop1, c.md5crop2);
const dupMd5 = new Set(allMd5.filter((m, i) => allMd5.indexOf(m) !== i));
const aplats = [];
for (const tag of ["A", "B"]) for (const c of S.photos[tag].cols) if (c.std < 1) aplats.push(`${tag}${c.i}`);

const COLKEYS = [...S.cols.map((c) => c.key), "rappel"];
const META = {
  temoin:    ["0 · Témoin", "Les deux photos nues — grain de la SOURCE compris (visible aux crops)."],
  lavis:     ["1 · Lavis seul (réf.)", "Kuwahara à bords gardés ; mouillé, fibres et front à 0. La première image qui ressemble à une PEINTURE (planche 5). Doit rester ≈ planche 5 col. 4 (au papier près, ici 0)."],
  bave1:     ["2 · Bave aux frontières · 1 %", "La couleur bave sur une bande ÉTROITE (≈62 px) à la frontière entre deux lavis ; l'INTÉRIEUR de chaque lavis reste plat. C'est le changement clé de la v5."],
  bave2:     ["3 · Bave · 2 %", "Bande de frontière ≈125 px. Réglage de référence — deux lavis voisins s'échangent leur couleur sans que l'image entière floute."],
  bave4:     ["4 · Bave · 4 %", "Bande ≈250 px : deux couleurs se mangent largement. Au-delà, la bave commence à ressembler à un flou — c'est la borne haute utile."],
  fibres:    ["5 · + Fibres", "Idem 3 (bave 2 %) plus l'effilochage capillaire des frontières : le déplacement d'UV est multiplié par la frontière locale, donc l'intérieur ne bouge pas. Amplitude ≈9 px."],
  front:     ["6 · + Front", "Idem 5 plus le pigment accumulé au BORD des lavis (assombrit et sature une bande étroite). Le front ne vit que dans la bave locale."],
  papier05:  ["7 · + Papier 0,5", "Idem 6, papier au défaut : hautes lumières vers le blanc du papier, tons moyens éclaircis, noirs allégés mais TEINTÉS."],
  papier1:   ["8 · + Papier 1", "Idem 6, papier à fond : l'image devient transparente sur blanc — un lys blanc-papier à ombres teintées."],
  rappel:    ["9 · v4 — bave GLOBALE", "RAPPEL planche 5 col. 2 : la bave s'étalait sur TOUTE l'image (pyramide 1/32, mélange global) = un flou où les fibres rendent l'image poilue. C'est ce que la v5 remplace par une bave LOCALE."],
};

const ligneParamsV5 = (p) => {
  if (!p) return "photo nue";
  return `lavis ${fr(p.wash, 2)} (grain ${fr(p.washRadius * 100, 2)} %) · portée ${fr(p.spread, 1)} · mouillé ${fr(p.wetness, 1)} · bave ${fr(p.bleedWidth * 100, 1)} % ≈ ${Math.round(p.bleedWidth * 6240)}px · fibres ${fr(p.fibers * 100, 2)} % · front ${fr(p.edgeDarkening, 1)} · dentelle ${fr(p.lace, 1)} · papier ${fr(p.paper, 2)}`;
};
const RAPPEL_PARAMS = "v4 (bave GLOBALE, planche 5) : lavis 0,85 · portée 2,0 · mouillé 0,7 · pyramide 1/32 (pas de bande de frontière) · fibres 0,3 % · front 0,9 · papier 0,5";

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
    : (S.cols[i].params ? ligneParamsV5(S.cols[i].params) : "photo nue");
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

// Rail mi-echelle par photo : colonnes 0-8 (la col 9 rappel n'a pas de mi-echelle).
const midCarte = (tag, i) => {
  const key = COLKEYS[i];
  const [titre] = META[key];
  const s = src(tag, i);
  if (!s.hasMid) return "";
  return `
      <figure class="midcarte">
        <img src="data:image/png;base64,${b64(`${s.pre}-mid.png`)}" alt="${tag} ${i} mi-échelle">
        <figcaption>${titre}</figcaption>
      </figure>`;
};
const midRail = (tag) => `
  <h2 class="midtitre"><span class="tg tg${tag}">${tag}</span> Mi-échelle — ${tag === "A" ? "lys blancs, roses rouges" : "main sur bandes bleu/teal"}</h2>
  <p class="chapeau">Crop central rendu à ~1200 px (≈ moitié de la résolution native). Comparez l'intérieur des lavis (doit rester plat de la col. 1 à la col. 8) et la bande de frontière entre deux couleurs (elle s'élargit 1 % → 2 % → 4 %, col. 2-3-4).</p>
  <div class="midrail">
${["1", "2", "3", "4", "5", "6", "7", "8", "0"].map((n) => midCarte(tag, Number(n))).join("\n")}
  </div>`;

const smin = fr(Math.min(...["A", "B"].flatMap((t) => S.photos[t].cols.map((c) => c.std))));
const smax = fr(Math.max(...["A", "B"].flatMap((t) => S.photos[t].cols.map((c) => c.std))));
const mA = [6, 7, 8].map((i) => fr(S.photos.A.cols[i].mean, 0));
const mB = [6, 7, 8].map((i) => fr(S.photos.B.cols[i].mean, 0));
const dkB = [6, 7, 8].map((i) => fr(S.photos.B.cols[i].dark10, 1));

const html = `<title>Aquarelle v5 — bave locale aux frontières</title>
<style>
  :root { --fond:#15161a; --carte:#1e2026; --filet:#2c2e35; --texte:#e8e6e1;
    --sourd:#9a9891; --accent:#d9a441; --pointe:#8fae7a; --a:#c98a86; --b:#6f9bd0; --rappel:#7a5a5a; }
  * { box-sizing: border-box; }
  body { background: var(--fond); color: var(--texte); margin: 0;
    font-family: "Source Sans 3","Segoe UI",sans-serif; font-size:15px; line-height:1.5; }
  main { padding: 32px 24px 72px; }
  h1 { font-family:"Archivo","Segoe UI",sans-serif; font-size:28px; margin:0 0 6px; }
  .chapeau { color: var(--sourd); max-width: 110ch; margin: 0 0 6px; }
  .chapeau b { color: var(--texte); }
  .bandeau { border-left: 3px solid var(--pointe); background: var(--carte);
    padding: 12px 16px; margin: 18px 0 8px; max-width: 110ch; }
  .bandeau strong { color: var(--pointe); }
  .rail { display: flex; gap: 16px; overflow-x: auto; padding: 18px 2px 8px; align-items: start; }
  .col { flex: 0 0 344px; background: var(--carte); border: 1px solid var(--filet);
    border-radius: 6px; padding: 12px; }
  .col.rappel { border-color: var(--rappel); opacity: 0.9; }
  .col h2 { font-family:"Archivo","Segoe UI",sans-serif; font-size:15px; margin:0 0 4px; text-wrap:balance; }
  .col.rappel h2 { color: var(--a); }
  .change { color: var(--sourd); font-size:12.5px; margin:0 0 8px; min-height:7.2em; }
  .reglages { color: var(--sourd); font-size:10.5px; margin:0 0 10px;
    font-family:"JetBrains Mono",Consolas,monospace; border-bottom:1px solid var(--filet); padding-bottom:8px; min-height:4.4em; }
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
  .midtitre { font-family:"Archivo","Segoe UI",sans-serif; font-size:18px; margin:34px 0 4px; }
  .midrail { display:flex; gap:14px; overflow-x:auto; padding:12px 2px 8px; align-items:start; }
  .midcarte { flex:0 0 600px; }
  .midcarte img { display:block; width:600px; height:auto; border-radius:4px; background:#000; border:1px solid var(--filet); }
  .midcarte figcaption { font-size:12px; margin-top:4px; color:var(--texte); font-family:"Source Sans 3",sans-serif; }
  .piednote { color: var(--sourd); font-size:12.5px; margin-top:26px; max-width: 110ch; }
  .piednote b { color: var(--texte); }
</style>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@600;700&family=Source+Sans+3:wght@400;600&family=JetBrains+Mono:wght@400;500&display=swap">
<main>
  <h1>Aquarelle v5 — la bave devient LOCALE aux frontières</h1>
  <p class="chapeau">Ticket 06, planche 6. Constat de la planche 5 : le lavis seul ressemble à une peinture, mais
  dès que la bave GLOBALE s'ajoute tout redevient un flou. En v5 la bave ne vit qu'aux <b>frontières entre deux
  lavis</b>, sur une bande de largeur réglable (<code>bleedWidth</code>) ; l'<b>intérieur de chaque lavis reste
  plat</b> (= le lavis net). Rendu par le pipeline réel, pleine résolution native (6240×4160), sur
  <code>aquarelle.ts</code> tel qu'il est sur le disque (NON commité, prototype).</p>
  <p class="chapeau"><b>Mécanisme.</b> Une carte de frontières <b>E</b> ∈ [0,1] est calculée dans la composite à
  partir de la version diffusée (anneau de taps au rayon <code>bleedWidth</code>) : 1 près d'une frontière,
  0 exactement à l'intérieur d'un aplat. La composite fait <code>mix(lavis, diffusée, mouillé × E × plages)</code>
  en absorbance (les noirs restent des noirs). La pyramide de diffusion est ramenée à 1/8. Les fibres ne
  déplacent que là où E &gt; 0. Front et papier inchangés depuis la v4.</p>
  <p class="chapeau"><b>Photo A</b> — lys blancs, roses rouges, feuillage. <b>Photo B</b> — main en silhouette
  sur des bandes de lumière (étalonnée <b>bleu / teal / noir</b>). Deux lignes par colonne :
  <span style="color:var(--a)">A</span> puis <span style="color:var(--b)">B</span>. La <b>vignette</b> (~620 px)
  juge par masses ; les <b>crops 1:1</b> (256 px natifs) jugent par pixel ; le rail <b>mi-échelle</b> plus bas
  (~1200 px, crop central) est là où la bave locale à la frontière rose/pétale se lit. <b>noirs</b> (B) =
  luminance moyenne des 10 % de pixels les plus sombres du témoin, aux mêmes positions (témoin B = 0,0).</p>
  <div class="bandeau"><strong>Pointez la colonne préférée — ou « aucune »</strong> : celle dont la bave locale,
  le lavis, le front et le papier ressemblent le plus à une aquarelle, et à quelle largeur de bave. Le design se
  fige APRÈS votre pointage ; aucun verdict n'est porté ici.</div>
  <div class="rail">
${cartes.join("\n")}
  </div>
${midRail("A")}
${midRail("B")}
  <p class="piednote">Photos d'Antoine, <b>orientation EXIF respectée</b> (dimensions rendues 6240×4160 ==
  source, vérifié). Le <b>grain fin</b> vient de la SOURCE (visible au crop du témoin), absorbé par le lavis.
  Écart-type de luminance ${smin} à ${smax}${aplats.length ? ` — aplats (&lt;1) : ${aplats.join(", ")}` : " (aucun aplat)"}.
  <b>Papier</b> (colonnes 6→7→8) : luminance moyenne A ${mA.join(" → ")}, B ${mB.join(" → ")} ; noirs de la
  main (B) ${dkB.join(" → ")} sur 255. ${dupMd5.size ? `${dupMd5.size} images identiques (md5, surlignées) : crops/vignettes tombant hors de toute frontière, où le réglage de bave ne change rien. Attendu si le crop est en plein aplat.` : "Toutes les images v5 ont un md5 distinct."}
  La colonne 9 est le <b>rappel v4</b> (planche 5 col. 2), bave GLOBALE (pas de mi-échelle rendue).
  Prototype du ${new Date().toISOString().slice(0, 10)}, aquarelle.ts NON commité. Scripts :
  ref-06/planche-06-*-6.mjs.</p>
</main>
`;
writeFileSync(path.join(OUT, "planche-06-mecanisme-6.html"), html);
console.log("ecrit planche-06-mecanisme-6.html (" + html.length + " octets)");
console.log("doublons md5:", dupMd5.size, "| aplats std<1:", aplats.length);
