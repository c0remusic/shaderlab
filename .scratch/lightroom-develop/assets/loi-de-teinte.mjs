// LA LOI DE TEINTE DU COLOR GRADING — lecteur de la campagne A.
//
// CE QU'IL LIT. Les onze scenes `st-h*` de la campagne A (teintes 0, 40, 60, 90,
// 140, 150, 180, 220, 270, 300, 330, toutes sur la roue des ombres a
// SplitToningBalance=-100) plus les deux controles de roue `cg-glob-h*`. Il est
// TOLERANT AUX MANQUES : lance pendant la course, il imprime ce qui existe et
// nomme ce qui manque.
//
// COMMENT IL MESURE. L'angle de la chroma de sortie, la ou une seule roue agit —
// l'instrument de research/21, qui n'inverse rien et ne suppose aucun poids. Sur
// une rampe de GRIS la chroma d'entree est nulle, donc celle de sortie EST le
// vecteur ajoute par la roue.
//
// ⚠️ LIRE L'ECART-TYPE AVANT L'ECART. Sur les scenes deja mesurees il vaut 0,83 a
// 4,19 degres. Une teinte dont il monterait beaucoup signalerait que l'angle y
// DERIVE avec le niveau — et une derive ne se corrige pas par une rotation, donc
// l'ecart moyen n'y voudrait rien dire.
//
// LES FAMILLES CANDIDATES. Le ticket 06 affirme que « sept hypotheses d'espace
// ont ete testees et rejetees », mais aucune trace de ces sept n'existe dans le
// depot — ni liste, ni script, ni chiffres. On ne peut donc ni les reprendre ni
// les eviter : elles sont re-testees ici, avec leurs resultats ecrits cette fois.
//
// La piste que ce dossier n'a jamais essayee est la derniere : **Lightroom Classic
// travaille en interne en ProPhoto RGB** (« Melissa RGB », ProPhoto primaries en
// D50). Si le cercle de teintes du selecteur est defini LA et non en sRGB, la
// deformation vue depuis sRGB change de signe selon la region du cercle — ce que
// research/21 a precisement mesure (+9,2 degres sur le vert, -30,7 sur le bleu).
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;

// ── LES FAMILLES CANDIDATES ─────────────────────────────────────────────────
// Chacune rend l'angle OKLab de la direction que le modele donnerait a la teinte.

/** A. En service : HSL sur sRGB, puis OKLab. */
function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  return deg(lab[1], lab[2]);
}

/** B. Angle DIRECT dans le plan (a,b) d'OKLab — « la teinte EST l'angle OKLCh ».
 *  ⚠️ Le zero du selecteur est le ROUGE, et le rouge pur n'est pas a 0 degre en
 *  OKLab : on cale donc la famille sur le rouge, sinon on testerait un decalage
 *  d'origine au lieu d'une forme. */
const ZERO_OKLCH = angleSrgbHsl(0);
const angleOklchDirect = (h) => ZERO_OKLCH + h;

/** C. ProPhoto RGB (D50) — l'espace de travail interne de Lightroom Classic.
 *  La teinte est posee sur la roue ProPhoto, puis la couleur est convertie en
 *  sRGB lineaire pour etre lue en OKLab comme les autres.
 *  Matrices de Lindbloom : ProPhoto->XYZ(D50), puis XYZ(D50)->sRGB lineaire avec
 *  adaptation Bradford D50->D65 deja incorporee. */
const PROPHOTO_VERS_XYZ = [
  [0.7976749, 0.1351917, 0.0313534],
  [0.2880402, 0.7118741, 0.0000857],
  [0.0000000, 0.0000000, 0.8252100],
];
const XYZ_VERS_SRGB = [
  [3.1338561, -1.6168667, -0.4906146],
  [-0.9787684, 1.9161415, 0.0334540],
  [0.0719453, -0.2289914, 1.4052427],
];
const applique = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function angleProPhoto(h) {
  // hsl2rgb rend des coordonnees de roue dans [0,1] ; on les prend comme des
  // valeurs ProPhoto ENCODEES (gamma 1,8), qu'on linearise avant la matrice.
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5).map((c) => Math.pow(c, 1.8));
  const lin = applique(XYZ_VERS_SRGB, applique(PROPHOTO_VERS_XYZ, rgb));
  const lab = linearSrgbToOklab(lin);
  return deg(lab[1], lab[2]);
}

/** D. ProPhoto LINEAIRE — meme chose sans le gamma 1,8, au cas ou la roue serait
 *  posee sur les valeurs lineaires. Les deux se separent nettement. */
function angleProPhotoLineaire(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const lin = applique(XYZ_VERS_SRGB, applique(PROPHOTO_VERS_XYZ, rgb));
  return deg(...linearSrgbToOklab(lin).slice(1));
}

/** E. Rotation constante sur la famille en service — le garde-fou. research/21
 *  la dit fausse (l'ecart change de signe) ; elle reste dans la table pour que le
 *  classement le MONTRE au lieu de le rappeler. Son parametre est ajuste. */
const angleRotation = (k) => (h) => angleSrgbHsl(h) + k;

