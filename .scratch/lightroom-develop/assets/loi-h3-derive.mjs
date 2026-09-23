// HYPOTHESE 3 — LA DERIVE DE 140 ET 150 A-T-ELLE UNE CAUSE IDENTIFIABLE ?
//
// CE QUE LE DETAIL A MONTRE. Sur les onze teintes de la campagne A, deux sortent
// du lot par DEUX chiffres a la fois : l'ecart-type de l'angle (6,63 et 6,23 deg
// contre 0,98 a 3,95 ailleurs) et la derive de cet angle avec le niveau (+9,87 et
// +9,44 deg par centaine de niveaux contre -2,1 a +2,7). Leur angle n'est donc pas
// constant sur la rampe, et un « angle moyen » y veut moins dire qu'ailleurs.
//
// LA PISTE, ET POURQUOI ELLE EST TESTABLE SANS RIEN SUPPOSER. Une rampe de gris
// qui recoit un vecteur de chroma sort du gamut sRGB des que le vecteur demande
// plus de chroma que le gamut n'en porte a cette clarte. L'ecretage qui suit n'est
// PAS radial : il tape CANAL PAR CANAL, donc il ne raccourcit pas le vecteur, il
// le TOURNE. Et la capacite du gamut sRGB depend fortement de la direction — a
// clarte faible, la direction du vert est celle qui en porte le moins.
//
// Cette piste a une signature qu'on peut lire dans les octets sans modele : un
// canal COLLE A ZERO. On la compte d'abord, on regarde ensuite si la derive vit
// exactement la, et on finit par refaire la mesure hors de cette zone.
//
// ⚠️ LE PIEGE DE CE GENRE DE CORRECTION. Retirer des niveaux a deux teintes et
// garder toutes les autres ferait BAISSER leur residu quoi qu'il arrive — une
// selection est un parametre libre deguise. La regle d'exclusion est donc UNE
// SEULE, ecrite une fois, appliquee aux ONZE teintes, et son seuil est balaye pour
// montrer que le resultat ne tient pas a sa valeur.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;                 // le meme seuil de chroma que le lecteur
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];

// ── LES DEUX MODELES QU'ON COMPARE (recopies du lecteur, meme raison qu'au controle)
function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  return deg(...linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]).slice(1));
}
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function angleProPhotoLineaire(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  return deg(...linearSrgbToOklab(ap(XS, ap(PP, rgb))).slice(1));
}
function angleProPhotoGamma(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5).map((c) => Math.pow(c, 1.8));
  return deg(...linearSrgbToOklab(ap(XS, ap(PP, rgb))).slice(1));
}
const ZERO_OKLCH = angleSrgbHsl(0);
const angleOklchDirect = (h) => ZERO_OKLCH + h;

/** Chroma MAXIMALE que le gamut sRGB porte a cette clarte dans cette direction.
 *  Recherche dichotomique sur la longueur du vecteur (a,b) : la seule facon
 *  honnete de la connaitre, la frontiere du gamut n'ayant pas de forme fermee en
 *  OKLab. 48 iterations = 1e-14 de precision, gratuit a cette echelle. */
function chromaMax(L, angleDeg) {
  const ca = Math.cos(rad(angleDeg)), sa = Math.sin(rad(angleDeg));
  const dedans = (c) => oklabToLinearSrgb([L, c * ca, c * sa]).every((v) => v >= -1e-9 && v <= 1 + 1e-9);
  if (!dedans(0)) return 0;
  let bas = 0, haut = 0.5;
  if (dedans(haut)) return haut;
  for (let i = 0; i < 48; i++) { const mid = (bas + haut) / 2; if (dedans(mid)) bas = mid; else haut = mid; }
  return bas;
}

// ── LECTURE NIVEAU PAR NIVEAU ───────────────────────────────────────────────
/** Pour chaque niveau : l'angle et la chroma OKLab, plus ce que les OCTETS disent
 *  tout seuls — le canal le plus bas et le plus haut. Un canal a zero est la
 *  signature de l'ecretage, et elle se lit sans modele. */
