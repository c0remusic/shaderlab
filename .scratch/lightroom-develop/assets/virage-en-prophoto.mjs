// ET SI LIGHTROOM AJOUTAIT SA CHROMA EN ProPhoto, PAS EN OKLab ?
//
// CE QUI MENE ICI — trois constats independants qui disent la meme chose.
//
//  1. L'ANGLE MESURE DEPEND DE L. Le workflow l'a trouve sans le chercher : sur
//     les quatre scenes a roue unique, l'angle OKLab de la chroma de sortie a une
//     pente de -8,3 a +12,9 degres par unite de L. Or un vecteur ajoute EN OKLab
//     donnerait un angle independant de L PAR CONSTRUCTION. Donc l'addition n'a
//     pas lieu en OKLab.
//  2. LA DIRECTION ProPhoto N'EST PAS STABLE EN SATURATION (loi-220-singularite) :
//     etendue de 0,8 degre sur la teinte 140 a 33,1 sur la teinte 220. Lire « la
//     direction de la teinte » comme l'angle OKLab d'une couleur ProPhoto saturee
//     n'est donc pas bien defini — et le residu moyen depend du choix : 5,00 a
//     saturation pleine, 2,76 a mi-saturation, 5,43 a la limite infinitesimale.
//  3. LA CHROMA AJOUTEE VARIE D'UN FACTEUR 1,77 SELON LA TEINTE (0,0540 a h220,
//     0,0958 a h300) alors qu'une direction UNITAIRE en OKLab imposerait l'egalite.
//
// L'HYPOTHESE QU'ILS DESIGNENT. Lightroom Classic travaille en ProPhoto RGB. S'il
// ajoute son virage LA — un deplacement vers la couleur de la teinte, en lumiere
// lineaire ProPhoto — alors vu depuis OKLab l'angle depend de L et de l'amplitude,
// la chroma resultante varie avec la teinte, et la direction n'a pas de sens hors
// d'une amplitude donnee. Les trois constats tombent ensemble.
//
// ⚠️ CE QUI SE MESURE ICI N'EST PLUS UN ANGLE. Un angle etait la bonne grandeur
// tant qu'on cherchait une DIRECTION ; l'hypothese porte maintenant sur l'operateur
// entier, donc on compare les RAMPES, canal par canal, en niveaux sRGB — la meme
// metrique que verifier-grading.mjs, celle qui decide.
//
// ⚠️ ET LE MODELE COMPARE DOIT AVOIR LE MEME NOMBRE DE PARAMETRES. Chaque modele
// recoit UNE amplitude ajustee par teinte a partir de la mesure elle-meme (sa
// chroma moyenne), et AUCUN autre degre de liberte. Sinon on comparerait un modele
// libre a un modele contraint.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const niv = (lin) => linearToSrgb(Math.max(0, Math.min(1, lin))) * 255;

const PP_XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XYZ_S = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
/** Inverses, calcules une fois — sRGB lineaire -> ProPhoto lineaire. */
function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
const S_XYZ = inverse3(XYZ_S), XYZ_PP = inverse3(PP_XYZ);
const srgbVersPP = (lin) => ap(XYZ_PP, ap(S_XYZ, lin));
const ppVersSrgb = (pp) => ap(XYZ_S, ap(PP_XYZ, pp));

// ── CONTROLE DE L'ALLER-RETOUR, avant tout ──────────────────────────────────
{
  let pire = 0;
  for (const v of [[0.1, 0.2, 0.3], [0.9, 0.5, 0.05], [0.5, 0.5, 0.5], [0.02, 0.8, 0.4]]) {
    const r = ppVersSrgb(srgbVersPP(v));
    pire = Math.max(pire, ...r.map((x, i) => Math.abs(x - v[i])));
  }
  console.log("controle aller-retour sRGB <-> ProPhoto : ecart max %s", pire.toExponential(2));
  if (pire > 1e-10) throw new Error("matrices inverses fausses — rien de ce qui suit ne vaut");
}