// ── LECTURE DES MESURES ─────────────────────────────────────────────────────
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const nomDe = (t) => `st-h${String(t).padStart(3, "0")}`;

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
  if (lus.length < 20) return { niveaux: lus.length, insuffisant: true };
  let sx = 0, sy = 0;
  for (const [a, c] of lus) { sx += c * Math.cos(a * Math.PI / 180); sy += c * Math.sin(a * Math.PI / 180); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(lus.reduce((s, [a]) => s + ecartAngle(a, moyen) ** 2, 0) / lus.length);
  return { niveaux: lus.length, moyen, ecartType: et };
}

const vus = [], manquants = [];
console.log("LOI DE TEINTE — campagne A");
console.log("");
console.log("teinte  scene         niveaux  angle mesure  ecart-type   en service   ECART");
console.log("".padEnd(82, "-"));
for (const t of TEINTES) {
  const nom = nomDe(t);
  const m = mesure(nom);
  if (!m) { manquants.push(nom); continue; }
  if (m.insuffisant) {
    console.log("%s %s %s   ⚠️ trop peu de niveaux au-dessus du seuil",
      String(t).padStart(6), nom.padEnd(13), String(m.niveaux).padStart(8));
    continue;
  }
  const svc = angleSrgbHsl(t);
  const e = ecartAngle(m.moyen, svc);
  vus.push({ teinte: t, mesure: m.moyen, ecartType: m.ecartType, ecart: e });
  console.log("%s %s %s %s %s %s %s",
    String(t).padStart(6), nom.padEnd(13), String(m.niveaux).padStart(8),
    m.moyen.toFixed(2).padStart(13), m.ecartType.toFixed(2).padStart(11),
    svc.toFixed(2).padStart(12), ((e >= 0 ? "+" : "") + e.toFixed(2)).padStart(8));
}
if (manquants.length) {
  console.log("");
  console.log("MANQUENT (%d) : %s", manquants.length, manquants.join(", "));
  console.log("  Lancer `python analyse-mesures.py` apres la course pour produire les JSON.");
}
if (vus.length < 3) {
  console.log("");
  console.log("Moins de trois teintes lues : pas de quoi classer une loi. On s'arrete la.");
  process.exit(0);
}

// ── CLASSEMENT DES FAMILLES ─────────────────────────────────────────────────
const FAMILLES = [
  ["A. HSL sur sRGB (en service)", angleSrgbHsl, 0],
  ["B. angle direct OKLCh", angleOklchDirect, 0],
  ["C. ProPhoto RGB (gamma 1,8)", angleProPhoto, 0],
  ["D. ProPhoto lineaire", angleProPhotoLineaire, 0],
];
// La rotation est ajustee : un parametre, donc elle part avec un avantage qu'il
// faut lui accorder explicitement plutot que de la comparer a parametres egaux.
let meilleurK = 0, meilleurR = Infinity;
for (let k = -60; k <= 60; k += 0.5) {
  const r = vus.reduce((s, v) => s + Math.abs(ecartAngle(v.mesure, angleRotation(k)(v.teinte))), 0) / vus.length;
  if (r < meilleurR) { meilleurR = r; meilleurK = k; }
}
FAMILLES.push([`E. rotation constante (k = ${meilleurK.toFixed(1)}, AJUSTE)`, angleRotation(meilleurK), 1]);

console.log("");
console.log("FAMILLES — ecart moyen absolu a la mesure, sur %d teintes", vus.length);
console.log("");
console.log("famille                                  parametres   ecart moyen   pire teinte");
console.log("".padEnd(84, "-"));
const classement = FAMILLES.map(([nom, f, p]) => {
  const ecarts = vus.map((v) => ({ t: v.teinte, e: Math.abs(ecartAngle(v.mesure, f(v.teinte))) }));
  const moy = ecarts.reduce((s, x) => s + x.e, 0) / ecarts.length;
  const pire = ecarts.slice().sort((a, b) => b.e - a.e)[0];
  return { nom, p, moy, pire };
}).sort((a, b) => a.moy - b.moy);
for (const c of classement) {
  console.log("%s %s %s   %s a %s deg",
    c.nom.padEnd(40), String(c.p).padStart(10),
    c.moy.toFixed(2).padStart(13), String(c.pire.t).padStart(3), c.pire.e.toFixed(1));
}
console.log("");
console.log("⚠️ Une famille a 0 parametre qui bat une famille ajustee est un resultat FORT.");
console.log("   L'inverse ne prouve rien : un parametre libre achete toujours du residu.");

// ── LE POSTULAT « UNE SEULE LOI POUR LES QUATRE ROUES » ─────────────────────
console.log("");
console.log("CONTROLE DE ROUE — le postulat qui porte toute la serie :");
for (const t of [40, 220]) {
  const glob = mesure(`cg-glob-h${String(t).padStart(3, "0")}`);
  const ombres = vus.find((v) => v.teinte === t);
  if (!glob || glob.insuffisant || !ombres) {
    console.log("  teinte %s : mesure manquante des deux cotes, controle impossible", t);
    continue;
  }
  const eGlob = ecartAngle(glob.moyen, angleSrgbHsl(t));
  console.log("  teinte %s : ombres %s deg, GLOBALE %s deg — difference %s deg",
    String(t).padStart(3), ombres.ecart.toFixed(2), eGlob.toFixed(2),
    Math.abs(ombres.ecart - eGlob).toFixed(2));
}
console.log("  Une difference du meme ordre que les ecarts-types (sous ~5 deg) : le");
console.log("  postulat tient. Beaucoup plus : la loi est PAR ROUE, et la serie mesuree");
console.log("  sur les ombres ne vaut que pour les ombres.");
