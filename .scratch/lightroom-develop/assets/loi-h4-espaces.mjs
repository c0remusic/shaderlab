// HYPOTHESE 4 — UNE AUTRE FAMILLE D'ESPACE BAT-ELLE ProPhoto LINEAIRE ?
//
// CE QUI PRECEDE. Sur les onze teintes de la campagne A (roue des ombres,
// SplitToningBalance=-100, saturation 60), le classement a zero parametre dit :
//   D. ProPhoto RGB lineaire ....... 5,00 deg
//   C. ProPhoto RGB gamma 1,8 ...... 8,91
//   B. angle direct OKLCh .......... 13,41
//   A. HSL sur sRGB (en service) ... 13,42
// Le controle synthetique (loi-de-teinte-controle.mjs) a mesure le plancher de
// bruit de la quantification 8 bits : 1,28 a 2,51 degres MEME QUAND LA LOI EST
// EXACTE. 5,00 porte donc encore de la structure.
//
// CE QUE CE SCRIPT FAIT. Il balaie systematiquement d'autres familles a ZERO
// PARAMETRE — chacune une hypothese sur ce que le selecteur de teinte de
// Lightroom appelle « teinte ». Aucun parametre ajustable nulle part : une
// famille a 0 parametre qui bat une famille ajustee est un resultat fort,
// l'inverse ne prouve rien.
//
// L'INSTRUMENT EST CELUI DE loi-de-teinte.mjs, A LA LIGNE PRES : angle OKLab de
// la chroma de sortie, moyenne circulaire ponderee par la chroma, seuil 0,02.
// Sur une rampe de gris la chroma d'entree est nulle, donc la chroma de sortie
// EST le vecteur ajoute par la roue.
//
// LES MATRICES NE SONT PAS RECOPIEES, ELLES SONT CALCULEES depuis les
// chromaticites et le point blanc — c'est la seule facon de faire varier
// l'adaptation chromatique (Bradford / von Kries / XYZ scaling) sans recopier
// trois jeux de neuf nombres. Garde-fou : la voie ProPhoto D50+Bradford ainsi
// calculee est comparee aux matrices de Lindbloom codees en dur dans
// loi-de-teinte.mjs, et doit rendre le MEME angle.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;
const BRUIT_HAUT = 3.0; // plancher mesure par le controle synthetique : 1,28 a 2,51

// ── ALGEBRE 3x3 ─────────────────────────────────────────────────────────────
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

// ── COLORIMETRIE : matrice espace -> XYZ depuis les chromaticites ───────────
const xyToXYZ = ([x, y]) => [x / y, 1, (1 - x - y) / y];
function rgbVersXyz(prim, blancXy) {
  const W = xyToXYZ(blancXy);
  const Mp = [0, 1, 2].map((l) => prim.map((p) => xyToXYZ(p)[l]));
  const S = mv(inv(Mp), W);
  return mm(Mp, diag(S));
}

// Chromaticites (CIE xy) et points blancs.
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

// Matrices de reponse des cones — c'est ELLES qui distinguent les adaptations.
const CONES = {
  bradford: [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]],
  vonkries: [[0.40024, 0.70760, -0.08081], [-0.22630, 1.16532, 0.04570], [0.0, 0.0, 0.91822]],
  xyz:      [[1, 0, 0], [0, 1, 0], [0, 0, 1]], // « XYZ scaling » = pas de passage aux cones
};
function adaptation(srcXy, dstXy, nomCone) {
  if (nomCone === null) return [[1, 0, 0], [0, 1, 0], [0, 0, 1]]; // AUCUNE adaptation
  const Ma = CONES[nomCone];
  const s = mv(Ma, xyToXYZ(srcXy)), d = mv(Ma, xyToXYZ(dstXy));
  return mm(inv(Ma), mm(diag([d[0] / s[0], d[1] / s[1], d[2] / s[2]]), Ma));
}
const XYZ_D65_VERS_SRGB_LIN = inv(rgbVersXyz(PRIM.srgb, BLANC.D65));

/** Fabrique la fonction « teinte -> angle OKLab » d'un espace RGB.
 *  @param espace  cle de PRIM
 *  @param blanc   cle de BLANC
 *  @param cone    "bradford" | "vonkries" | "xyz" | null (aucune adaptation)
 *  @param gamma   null = roue posee sur les valeurs LINEAIRES ; un nombre =
 *                 roue posee sur les valeurs ENCODEES, linearisees par ce gamma ;
 *                 "srgb" = courbe sRGB.
 */
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