function niveaux(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  const rgb = JSON.parse(readFileSync(f, "utf8")).rampe_rgb;
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const [R, G, B] = rgb[n];
    const lab = linearSrgbToOklab([s2l(R / 255), s2l(G / 255), s2l(B / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    out.push({
      n, R, G, B, min: Math.min(R, G, B), max: Math.max(R, G, B),
      L: lab[0], angle: deg(lab[1], lab[2]), chroma: c,
      lisible: c >= SEUIL,
    });
  }
  return out;
}

/** Moyenne circulaire ponderee par la chroma, ecart-type et pente — exactement la
 *  statistique du lecteur, pour que les chiffres se comparent aux siens. */
function stat(pts) {
  if (pts.length < 8) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.chroma * Math.cos(rad(p.angle)); sy += p.chroma * Math.sin(rad(p.angle)); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(pts.reduce((s, p) => s + ecartAngle(p.angle, moyen) ** 2, 0) / pts.length);
  const nMoy = pts.reduce((s, p) => s + p.n, 0) / pts.length;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.n - nMoy) * ecartAngle(p.angle, moyen); den += (p.n - nMoy) ** 2; }
  return { k: pts.length, moyen, et, pente: (num / den) * 100, err: et / Math.sqrt(pts.length) };
}

const TOUT = {};
for (const t of TEINTES) TOUT[t] = niveaux(`st-h${String(t).padStart(3, "0")}`);
const absents = TEINTES.filter((t) => !TOUT[t]);
if (absents.length) { console.log("MANQUENT : %s — on s'arrete.", absents.join(", ")); process.exit(1); }

console.log("HYPOTHESE 3 — la derive de 140 et 150");
console.log("");

// ── 0. LA SIGNATURE, COMPTEE DANS LES OCTETS ────────────────────────────────
console.log("0. UN CANAL COLLE A ZERO — compte brut, avant tout modele.");
console.log("");
console.log("teinte  lus   niv. min<1  dernier tel niv.  canal concerne   niv. max>254");
console.log("".padEnd(78, "-"));
const NOMCANAL = ["R", "V", "B"];
for (const t of TEINTES) {
  const lus = TOUT[t].filter((p) => p.lisible);
  const bas = lus.filter((p) => p.min < 1);
  const haut = lus.filter((p) => p.max > 254);
  // Quel canal touche le plancher ? On prend le plus frequent parmi les niveaux bas.
  const compte = [0, 0, 0];
  for (const p of bas) { const v = [p.R, p.G, p.B]; compte[v.indexOf(Math.min(...v))]++; }
  const canal = bas.length ? NOMCANAL[compte.indexOf(Math.max(...compte))] : "—";
  console.log("%s %s %s %s %s %s",
    String(t).padStart(6), String(lus.length).padStart(5), String(bas.length).padStart(11),
    String(bas.length ? bas[bas.length - 1].n : "—").padStart(17),
    canal.padStart(15), String(haut.length).padStart(14));
}
console.log("");
console.log("  Un canal qui vaut zero ne peut pas descendre plus bas : le vecteur demande");
console.log("  l'a franchi, et ce qui sort n'est plus sa direction. La colonne « dernier »");
console.log("  dit jusqu'ou dans la rampe l'ecretage remonte.");

// ── 1. LE PROFIL DE L'ANGLE PAR NIVEAU ──────────────────────────────────────
console.log("");
console.log("1. PROFIL DE L'ANGLE PAR NIVEAU — deux malades (140, 150), deux saines (90, 330).");
console.log("");
const PAS = 16;
const enteteProfil = ["niveaux"];
for (const t of [140, 150, 90, 330]) enteteProfil.push(`h${t}`);
console.log("  bin        %s", [140, 150, 90, 330].map((t) => `h${String(t).padStart(3, "0")} angle  min`).join("   "));
console.log("".padEnd(88, "-"));
for (let b = 0; b < 256; b += PAS) {
  const cells = [];
  for (const t of [140, 150, 90, 330]) {
    const pts = TOUT[t].filter((p) => p.n >= b && p.n < b + PAS && p.lisible);
    if (!pts.length) { cells.push("     —       —"); continue; }
    let sx = 0, sy = 0;
    for (const p of pts) { sx += p.chroma * Math.cos(rad(p.angle)); sy += p.chroma * Math.sin(rad(p.angle)); }
    const a = deg(sx, sy);
    const mn = Math.min(...pts.map((p) => p.min));
    cells.push(`${a.toFixed(1).padStart(7)} ${mn.toFixed(2).padStart(7)}`);
  }
  console.log("  %s %s", `${String(b).padStart(3)}-${String(b + PAS - 1).padStart(3)}`.padEnd(9), cells.join("   "));
}
console.log("");
console.log("  Colonne « min » = le canal le plus bas du bin. La derive se lit en comparant");
console.log("  la colonne angle a elle-meme du haut vers le bas du tableau.");

