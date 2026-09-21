// LE MODELE EN COURBE : gain + point noir, en lumiere LINEAIRE, confronte aux
// deux memes criteres que research/17 a utilises pour refuser les precedents.
//
// D'OU SORT LA FORME. Pas d'une intuition : de forme-lum-ombres.mjs, qui imprime
// la transformation mesuree sous trois lectures. Une seule est CONSTANTE — le
// rapport lin_sortie/lin_entree a dose negative, qui vaut 0,5000 exactement aux
// niveaux 2, 4 et 6 et 0,51 jusqu'a 16. Une PENTE en lumiere lineaire, donc. Et a
// dose positive le niveau 0 sort a 14,33 alors qu'une pente laisserait 0 a 0 :
// il y a un second terme, un LIFT. C'est ce que le brevet B220 nomme
// (« color curve slopes ») et ce que research/17 laissait comme seule piste.
//
// ⚠️ CE QUI SERAIT UN PIEGE ICI. Deux parametres au lieu d'un, donc ce modele
// DOIT gagner : le comparer au residu d'un modele a un parametre ne prouverait
// rien. Trois gardes, et elles decident :
//   1. l'ECRASEMENT — c'est le critere qui a fait refuser k = 0,177, et il ne
//      s'achete pas avec un parametre de plus ;
//   2. la COHERENCE DES DEUX SIGNES — b doit tomber a ~0 a dose negative sans
//      qu'on le lui impose, sinon le lift est un parametre libre qui absorbe du
//      bruit ;
//   3. HORS ECHANTILLON — les roues moyens / global / hautes n'ont servi a aucun
//      ajustement ici. Si la forme est bonne elles s'ameliorent aussi.
//
// Le poids de plage n'est PAS reecrit : recupere du code en service.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niveau = (lin) => l2s(lin) * 255;
const Lde = (lin) => Math.cbrt(Math.max(0, lin));
const linDe = (L) => L * L * L;

/** Index du curseur de Luminance de chaque roue dans params. */
const INDEX_LUM = { ombres: 2, moyens: 5, hautes: 8, global: 11 };
function params(roue, lum) {
  const p = new Array(14).fill(0);
  p[12] = 50;
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
  return (monte ? 1 : -1) * (-h * Math.log(1 - d));
}
/** Poids de plage d'une roue, RECUPERE du code en service. */
function poids(roue, lin, dose) {
  const L = Lde(lin);
  const out = colorGradingSpec([lin, lin, lin], params(roue, dose * 100));
  const dL = dLdepuisSortie(L, Lde(Math.max(0, out[0])));
  return dL === null ? null : dL / (dose * CG.lumK);
}

// ── LES MODELES ──────────────────────────────────────────────────────────────
// A. en service / OKLab : un decalage de L, pondere. Un parametre.
const modeleOklab = (k) => (lin, w) => linDe(appliqueLum(Lde(lin), k * w));
// C. courbe : gain et point noir en lumiere lineaire, tous deux pondrés par w.
//    A w = 0 elle est l'identite exactement, comme il se doit.
const modeleCourbe = (g, b) => (lin, w) =>
  Math.max(0, Math.min(1, lin * (1 + w * (g - 1)) + w * b));

function residu(ramp, f, poidsTable) {
  let s = 0, compte = 0;
  for (let n = 0; n <= 255; n++) {
    const w = poidsTable[n];
    if (w === null) continue;
    s += Math.abs(niveau(f(s2l(n / 255), w)) - ramp[n]);
    compte++;
  }
  return s / compte;
}

/** Ce que le modele fait a la rampe : niveaux distincts, colles aux bornes. */
function profil(f, poidsTable) {
  const sorties = [];
  for (let n = 0; n <= 255; n++) {
    const w = poidsTable[n];
    sorties.push(Math.round(niveau(f(s2l(n / 255), w === null ? 0 : w))));
  }
  return {
    distincts: new Set(sorties).size,
    zero: sorties.filter((v) => v === 0).length,
    blanc: sorties.filter((v) => v === 255).length,
  };
}

const rampe = (nom) => JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe;
const tablePoids = (roue, dose) => {
  const t = [];
  for (let n = 0; n <= 255; n++) t.push(poids(roue, s2l(n / 255), dose));
  return t;
};

