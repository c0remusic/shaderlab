// REFUTATION DE L'HYPOTHESE 4 — L'ECRETAGE DE GAMUT EST-IL DANS LA MESURE ?
//
// CE QUI EST CONTESTE. loi-h4-espaces.mjs conclut : « aucune famille n'atteint le
// bruit ; ProPhoto lineaire reste premiere a 5,00 deg ; le residu n'est PAS un
// choix d'espace mal devine ». La marche de ce raisonnement est la comparaison de
// 5,00 deg a un PLANCHER DE BRUIT de 1,28 a 2,51 deg.
//
// D'OU VIENT CE PLANCHER. De loi-de-teinte-controle.mjs, qui fabrique des rampes
// synthetiques sous une loi connue. Son propre en-tete dit, mot pour mot :
//   « Ce qui n'est PAS simule : l'ecretage de gamut, le bruit JPEG, et une
//     eventuelle derive de l'angle avec le niveau. »
// Le plancher a donc ete mesure dans un monde SANS ecretage, puis applique a des
// mesures qui, elles, en portent. Si l'ecretage biaise l'angle, le plancher est
// faux et la marche ne tient plus.
//
// CE QUE CE SCRIPT FAIT.
//   1. Recense l'ecretage REEL dans les onze mesures — combien de niveaux, et
//      surtout quelle PART DU POIDS de chroma que l'instrument moyenne.
//   2. Refait le controle manquant, en ABLATION A UN FACTEUR : on genere sous une
//      loi EXACTEMENT connue et on mesure ce que l'instrument en rend, avec et
//      sans ecretage, avec et sans quantification. Quatre bras, un facteur a la
//      fois. Si le bras « ecrete » rend un biais de l'ordre de 5 deg alors que la
//      loi generatrice est exacte, alors 5,00 deg est compatible avec « ProPhoto
//      lineaire est juste » et la conclusion contestee tombe.
//   3. Re-mesure le reel sur les seuls niveaux NON ecretes et re-classe.
//
// L'INSTRUMENT DE LECTURE EST RECOPIE DE loi-h4-espaces.mjs A LA LIGNE PRES
// (seuil 0,02, moyenne circulaire ponderee par la chroma), pour que les chiffres
// soient comparables aux siens.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];

// ── ALGEBRE ET COLORIMETRIE, reprises de loi-h4 sans y toucher ──────────────
const mv = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
const mm = (a, b) => a.map((r) => [0, 1, 2].map((j) => r[0] * b[0][j] + r[1] * b[1][j] + r[2] * b[2][j]));
function inv(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const diag = (v) => [[v[0], 0, 0], [0, v[1], 0], [0, 0, v[2]]];
const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];
function rgbVersXyz(prim, blancXy) {
  const W = xyToXYZ(blancXy);
  const Mp = [0, 1, 2].map((l) => prim.map((p) => xyToXYZ(p)[l]));
  return mm(Mp, diag(mv(inv(Mp), W)));
}
const PRIM = {
  srgb:     [[0.64, 0.33], [0.30, 0.60], [0.15, 0.06]],
  adobe:    [[0.64, 0.33], [0.21, 0.71], [0.15, 0.06]],
  p3:       [[0.680, 0.320], [0.265, 0.690], [0.150, 0.060]],
  rec2020:  [[0.708, 0.292], [0.170, 0.797], [0.131, 0.046]],
  prophoto: [[0.734699, 0.265301], [0.159597, 0.840403], [0.036598, 0.000105]],
  ap1:      [[0.713, 0.293], [0.165, 0.830], [0.128, 0.044]],
  ap0:      [[0.7347, 0.2653], [0.0, 1.0], [0.0001, -0.0770]],
};
const BLANC = { D65: [0.3127, 0.3290], D50: [0.34567, 0.35850], ACES: [0.32168, 0.33767] };
const CONES = {
  bradford: [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]],
  vonkries: [[0.40024, 0.70760, -0.08081], [-0.22630, 1.16532, 0.04570], [0.0, 0.0, 0.91822]],
  xyz:      [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
};
function adaptation(srcXy, dstXy, nomCone) {
  if (nomCone === null) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  const Ma = CONES[nomCone];
  const s = mv(Ma, xyToXYZ(srcXy)), d = mv(Ma, xyToXYZ(dstXy));
  return mm(inv(Ma), mm(diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), Ma));
}
const XYZ_D65_VERS_SRGB_LIN = inv(rgbVersXyz(PRIM.srgb, BLANC.D65));
function familleRgb(espace, blanc, cone, gamma) {
  const Mfin = mm(XYZ_D65_VERS_SRGB_LIN, mm(adaptation(BLANC[blanc], BLANC.D65, cone), rgbVersXyz(PRIM[espace], BLANC[blanc])));
  return (h) => {
    let rgb = hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
    if (gamma === "srgb") rgb = rgb.map((c) => srgbToLinear(c));
    else if (typeof gamma === "number") rgb = rgb.map((c) => Math.pow(c, gamma));
    const lab = linearSrgbToOklab(mv(Mfin, rgb));
    return deg(lab[1], lab[2]);
  };
}
function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  return deg(lab[1], lab[2]);
}
const LOI_D = familleRgb("prophoto", "D50", "bradford", null); // la gagnante contestee

