// CE QUE LA BALANCE FAIT AU PARTAGE, lu dans la mesure.
//
// POURQUOI CETTE PISTE. research/20 a refuse la cloche et trouve autre chose : le
// pire cas des treize mesures vaut 41,0 sur `st-balance-p100` depuis le debut,
// aucune correction de poids ne l'avait fait bouger, et TOUTE forme bornee en haut
// de rampe le divise par 2,7. Un defaut qu'on soulage sans le viser est un
// symptome. Les deux scenes de Balance sont par ailleurs les deux pires des treize
// (moyennes 6,99 et 11,47), alors que `balanceMid` est CALIBRE — la table le tire
// du croisement du duo, symetrique a 2 % pres. Le point de bascule est donc juste
// et quelque chose d'autre est faux.
//
// L'INSTRUMENT. Les scenes de Balance sont des scenes de TEINTE : le duo pose bleu
// 220 dans les ombres et orange 40 dans les hautes lumieres. Sur une rampe de GRIS,
// l'entree a une chroma nulle, donc la chroma de SORTIE est exactement ce que les
// deux roues ont ajoute :
//
//     (a, b) = chromaK * (sat/100) * (dSh * ws + dH * wh)
//
// Deux equations, deux inconnues. Le partage se RESOUT au lieu de s'ajuster — et
// c'est le partage que la Balance deplace, donc c'est la grandeur a regarder.
//
// ⚠️ LE SYSTEME PEUT ETRE MAL CONDITIONNE. Bleu et orange sont a 180 degres l'un
// de l'autre en teinte HSL ; si leurs directions OKLab sortent colineaires, on ne
// peut extraire que la COMBINAISON le long de leur axe commun, pas les deux poids
// separement. Le script MESURE ce conditionnement et le dit avant de resoudre —
// une resolution sur un systeme degenere rendrait des nombres stables et faux.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const linearToSrgb = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };

