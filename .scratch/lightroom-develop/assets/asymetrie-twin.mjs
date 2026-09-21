// L'ASYMETRIE DES DEUX SIGNES : ce que Lightroom fait, ce que NOUS faisons.
//
// espace-sans-poids.mjs a montre qu'aucun espace ne rend plat le rapport
// dL(+50)/dL(-50), donc que l'operateur n'est PAS « un decalage pondere » — le
// poids se simplifierait et le rapport serait constant. Il derive de -5,2 au
// niveau 2 a -0,72 au niveau 160 : a dose positive le bas de rampe bouge cinq
// fois plus qu'a dose negative, et au milieu les deux s'equilibrent.
//
// CE QUI MANQUE A CE CONSTAT, et c'est le controle que ce script ajoute : notre
// operateur en service est SATURANT (`appliqueLum` : h = 1-L en montant, h = L en
// descendant), donc il produit deja une asymetrie de ce sens-la — au noir il peut
// monter beaucoup et ne peut pas descendre. Avant de chercher une forme neuve, il
// faut savoir si la notre reproduit DEJA la courbe d'asymetrie mesuree. Le meme
// rapport calcule sur la sortie du twin repond, et il ne coute rien.
//
// Si les deux profils se superposent : l'asymetrie est bonne, l'ecart est une
// amplitude qui depend du niveau — donc le POIDS. Si le notre est plat la ou
// celui de Lightroom derive : c'est l'operateur.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

const plus = JSON.parse(readFileSync(`${M}/cg-ombres-lum-p50.json`, "utf8")).rampe;
const moins = JSON.parse(readFileSync(`${M}/cg-ombres-lum-m50.json`, "utf8")).rampe;

/** Notre rampe, par le twin en service. Roue des ombres = params[2]. */
function notre(dose) {
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const p = new Array(14).fill(0);
    p[12] = 50;
    p[2] = dose * 100;
    out.push(l2s(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0])) * 255);
  }
  return out;
}
const nPlus = notre(0.5), nMoins = notre(-0.5);

const rapport = (rp, rm, n) => {
  const L = Lde(s2l(n / 255));
  return (Lde(s2l(rp[n] / 255)) - L) / (Lde(s2l(rm[n] / 255)) - L);
};

console.log("Rapport dL(+50) / dL(-50), en L d'OKLab. Un decalage pondere donnerait -1 partout.");
console.log("");
console.log("  niv    Lightroom      nous    |  amplitude LR   amplitude nous");
console.log("".padEnd(74, "-"));
for (const n of [2, 4, 8, 16, 32, 48, 64, 96, 128, 160, 200]) {
  const L = Lde(s2l(n / 255));
  const dLR = Lde(s2l(plus[n] / 255)) - L;
  const dNous = Lde(s2l(nPlus[n] / 255)) - L;
  console.log("  %s %s %s  | %s %s",
    String(n).padStart(3),
    rapport(plus, moins, n).toFixed(3).padStart(12),
    rapport(nPlus, nMoins, n).toFixed(3).padStart(10),
    dLR.toFixed(4).padStart(14),
    dNous.toFixed(4).padStart(16));
}

// Dispersion des deux profils, sur les memes niveaux que l'autre script.
const utiles = [];
for (let n = 1; n <= 254; n++) {
  if (Math.abs(plus[n] - n) >= 1 && Math.abs(moins[n] - n) >= 1) utiles.push(n);
}
const stats = (rp, rm) => {
  const v = utiles.map((n) => rapport(rp, rm, n)).filter(Number.isFinite);
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return [m, Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length)];
};
const [mLR, eLR] = stats(plus, moins);
const [mN, eN] = stats(nPlus, nMoins);
console.log("");
console.log("Lightroom : rapport moyen %s, ecart-type %s", mLR.toFixed(4), eLR.toFixed(4));
console.log("nous      : rapport moyen %s, ecart-type %s", mN.toFixed(4), eN.toFixed(4));