// Monotone ? Concentree ou ? Pente par TIERS de la zone lisible.
console.log("");
console.log("  PENTE PAR TIERS (deg / 100 niveaux) — ou la derive se concentre :");
console.log("");
console.log("  teinte   tiers bas    tiers milieu   tiers haut    globale");
console.log("  " + "".padEnd(62, "-"));
for (const t of TEINTES) {
  const lus = TOUT[t].filter((p) => p.lisible);
  const tiers = Math.floor(lus.length / 3);
  const seg = [lus.slice(0, tiers), lus.slice(tiers, 2 * tiers), lus.slice(2 * tiers)];
  const p = seg.map((s) => stat(s));
  const g = stat(lus);
  console.log("  %s %s %s %s %s",
    String(t).padStart(6),
    (p[0] ? p[0].pente.toFixed(1) : "—").padStart(12),
    (p[1] ? p[1].pente.toFixed(1) : "—").padStart(14),
    (p[2] ? p[2].pente.toFixed(1) : "—").padStart(13),
    g.pente.toFixed(1).padStart(11));
}

// ── 2. LA GEOMETRIE DU GAMUT ────────────────────────────────────────────────
console.log("");
console.log("2. OU SONT LES FRONTIERES — les primaires sRGB, en angle OKLab.");
console.log("");
const COINS = [
  ["rouge sRGB", [1, 0, 0]], ["jaune sRGB", [1, 1, 0]], ["vert sRGB", [0, 1, 0]],
  ["cyan sRGB", [0, 1, 1]], ["bleu sRGB", [0, 0, 1]], ["magenta sRGB", [1, 0, 1]],
];
console.log("  coin           angle OKLab   teinte de roue ProPhoto lin. qui vise cet angle");
console.log("  " + "".padEnd(76, "-"));
for (const [nom, rgb] of COINS) {
  const a = deg(...linearSrgbToOklab(rgb.map(srgbToLinear)).slice(1));
  // Quelle position de roue h le modele ProPhoto lineaire envoie-t-il sur cet angle ?
  let meilleur = 0, best = Infinity;
  for (let h = 0; h < 360; h += 0.1) {
    const d = Math.abs(ecartAngle(angleProPhotoLineaire(h), a));
    if (d < best) { best = d; meilleur = h; }
  }
  console.log("  %s %s %s", nom.padEnd(14), a.toFixed(2).padStart(11), meilleur.toFixed(1).padStart(30));
}
console.log("");
console.log("  Le VERT sRGB est le coin du gamut le plus pauvre en chroma dans les basses");
console.log("  clartes : c'est une primaire dont la clarte OKLab est haute (0,87), donc un");
console.log("  gris sombre ne peut presque pas s'en approcher sans sortir.");
console.log("");
console.log("  CHROMA MAXIMALE DU GAMUT sRGB, par direction et par clarte :");
console.log("");
console.log("  teinte  direction  cmax(L=.25)  cmax(L=.40)  cmax(L=.55)   chroma mesuree max");
console.log("  " + "".padEnd(80, "-"));
for (const t of TEINTES) {
  const lus = TOUT[t].filter((p) => p.lisible);
  const a = stat(lus).moyen;
  const cmes = Math.max(...lus.map((p) => p.chroma));
  console.log("  %s %s %s %s %s %s",
    String(t).padStart(6), a.toFixed(1).padStart(10),
    chromaMax(0.25, a).toFixed(4).padStart(12), chromaMax(0.40, a).toFixed(4).padStart(12),
    chromaMax(0.55, a).toFixed(4).padStart(12), cmes.toFixed(4).padStart(20));
}