// Les six rampes de luminance disponibles, avec leur roue et leur dose.
const MESURES = [
  ["cg-ombres-lum-p50", "ombres", 0.5],
  ["cg-ombres-lum-m50", "ombres", -0.5],
  ["cg-moyens-lum-p50", "moyens", 0.5],
  ["cg-hl-lum-p50", "hautes", 0.5],
  ["grading-global-lum-p50", "global", 0.5],
];

console.log("MODELE C — courbe : lin_out = lin*(1 + w*(g-1)) + w*b");
console.log("Modele A — en service : decalage de L en OKLab, k = %s", CG.lumK.toFixed(4));
console.log("");
console.log("mesure                  A ajuste   A service  |  C ajuste   gain g   point noir b");
console.log("".padEnd(88, "-"));

const ajustes = {};
for (const [nom, roue, dose] of MESURES) {
  const ramp = rampe(nom);
  const pt = tablePoids(roue, dose);

  let bestA = null;
  for (let i = -4000; i <= 4000; i++) {
    const k = i / 8000;
    const r = residu(ramp, modeleOklab(k), pt);
    if (!bestA || r < bestA[1]) bestA = [k, r];
  }
  // Grille sur (g, b). g autour de 1, b petit et des DEUX signes — on ne lui
  // impose pas d'etre nul a dose negative, c'est la garde 2 qui le verifie.
  let bestC = null;
  for (let ig = 0; ig <= 400; ig++) {
    const g = 0.2 + ig * 0.01;
    for (let ib = -60; ib <= 200; ib++) {
      const b = ib * 1e-4;
      const r = residu(ramp, modeleCourbe(g, b), pt);
      if (!bestC || r < bestC[2]) bestC = [g, b, r];
    }
  }
  const rService = residu(ramp, modeleOklab(dose * CG.lumK), pt);
  ajustes[nom] = { roue, dose, g: bestC[0], b: bestC[1] };

  console.log("%s %s %s  | %s %s %s",
    nom.padEnd(24),
    bestA[1].toFixed(3).padStart(8),
    rService.toFixed(3).padStart(11),
    bestC[2].toFixed(3).padStart(9),
    bestC[0].toFixed(3).padStart(8),
    bestC[1].toExponential(2).padStart(14));
}

// ── GARDE 1 : l'ECRASEMENT, aux doses EXTREMES ───────────────────────────────
console.log("");
console.log("GARDE 1 — ecrasement de la roue des OMBRES, un cran au-dela de l'echantillon.");
console.log("Le modele C est extrapole en LOI DE PUISSANCE sur la dose : g(d) = g(0,5)^(2d),");
console.log("b(d) = 2d*b(0,5). Un gain se compose, un lift s'additionne.");
console.log("");
console.log("dose   modele        distincts   colles a 0   colles a 255");
console.log("".padEnd(64, "-"));
const aj = ajustes["cg-ombres-lum-p50"], ajm = ajustes["cg-ombres-lum-m50"];
for (const dose of [1.0, 0.5, -0.5, -1.0]) {
  const pt = tablePoids("ombres", dose);
  const src = dose >= 0 ? aj : ajm;
  const f = dose >= 0 ? Math.abs(dose / 0.5) : Math.abs(dose / 0.5);
  const cand = [
    ["A service", modeleOklab(dose * CG.lumK)],
    ["C courbe", modeleCourbe(Math.pow(src.g, f), f * src.b)],
  ];
  for (const [nomModele, f2] of cand) {
    const pr = profil(f2, pt);
    console.log("%s %s %s %s %s",
      ((dose >= 0 ? "+" : "") + (dose * 100).toFixed(0)).padStart(5),
      nomModele.padEnd(14),
      String(pr.distincts).padStart(10),
      String(pr.zero).padStart(12),
      String(pr.blanc).padStart(14));
  }
}

// ── GARDE 2 : la COHERENCE DES DEUX SIGNES ───────────────────────────────────
console.log("");
console.log("GARDE 2 — coherence des deux signes de la roue des OMBRES.");
console.log("   gain a +50 : %s     gain a -50 : %s", aj.g.toFixed(4), ajm.g.toFixed(4));
console.log("   reciproque du gain a -50 : %s  (a comparer au gain a +50)", (1 / ajm.g).toFixed(4));
console.log("   point noir a +50 : %s", aj.b.toExponential(3));
console.log("   point noir a -50 : %s  <- doit tomber a ~0 SANS qu'on le lui impose", ajm.b.toExponential(3));