/** Direction UNITAIRE de la teinte, dans l'espace ou le virage est ajoute. */
function dirPP(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const gris = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const d = rgb.map((c) => c - gris);
  const n = Math.hypot(d[0], d[1], d[2]) || 1;
  return d.map((c) => c / n);
}
function dirOklab(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])]);
  const n = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / n, lab[2] / n];
}
/** Direction ProPhoto lineaire projetee en OKLab — la famille D du classement. */
function dirOklabDepuisPP(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const lab = linearSrgbToOklab(ppVersSrgb(rgb));
  const gris = (rgb[0] + rgb[1] + rgb[2]) / 3;
  const labG = linearSrgbToOklab(ppVersSrgb([gris, gris, gris]));
  const da = lab[1] - labG[1], db = lab[2] - labG[2];
  const n = Math.hypot(da, db) || 1;
  return [da / n, db / n];
}

// ── LES TROIS MODELES, un parametre chacun (l'amplitude) ────────────────────
const MODELES = [
  ["ajout en OKLab, direction sRGB/HSL (en service)", (lin, h, k) => {
    const lab = linearSrgbToOklab(lin); const d = dirOklab(h);
    return oklabToLinearSrgb([lab[0], lab[1] + k * d[0], lab[2] + k * d[1]]);
  }],
  ["ajout en OKLab, direction ProPhoto (famille D)", (lin, h, k) => {
    const lab = linearSrgbToOklab(lin); const d = dirOklabDepuisPP(h);
    return oklabToLinearSrgb([lab[0], lab[1] + k * d[0], lab[2] + k * d[1]]);
  }],
  ["ajout en ProPhoto LINEAIRE", (lin, h, k) => {
    const pp = srgbVersPP(lin); const d = dirPP(h);
    return ppVersSrgb([pp[0] + k * d[0], pp[1] + k * d[1], pp[2] + k * d[2]]);
  }],
];

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const charge = (t) => {
  const f = `${M}/st-h${String(t).padStart(3, "0")}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).rampe_rgb : null;
};

/** Ecart moyen en niveaux sRGB, 3 canaux, amplitude ajustee par teinte ET par
 *  niveau via le PROFIL mesure — on ne cherche pas la loi de poids ici, donc on
 *  la prend de la mesure pour que les trois modeles soient juges sur la seule
 *  chose qui les distingue : l'espace ou l'addition a lieu. */
function evalue(f, t, rgbMes) {
  let somme = 0, n = 0;
  for (let i = 0; i <= 255; i++) {
    const lin = s2l(i / 255);
    const mes = [s2l(rgbMes[i][0] / 255), s2l(rgbMes[i][1] / 255), s2l(rgbMes[i][2] / 255)];
    const labM = linearSrgbToOklab(mes);
    const cible = Math.hypot(labM[1], labM[2]);
    if (cible < 0.02) continue;
    // Amplitude cherchee pour que le modele atteigne CETTE chroma a CE niveau.
    let lo = 0, hi = 0.6;
    for (let it = 0; it < 30; it++) {
      const k = (lo + hi) / 2;
      const out = f([lin, lin, lin], t, k);
      const lab = linearSrgbToOklab(out.map((v) => Math.max(0, Math.min(1, v))));
      if (Math.hypot(lab[1], lab[2]) < cible) lo = k; else hi = k;
    }
    const out = f([lin, lin, lin], t, (lo + hi) / 2);
    for (let c = 0; c < 3; c++) somme += Math.abs(niv(out[c]) - rgbMes[i][c]);
    n += 3;
  }
  return n ? somme / n : null;
}

console.log("");
console.log("ECART AUX RAMPES MESUREES, en niveaux sRGB (3 canaux).");
console.log("Chaque modele recoit la MEME amplitude par niveau, tiree de la mesure :");
console.log("ils ne different que par l'ESPACE ou le virage est ajoute.");
console.log("");
const entetes = TEINTES.map((t) => String(t).padStart(6)).join("");
console.log("modele" + " ".repeat(44) + entetes + "  moyenne");
console.log("".padEnd(118, "-"));
for (const [nom, f] of MODELES) {
  const par = [];
  for (const t of TEINTES) {
    const rgbMes = charge(t);
    par.push(rgbMes ? evalue(f, t, rgbMes) : null);
  }
  const vus = par.filter((v) => v !== null);
  const moy = vus.reduce((s, v) => s + v, 0) / vus.length;
  console.log("%s%s %s",
    nom.padEnd(50),
    par.map((v) => (v === null ? "—" : v.toFixed(1)).padStart(6)).join(""),
    moy.toFixed(2).padStart(8));
}
console.log("");
console.log("⚠️ La quantification 8 bits vaut 0,29 niveau d'ecart moyen par canal au");
console.log("   mieux (arrondi uniforme). Un modele proche de ce plancher est exact.");
