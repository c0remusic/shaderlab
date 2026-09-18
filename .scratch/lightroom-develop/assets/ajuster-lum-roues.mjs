// L'AMPLITUDE DE LUMINANCE, ROUE PAR ROUE, sur toutes les rampes mesurees.
//
// `comparer-lum-modeles.mjs` a tranche l'ESPACE : OKLab gagne sur les DEUX
// signes de la roue des ombres (residu 0,97 et 1,00 contre 2,94 et 3,40 pour un
// offset en lumiere lineaire), donc l'hypothese « les luminances agissent en
// lumiere LINEAIRE » est refutee. Restait l'AMPLITUDE : l'optimum des ombres
// tombe a 0,179 la ou nous servons 0,074 — un facteur 2,4.
//
// ⚠️ UN SEUL k EST PARTAGE PAR LES QUATRE ROUES aujourd'hui. Le ticket 06 note
// que « les roues de plage demandent environ 1,8 fois l'amplitude nominale, les
// deux roues sur lesquelles lumK est calibre tombent juste » — donc gonfler le k
// COMMUN casserait les autres. Ce script mesure l'optimum de CHAQUE roue,
// separement, pour dire si la bonne correction est un k par roue.
//
// Meme discipline que le script precedent : le poids de plage n'est pas reecrit,
// il est RECUPERE du code en service en inversant `appliqueLum`, et le modele
// doit reproduire `colorGradingSpec` avant toute comparaison.
import { readFileSync, existsSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niveau = (lin) => l2s(lin) * 255;
const Lde = (lin) => Math.cbrt(Math.max(0, lin));
const linDe = (L) => L * L * L;

/** Index du parametre de LUMINANCE de chaque roue dans le uniform de 14. */
const INDEX_LUM = { ombres: 2, moyens: 5, hautes: 8, global: 11 };

function params(roue, lum) {
  const p = new Array(14).fill(0);
  p[12] = 50; // Fusion au defaut : les mesures ont ete prises la.
  p[INDEX_LUM[roue]] = lum;
  return p;
}

function appliqueLum(L, dL) {
  const h = dL >= 0 ? 1 - L : L;
  if (h <= 1e-6) return dL >= 0 ? 1 : 0;
  const d = 1 - Math.exp(-Math.abs(dL) / h);
  return dL >= 0 ? L + h * d : L - h * d;
}

function dLdepuisSortie(L, Lout) {
  if (Math.abs(Lout - L) < 1e-12) return 0;
  const monte = Lout > L;
  const h = monte ? 1 - L : L;
  if (h <= 1e-6) return null;
  const d = Math.abs(Lout - L) / h;
  if (d >= 1) return null;
  const mag = -h * Math.log(1 - d);
  return monte ? mag : -mag;
}

/** Poids de plage de `roue` au niveau `n`, recupere du code en service. */
function poids(roue, dose, n) {
  const lin = s2l(n / 255);
  const L = Lde(lin);
  const out = colorGradingSpec([lin, lin, lin], params(roue, dose * 100));
  const dL = dLdepuisSortie(L, Lde(Math.max(0, out[0])));
  if (dL === null) return null;
  return dL / (dose * CG.lumK);
}

const CAS = [
  ["cg-ombres-lum-p50", "ombres", 0.5],
  ["cg-ombres-lum-m50", "ombres", -0.5],
  ["cg-moyens-lum-p50", "moyens", 0.5],
  ["cg-hl-lum-p50", "hautes", 0.5],
  ["grading2-hl-lum-m100", "hautes", -1.0],
  ["grading-global-lum-p50", "global", 0.5],
];

console.log("roue      mesure                 k optimal   residu(k*)   residu(0,074)   facteur");
console.log("".padEnd(88, "-"));
const parRoue = {};
for (const [nom, roue, dose] of CAS) {
  const chemin = `${M}/${nom}.json`;
  if (!existsSync(chemin)) { console.log("%s  ABSENT", nom.padEnd(24)); continue; }
  const ramp = JSON.parse(readFileSync(chemin, "utf8")).rampe;

  const w = [];
  for (let n = 0; n <= 255; n++) w.push(poids(roue, dose, n));
  // CONTROLE : le modele au k en service doit reproduire le jumeau.
  let pire = 0;
  for (let n = 0; n <= 255; n++) {
    if (w[n] === null) continue;
    const lin = s2l(n / 255);
    const attendu = colorGradingSpec([lin, lin, lin], params(roue, dose * 100))[0];
    pire = Math.max(pire, Math.abs(niveau(linDe(appliqueLum(Lde(lin), dose * CG.lumK * w[n]))) - niveau(attendu)));
  }
  if (pire > 1e-6) throw new Error(`${nom} : instrument faux (ecart ${pire})`);

  const residu = (k) => {
    let s = 0, c = 0;
    for (let n = 0; n <= 255; n++) {
      if (w[n] === null) continue;
      s += Math.abs(niveau(linDe(appliqueLum(Lde(s2l(n / 255)), dose * k * w[n]))) - ramp[n]);
      c++;
    }
    return s / Math.max(1, c);
  };
  let best = null;
  for (let i = 1; i <= 6000; i++) {
    const k = i / 6000;
    const r = residu(k);
    if (!best || r < best[1]) best = [k, r];
  }
  const [kOpt, rOpt] = best;
  const rService = residu(CG.lumK);
  (parRoue[roue] ??= []).push(kOpt);
  console.log("%s %s %s %s %s %s",
    roue.padEnd(9), nom.padEnd(22),
    kOpt.toFixed(4).padStart(9), rOpt.toFixed(3).padStart(12),
    rService.toFixed(3).padStart(15), (kOpt / CG.lumK).toFixed(2).padStart(9));
}

console.log("");
console.log("=== OPTIMUM PAR ROUE, et ACCORD ENTRE SES MESURES ===");
console.log("(deux mesures d'une meme roue qui donnent le meme k, c'est la validation");
console.log(" croisee ; deux qui divergent disent que le poids de plage est en cause)");
for (const [roue, ks] of Object.entries(parRoue)) {
  const moy = ks.reduce((a, b) => a + b, 0) / ks.length;
  const ecart = ks.length > 1 ? Math.max(...ks) - Math.min(...ks) : 0;
  console.log("  %s k = %s   (%d mesure(s), etendue %s)",
    roue.padEnd(8), moy.toFixed(4), ks.length, ecart.toFixed(4));
}
console.log("");
console.log("k EN SERVICE (partage par les quatre roues) : %s", CG.lumK.toFixed(4));