// Occupation du gamut : la chroma mesuree touche-t-elle le plafond du gamut ?
console.log("");
console.log("  OCCUPATION DU GAMUT (chroma mesuree / chroma max a la MEME clarte) :");
console.log("  1,00 = la couleur est POSEE SUR la frontiere, donc ecretee.");
console.log("");
console.log("  teinte  niv.20  niv.40  niv.60  niv.90  niv.130  niv.180   niv. a plus de 0,95");
console.log("  " + "".padEnd(84, "-"));
for (const t of TEINTES) {
  const pts = TOUT[t];
  const occ = (n) => { const p = pts[n]; const m = chromaMax(p.L, p.angle); return m > 0 ? p.chroma / m : NaN; };
  const lus = pts.filter((p) => p.lisible);
  const colles = lus.filter((p) => { const m = chromaMax(p.L, p.angle); return m > 0 && p.chroma / m > 0.95; }).length;
  console.log("  %s %s %s %s %s %s %s %s",
    String(t).padStart(6), occ(20).toFixed(2).padStart(7), occ(40).toFixed(2).padStart(7),
    occ(60).toFixed(2).padStart(7), occ(90).toFixed(2).padStart(7), occ(130).toFixed(2).padStart(8),
    occ(180).toFixed(2).padStart(8), String(colles).padStart(21));
}

