// LE BAS DE RAMPE, qui est le seul endroit qui ait jamais decide ici.
//
// DEUX CORRECTIONS D'INSTRUMENT PAR RAPPORT A courbe-verdict.mjs.
//
//  1. LE NIVEAU 0 N'ETAIT PAS AJUSTE. Les niveaux retenus venaient du signe
//     NEGATIF, ou le niveau 0 ne bouge pas (0 -> 0,00) : il etait donc exclu, et
//     c'est le point qui porte toute la question depuis le debut — Lightroom l'a
//     mesure a 14,33. Le domaine d'ajustement du signe positif est desormais tire
//     du signe POSITIF.
//  2. LE RESIDU MOYEN EST LE MAUVAIS OBJECTIF, research/17 l'a etabli en refusant
//     k = 0,177 : il moyenne un bas de rampe que l'oeil regarde. On ajuste donc
//     sur le BAS (niveaux 0 a 32) et on lit l'erreur sur le HAUT, qui n'a servi a
//     rien. Si un seul jeu (g, b) tient les deux bouts, la forme est bonne ; s'il
//     faut choisir, il manque un terme et il faut le dire.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niveau = (lin) => l2s(lin) * 255;

const plus = JSON.parse(readFileSync(`${M}/cg-ombres-lum-p50.json`, "utf8")).rampe;
const moins = JSON.parse(readFileSync(`${M}/cg-ombres-lum-m50.json`, "utf8")).rampe;

// Poids extrait du signe NEGATIF, hypothese pente (celle que la garde A retient).
// Le niveau 0 n'y est pas mesurable : on l'extrapole a la valeur du niveau 2, que
// la mesure donne a 1,0000 — et on le DIT, plutot que de laisser un null devenir
// un 1 par accident quelque part.
const w = new Array(256).fill(null);
{
  const brut = new Array(256).fill(null);
  for (let n = 1; n <= 255; n++) {
    if (Math.abs(moins[n] - n) < 1) continue;
    brut[n] = 1 - s2l(moins[n] / 255) / s2l(n / 255);
  }
  const max = Math.max(...brut.filter((v) => v !== null));
  for (let n = 0; n <= 255; n++) w[n] = brut[n] === null ? null : brut[n] / max;
  w[0] = w[2];
  w[1] = w[2];
  for (let n = 200; n <= 255; n++) if (w[n] === null) w[n] = 0;
}
console.log("poids extrait : w(0) extrapole a %s (valeur du niveau 2), w(255) = %s",
  w[0].toFixed(4), w[255].toFixed(4));

const courbe = (g, b) => (lin, ww) => Math.max(0, Math.min(1, lin * (1 + ww * (g - 1)) + ww * b));

const BAS = [], HAUT = [];
for (let n = 0; n <= 199; n++) {
  if (w[n] === null) continue;
  (n <= 32 ? BAS : HAUT).push(n);
}
function residu(domaine, f, ramp) {
  let s = 0;
  for (const n of domaine) s += Math.abs(niveau(f(s2l(n / 255), w[n])) - ramp[n]);
  return s / domaine.length;
}
function ajuster(domaine, ramp) {
  let best = null;
  for (let ig = 0; ig <= 400; ig++) {
    const g = 0.3 + ig * 0.005;
    for (let ib = 0; ib <= 400; ib++) {
      const b = ib * 2.5e-5;
      const r = residu(domaine, courbe(g, b), ramp);
      if (!best || r < best[2]) best = [g, b, r];
    }
  }
  return best;
}

const surBas = ajuster(BAS, plus);
const surTout = ajuster(BAS.concat(HAUT), plus);
console.log("");
console.log("SIGNE +50 — ou l'ajustement se fait, et ce que ça coute ailleurs.");
console.log("");
console.log("ajuste sur        g       b          residu BAS   residu HAUT");
console.log("".padEnd(66, "-"));
for (const [nom, sol] of [["le BAS (0-32)", surBas], ["toute la rampe", surTout]]) {
  console.log("%s %s %s %s %s",
    nom.padEnd(17),
    sol[0].toFixed(3).padStart(7),
    sol[1].toExponential(2).padStart(10),
    residu(BAS, courbe(sol[0], sol[1]), plus).toFixed(3).padStart(13),
    residu(HAUT, courbe(sol[0], sol[1]), plus).toFixed(3).padStart(13));
}
// L'operateur en service, sur les memes deux domaines.
function residuService(domaine, dose) {
  let s = 0;
  for (const n of domaine) {
    const lin = s2l(n / 255);
    const p = new Array(14).fill(0); p[12] = 50; p[2] = dose * 100;
    s += Math.abs(niveau(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0])) - (dose > 0 ? plus : moins)[n]);
  }
  return s / domaine.length;
}
console.log("%s %s %s %s %s", "en service".padEnd(17), "—".padStart(7), "—".padStart(10),
  residuService(BAS, 0.5).toFixed(3).padStart(13), residuService(HAUT, 0.5).toFixed(3).padStart(13));

console.log("");
console.log("Le bas de rampe, niveau par niveau :");
console.log("  niv   Lightroom   en service   courbe(bas)   courbe(tout)");
for (const n of [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32]) {
  const lin = s2l(n / 255);
  const p = new Array(14).fill(0); p[12] = 50; p[2] = 50;
  console.log("  %s %s %s %s %s",
    String(n).padStart(3),
    plus[n].toFixed(2).padStart(11),
    niveau(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0])).toFixed(2).padStart(12),
    niveau(courbe(surBas[0], surBas[1])(lin, w[n])).toFixed(2).padStart(13),
    niveau(courbe(surTout[0], surTout[1])(lin, w[n])).toFixed(2).padStart(14));
}