// ── L'INSTRUMENT ────────────────────────────────────────────────────────────
/** Lit une rampe [R,G,B] 0-255 et rend l'angle moyen, comme loi-h4.
 *  `filtre` permet de ne garder que les niveaux NON ecretes. */
function lire(rampe, filtre = () => true) {
  const lus = [];
  let poidsTotal = 0, poidsEcrete = 0;
  for (let n = 0; n <= 255; n++) {
    const p = rampe[n];
    const lab = linearSrgbToOklab([s2l(p[0] / 255), s2l(p[1] / 255), s2l(p[2] / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    if (c < SEUIL) continue;
    poidsTotal += c;
    const ecrete = Math.min(...p) <= 0.5 || Math.max(...p) >= 254.5;
    if (ecrete) poidsEcrete += c;
    if (!filtre(p, n)) continue;
    lus.push([deg(lab[1], lab[2]), c]);
  }
  if (lus.length < 20) return null;
  let sx = 0, sy = 0;
  for (const [a, c] of lus) { sx += c * Math.cos((a * Math.PI) / 180); sy += c * Math.sin((a * Math.PI) / 180); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(lus.reduce((s, [a]) => s + ecartAngle(a, moyen) ** 2, 0) / lus.length);
  return { niveaux: lus.length, moyen, ecartType: et, partEcretee: poidsTotal ? poidsEcrete / poidsTotal : 0 };
}
const nonEcrete = (p) => Math.min(...p) > 0.5 && Math.max(...p) < 254.5;
const rampeDe = (nom) => JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe_rgb;

console.log("REFUTATION H4 — L'ECRETAGE DE GAMUT EST-IL DANS LA MESURE ?");
console.log("");

// ── 1. LE RECENSEMENT ───────────────────────────────────────────────────────
console.log("1. RECENSEMENT DE L'ECRETAGE DANS LES ONZE MESURES REELLES");
console.log("");
console.log("Un canal a 0 (ou a 255) veut dire que la couleur demandee SORT du sRGB et a");
console.log("ete rabattue sur sa frontiere. L'angle lu n'y est plus celui du vecteur ajoute :");
console.log("c'est celui de sa PROJECTION. La colonne qui compte est la part du POIDS, car");
console.log("l'instrument fait une moyenne PONDEREE PAR LA CHROMA.");
console.log("");
console.log("teinte  niveaux lus  niveaux ecretes  PART DU POIDS ecretee  canal  residu D  derive");
console.log("".padEnd(94, "-"));
const RESIDU_D = { 0: -7.5, 40: -4.2, 60: -2.8, 90: -0.0, 140: -8.2, 150: -7.3, 180: -0.5, 220: 21.3, 270: -2.0, 300: -0.9, 330: -0.2 };
const DERIVE = { 0: -1.4, 40: -1.8, 60: -1.8, 90: -2.1, 140: 9.9, 150: 9.4, 180: 2.7, 220: 1.9, 270: 0.7, 300: 0.1, 330: -0.8 };
const reel = {};
for (const t of TEINTES) {
  const r = rampeDe(`st-h${String(t).padStart(3, "0")}`);
  const tout = lire(r);
  const propre = lire(r, nonEcrete);
  let nEcr = 0; const canaux = new Set();
  for (let n = 0; n <= 255; n++) {
    const lab = linearSrgbToOklab([s2l(r[n][0] / 255), s2l(r[n][1] / 255), s2l(r[n][2] / 255)]);
    if (Math.hypot(lab[1], lab[2]) < SEUIL) continue;
    if (!nonEcrete(r[n])) { nEcr++; canaux.add("RGB"[r[n].indexOf(Math.min(...r[n]))]); }
  }
  reel[t] = { rampe: r, tout, propre, nEcr };
  console.log("%s %s %s %s   %s %s %s",
    String(t).padStart(6), String(tout.niveaux).padStart(12), String(nEcr).padStart(16),
    (100 * tout.partEcretee).toFixed(1).padStart(21) + " %", [...canaux].sort().join("").padEnd(6),
    RESIDU_D[t].toFixed(1).padStart(8), DERIVE[t].toFixed(1).padStart(7));
}
console.log("");
console.log("Les trois teintes ou l'angle DERIVE le plus avec le niveau (140, 150, 180 :");
console.log("+9,9 / +9,4 / +2,7 deg par 100 niveaux) sont exactement les trois ou l'ecretage");
console.log("emporte plus de 60 %% du poids. Une derive est ce que l'ecretage PRODUIT : la");
console.log("part rabattue grandit avec l'amplitude, donc l'angle tourne avec le niveau.");

// ── 2. LE CONTROLE MANQUANT, EN ABLATION A UN FACTEUR ───────────────────────
console.log("");
console.log("");
console.log("2. LE CONTROLE QUE loi-de-teinte-controle.mjs N'A PAS FAIT");
console.log("");
console.log("On genere les onze rampes sous la loi D — ProPhoto D50/Bradford lineaire —");
console.log("EXACTEMENT. La luminance par niveau est celle du temoin (mesure : le temoin est");
console.log("neutre au centieme, 0/0/0 a 255/255/255) et l'amplitude de chroma par niveau est");
console.log("celle que la mesure REELLE de la meme teinte porte, remise a l'echelle jusqu'a");
console.log("reproduire la part de poids ecretee observee. La loi generatrice etant exacte,");
console.log("tout ecart que l'instrument rendra est un ARTEFACT DE MESURE, pas une loi fausse.");
console.log("");
console.log("Quatre bras, UN FACTEUR A LA FOIS :");
console.log("  (a) ni ecretage ni quantification  — controle de sanite, doit rendre 0");
console.log("  (b) quantification seule           — le plancher qu'il a mesure");
console.log("  (c) ECRETAGE SEUL                  — le facteur qu'il n'a pas simule");
console.log("  (d) les deux                       — la condition reelle");
console.log("");

const temoin = rampeDe("temoin4");
const Ltemoin = [];
for (let n = 0; n <= 255; n++) Ltemoin.push(linearSrgbToOklab([s2l(temoin[n][0] / 255), s2l(temoin[n][1] / 255), s2l(temoin[n][2] / 255)])[0]);

/** Fabrique une rampe sous un angle EXACT, avec un profil d'amplitude donne. */
function fabrique(angleVrai, amp, echelle, ecreter, quantifier) {
  const a = (angleVrai * Math.PI) / 180;
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const c = amp[n] * echelle;
    let rgb = oklabToLinearSrgb([Ltemoin[n], c * Math.cos(a), c * Math.sin(a)]);
    let enc = rgb.map((v) => (v >= 0 ? linearToSrgb(v) : -linearToSrgb(-v)));
    if (ecreter) enc = enc.map((v) => Math.max(0, Math.min(1, v)));
    let v255 = enc.map((v) => v * 255);
    if (quantifier) v255 = v255.map((v) => Math.round(v));
    out.push(v255);
  }
  return out;
}
/** Profil d'amplitude REEL de la teinte, tel que la mesure le porte. */
function profil(t) {
  const r = reel[t].rampe, amp = [];
  for (let n = 0; n <= 255; n++) {
    const lab = linearSrgbToOklab([s2l(r[n][0] / 255), s2l(r[n][1] / 255), s2l(r[n][2] / 255)]);
    amp.push(Math.hypot(lab[1], lab[2]));
  }
  return amp;
}
/** Cherche l'echelle qui reproduit la part de poids ecretee observee. */
function caleEchelle(t, angleVrai, amp, cible) {
  let lo = 0.5, hi = 6.0;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    const l = lire(fabrique(angleVrai, amp, mid, true, false));
    if (!l) { hi = mid; continue; }
    if (l.partEcretee < cible) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

console.log("teinte  vrai angle   (a) rien   (b) quant.   (c) ECRETAGE   (d) les deux   part ecretee   | residu REEL");
console.log("".padEnd(118, "-"));
const biais = { a: [], b: [], c: [], d: [] };
for (const t of TEINTES) {
  const vrai = LOI_D(t);
  const amp = profil(t);
  const cible = reel[t].tout.partEcretee;
  const ech = cible > 0.005 ? caleEchelle(t, vrai, amp, cible) : 1.0;
  const bras = {
    a: lire(fabrique(vrai, amp, ech, false, false)),
    b: lire(fabrique(vrai, amp, ech, false, true)),
    c: lire(fabrique(vrai, amp, ech, true, false)),
    d: lire(fabrique(vrai, amp, ech, true, true)),
  };
  const e = {};
  for (const k of ["a", "b", "c", "d"]) { e[k] = bras[k] ? ecartAngle(bras[k].moyen, vrai) : NaN; biais[k].push(Math.abs(e[k])); }
  console.log("%s %s %s %s %s %s %s   | %s",
    String(t).padStart(6), vrai.toFixed(1).padStart(11),
    e.a.toFixed(2).padStart(10), e.b.toFixed(2).padStart(12), e.c.toFixed(2).padStart(14),
    e.d.toFixed(2).padStart(14), ((100 * (bras.d ? bras.d.partEcretee : 0)).toFixed(0) + " %").padStart(14),
    RESIDU_D[t].toFixed(1).padStart(10));
}
const moy = (x) => x.reduce((s, v) => s + v, 0) / x.length;
console.log("".padEnd(118, "-"));
console.log("%s %s %s %s %s",
  "ecart moyen absolu".padStart(18), moy(biais.a).toFixed(2).padStart(10), moy(biais.b).toFixed(2).padStart(12),
  moy(biais.c).toFixed(2).padStart(14), moy(biais.d).toFixed(2).padStart(14));
console.log("");
console.log("LECTURE. (a) doit valoir 0 : si oui, la chaine de fabrication est saine.");
console.log("(b) est le plancher qu'il a mesure et annonce a 1,28-2,51 deg.");
console.log("(c) est le facteur qu'il n'a JAMAIS simule, et (d) la condition reelle.");
console.log("Le nombre a comparer a ses 5,00 deg est (d), pas (b).");

// ── 3. LE REEL, SUR LES SEULS NIVEAUX NON ECRETES ───────────────────────────
console.log("");
console.log("");
console.log("3. LE REEL RE-MESURE SUR LES SEULS NIVEAUX NON ECRETES");
console.log("");
console.log("teinte  angle TOUT  angle PROPRE  difference  niveaux propres  ecart-type tout / propre");
console.log("".padEnd(98, "-"));
for (const t of TEINTES) {
  const a = reel[t].tout, b = reel[t].propre;
  if (!b) { console.log("%s   trop peu de niveaux propres pour mesurer", String(t).padStart(6)); continue; }
  console.log("%s %s %s %s %s %s / %s",
    String(t).padStart(6), a.moyen.toFixed(2).padStart(11), b.moyen.toFixed(2).padStart(13),
    ecartAngle(b.moyen, a.moyen).toFixed(2).padStart(11), String(b.niveaux).padStart(16),
    a.ecartType.toFixed(2).padStart(13), b.ecartType.toFixed(2));
}

// ── 4. RE-CLASSEMENT, PLUS LES FAMILLES QUE H4 A OUBLIEES ───────────────────
console.log("");
console.log("");
console.log("4. RE-CLASSEMENT SUR LA MESURE PROPRE — et les familles que H4 n'a pas listees");
console.log("");
console.log("⚠️ H4 a balaye 28 candidates et applique la courbe sRGB a Display P3 (famille R),");
console.log("mais JAMAIS a ProPhoto. Or « ProPhoto primaires + courbe sRGB » est precisement");
console.log("Melissa RGB, l'espace d'affichage du module Develop de Lightroom. C'est la");
console.log("candidate la plus documentee du dossier, et elle manque a sa liste.");
console.log("");
const FAMILLES = [
  ["A. HSL sur sRGB (en service)", angleSrgbHsl],
  ["C. ProPhoto D50/Bradford gamma 1,8", familleRgb("prophoto", "D50", "bradford", 1.8)],
  ["D. ProPhoto D50/Bradford lineaire", LOI_D],
  ["H. ProPhoto prim. + D65 sans adapt., lin.", familleRgb("prophoto", "D65", null, null)],
  ["K. ProPhoto D50 / XYZ scaling, lineaire", familleRgb("prophoto", "D50", "xyz", null)],
  ["O. Rec.2020 lineaire", familleRgb("rec2020", "D65", null, null)],
  ["P. ACEScg (AP1) lineaire", familleRgb("ap1", "ACES", "bradford", null)],
  ["M. sRGB lineaire", familleRgb("srgb", "D65", null, null)],
  ["N. Display P3 lineaire", familleRgb("p3", "D65", null, null)],
  ["F. Adobe RGB lineaire", familleRgb("adobe", "D65", null, null)],
  // ── LES MANQUANTES ────────────────────────────────────────────────────────
  ["d1. MELISSA RGB (ProPhoto D50/Bradford + courbe sRGB)", familleRgb("prophoto", "D50", "bradford", "srgb")],
  ["d2. Melissa, D65 sans adaptation + courbe sRGB", familleRgb("prophoto", "D65", null, "srgb")],
  ["d3. Melissa, D50 / XYZ scaling + courbe sRGB", familleRgb("prophoto", "D50", "xyz", "srgb")],
  ["d4. Rec.2020 + courbe sRGB", familleRgb("rec2020", "D65", null, "srgb")],
  ["d5. Adobe RGB + courbe sRGB", familleRgb("adobe", "D65", null, "srgb")],
];
function classe(getAngle, etiquette) {
  const pts = TEINTES.map((t) => ({ t, m: getAngle(t) })).filter((x) => x.m !== null);
  const r = FAMILLES.map(([nom, f]) => {
    const res = pts.map((p) => ({ t: p.t, r: ecartAngle(p.m, f(p.t)) }));
    const abs = res.map((x) => Math.abs(x.r)).sort((a, b) => a - b);
    const moyenne = abs.reduce((s, x) => s + x, 0) / abs.length;
    const med = abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2;
    return { nom, moy: moyenne, med, res };
  }).sort((a, b) => a.moy - b.moy);
  console.log("%s  (%d teintes)", etiquette, pts.length);
  console.log("  rang  famille                                                  ecart moyen   mediane");
  console.log("  " + "".padEnd(96, "-"));
  r.forEach((c, i) => console.log("  %s  %s %s %s",
    String(i + 1).padStart(4), c.nom.padEnd(54), c.moy.toFixed(2).padStart(11), c.med.toFixed(2).padStart(9)));
  console.log("");
  return r;
}
classe((t) => reel[t].tout.moyen, "SUR TOUS LES NIVEAUX (la mesure de H4, pour l'ancrage)");
const propre = classe((t) => (reel[t].propre ? reel[t].propre.moyen : null), "SUR LES SEULS NIVEAUX NON ECRETES");

console.log("RESIDU PAR TEINTE SUR LA MESURE PROPRE — les quatre premieres");
console.log("");
console.log("%s%s", "famille".padEnd(54), TEINTES.map((t) => String(t).padStart(7)).join(""));
console.log("".padEnd(54 + 7 * TEINTES.length, "-"));
for (const c of propre.slice(0, 4)) {
  const par = new Map(c.res.map((x) => [x.t, x.r]));
  console.log("%s%s", c.nom.padEnd(54), TEINTES.map((t) => (par.has(t) ? (par.get(t) >= 0 ? "+" : "") + par.get(t).toFixed(1) : "—").padStart(7)).join(""));
}
