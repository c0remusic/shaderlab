// LA FORME de la luminance d'une roue, LUE dans la mesure au lieu d'etre ajustee.
//
// POURQUOI CE SCRIPT EXISTE. research/17 a ferme deux hypotheses par ajustement :
// l'espace n'est pas lineaire (OKLab gagne d'un facteur 3 sur les deux signes) et
// l'amplitude n'est pas le remede (k = 0,177 ecrase onze niveaux a -100 quand
// Lightroom n'en ecrase qu'un a -50). Il a conclu que l'ecart est la FORME au bas
// de la rampe, et le binaire nomme une COURBE (brevet B220, « color curve slopes »).
//
// Un ajustement de plus ne dirait rien de neuf. Ce script ne fitte RIEN : il
// imprime la transformation MESUREE sous trois lectures, et laisse la forme se
// designer elle-meme.
//
//   dL    = L_sortie - L_entree          un DECALAGE de L (notre modele actuel)
//   L/L   = L_sortie / L_entree          une PENTE sur L
//   lin/lin                              une PENTE en lumiere lineaire
//
// Celle des trois qui est CONSTANTE (a poids de plage pres) nomme l'operateur.
// Les deux autres varieront, et la façon dont elles varient est le controle.
//
// ⚠️ LE POIDS DE PLAGE N'EST PAS REECRIT ICI, meme raison que dans
// comparer-lum-modeles.mjs : il est RECUPERE du code en service en inversant
// appliqueLum. Une premiere version de ce controle-la l'avait reinvente en
// logistique, et mesurait donc sa propre invention.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

const p = (lum) => [0, 0, lum, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0];

function dLdepuisSortie(L, Lout) {
  if (Math.abs(Lout - L) < 1e-12) return 0;
  const monte = Lout > L;
  const h = monte ? 1 - L : L;
  if (h <= 1e-6) return null;
  const d = Math.abs(Lout - L) / h;
  if (d >= 1) return null;
  return (monte ? 1 : -1) * (-h * Math.log(1 - d));
}

/** Poids de plage des OMBRES, recupere du code en service. */
function poids(lin, dose) {
  const L = Lde(lin);
  const out = colorGradingSpec([lin, lin, lin], p(dose * 100));
  const dL = dLdepuisSortie(L, Lde(Math.max(0, out[0])));
  return dL === null ? null : dL / (dose * CG.lumK);
}

// ── CONTROLE DU TEMOIN : l'export de Lightroom derive-t-il ? ─────────────────
// La campagne Detail a mesure une derive de x1,004 sur ses exports. Si le temoin
// du virage derive aussi, toute lecture de forme au bas de rampe la lirait comme
// un effet de l'operateur. On regarde avant, pas apres.
const temoin = JSON.parse(readFileSync(`${M}/temoin.json`, "utf8")).rampe;
let pireTemoin = 0, oudonc = 0;
for (let n = 0; n <= 255; n++) {
  const e = Math.abs(temoin[n] - n);
  if (e > pireTemoin) { pireTemoin = e; oudonc = n; }
}
console.log("temoin : ecart max a la rampe nue %s niveau (au niveau %d)", pireTemoin.toFixed(3), oudonc);
console.log("  quinze premiers niveaux du temoin :", temoin.slice(0, 15).map((v) => v.toFixed(2)).join(" "));
console.log("");

for (const [nom, dose] of [["cg-ombres-lum-p50", 0.5], ["cg-ombres-lum-m50", -0.5]]) {
  const ramp = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe;
  console.log("=== %s ===", nom);
  console.log("  niv  entree->sortie      w       dL      dL/w     Lout/Lin   lin/lin");
  console.log("".padEnd(74, "-"));
  for (const n of [0, 1, 2, 3, 4, 6, 8, 12, 16, 24, 32, 48, 64, 96, 128, 160, 200, 255]) {
    const lin = s2l(n / 255);
    const linOut = s2l(ramp[n] / 255);
    const L = Lde(lin), Lout = Lde(linOut);
    const w = poids(lin, dose);
    const dL = Lout - L;
    const rapportL = L > 1e-9 ? Lout / L : NaN;
    const rapportLin = lin > 1e-12 ? linOut / lin : NaN;
    console.log("  %s %s %s %s %s %s %s",
      String(n).padStart(3),
      (String(n) + "->" + ramp[n].toFixed(2)).padStart(14),
      (w === null ? "—" : w.toFixed(4)).padStart(8),
      dL.toFixed(4).padStart(9),
      (w === null || Math.abs(w) < 1e-9 ? "—" : (dL / w).toFixed(4)).padStart(9),
      (Number.isNaN(rapportL) ? "—" : rapportL.toFixed(4)).padStart(10),
      (Number.isNaN(rapportLin) ? "—" : rapportLin.toFixed(4)).padStart(10));
  }
  console.log("");
}