// ── CIE Lab / Luv ───────────────────────────────────────────────────────────
const f_1 = (t) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
function labVersXyz(L, a, b, blancXy) {
  const W = xyToXYZ(blancXy);
  const fy = (L + 16) / 116;
  return [W[0] * f_1(fy + a / 500), W[1] * f_1(fy), W[2] * f_1(fy - b / 200)];
}
function luvVersXyz(L, u, v, blancXy) {
  const W = xyToXYZ(blancXy);
  const un = (4 * W[0]) / (W[0] + 15 * W[1] + 3 * W[2]);
  const vn = (9 * W[1]) / (W[0] + 15 * W[1] + 3 * W[2]);
  const Y = W[1] * (L > 8 ? ((L + 16) / 116) ** 3 : L * (3 / 29) ** 3);
  if (L === 0) return [0, 0, 0];
  const uu = u / (13 * L) + un, vv = v / (13 * L) + vn;
  const X = Y * ((9 * uu) / (4 * vv));
  const Z = Y * ((12 - 3 * uu - 20 * vv) / (4 * vv));
  return [X, Y, Z];
}
const xyzVersOklabAngle = (xyz) => { const lab = linearSrgbToOklab(mv(XYZ_D65_VERS_SRGB_LIN, xyz)); return deg(lab[1], lab[2]); };

/** Famille LCh : la teinte EST l'angle du plan (a,b) de Lab (ou (u,v) de Luv).
 *  @param zero  "rouge" = l'angle 0 du selecteur est cale sur le ROUGE sRGB pur ;
 *               "axe"   = l'angle 0 est l'axe +a (resp. +u).
 *  @param mode  "fini" = locus a L*=50, C*=50 ; "infini" = direction ajoutee a un
 *               gris L*=50, lue a chroma infinitesimale (ce que fait la roue). */
function familleLch(quel, blanc, zero, mode, Lstar = 50, Cstar = 50) {
  const versXyz = quel === "lab" ? labVersXyz : luvVersXyz;
  const zeroDeg = zero === "axe" ? 0 : (() => {
    // Angle Lab/Luv du rouge sRGB pur — le zero du selecteur de Lightroom.
    const X = mv(rgbVersXyz(PRIM.srgb, BLANC.D65), [1, 0, 0]);
    const W = xyToXYZ(BLANC[blanc]);
    if (quel === "lab") {
      const f = (t) => (t > (6 / 29) ** 3 ? Math.cbrt(t) : t / (3 * (6 / 29) ** 2) + 4 / 29);
      const fx = f(X[0] / W[0]), fy = f(X[1] / W[1]), fz = f(X[2] / W[2]);
      return deg(500 * (fx - fy), 200 * (fy - fz));
    }
    const den = X[0] + 15 * X[1] + 3 * X[2];
    const up = (4 * X[0]) / den, vp = (9 * X[1]) / den;
    const dn = W[0] + 15 * W[1] + 3 * W[2];
    const un = (4 * W[0]) / dn, vn = (9 * W[1]) / dn;
    const L = 116 * Math.cbrt(X[1] / W[1]) - 16;
    return deg(13 * L * (up - un), 13 * L * (vp - vn));
  })();
  return (h) => {
    const a = ((zeroDeg + h) * Math.PI) / 180;
    if (mode === "fini") return xyzVersOklabAngle(versXyz(Lstar, Cstar * Math.cos(a), Cstar * Math.sin(a), BLANC[blanc]));
    const eps = 0.25;
    const g = linearSrgbToOklab(mv(XYZ_D65_VERS_SRGB_LIN, versXyz(Lstar, 0, 0, BLANC[blanc])));
    const c = linearSrgbToOklab(mv(XYZ_D65_VERS_SRGB_LIN, versXyz(Lstar, eps * Math.cos(a), eps * Math.sin(a), BLANC[blanc])));
    return deg(c[1] - g[1], c[2] - g[2]);
  };
}

