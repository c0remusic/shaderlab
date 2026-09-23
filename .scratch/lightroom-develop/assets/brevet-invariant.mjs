// QUELLE GRANDEUR LIGHTROOM CONSERVE-T-IL QUAND IL VIRE UNE COULEUR ?
//
// Le brevet B220 (US 7 830 548) l'annonce dans son titre : le virage se fait « en
// maintenant une luminance constante ». Il nomme DEUX invariances possibles — la
// lumiere HSL (min + max) / 2 et la luminance ponderee wR R + wG G + wB B — sans
// dire laquelle Lightroom retient, ni dans quel espace.
//
// Notre operateur conserve le L d'OKLab (addition en a, b a L constant, puis
// clipGamut a L constant). Si Lightroom conserve autre chose, l'ecart de
// luminance est STRUCTUREL et aucun reglage d'amplitude ne l'effacera.
//
// LE TEST NE PORTE AUCUN PARAMETRE LIBRE. Pour chaque scene de TEINTE SEULE
// (aucun curseur de Luminance), a chaque niveau lisible, on calcule chaque
// invariance candidate sur la sortie mesuree, puis le niveau de GRIS qui a la
// meme valeur. Si Lightroom conserve cette grandeur, ce niveau equivalent est le
// niveau d'entree, a l'arrondi 8 bits pres. L'unite est donc la meme pour toutes
// les candidates : des niveaux sRGB.
//
// ⚠️ CONTROLES AVANT LES MESURES. L'instrument doit reconnaitre une reponse
// connue : une rampe fabriquee par l'operateur du brevet en ProPhoto lineaire
// (luminance conservee par construction) doit designer « Y ProPhoto », et une
// rampe fabriquee par notre twin doit designer « L OKLab ». Sinon rien de ce qui
// suit ne vaut.
import {
  s2l, l2s, niveau, ap, oklab, SRGB_VERS_PP, SRGB_XYZ65, PP_XYZ, ESPACES,
  pentes, hermite, charge, lisible,
} from "./brevet-commun.mjs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const g18 = (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / 1.8);
const enc = (v) => Math.sign(v) * l2s(Math.abs(v));
const pp = (lin) => ap(SRGB_VERS_PP, lin);
const lumiereHSL = (v) => (Math.max(...v) + Math.min(...v)) / 2;
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];

/** Chaque candidate : sRGB LINEAIRE -> scalaire, croissante sur le gris. */
const CANDIDATES = [
  ["Y CIE (D65, sRGB lineaire)", (l) => dot(SRGB_XYZ65[1], l)],
  ["Y ProPhoto (D50, ProPhoto lineaire)", (l) => dot(PP_XYZ[1], pp(l))],
  ["L OKLab (en service)", (l) => oklab(l)[0]],
  ["lumiere HSL, ProPhoto lineaire", (l) => lumiereHSL(pp(l))],
  ["lumiere HSL, ProPhoto gamma 1,8", (l) => lumiereHSL(pp(l).map(g18))],
  ["lumiere HSL, sRGB encode", (l) => lumiereHSL(l.map(enc))],
  ["moyenne, ProPhoto lineaire", (l) => { const p = pp(l); return (p[0] + p[1] + p[2]) / 3; }],
  ["Y ProPhoto sur gamma 1,8", (l) => dot(PP_XYZ[1], pp(l).map(g18))],
  ["luma Rec.709 sur sRGB encode", (l) => dot(SRGB_XYZ65[1], l.map(enc))],
];

/** Niveau de gris (0..255, continu) dont la candidate vaut `valeur`. */
function niveauEquivalent(f, valeur) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (f([m, m, m]) < valeur) lo = m; else hi = m;
  }
  return 255 * l2s((lo + hi) / 2);
}

/** Ecart moyen absolu (et signe) en niveaux, sur les niveaux lisibles >= 4. */
function juge(rampeRgb) {
  return CANDIDATES.map(([, f]) => {
    let sa = 0, ss = 0, n = 0;
    for (let i = 4; i <= 251; i++) {
      const rgb = rampeRgb[i];
      if (!lisible(rgb)) continue;
      const l = rgb.map((c) => s2l(c / 255));
      const e = niveauEquivalent(f, f(l)) - i;
      sa += Math.abs(e); ss += e; n++;
    }
    return n ? { abs: sa / n, signe: ss / n, n } : null;
  });
}

