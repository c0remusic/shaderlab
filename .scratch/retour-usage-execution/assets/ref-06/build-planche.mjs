// Construit planche-06-aquarelle.html (dataURL) + ref-06-sources.md
// Re-telecharge les keepers en 1100px, encode base64, calcule les crops (bgPos derive).
import { readFileSync, writeFileSync } from "node:fs";
const UA = { "User-Agent": "shaderlab-refboard/1.0 (research; contact rawrnie@gmail.com)" };

// Liste unique reconstruite comme dans download.mjs (meme ordre)
const seen = new Map();
for (const l of readFileSync("candidates.jsonl", "utf8").trim().split("\n")) {
  if (!l) continue;
  try { const o = JSON.parse(l); if (o.mime !== "image/jpeg" && o.mime !== "image/png") continue; if (!seen.has(o.title)) seen.set(o.title, o); } catch {}
}
const uniq = [...seen.values()];

// Sections de phenomene
const SECTIONS = [
  { id: "A", titre: "Bavure fusante — wet-on-wet",
    sous: "Couleur laquee dans du papier deja mouille : elle FUSE en s'estompant, sans bord. Le pigment migre tant que l'eau porte. C'est le coeur de la cible aquarelle." },
  { id: "B", titre: "Granulation de pigment",
    sous: "Le pigment se depose dans le CREUX du grain et laisse les bosses claires : un moucheté a deux tons, propre au pigment lourd et au papier a grain. Ne depend pas du geste mais de la matiere." },
  { id: "C", titre: "Bords de séchage — backrun, cauliflower, auréole, lifting",
    sous: "Quand une zone seche plus vite que sa voisine, l'eau repousse le pigment vers un FRONT irregulier : bord dentele fonce (backrun/chou-fleur), auréole claire au centre, pigment souleve. Bord DUR mais decoupe en dentelle, l'inverse d'un bord franc net." },
  { id: "D", titre: "Lavis dégradé — graded wash",
    sous: "Un aplat dont le ton glisse en douceur sur toute sa longueur, sans couture. Le pigment se dilue progressivement. Base tonale sur laquelle les autres phenomenes se posent." },
  { id: "E", titre: "Substrat — grain du papier",
    sous: "Le papier NU : c'est sa topographie (grain, coton) qui capte le pigment et fabrique granulation et bord granuleux. Reference du support, pas un rendu." },
];

// Keepers : idx (dans uniq), section, fx/fy (centre du phenomene, fraction), z (zoom), legende
const K = [
  // A — bavure fusante
  { idx: 5, s: "A", fx: 0.42, fy: 0.44, z: 3.0, leg: "Turner, etudes de nuages et pluie. Tache pourpre/bleue qui FUSE en rose vers le papier mouille — bord nul, degrade continu. C'est la bavure fusante a l'etat pur." },
  { idx: 29, s: "A", fx: 0.38, fy: 0.46, z: 3.0, leg: "Sargent, At Chioggia. Bruns des voiles laques mouille-sur-mouille : ils bavent l'un dans l'autre. A cote, des touches franches sur papier sec (bord DUR) — les deux regimes cote a cote." },
  { idx: 74, s: "A", fx: 0.46, fy: 0.5, z: 3.2, leg: "Aquarelle fraiche en cours. Bleus/verts/violets qui fusent en direct ; par endroits l'eau a repousse un front sombre (backrun naissant). Montre le phenomene VIVANT, pas seche." },
  { idx: 96, s: "A", fx: 0.26, fy: 0.24, z: 3.2, leg: "Feuilles + gouttes (etiquetee wet-on-wet ET wet-on-dry). Fond vert flou = fusion dans le mouille ; brins nets = bord franc sur sec. Contraste explicite des deux." },
  // B — granulation
  { idx: 34, s: "B", fx: 0.5, fy: 0.33, z: 3.2, leg: "Prune. La 'pruine' ciree est peinte mouille-sur-mouille : film bleu-gris MOUCHETÉ sur le pourpre = granulation sur une surface lisse. Cas d'ecole isole." },
  { idx: 41, s: "B", fx: 0.5, fy: 0.45, z: 3.0, leg: "Grappe (Rose d'Italie). Grains modeles mouille-sur-mouille, la matiere du raisin grene dans les ombres — granulation dense a forte saturation." },
  { idx: 20, s: "B", fx: 0.5, fy: 0.56, z: 3.0, leg: "Sargent, Muddy Alligators. Corps gris-bleus : le pigment granule et se depose ; hautes lumieres SOULEVÉES (blanc du papier reserve/essuye). Granulation + lifting." },
  { idx: 86, s: "B", fx: 0.3, fy: 0.2, z: 3.6, leg: "David Cox, Junction of the Llugwy. Ciel bleu qui grene (granulation atmospherique) ; feuillage en brosse seche. Grain plus vert et rugueux que Turner." },
  // C — bords de sechage
  { idx: 76, s: "C", fx: 0.78, fy: 0.28, z: 4.2, leg: "Nuancier (Te Papa). Le grand carre jaune : l'eau a fui vers les bords et y a POUSSÉ un liseré brun/bleu fonce en dentelle = backrun + bord granuleux, isole sur fond blanc. Piece maitresse." },
  { idx: 54, s: "C", fx: 0.5, fy: 0.2, z: 3.6, leg: "Citron (Brown Tip). La pointe brune bave dans le jaune et s'arrete sur un front irregulier — backrun de tache humide sur zone plus seche." },
  { idx: 30, s: "C", fx: 0.46, fy: 0.28, z: 3.6, leg: "Prune (Diamond). Tache rose CLAIRE au centre du dome : pigment souleve/repousse (auréole) au milieu d'un lavis lisse." },
  // D — lavis degrade
  { idx: 7, s: "D", fx: 0.5, fy: 0.18, z: 2.6, leg: "Turner, The Dark Rigi. Ciel jaune qui se degrade sans couture vers le haut ; montagne qui grene. Lavis degrade + granulation." },
  { idx: 3, s: "D", fx: 0.45, fy: 0.24, z: 2.6, leg: "Turner, Fete Day in Zurich. Grand ciel orange en degrade continu, le pigment se dilue vers le zenith." },
  { idx: 8, s: "D", fx: 0.68, fy: 0.46, z: 3.0, leg: "Turner, Lucerne. Lac bleu en lavis qui grene ; bords de touches en brosse seche sur le grain. Lavis + granulation + bord seche." },
  // E — substrat
  { idx: 97, s: "E", fx: 0.5, fy: 0.5, z: 2.8, leg: "Papier aquarelle coton, grain fin, NU. La topographie qui capte le pigment : c'est ce creux/bosse qui fabrique granulation et bord granuleux." },
];

