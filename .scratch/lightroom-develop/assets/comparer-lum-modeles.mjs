// Les DEUX modeles de luminance de roue, confrontes a la rampe MESUREE.
//
// LE POINT DE DEPART. Le ticket 06 et docs/ROADMAP.md portent la phrase « un
// decalage de L en OKLab ne PEUT pas lever un noir absolu », et c'est elle qui
// motive l'hypothese ouverte « les luminances agissent en lumiere LINEAIRE —
// changement de modele, pas un reglage ». Mesure faite (verifier-lift-noir.mjs) :
// la phrase est FAUSSE. Un decalage de L de 0,1653 porte le niveau 0 a 14,33
// exactement, la valeur de Lightroom. Notre operateur en applique au plus 0,037.
//
// Mais un seul point ne tranche rien — c'est le defaut que la memoire
// `mesurer-un-cran-au-dela-du-gain` decrit. Ce script confronte les deux modeles
// a la RAMPE ENTIERE, et aux DEUX SIGNES : un operateur a signe a un jumeau faux
// de meme amplitude, et une seule branche ne l'attrape pas.
//
// ⚠️ AUCUN POIDS DE PLAGE N'EST REECRIT ICI. Une premiere version de ce
// controle avait reinvente le poids des ombres en logistique ; le vrai est
// `pow(1 - alpha, 1.6) * cov` avec alpha tire du NIVEAU sRGB, pas de L. Le poids
// est donc RECUPERE du code en service, en inversant `appliqueLum` sur la sortie
// du jumeau — exact, et rien a tenir a jour. Le modele A doit alors reproduire
// `colorGradingSpec` au bit pres ; s'il ne le fait pas, l'instrument est faux et
// le script le dit avant de comparer quoi que ce soit.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niveau = (lin) => l2s(lin) * 255;
// Sur un GRIS, les trois canaux sont egaux, donc L d'OKLab = racine cubique.
const Lde = (lin) => Math.cbrt(lin);
const linDe = (L) => L * L * L;

const p = (lum) => [0, 0, lum, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0];

// `appliqueLum` recopiee ? NON : inversee. Elle est bijective a h fixe, donc on
// retrouve le dL EXACT que le code en service a calcule.
function dLdepuisSortie(L, Lout) {
  if (Math.abs(Lout - L) < 1e-12) return 0;
  const monte = Lout > L;
  const h = monte ? 1 - L : L;
  if (h <= 1e-6) return monte ? Infinity : -Infinity;
  const d = Math.abs(Lout - L) / h;
  if (d >= 1) return monte ? Infinity : -Infinity;
  const mag = -h * Math.log(1 - d);
  return monte ? mag : -mag;
}

function appliqueLum(L, dL) {
  const h = dL >= 0 ? 1 - L : L;
  if (h <= 1e-6) return dL >= 0 ? 1 : 0;
  const d = 1 - Math.exp(-Math.abs(dL) / h);
  return dL >= 0 ? L + h * d : L - h * d;
}

/** Poids de plage RECUPERE : dL = dose * lumK * ws, donc ws = dL / (dose*lumK). */
function poidsOmbres(lin, dose) {
  const L = Lde(lin);
  const out = colorGradingSpec([lin, lin, lin], p(dose * 100));
  const Lout = Lde(Math.max(0, out[0]));
  const dL = dLdepuisSortie(L, Lout);
  if (!Number.isFinite(dL)) return null;
  return dL / (dose * CG.lumK);
}

const rampe = (nom) => JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe;

// ── CONTROLE DE L'INSTRUMENT, avant toute comparaison ────────────────────────
function controle(dose) {
  let pire = 0;
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const w = poidsOmbres(lin, dose);
    if (w === null) continue;
    const attendu = colorGradingSpec([lin, lin, lin], p(dose * 100))[0];
    const rendu = linDe(appliqueLum(Lde(lin), dose * CG.lumK * w));
    pire = Math.max(pire, Math.abs(niveau(rendu) - niveau(attendu)));
  }
  return pire;
}
for (const dose of [0.5, -0.5]) {
  const e = controle(dose);
  console.log("controle de l'instrument, dose %s : ecart max au jumeau %s niveau",
    dose.toFixed(1), e.toExponential(2));
  if (e > 1e-6) throw new Error("le modele A ne reproduit pas colorGradingSpec — instrument faux");
}
console.log("");

// ── LES DEUX MODELES ─────────────────────────────────────────────────────────
const modeleOklab = (k, dose) => (lin, w) => linDe(appliqueLum(Lde(lin), dose * k * w));
const modeleLineaire = (k, dose) => (lin, w) => Math.max(0, Math.min(1, lin + dose * k * w));

function residu(ramp, f, dose, poids) {
  let s = 0;
  for (let n = 0; n <= 255; n++) {
    const w = poids[n];
    if (w === null) continue;
    s += Math.abs(niveau(f(s2l(n / 255), w)) - ramp[n]);
  }
  return s / 256;
}

for (const [nom, dose] of [["cg-ombres-lum-p50", 0.5], ["cg-ombres-lum-m50", -0.5]]) {
  const ramp = rampe(nom);
  const poids = [];
  for (let n = 0; n <= 255; n++) poids.push(poidsOmbres(s2l(n / 255), dose));

  const ks = [];
  for (let i = 1; i <= 4000; i++) ks.push(i / 4000);
  const ajuster = (fab) => {
    let best = null;
    for (const k of ks) {
      const r = residu(ramp, fab(k, dose), dose, poids);
      if (!best || r < best[1]) best = [k, r];
    }
    return best;
  };
  const [kA, rA] = ajuster(modeleOklab);
  const [kB, rB] = ajuster(modeleLineaire);
  const rService = residu(ramp, modeleOklab(CG.lumK, dose), dose, poids);

  console.log("=== %s ===", nom);
  console.log("   niveau 0 mesure chez Lightroom : %s", ramp[0].toFixed(2));
  console.log("   A. OKLab    k optimal %s   residu moyen %s niveaux", kA.toFixed(4), rA.toFixed(3));
  console.log("   B. lineaire k optimal %s   residu moyen %s niveaux", kB.toFixed(4), rB.toFixed(3));
  console.log("   notre k en service %s      residu moyen %s niveaux", CG.lumK.toFixed(4), rService.toFixed(3));
  console.log("   profil, aux niveaux qui separent les modeles :");
  console.log("      niv   mesure   A(OKLab)  B(lineaire)");
  for (const n of [0, 2, 4, 8, 16, 32, 64, 128, 200, 255]) {
    const lin = s2l(n / 255), w = poids[n];
    const a = w === null ? NaN : niveau(modeleOklab(kA, dose)(lin, w));
    const b = w === null ? NaN : niveau(modeleLineaire(kB, dose)(lin, w));
    console.log("      %s %s %s %s",
      String(n).padStart(3), ramp[n].toFixed(2).padStart(8), a.toFixed(2).padStart(9), b.toFixed(2).padStart(11));
  }
  console.log("");
}