// ── 3. LA DERIVE CORRELE-T-ELLE AVEC QUOI ? ─────────────────────────────────
console.log("");
console.log("3. AVEC QUOI LA DERIVE CORRELE — chroma, clarte, ou proximite du plancher ?");
console.log("");
const pearson = (xs, ys) => {
  const n = xs.length; if (n < 8) return NaN;
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = xs[i] - mx, dy = ys[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
};
console.log("  teinte   r(angle,chroma)  r(angle,clarte)  r(angle,marge au plancher)");
console.log("  " + "".padEnd(74, "-"));
for (const t of TEINTES) {
  const lus = TOUT[t].filter((p) => p.lisible);
  const m = stat(lus).moyen;
  const dev = lus.map((p) => ecartAngle(p.angle, m));
  // « marge au plancher » = le canal le plus bas, borne a 8 : au-dela le plancher
  // ne joue plus, et sans la borne la variable mesurerait surtout la clarte.
  const marge = lus.map((p) => Math.min(p.min, 8));
  console.log("  %s %s %s %s",
    String(t).padStart(6),
    pearson(lus.map((p) => p.chroma), dev).toFixed(3).padStart(16),
    pearson(lus.map((p) => p.L), dev).toFixed(3).padStart(16),
    pearson(marge, dev).toFixed(3).padStart(27));
}

// ── 4. LA BANDE PROPRE — UNE SEULE REGLE, LES ONZE TEINTES ──────────────────
console.log("");
console.log("4. LA BANDE PROPRE — niveaux dont AUCUN canal ne touche un rail.");
console.log("");
console.log("   Regle unique : min(R,V,B) >= S et max(R,V,B) <= 255-S, chroma >= 0,02.");
console.log("   Appliquee aux ONZE teintes. Balayage de S pour montrer que le resultat");
console.log("   ne tient pas au seuil choisi.");
console.log("");
const bande = (t, S) => TOUT[t].filter((p) => p.lisible && p.min >= S && p.max <= 255 - S);
console.log("  S      teinte 140                    teinte 150                  moyenne des 11");
console.log("         lus   angle   residu  e-type  lus   angle   residu  e-type   residu ProPhoto");
console.log("  " + "".padEnd(92, "-"));
for (const S of [0, 0.5, 1, 2, 4, 8]) {
  const cells = [];
  for (const t of [140, 150]) {
    const st = stat(bande(t, S));
    if (!st) { cells.push("   —       —        —       —"); continue; }
    const r = ecartAngle(st.moyen, angleProPhotoLineaire(t));
    cells.push(`${String(st.k).padStart(5)} ${st.moyen.toFixed(1).padStart(7)} ${((r >= 0 ? "+" : "") + r.toFixed(1)).padStart(8)} ${st.et.toFixed(2).padStart(7)}`);
  }
  let somme = 0, cpt = 0;
  for (const t of TEINTES) {
    const st = stat(bande(t, S));
    if (!st) continue;
    somme += Math.abs(ecartAngle(st.moyen, angleProPhotoLineaire(t))); cpt++;
  }
  console.log("  %s %s  %s %s",
    String(S).padStart(4), cells[0], cells[1], (somme / cpt).toFixed(2).padStart(14));
}

const S_RETENU = 2;
console.log("");
console.log("   AU SEUIL S = %d, LES ONZE TEINTES :", S_RETENU);
console.log("");
console.log("  teinte  lus   perdus  angle    e-type  derive/100  residu PP lin.  (avant)");
console.log("  " + "".padEnd(82, "-"));
const propre = {};
for (const t of TEINTES) {
  const tousLus = TOUT[t].filter((p) => p.lisible);
  const b = bande(t, S_RETENU);
  const st = stat(b), av = stat(tousLus);
  propre[t] = st;
  const r = ecartAngle(st.moyen, angleProPhotoLineaire(t));
  const rAv = ecartAngle(av.moyen, angleProPhotoLineaire(t));
  console.log("  %s %s %s %s %s %s %s %s",
    String(t).padStart(6), String(st.k).padStart(5), String(tousLus.length - st.k).padStart(7),
    st.moyen.toFixed(1).padStart(8), st.et.toFixed(2).padStart(8), st.pente.toFixed(1).padStart(11),
    ((r >= 0 ? "+" : "") + r.toFixed(1)).padStart(15),
    ((rAv >= 0 ? "+" : "") + rAv.toFixed(1)).padStart(9));
}

// ── 5. CE QUE LA BANDE PROPRE FAIT AU CLASSEMENT ────────────────────────────
console.log("");
console.log("5. LE CLASSEMENT DES FAMILLES, REFAIT SUR LA BANDE PROPRE.");
console.log("");
const FAMILLES = [
  ["A. HSL sur sRGB (en service)", angleSrgbHsl],
  ["B. angle direct OKLCh", angleOklchDirect],
  ["C. ProPhoto RGB (gamma 1,8)", angleProPhotoGamma],
  ["D. ProPhoto lineaire", angleProPhotoLineaire],
];
console.log("  famille                            avant (11 teintes)   bande propre   pire teinte");
console.log("  " + "".padEnd(86, "-"));
const rangs = FAMILLES.map(([nom, f]) => {
  let av = 0, ap2 = 0, pire = { t: 0, e: 0 };
  for (const t of TEINTES) {
    const stAv = stat(TOUT[t].filter((p) => p.lisible));
    av += Math.abs(ecartAngle(stAv.moyen, f(t)));
    const e = Math.abs(ecartAngle(propre[t].moyen, f(t)));
    ap2 += e;
    if (e > pire.e) pire = { t, e };
  }
  return { nom, av: av / TEINTES.length, ap: ap2 / TEINTES.length, pire };
}).sort((a, b) => a.ap - b.ap);
for (const r of rangs) {
  console.log("  %s %s %s   %s a %s deg",
    r.nom.padEnd(34), r.av.toFixed(2).padStart(15), r.ap.toFixed(2).padStart(14),
    String(r.pire.t).padStart(3), r.pire.e.toFixed(1));
}

// ── 6. LE TEST QUI TRANCHE — L'ECRETAGE REPRODUIT-IL LA DERIVE ? ────────────
console.log("");
console.log("6. TEST DIRECT — on REFABRIQUE la derive a partir de l'ecretage seul.");
console.log("");
console.log("   Protocole : on prend la direction ProPhoto lineaire de la teinte, on lui");
console.log("   donne a chaque niveau l'amplitude qu'il FAUDRAIT pour que la chroma qui");
console.log("   SORT apres ecretage canal-par-canal egale la chroma mesuree, puis on lit");
console.log("   l'angle qui sort. Aucun parametre ajuste : la direction vient du modele,");
console.log("   l'amplitude vient de la mesure. Si la derive apparait la, elle est de");
console.log("   l'ecretage et de rien d'autre.");
console.log("");
/** Sortie APRES ecretage canal-par-canal, pour une clarte, une direction, une
 *  amplitude demandee. On rend l'angle et la chroma REELLEMENT sortis. */
function apresEcretage(L, angleDeg, c) {
  const lin = oklabToLinearSrgb([L, c * Math.cos(rad(angleDeg)), c * Math.sin(rad(angleDeg))]);
  const lab = linearSrgbToOklab(lin.map((v) => Math.max(0, Math.min(1, v))));
  return { angle: deg(lab[1], lab[2]), chroma: Math.hypot(lab[1], lab[2]) };
}
console.log("  teinte   derive MESUREE   derive SIMULEE   angle moyen mes.  simule   modele");
console.log("  " + "".padEnd(84, "-"));
for (const t of TEINTES) {
  const lus = TOUT[t].filter((p) => p.lisible);
  const aModele = angleProPhotoLineaire(t);
  const simules = [];
  for (const p of lus) {
    // Amplitude demandee telle que la chroma SORTIE egale la chroma mesuree.
    let bas = 0, haut = 1.2;
    for (let i = 0; i < 40; i++) {
      const mid = (bas + haut) / 2;
      if (apresEcretage(p.L, aModele, mid).chroma < p.chroma) bas = mid; else haut = mid;
    }
    const s = apresEcretage(p.L, aModele, (bas + haut) / 2);
    simules.push({ n: p.n, angle: s.angle, chroma: Math.max(s.chroma, 1e-6) });
  }
  const sm = stat(simules), me = stat(lus);
  console.log("  %s %s %s %s %s %s",
    String(t).padStart(6), me.pente.toFixed(1).padStart(15), sm.pente.toFixed(1).padStart(16),
    me.moyen.toFixed(1).padStart(18), sm.moyen.toFixed(1).padStart(8), aModele.toFixed(1).padStart(8));
}
console.log("");
console.log("  Une derive simulee du meme SIGNE et du meme ORDRE que la mesuree, sur les");
console.log("  deux teintes malades ET pas sur les saines, ferme la question : l'angle ne");
console.log("  derive pas, c'est le gamut qui le rabat.");

// ── 7. LA FENETRE FAIT-ELLE LE TRAVAIL A LA PLACE DE L'ECRETAGE ? ───────────
console.log("");
console.log("7. CONTROLE DE LA FENETRE — le garde-fou de la section 4.");
console.log("");
console.log("   La bande propre de 140 et 150 est une FENETRE DE NIVEAUX HAUTS. Si le seul");
console.log("   fait de ne lire que ces niveaux-la deplacait deja l'angle, la correction");
console.log("   serait un artefact de selection et non une reparation. On impose donc la");
console.log("   MEME fenetre aux teintes saines, qui n'ont aucun canal ecrete dedans.");
console.log("");
const fen140 = bande(140, S_RETENU);
const N0 = fen140[0].n, N1 = fen140[fen140.length - 1].n;
console.log("   Fenetre de la bande propre de 140 : niveaux %d a %d (%d lus).", N0, N1, fen140.length);
console.log("");
console.log("  teinte  rampe entiere  meme fenetre   deplacement   chroma moy.  encore ecretes");
console.log("  " + "".padEnd(84, "-"));
for (const t of TEINTES) {
  const tous = TOUT[t].filter((p) => p.lisible);
  const dans = tous.filter((p) => p.n >= N0 && p.n <= N1);
  const a = stat(tous), b = stat(dans);
  if (!b) { console.log("  %s  trop peu de niveaux lisibles dans la fenetre", String(t).padStart(6)); continue; }
  const d = ecartAngle(b.moyen, a.moyen);
  const cm = dans.reduce((s, p) => s + p.chroma, 0) / dans.length;
  const ecrete = dans.filter((p) => p.min < S_RETENU).length;
  console.log("  %s %s %s %s %s %s",
    String(t).padStart(6), a.moyen.toFixed(1).padStart(14), b.moyen.toFixed(1).padStart(13),
    ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(13), cm.toFixed(4).padStart(12),
    String(ecrete).padStart(14));
}
console.log("");
console.log("  Un deplacement quasi nul sur les teintes SAINES et large sur les deux");
console.log("  malades : la fenetre ne deplace rien par elle-meme, c'est bien l'ecretage");
console.log("  qu'elle retire.");