// ── LA ROUE ARTISTIQUE RYB (Gossett & Chen) ─────────────────────────────────
// Huit coins du cube RYB, en valeurs d'AFFICHAGE sRGB. Interpolation trilineaire.
const RYB_COINS = {
  "000": [1, 1, 1],       // blanc
  "100": [1, 0, 0],       // rouge
  "010": [1, 1, 0],       // jaune
  "001": [0, 0, 1],       // bleu
  "110": [1, 0.5, 0],     // orange
  "101": [0.5, 0, 0.5],   // violet
  "011": [0, 0.66, 0.2],  // vert
  "111": [0, 0, 0],       // noir
};
function rybVersRgb(r, y, b) {
  const out = [0, 1, 2].map((k) => {
    let s = 0;
    for (const [cle, col] of Object.entries(RYB_COINS)) {
      const [i, j, l] = cle.split("").map(Number);
      s += (i ? r : 1 - r) * (j ? y : 1 - y) * (l ? b : 1 - b) * col[k];
    }
    return s;
  });
  return out;
}
/** Roue d'artiste : rouge 0, jaune 120, bleu 240 — les trois primaires a 120 deg. */
function angleRyb(h) {
  const t = (((h % 360) + 360) % 360) / 120;
  const i = Math.floor(t), f = t - i;
  const ryb = [0, 0, 0];
  ryb[i % 3] = 1 - f;
  ryb[(i + 1) % 3] = f;
  const rgb = rybVersRgb(ryb[0], ryb[1], ryb[2]);
  const lab = linearSrgbToOklab(rgb.map((c) => srgbToLinear(Math.min(1, Math.max(0, c)))));
  return deg(lab[1], lab[2]);
}

// ── INTERPOLATION ENTRE LES SIX PRIMAIRES / SECONDAIRES sRGB ────────────────
const SIX = [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1], [1, 0, 1]]; // 0/60/.../300
function angleSixLineaire(h) {
  const t = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(t), f = t - i;
  const A = SIX[i % 6], B = SIX[(i + 1) % 6];
  // Les six coins valent 0 ou 1, donc encode == lineaire AU COIN : la difference
  // avec la famille en service tient entierement au chemin entre deux coins.
  const lin = [0, 1, 2].map((k) => A[k] * (1 - f) + B[k] * f);
  const lab = linearSrgbToOklab(lin);
  return deg(lab[1], lab[2]);
}
const SIX_AB = SIX.map((c) => linearSrgbToOklab(c).slice(1));
function angleSixOklab(h) {
  const t = (((h % 360) + 360) % 360) / 60;
  const i = Math.floor(t), f = t - i;
  const A = SIX_AB[i % 6], B = SIX_AB[(i + 1) % 6];
  return deg(A[0] * (1 - f) + B[0] * f, A[1] * (1 - f) + B[1] * f);
}

// ── LES DEUX FAMILLES DE REFERENCE, RECOPIEES A L'IDENTIQUE ─────────────────
function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  return deg(lab[1], lab[2]);
}
const PP_LINDBLOOM = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS_LINDBLOOM = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
function angleProPhotoLineaireLindbloom(h) {
  const rgb = hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
  return deg(...linearSrgbToOklab(mv(XS_LINDBLOOM, mv(PP_LINDBLOOM, rgb))).slice(1));
}
const ZERO_OKLCH = angleSrgbHsl(0);
const angleOklchDirect = (h) => ZERO_OKLCH + h;