/** Copie exacte de `dirFromHue` du module (meme chaine, memes fonctions). */
function dirFromHue(hueDeg) {
  const [r, g, b] = hsl2rgb((((hueDeg % 360) + 360) % 360) / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  const c = Math.hypot(lab[1], lab[2]) || 1;
  return [lab[1] / c, lab[2] / c];
}
const dSh = dirFromHue(220), dH = dirFromHue(40);

// ── CONDITIONNEMENT, avant toute resolution ─────────────────────────────────
const det = dSh[0] * dH[1] - dSh[1] * dH[0];
const cos = dSh[0] * dH[0] + dSh[1] * dH[1];
const angle = Math.acos(Math.max(-1, Math.min(1, cos))) * 180 / Math.PI;
// ⚠️ LE DETERMINANT SEUL NE DIT PAS SI LE SYSTEME EST UTILISABLE. Pour deux
// vecteurs UNITAIRES il vaut sin(angle), donc il reste gros a 170 degres alors que
// les deux directions sont presque opposees. Ce qui compte est le CONDITIONNEMENT,
// qui dit de combien le bruit d'entree est amplifie en sortie.
const conditionnement = Math.sqrt((1 + Math.abs(cos)) / (1 - Math.abs(cos)));
console.log("directions OKLab : ombres(220) = [%s, %s], hautes(40) = [%s, %s]",
  dSh[0].toFixed(4), dSh[1].toFixed(4), dH[0].toFixed(4), dH[1].toFixed(4));
console.log("angle %s degres   determinant %s   CONDITIONNEMENT %s",
  angle.toFixed(2), det.toFixed(4), conditionnement.toFixed(1));
console.log("  Quantification 8 bits : +-0,5 niveau en entree, donc jusqu'a +-%s en sortie.",
  (0.5 * conditionnement).toFixed(1));
console.log("");

/** Resout (ws, wh) depuis la chroma mesuree d'un niveau. */
function resoudre(a, b, sat) {
  const k = CG.chromaK * (sat / 100);
  // [dSh dH] * [ws wh]^T = [a b]^T / k
  const A = a / k, B2 = b / k;
  const ws = (A * dH[1] - B2 * dH[0]) / det;
  const wh = (dSh[0] * B2 - dSh[1] * A) / det;
  return [ws, wh];
}

/** Les poids ws/wh du code EN SERVICE, a une balance donnee. */
function poidsService(n, bal) {
  const L = Math.cbrt(s2l(n / 255));
  const beta = 0.5;
  const x = Math.max(0, Math.min(1, linearToSrgb(L * L * L)));
  const B = Math.min(1 - 1e-4, Math.max(1e-4, 0.5 - CG.balanceMid * bal));
  const divMap = (v, aa) => (aa * v) / (aa * v + 1 - v);
  const alpha = divMap(x, (1 - B) / B);
  const CG_BLEND_MAP_A = 0.42857142857142866;
  const cov = 1 - CG.blendDepth * (1 - divMap(beta, CG_BLEND_MAP_A)) * 4 * alpha * (1 - alpha);
  const g = CG.rangeContrast;
  return [Math.pow(1 - alpha, g) * cov, Math.pow(alpha, g) * cov];
}

// ── CONTROLE DE L'INSTRUMENT, avant toute lecture ───────────────────────────
// La regle de ce dossier : un instrument se mesure sur une sortie dont on CONNAIT
// deja la reponse. On lui donne celle du TWIN, dont ws et wh sont calculables, et
// on regarde s'il les retrouve. S'il ne les retrouve pas, ce qu'il dit des mesures
// de Lightroom n'a aucune valeur — et il rendrait des nombres stables et faux.
{
  const { colorGradingSpec } = await import("../../../src/render/effects/colorGrading.ts");
  const p = [220, 60, 0, 0, 0, 0, 40, 60, 0, 0, 0, 0, 50, 0];
  let pireWs = 0, pireWh = 0;
  for (const n of [8, 32, 64, 128, 190, 240]) {
    const lin = s2l(n / 255);
    const out = colorGradingSpec([lin, lin, lin], p);
    const lab = linearSrgbToOklab(out);
    const [wsM, whM] = resoudre(lab[1], lab[2], 60);
    const [wsS, whS] = poidsService(n, 0);
    pireWs = Math.max(pireWs, Math.abs(wsM - wsS));
    pireWh = Math.max(pireWh, Math.abs(whM - whS));
  }
  console.log("CONTROLE — l'instrument relit-il les poids du TWIN sur la sortie du TWIN ?");
  console.log("  ecart maximal : ws %s, wh %s", pireWs.toFixed(4), pireWh.toFixed(4));
  if (pireWs > 0.02 || pireWh > 0.02) {
    console.log("  ⚠️ INSTRUMENT FAUX — il ne retrouve pas ce qu'il sait deja.");
    console.log("     Cause a chercher avant de lire quoi que ce soit des mesures Lightroom :");
    console.log("     l'ecretage de gamut (clipGamut) modifie la chroma apres le melange,");
    console.log("     donc la chroma de SORTIE n'est plus la somme ponderee des deux roues.");
  } else {
    console.log("  ✅ Instrument verifie.");
  }
  console.log("");
}

for (const [nom, bal] of [["st-duo", 0], ["st-balance-p100", 1], ["st-balance-m100", -1]]) {
  const rgb = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe_rgb;
  console.log("=== %s (balance %s) ===", nom, bal * 100);
  console.log("  niv |  ws mesure  wh mesure |  ws service  wh service | somme mes.  somme svc");
  console.log("".padEnd(88, "-"));
  for (const n of [8, 24, 48, 64, 96, 128, 160, 190, 220, 240]) {
    const lab = linearSrgbToOklab([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    const [wsM, whM] = resoudre(lab[1], lab[2], 60);
    const [wsS, whS] = poidsService(n, bal);
    console.log("  %s | %s %s | %s %s | %s %s",
      String(n).padStart(3),
      wsM.toFixed(3).padStart(10), whM.toFixed(3).padStart(10),
      wsS.toFixed(3).padStart(11), whS.toFixed(3).padStart(11),
      (wsM + whM).toFixed(3).padStart(10), (wsS + whS).toFixed(3).padStart(10));
  }
  // Le CROISEMENT : le niveau ou les deux poids s'egalent. C'est ce que la table
  // dit avoir calibre (`balanceMid`), donc c'est le controle de la calibration.
  const croisement = (f) => {
    for (let n = 1; n <= 255; n++) {
      const [a0, b0] = f(n - 1), [a1, b1] = f(n);
      if ((a0 - b0) * (a1 - b1) <= 0) return n;
    }
    return null;
  };
  const mes = (n) => {
    const lab = linearSrgbToOklab([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    return resoudre(lab[1], lab[2], 60);
  };
  console.log("  croisement ws = wh : mesure au niveau %s, en service au niveau %s",
    croisement(mes), croisement((n) => poidsService(n, bal)));
  console.log("");
}