// ── CONTROLES ───────────────────────────────────────────────────────────────
const quantifie = (lin) => lin.map((v) => Math.round(niveau(v) * 100) / 100); // mesures = moyennes, pas des entiers
function rampeBrevet(h, S) {
  const E = ESPACES["ProPhoto lineaire"];
  const s0 = pentes(h, S, E.w);
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    const y = [0, 1, 2].map((c) => hermite(x, s0[c], 1));
    return quantifie(ap(E.depuis, y));
  });
}
function rampeTwin(h, sat) {
  const p = [h, sat, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, -100];
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    return quantifie(colorGradingSpec([x, x, x], p));
  });
}

function imprime(titre, lignes) {
  console.log("");
  console.log(titre);
  const tete = "scene".padEnd(22) + CANDIDATES.map((_, k) => ("#" + (k + 1)).padStart(7)).join("") + "   n";
  console.log(tete);
  console.log("".padEnd(tete.length, "-"));
  const somme = new Array(CANDIDATES.length).fill(0);
  let nb = 0;
  for (const [nom, r] of lignes) {
    const j = juge(r);
    if (!j[0]) { console.log(nom.padEnd(22) + "  aucun niveau lisible"); continue; }
    j.forEach((v, k) => { somme[k] += v.abs; });
    nb++;
    const meilleur = j.reduce((b, v, k) => (v.abs < j[b].abs ? k : b), 0);
    console.log(nom.padEnd(22) + j.map((v, k) => ((k === meilleur ? "*" : "") + v.abs.toFixed(2)).padStart(7)).join("") + String(j[0].n).padStart(5));
  }
  if (nb > 1) {
    const moy = somme.map((v) => v / nb);
    const b = moy.reduce((bb, v, k) => (v < moy[bb] ? k : bb), 0);
    console.log("".padEnd(tete.length, "-"));
    console.log("MOYENNE".padEnd(22) + moy.map((v, k) => ((k === b ? "*" : "") + v.toFixed(2)).padStart(7)).join(""));
  }
}

console.log("CANDIDATES :");
CANDIDATES.forEach(([nom], k) => console.log("  #%d  %s", k + 1, nom));

imprime("CONTROLE 1 — rampes du BREVET (ProPhoto lineaire, luminance) : doit designer #2", [
  ["brevet h040 S0,6", rampeBrevet(40, 0.6)],
  ["brevet h140 S0,6", rampeBrevet(140, 0.6)],
  ["brevet h220 S0,6", rampeBrevet(220, 0.6)],
  ["brevet h300 S0,6", rampeBrevet(300, 0.6)],
]);
imprime("CONTROLE 2 — rampes du TWIN (OKLab) : doit designer #3", [
  ["twin h040 sat60", rampeTwin(40, 60)],
  ["twin h140 sat60", rampeTwin(140, 60)],
  ["twin h220 sat60", rampeTwin(220, 60)],
  ["twin h300 sat60", rampeTwin(300, 60)],
]);

// ── MESURES : scenes de teinte seule, base identite (pas de grading2-*) ─────
const TEINTE_SEULE = [
  "st-h000", "st-h040", "st-h060", "st-h090", "st-h140", "st-h150", "st-h180",
  "st-h220", "st-h270", "st-h300", "st-h330",
  "st-ombres-sat20", "st-ombres-sat100", "st-ombres-bleu", "st-hl-orange", "st-duo",
  "st-balance-m100", "st-balance-m50", "st-balance-p50", "st-balance-p100",
  "cg-fusion-0", "cg-fusion-25", "cg-fusion-75", "cg-fusion-100",
  "cg-glob-h040", "cg-glob-h220", "grading-moyens-vert",
];
imprime("MESURES LIGHTROOM — scenes de teinte seule", TEINTE_SEULE.map((n) => [n, charge(n)?.rampe_rgb]).filter(([, r]) => r));
imprime("TEMOINS — rampe nue, toutes doivent rendre ~0", ["temoin", "temoin3", "temoin4"].map((n) => [n, charge(n)?.rampe_rgb]).filter(([, r]) => r));