// ── LECTURE DES MESURES (instrument de loi-de-teinte.mjs) ───────────────────
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
function mesure(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  const rgb = JSON.parse(readFileSync(f, "utf8")).rampe_rgb;
  const lus = [];
  for (let n = 0; n <= 255; n++) {
    const lab = linearSrgbToOklab([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    if (c >= SEUIL) lus.push([deg(lab[1], lab[2]), c]);
  }
  if (lus.length < 20) return { insuffisant: true };
  let sx = 0, sy = 0;
  for (const [a, c] of lus) { sx += c * Math.cos((a * Math.PI) / 180); sy += c * Math.sin((a * Math.PI) / 180); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(lus.reduce((s, [a]) => s + ecartAngle(a, moyen) ** 2, 0) / lus.length);
  return { niveaux: lus.length, moyen, ecartType: et };
}
const vus = [];
for (const t of TEINTES) {
  const m = mesure(`st-h${String(t).padStart(3, "0")}`);
  if (m && !m.insuffisant) vus.push({ teinte: t, mesure: m.moyen, ecartType: m.ecartType });
}

// ── GARDE-FOU 1 : l'instrument est-il bien LE MEME ? ────────────────────────
const ppCalculee = familleRgb("prophoto", "D50", "bradford", null);
let ecartInstrument = 0;
for (const t of TEINTES) ecartInstrument = Math.max(ecartInstrument, Math.abs(ecartAngle(ppCalculee(t), angleProPhotoLineaireLindbloom(t))));
console.log("HYPOTHESE 4 — LES FAMILLES D'ESPACE, A ZERO PARAMETRE");
console.log("");
console.log("GARDE-FOU 1 — matrices CALCULEES contre matrices de Lindbloom codees en dur");
console.log("  ProPhoto D50 + Bradford, ecart maximal sur les 11 teintes : %s deg", ecartInstrument.toFixed(4));
console.log("  %s", ecartInstrument < 0.05 ? "OK — c'est bien le meme instrument, la comparaison est licite." : "⚠️ DIVERGENCE : les chiffres ci-dessous ne sont PAS comparables au classement precedent.");
console.log("  Teintes lues : %d sur %d.", vus.length, TEINTES.length);

// ── GARDE-FOU 2 : HSV vaut-il HSL sur une couleur pure saturee ? ────────────
function hsv2rgb(h, s, v) {
  const c = v * s, x = c * (1 - Math.abs((((h / 60) % 2) + 2) % 2 - 1)), m = v - c;
  const i = Math.floor((((h % 360) + 360) % 360) / 60) % 6;
  const t = [[c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x]][i];
  return t.map((u) => u + m);
}
let pireHsv = 0;
for (let h = 0; h < 360; h += 0.5) {
  const a = hsl2rgb(h / 360, 1, 0.5), b = hsv2rgb(h, 1, 1);
  for (let k = 0; k < 3; k++) pireHsv = Math.max(pireHsv, Math.abs(a[k] - b[k]));
}
console.log("");
console.log("GARDE-FOU 2 — HSV(h,1,1) contre HSL(h,1,0.5), 720 teintes, par canal");
console.log("  ecart maximal : %s", pireHsv.toExponential(2));
console.log("  %s", pireHsv < 1e-12
  ? "MESURE, pas suppose : les deux sont IDENTIQUES sur une couleur pure saturee."
  : "⚠️ ils different — HSV merite alors sa propre entree au classement.");
console.log("  Consequence : toute famille « HSV sur l'espace X » est la MEME que « HSL sur");
console.log("  l'espace X ». Elles ne sont donc pas listees deux fois — ce serait doubler");
console.log("  des lignes identiques, pas tester une hypothese de plus.");

// ── LE CATALOGUE ────────────────────────────────────────────────────────────
const FAMILLES = [
  // Les quatre du classement precedent, pour l'ancrage.
  ["A. HSL sur sRGB (en service)", angleSrgbHsl],
  ["B. angle direct OKLCh (cale rouge)", angleOklchDirect],
  ["C. ProPhoto D50/Bradford gamma 1,8", familleRgb("prophoto", "D50", "bradford", 1.8)],
  ["D. ProPhoto D50/Bradford lineaire", familleRgb("prophoto", "D50", "bradford", null)],
  // Adobe RGB (1998).
  ["F. Adobe RGB lineaire", familleRgb("adobe", "D65", null, null)],
  ["G. Adobe RGB gamma 2,2", familleRgb("adobe", "D65", null, 563 / 256)],
  // ProPhoto : le point blanc et l'adaptation, un facteur a la fois.
  ["H. ProPhoto primaires + blanc D65 (aucune adaptation), lin.", familleRgb("prophoto", "D65", null, null)],
  ["I. ProPhoto primaires + blanc D65 (aucune adaptation), g1,8", familleRgb("prophoto", "D65", null, 1.8)],
  ["J. ProPhoto D50 / von Kries (HPE), lineaire", familleRgb("prophoto", "D50", "vonkries", null)],
  ["K. ProPhoto D50 / XYZ scaling, lineaire", familleRgb("prophoto", "D50", "xyz", null)],
  ["L. ProPhoto D50 / AUCUNE adaptation, lineaire", familleRgb("prophoto", "D50", null, null)],
  // L'echelle des gamuts, lineaire — un balayage, pas un choix.
  ["M. sRGB lineaire", familleRgb("srgb", "D65", null, null)],
  ["N. Display P3 lineaire", familleRgb("p3", "D65", null, null)],
  ["O. Rec.2020 lineaire", familleRgb("rec2020", "D65", null, null)],
  ["P. ACEScg (AP1) lineaire", familleRgb("ap1", "ACES", "bradford", null)],
  ["Q. ACES 2065-1 (AP0) lineaire", familleRgb("ap0", "ACES", "bradford", null)],
  ["R. Display P3, courbe sRGB", familleRgb("p3", "D65", null, "srgb")],
  ["S. Rec.2020 gamma 2,4", familleRgb("rec2020", "D65", null, 2.4)],
  // CIE LCh.
  ["T. CIE LCh(ab) D65, cale rouge, L*50 C*50", familleLch("lab", "D65", "rouge", "fini")],
  ["U. CIE LCh(ab) D65, cale rouge, infinitesimal", familleLch("lab", "D65", "rouge", "infini")],
  ["V. CIE LCh(ab) D65, axe +a, L*50 C*50", familleLch("lab", "D65", "axe", "fini")],
  ["W. CIE LCh(ab) D50, cale rouge, L*50 C*50", familleLch("lab", "D50", "rouge", "fini")],
  ["X. CIE LCh(uv) D65, cale rouge, L*50 C*50", familleLch("luv", "D65", "rouge", "fini")],
  ["Y. CIE LCh(uv) D65, cale rouge, infinitesimal", familleLch("luv", "D65", "rouge", "infini")],
  ["Z. CIE LCh(uv) D65, axe +u, L*50 C*50", familleLch("luv", "D65", "axe", "fini")],
  // Roues non colorimetriques.
  ["a. roue artistique RYB (Gossett-Chen)", angleRyb],
  ["b. lerp LINEAIRE entre les six coins sRGB", angleSixLineaire],
  ["c. lerp du vecteur (a,b) OKLab entre les six coins", angleSixOklab],
];

const classement = FAMILLES.map(([nom, f]) => {
  const res = vus.map((v) => ({ t: v.teinte, r: ecartAngle(v.mesure, f(v.teinte)) }));
  const abs = res.map((x) => Math.abs(x.r)).sort((a, b) => a - b);
  const moy = abs.reduce((s, x) => s + x, 0) / abs.length;
  const med = abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2;
  const auBruit = abs.filter((x) => x < BRUIT_HAUT).length;
  const pire = res.slice().sort((a, b) => Math.abs(b.r) - Math.abs(a.r))[0];
  return { nom, f, moy, med, auBruit, pire, res };
}).sort((a, b) => a.moy - b.moy);

console.log("");
console.log("CLASSEMENT — ecart moyen absolu sur %d teintes, TOUTES a 0 parametre", vus.length);
console.log("");
console.log("La MEDIANE et le compte de teintes au bruit sont imprimes a cote de la moyenne :");
console.log("ce sont deux statistiques a 0 parametre elles aussi, et une moyenne sur 11 points");
console.log("se fait porter par un seul point aberrant. Aucune teinte n'est ecartee.");
console.log("");
console.log("rang  famille                                                  ecart moyen   mediane  teintes<3deg   pire teinte        verdict");
console.log("".padEnd(136, "-"));
classement.forEach((c, i) => {
  const v = c.moy < BRUIT_HAUT ? "AU NIVEAU DU BRUIT" : c.moy < 9 ? "-" : "distinguable";
  console.log("%s  %s %s %s %s   %s a %s deg   %s",
    String(i + 1).padStart(4), c.nom.padEnd(56), c.moy.toFixed(2).padStart(11),
    c.med.toFixed(2).padStart(9), (c.auBruit + "/" + vus.length).padStart(13),
    String(c.pire.t).padStart(3), Math.abs(c.pire.r).toFixed(1).padStart(5), v);
});
console.log("");
console.log("Plancher de bruit mesure (controle synthetique) : 1,28 a 2,51 deg. Une famille");
console.log("sous %s deg est indiscernable d'une loi exacte ; au-dela de ~9, distinguable.", BRUIT_HAUT.toFixed(1));

// ── RESIDU PAR TEINTE, POUR LES SIX PREMIERES ───────────────────────────────
console.log("");
console.log("RESIDU PAR TEINTE (mesure moins modele, en degres) — les six premieres");
console.log("");
console.log("%s%s", "famille".padEnd(50), vus.map((v) => String(v.teinte).padStart(7)).join(""));
console.log("".padEnd(50 + 7 * vus.length, "-"));
for (const c of classement.slice(0, 6)) {
  console.log("%s%s", c.nom.padEnd(50), c.res.map((x) => ((x.r >= 0 ? "+" : "") + x.r.toFixed(1)).padStart(7)).join(""));
}
console.log("%s%s", "(ecart-type de la mesure)".padEnd(50), vus.map((v) => v.ecartType.toFixed(1).padStart(7)).join(""));

// ── SENSIBILITE DES FAMILLES LCh A LEUR L* / C* ─────────────────────────────
// Ce ne sont PAS des parametres ajustes : L*=50 C*=50 a ete fixe d'avance. On
// imprime l'etendue pour dire ce que ce choix coute, au lieu de le taire.
console.log("");
console.log("SENSIBILITE DES FAMILLES LCh A LEUR LOCUS (L*, C*) — le choix L*50/C*50 a-t-il porte le resultat ?");
console.log("");
console.log("famille                          L*30C*20  L*30C*80  L*50C*50  L*70C*20  L*70C*80   etendue");
console.log("".padEnd(108, "-"));
for (const [nom, quel, zero] of [["CIE LCh(ab) D65 cale rouge", "lab", "rouge"], ["CIE LCh(uv) D65 cale rouge", "luv", "rouge"]]) {
  const pts = [[30, 20], [30, 80], [50, 50], [70, 20], [70, 80]].map(([L, C]) => {
    const f = familleLch(quel, "D65", zero, "fini", L, C);
    return vus.reduce((s, v) => s + Math.abs(ecartAngle(v.mesure, f(v.teinte))), 0) / vus.length;
  });
  console.log("%s %s   %s", nom.padEnd(32), pts.map((p) => p.toFixed(2).padStart(9)).join(""),
    (Math.max(...pts) - Math.min(...pts)).toFixed(2).padStart(7));
}
console.log("Une etendue large voudrait dire que la famille n'est pas a 0 parametre en pratique.");

// ── LE VERDICT ──────────────────────────────────────────────────────────────
const meilleure = classement[0];
const refD = classement.find((c) => c.nom.startsWith("D."));
console.log("");
console.log("VERDICT");
console.log("  meilleure : %s — %s deg", meilleure.nom, meilleure.moy.toFixed(2));
console.log("  ProPhoto D50/Bradford lineaire (l'ancienne meilleure) : %s deg, rang %d",
  refD.moy.toFixed(2), classement.indexOf(refD) + 1);
const sousBruit = classement.filter((c) => c.moy < BRUIT_HAUT);
console.log("  familles sous le plancher de bruit EN MOYENNE (%s deg) : %s",
  BRUIT_HAUT.toFixed(1), sousBruit.length ? sousBruit.map((c) => c.nom.split(".")[0]).join(", ") : "AUCUNE");
if (!sousBruit.length) {
  console.log("  Aucune famille d'espace a 0 parametre n'atteint le bruit EN MOYENNE.");
}
const medBruit = classement.filter((c) => c.med < BRUIT_HAUT);
console.log("  familles dont la MEDIANE est sous le bruit : %s",
  medBruit.length ? medBruit.map((c) => c.nom.split(".")[0] + " (" + c.med.toFixed(1) + ")").join(", ") : "AUCUNE");

// ── OU EST LE RESIDU ? Le meme profil pour toutes, ou un par famille ? ──────
// Si toutes les familles ratent LES MEMES teintes, le residu vient de la mesure
// ou d'un mecanisme commun, pas du choix d'espace. Si chacune rate les siennes,
// c'est bien une question d'espace.
console.log("");
console.log("PROFIL DU RESIDU — teintes ou les six premieres familles depassent %s deg", BRUIT_HAUT.toFixed(1));
const compte = new Map(vus.map((v) => [v.teinte, 0]));
for (const c of classement.slice(0, 6)) for (const x of c.res) if (Math.abs(x.r) >= BRUIT_HAUT) compte.set(x.t, compte.get(x.t) + 1);
console.log("  teinte      %s", vus.map((v) => String(v.teinte).padStart(6)).join(""));
console.log("  ratee par   %s   (sur 6)", vus.map((v) => String(compte.get(v.teinte)).padStart(6)).join(""));
console.log("  ecart-type  %s   (de la mesure elle-meme)", vus.map((v) => v.ecartType.toFixed(1).padStart(6)).join(""));
console.log("");
console.log("  Une teinte ratee par les SIX est une teinte que le choix d'espace n'explique");
console.log("  pas. Une teinte dont l'ecart-type de mesure est deja eleve (140, 150) est en");
console.log("  plus une teinte ou l'angle DERIVE avec le niveau : une rotation, quelle que");
console.log("  soit sa famille, ne peut pas y coller.");