function bgPos(f, z) { // centre la fraction f de l'image au zoom z ; renvoie % clampe
  const p = (f * z - 0.5) / (z - 1);
  return Math.max(0, Math.min(1, p)) * 100;
}

// Telecharge + encode chaque keeper en 1100px
const items = [];
for (const k of K) {
  const o = uniq[k.idx];
  const url1100 = "https://commons.wikimedia.org/w/api.php?" + new URLSearchParams({
    action: "query", format: "json", titles: o.title,
    prop: "imageinfo", iiprop: "url|size|extmetadata", iiurlwidth: "1100",
  });
  const j = await (await fetch(url1100, { headers: UA })).json();
  const p = Object.values(j.query.pages)[0];
  const ii = p.imageinfo[0];
  const buf = Buffer.from(await (await fetch(ii.thumburl, { headers: UA })).arrayBuffer());
  const dataURL = "data:image/jpeg;base64," + buf.toString("base64");
  const em = ii.extmetadata || {};
  items.push({
    ...k, title: o.title.replace(/^File:/, ""),
    lic: em.LicenseShortName?.value || o.lic || "?",
    artist: (em.Artist?.value || o.artist || "?").replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim(),
    descurl: o.descurl,
    origW: o.w, origH: o.h,
    dataURL, kb: (buf.length / 1024) | 0,
    posx: bgPos(k.fx, k.z).toFixed(1), posy: bgPos(k.fy, k.z).toFixed(1),
  });
  console.log(`embed r${k.idx} ${(buf.length/1024|0)}KB`);
}

// ---- HTML ----
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
let styleImgs = "";
for (const it of items) styleImgs += `.u${it.idx}{--u:url(${it.dataURL})}\n`;

function card(it) {
  return `<figure class="card u${it.idx}">
  <div class="vig"></div>
  <div class="crop" style="background-size:${(it.z*100).toFixed(0)}%;background-position:${it.posx}% ${it.posy}%"></div>
  <figcaption>
    <p class="leg">${esc(it.leg)}</p>
    <p class="src">${esc(it.title)}<br><span>${esc(it.artist)} — ${esc(it.lic)}</span></p>
  </figcaption>
</figure>`;
}

let sectionsHTML = "";
for (const sec of SECTIONS) {
  const cards = items.filter((i) => i.s === sec.id).map(card).join("\n");
  sectionsHTML += `<section>
  <h2><span class="tag">${sec.id}</span> ${esc(sec.titre)}</h2>
  <p class="sous">${esc(sec.sous)}</p>
  <div class="grid">${cards}</div>
</section>\n`;
}

