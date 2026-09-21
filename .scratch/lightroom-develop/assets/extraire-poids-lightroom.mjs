// EXTRAIRE LE POIDS DE PLAGE DE LIGHTROOM, au lieu de continuer a le modeliser.
//
// CE QUI REND L'EXTRACTION POSSIBLE. asymetrie-twin.mjs a montre que notre
// operateur est quasi SYMETRIQUE entre les deux signes (ecart-type du rapport
// 0,034) la ou Lightroom derive d'un facteur 7 (0,64), en croisant -1 vers le
// niveau 48. Et forme-lum-ombres.mjs a montre qu'a dose NEGATIVE le rapport
// lin_sortie/lin_entree vaut 0,5000 aux niveaux 2, 4 et 6. A dose negative,
// l'operateur est donc une PENTE en lumiere lineaire — et une pente laisse le
// poids se lire directement :
//
//     lin_sortie = lin * (1 + w(n)*(g-1))   =>   w(n) = (rapport(n) - 1) / (g - 1)
//
// `g` est inconnu, donc w n'est determine qu'a une constante pres. On le NORMALISE
// sur son maximum. La FORME du poids, elle, ne doit rien a aucun ajustement : elle
// sort de la mesure seule.
//
// ⚠️ TROIS GARDES, parce qu'une extraction rend toujours quelque chose.
//   1. le profil doit etre LISSE et MONOTONE — un poids de plage l'est ; du bruit
//      divise par du bruit ne l'est pas ;
//   2. on ne lit que la ou l'effet mesure depasse UN niveau. Au-dessus, on
//      diviserait de la quantification par de la quantification ;
//   3. le w extrait sert ensuite a ajuster l'autre signe, qui n'a servi a rien
//      dans l'extraction. C'est un jeu disjoint.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niveau = (lin) => l2s(lin) * 255;
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

const plus = JSON.parse(readFileSync(`${M}/cg-ombres-lum-p50.json`, "utf8")).rampe;
const moins = JSON.parse(readFileSync(`${M}/cg-ombres-lum-m50.json`, "utf8")).rampe;

// ── NOTRE poids, pour comparaison : `pow(1 - alpha, 1.6) * cov`, recupere. ───
function notrePoids(n) {
  const lin = s2l(n / 255);
  const L = Lde(lin);
  const p = new Array(14).fill(0); p[12] = 50; p[2] = -50;
  const Lout = Lde(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0]));
  if (Math.abs(Lout - L) < 1e-12) return 0;
  const h = L;
  if (h <= 1e-6) return 0;
  const d = Math.abs(Lout - L) / h;
  if (d >= 1) return null;
  return (-h * Math.log(1 - d)) / (0.5 * CG.lumK);
}

// ── EXTRACTION, sur la rampe NEGATIVE seule ─────────────────────────────────
const brut = [];
for (let n = 0; n <= 255; n++) {
  const lin = s2l(n / 255);
  if (lin <= 0 || Math.abs(moins[n] - n) < 1) { brut.push(null); continue; }
  brut.push(1 - s2l(moins[n] / 255) / lin);
}
const maxBrut = Math.max(...brut.filter((v) => v !== null));
const wLR = brut.map((v) => (v === null ? null : v / maxBrut));

console.log("POIDS DE PLAGE DES OMBRES — extrait de la rampe NEGATIVE seule.");
console.log("maximum brut (1 - rapport) = %s, soit une pente g = %s a poids 1",
  maxBrut.toFixed(4), (1 - maxBrut).toFixed(4));
console.log("");
console.log("  niv   w Lightroom   w en service   ecart");
console.log("".padEnd(48, "-"));
for (const n of [1, 2, 4, 8, 16, 24, 32, 48, 64, 80, 96, 112, 128, 160, 187]) {
  const a = wLR[n], b = notrePoids(n);
  console.log("  %s %s %s %s",
    String(n).padStart(3),
    (a === null ? "—" : a.toFixed(4)).padStart(13),
    (b === null ? "—" : b.toFixed(4)).padStart(14),
    (a === null || b === null ? "—" : (a - b >= 0 ? "+" : "") + (a - b).toFixed(4)).padStart(8));
}

// GARDE 1 : monotonie et lissage du profil extrait.
const defs = [];
for (let n = 0; n <= 255; n++) if (wLR[n] !== null) defs.push(n);
let ruptures = 0;
for (let i = 1; i < defs.length; i++) if (wLR[defs[i]] > wLR[defs[i - 1]] + 0.01) ruptures++;
console.log("");
console.log("GARDE 1 — profil extrait : %d niveaux definis (de %d a %d), %d remontees > 0,01",
  defs.length, defs[0], defs[defs.length - 1], ruptures);
console.log("   (un poids de plage est decroissant ; des remontees signaleraient du bruit)");

// ── GARDE 3 : le signe POSITIF, qui n'a servi a rien ci-dessus ───────────────
// Modele : lin_out = lin*(1 + w*(g-1)) + w*b. Deux parametres, ajustes sur la
// rampe positive avec le w extrait du signe negatif. Jeu disjoint.
function residuPositif(g, b) {
  let s = 0, c = 0;
  for (const n of defs) {
    const lin = s2l(n / 255);
    const out = Math.max(0, Math.min(1, lin * (1 + wLR[n] * (g - 1)) + wLR[n] * b));
    s += Math.abs(niveau(out) - plus[n]); c++;
  }
  return s / c;
}
let best = null;
for (let ig = 0; ig <= 300; ig++) {
  const g = 0.5 + ig * 0.01;
  for (let ib = 0; ib <= 300; ib++) {
    const b = ib * 5e-5;
    const r = residuPositif(g, b);
    if (!best || r < best[2]) best = [g, b, r];
  }
}
// Le meme calcul pour l'operateur EN SERVICE, sur les memes niveaux.
function residuService() {
  let s = 0, c = 0;
  for (const n of defs) {
    const lin = s2l(n / 255);
    const p = new Array(14).fill(0); p[12] = 50; p[2] = 50;
    s += Math.abs(niveau(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0])) - plus[n]); c++;
  }
  return s / c;
}
console.log("");
console.log("GARDE 3 — le signe POSITIF, avec le poids extrait du signe NEGATIF (jeu disjoint) :");
console.log("   modele en service        residu moyen %s niveaux", residuService().toFixed(3));
console.log("   courbe gain+point noir   residu moyen %s niveaux  (g = %s, b = %s)",
  best[2].toFixed(3), best[0].toFixed(3), best[1].toExponential(2));
console.log("   niveau 0 : Lightroom %s, courbe %s",
  plus[0].toFixed(2), niveau(Math.max(0, Math.min(1, wLR[1] * best[1]))).toFixed(2));
