// LES SCENES DE BALANCE EXTREME ISOLENT CHAQUE TEINTE — elles mesurent, elles ne
// sont pas un defaut.
//
// CE QUE balance-chroma.mjs A TROUVE. La « part hautes » mesuree sur le duo n'est
// jamais entre 0 et 1 : elle vaut -0,21 +- 0,01 du niveau 8 au niveau 190 dans
// `st-balance-m100`, et 0,85 a 0,93 dans les hautes lumieres. C'est un PLATEAU,
// pas un partage qui derive — donc pas un defaut de partage, mais un BIAIS D'ANGLE
// constant par teinte. Et le croisement mesure (niveau 34 a Balance +100) tombe
// pres du notre (entre 24 et 48) : le point de bascule est juste, `balanceMid`
// aussi, et la piste « la Balance fait quelque chose de faux a alpha » tombe.
//
// CE QUE CE SCRIPT EN TIRE. A Balance -100 tout est ombre : la chroma de la rampe
// est celle de la roue des OMBRES seule, sur presque toute sa longueur. A +100,
// celle des HAUTES seule. Ces deux scenes ISOLENT donc chacune une teinte, et
// donnent son angle REEL chez Lightroom — ce que `st-ombres-bleu` et
// `st-hl-orange` ne donnent pas aussi proprement, l'autre roue y restant active.
//
// C'est le premier poste d'erreur connu du module (« nos directions de teinte sont
// fausses de +15,7 degres sur l'orange, -12,9 sur le vert, +26,8 sur le bleu »),
// et la campagne A a ete ecrite pour lui. Deux teintes de plus, gratuitement.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const angleDe = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;

function dirFromHue(hueDeg) {
  const [r, g, b] = hsl2rgb((((hueDeg % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c];
}
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

function angles(nom, seuil) {
  const rgb = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe_rgb;
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const lab = linearSrgbToOklab([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    if (c < seuil) { out.push(null); continue; }
    out.push([angleDe(lab[1], lab[2]), c]);
  }
  return out;
}

// ⚠️ SEUIL DE CHROMA. Sous une chroma faible l'angle est du bruit de
// quantification. On ne lit que la ou la mesure a de quoi porter un angle, et on
// DIT combien de niveaux ont servi — un angle moyen sur trois niveaux ne vaut pas
// un angle moyen sur cent cinquante.
const SEUIL = 0.02;

console.log("ANGLE REEL DE CHAQUE TEINTE, mesure la ou une seule roue agit.");
console.log("");
console.log("scene                teinte  niveaux lus   angle mesure   angle calcule   ECART");
console.log("".padEnd(86, "-"));

// Cinq scenes, TROIS teintes. Les deux scenes de Balance extreme isolent le bleu
// et l'orange en poussant tout d'un cote ; les trois scenes simples n'activent
// qu'une roue par construction. Le bleu et l'orange sont donc mesures DEUX fois
// par des chemins differents — validation croisee gratuite, et si les deux
// mesures d'une meme teinte divergent, c'est l'instrument qu'il faut regarder.
const resultats = {};
for (const [nom, teinte] of [
  ["st-balance-m100", 220], ["st-ombres-bleu", 220],
  ["st-balance-p100", 40], ["st-hl-orange", 40],
  ["grading-moyens-vert", 140],
]) {
  const a = angles(nom, SEUIL);
  const lus = a.map((v, n) => [n, v]).filter(([, v]) => v !== null);
  // Moyenne PONDEREE par la chroma : un niveau a forte chroma porte un angle plus
  // sur que le voisin qui frole le seuil.
  let sx = 0, sy = 0;
  for (const [, [ang, c]] of lus) { sx += c * Math.cos(ang * Math.PI / 180); sy += c * Math.sin(ang * Math.PI / 180); }
  const moyen = angleDe(sx, sy);
  const d = dirFromHue(teinte);
  const calcule = angleDe(d[0], d[1]);
  const ecart = ecartAngle(moyen, calcule);
  resultats[nom] = { teinte, moyen, calcule, ecart, lus: lus.length };
  console.log("%s %s %s %s %s %s",
    nom.padEnd(20), String(teinte).padStart(6), String(lus.length).padStart(12),
    moyen.toFixed(2).padStart(14), calcule.toFixed(2).padStart(15),
    ((ecart >= 0 ? "+" : "") + ecart.toFixed(2)).padStart(8));
}

// ── DISPERSION : l'angle est-il STABLE sur la rampe, ou derive-t-il ? ────────
// Un biais fixe se corrige par une direction ; un angle qui derive avec le niveau
// serait autre chose, et ne se corrigerait pas de la meme façon.
console.log("");
console.log("STABILITE de l'angle sur la rampe (un biais fixe se corrige, une derive non) :");
for (const nom of Object.keys(resultats)) {
  const a = angles(nom, SEUIL);
  const lus = a.map((v, n) => [n, v]).filter(([, v]) => v !== null);
  const ecarts = lus.map(([, [ang]]) => ecartAngle(ang, resultats[nom].moyen));
  const et = Math.sqrt(ecarts.reduce((s, v) => s + v * v, 0) / ecarts.length);
  const premier = lus[0], dernier = lus[lus.length - 1];
  console.log("  %s : ecart-type %s degres, du niveau %d (%s) au niveau %d (%s)",
    nom.padEnd(20), et.toFixed(2),
    premier[0], premier[1][0].toFixed(1), dernier[0], dernier[1][0].toFixed(1));
}

// ── LES DEUX MESURES D'UNE MEME TEINTE S'ACCORDENT-ELLES ? ──────────────────
// C'est le controle qui ne coute rien : deux chemins differents, une seule
// verite. S'ils divergent, l'instrument est en cause avant la loi de teinte.
console.log("");
console.log("VALIDATION CROISEE — deux chemins pour le bleu et pour l'orange :");
for (const [a, b, teinte] of [
  ["st-balance-m100", "st-ombres-bleu", 220],
  ["st-balance-p100", "st-hl-orange", 40],
]) {
  console.log("  teinte %s : %s degres (%s) contre %s degres (%s) — ecart %s",
    String(teinte).padStart(3),
    resultats[a].ecart.toFixed(2), a,
    resultats[b].ecart.toFixed(2), b,
    Math.abs(resultats[a].ecart - resultats[b].ecart).toFixed(2));
}

console.log("");
console.log("LA LOI, sur les trois teintes mesurees :");
for (const t of [40, 140, 220]) {
  const pour = Object.values(resultats).filter((r) => r.teinte === t);
  const moy = pour.reduce((s, r) => s + r.ecart, 0) / pour.length;
  console.log("  teinte %s : ecart moyen %s degres (%d mesure%s)",
    String(t).padStart(3), (moy >= 0 ? "+" : "") + moy.toFixed(2), pour.length, pour.length > 1 ? "s" : "");
}
console.log("");
console.log("Un ecart qui CHANGE DE SIGNE entre deux teintes interdit une rotation");
console.log("constante — et une rotation constante est exactement ce que le balayage a");
console.log("montre : -14 degres ameliore les sept scenes bleu/orange et DOUBLE l'erreur");
console.log("de grading-moyens-vert.");