const html = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Planche 06 — References aquarelle reelle</title>
<style>
:root{--bg:#f4f1ea;--ink:#20242b;--mut:#6a7180;--line:#d9d3c6;--acc:#7a5cff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
header{padding:28px 28px 8px;max-width:1400px;margin:0 auto}
h1{margin:0 0 6px;font-size:24px}
.hint{background:#fff5cc;border:1px solid #e8d38a;border-radius:8px;padding:10px 14px;margin:12px 0;font-weight:600}
.meta{color:var(--mut);font-size:12.5px;max-width:900px}
main{max-width:1400px;margin:0 auto;padding:8px 28px 60px}
section{margin:34px 0 0;border-top:1px solid var(--line);padding-top:18px}
h2{font-size:18px;margin:0 0 4px;display:flex;align-items:center;gap:10px}
.tag{display:inline-grid;place-items:center;width:26px;height:26px;background:var(--acc);color:#fff;border-radius:6px;font-size:14px;font-weight:700}
.sous{color:var(--mut);margin:0 0 16px;max-width:1000px}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:18px;align-items:start}
.card{margin:0;background:#fff;border:1px solid var(--line);border-radius:10px;overflow:hidden;display:flex;flex-direction:column}
.vig{height:150px;background:var(--u) center/contain no-repeat #ece7dd;border-bottom:1px solid var(--line)}
.crop{height:230px;background-image:var(--u);background-repeat:no-repeat;background-color:#ece7dd;image-rendering:auto;position:relative}
.crop::after{content:"crop 1:1 — phenomene";position:absolute;left:8px;bottom:8px;background:rgba(20,24,32,.72);color:#fff;font-size:10.5px;padding:2px 7px;border-radius:4px;letter-spacing:.02em}
figcaption{padding:12px 14px;display:flex;flex-direction:column;gap:8px;flex:1}
.leg{margin:0;font-size:12.8px}
.src{margin:0;font-size:11px;color:var(--mut);border-top:1px dashed var(--line);padding-top:7px}
.src span{opacity:.85}
footer{max-width:1400px;margin:0 auto;padding:0 28px 50px;color:var(--mut);font-size:12px}
</style></head>
<body>
<header>
  <h1>Planche 06 — L'encre procédurale AQUARELLE : références réelles</h1>
  <div class="hint">Pointez les rendus visés — plusieurs choix possibles. Chaque vignette : vue d'ensemble (haut) + crop 1:1 sur le phénomène (bas). Aucune conclusion ni design n'est proposé ici.</div>
  <p class="meta">${items.length} aquarelles réelles, toutes domaine public ou licence libre (source et licence sous chaque vignette). Cadre : encre procédurale = mode SUPPLÉMENTAIRE à côté des scans, famille AQUARELLE (grilling 2026-08-27). Rangement par PHÉNOMÈNE, pas par beauté. Note : le « bord franc sur papier sec » (wet-on-dry) n'a pas de section propre — il apparaît en contraste dans A (Chioggia, feuilles).</p>
</header>
<main>
${sectionsHTML}
</main>
<footer>Planche de travail — rien n'entre dans le dépôt à ce stade. Fichiers sources et licences : ref-06-sources.md (même dossier).</footer>
</body></html>`;

writeFileSync("planche-06-aquarelle.html", `<style>\n${styleImgs}</style>\n` + html.replace("</style></head>", "</style></head>"));
// Injecte les styles d'images DANS le head (avant </style>) proprement :
const finalHtml = html.replace("</style></head>", styleImgs + "</style></head>");
writeFileSync("planche-06-aquarelle.html", finalHtml);

// ---- sources.md ----
let md = `# Planche 06 — sources & licences (aquarelle réelle)\n\nPlanche de travail. Aucune image n'entre dans le dépôt. Toutes récupérées de Wikimedia Commons le 2026-09-07, versions mises à l'échelle (1100 px).\n\n| # | Phéno | Fichier | Auteur | Licence | Source |\n|---|---|---|---|---|---|\n`;
for (const it of items) md += `| r${it.idx} | ${it.s} | ${it.title} | ${it.artist} | ${it.lic} | ${it.descurl} |\n`;
md += `\n## Écartés (et pourquoi)\n- r00 Dolbadarn Castle, r10 Arlequin, r14 Mont Sainte-Victoire (von Lauves) : HUILES, pas de l'aquarelle (impasto/couteau visibles). La recherche « Cezanne watercolor » ramène ses huiles.\n- r70 « Watercolor painting Aquarelle Rostov » : kit peinture-au-numéro OPAQUE (pots numérotés, aplats couvrants), pas de l'aquarelle malgré le nom de fichier.\n- Aquarelles médicales Wellcome (ulcères, gangrène) : techniquement aquarelle mais sujet répugnant, hors-sujet pour une planche à pointer.\n`;
writeFileSync("ref-06-sources.md", md);
console.log(`\nplanche-06-aquarelle.html + ref-06-sources.md ecrits (${items.length} images)`);
