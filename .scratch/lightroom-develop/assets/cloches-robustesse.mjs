// LES PARAMETRES DE CLOCHE, sous les trois jeux de constantes d'extraction.
//
// quatre-cloches.mjs a montre que le SOMMET BRUT des medians (n=119) et des
// hautes lumieres (n=199) ne bouge sous aucun des trois jeux, et que les quatre
// profils s'ajustent en gaussiennes sur L. Mais un sommet stable ne dit pas qu'un
// CENTRE et une DEMI-LARGEUR ajustes le sont — l'ajustement voit tout le profil,
// pas seulement son maximum, et les queues dependent de `b`.
//
// Ce script borne donc la conclusion : quels parametres se citent, et lesquels
// sont a la merci d'un choix de constantes qui reste provisoire tant que le signe
// negatif des trois autres roues n'est pas mesure (campagne F).
import { readFileSync } from "node:fs";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

const RAMPES = {
  ombres: "cg-ombres-lum-p50",
  moyens: "cg-moyens-lum-p50",
  hautes: "cg-hl-lum-p50",
  global: "grading-global-lum-p50",
};
const JEUX = [
  ["research/18", 1.690, 4.73e-3],
  ["toute la rampe", 1.405, 6.98e-3],
  ["gain seul", 1.500, 0.0],
];

function cloche(nom, g, b) {
  const ramp = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe;
  const pts = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const denom = lin * (g - 1) + b;
    if (denom <= 1e-9) continue;
    pts.push([Lde(lin), (s2l(ramp[n] / 255) - lin) / denom]);
  }
  let best = null;
  for (let ic = 0; ic <= 120; ic++) {
    const c = ic / 100;
    for (let is = 2; is <= 80; is++) {
      const s = is / 200;
      for (let ih = 1; ih <= 140; ih++) {
        const h = ih / 100;
        let e = 0;
        for (const [L, v] of pts) e += Math.abs(h * Math.exp(-((L - c) ** 2) / (2 * s * s)) - v);
        e /= pts.length;
        if (!best || e < best[3]) best = [c, s, h, e];
      }
    }
  }
  return best;
}

console.log("roue       parametre     %s", JEUX.map(([n]) => n.padStart(16)).join(""));
console.log("".padEnd(74, "-"));
for (const [roue, nom] of Object.entries(RAMPES)) {
  const sols = JEUX.map(([, g, b]) => cloche(nom, g, b));
  const etendue = (i) => Math.max(...sols.map((s) => s[i])) - Math.min(...sols.map((s) => s[i]));
  console.log("%s centre L    %s   etendue %s",
    roue.padEnd(10), sols.map((s) => s[0].toFixed(3).padStart(16)).join(""), etendue(0).toFixed(3));
  console.log("%s demi-largeur%s   etendue %s",
    "".padEnd(10), sols.map((s) => s[1].toFixed(3).padStart(16)).join(""), etendue(1).toFixed(3));
}
console.log("");
console.log("Un parametre d'etendue faible se cite ; un parametre qui bouge attend la campagne F.");
console.log("Reperes de la table en service : midCenter 0,610, midSigma 0,144.");
