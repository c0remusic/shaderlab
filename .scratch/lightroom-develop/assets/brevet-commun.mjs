// L'INSTRUMENT COMMUN DU BREVET B220 — US 7 830 548 B2, « Method and apparatus for
// generating color toning curves », Mark Hamburg, Adobe.
//
// Le binaire de Lightroom cite ce brevet en clair a cote de cr_stage_SplitTone
// (research/17). Personne ne l'avait lu. Il decrit l'operateur ENTIER :
//
//   - trois COURBES PAR CANAL, R(x), G(x), B(x), appliquees canal par canal —
//     R(r), G(g), B(b) sur une image en couleur ;
//   - noir -> noir et blanc -> blanc, EXACTEMENT ;
//   - la teinte des ombres est portee par les PENTES en 0 : par l'Hospital, la
//     teinte de (R(x), G(x), B(x)) quand x -> 0 vaut la teinte HSL du vecteur des
//     pentes (R'(0), G'(0), B'(0)) ; idem en 1 pour les hautes lumieres ;
//   - la saturation HSL a la limite vaut (max - min) / (max + min) des pentes ;
//   - une propriete d'INVARIANCE fournit la troisieme equation : lumiere HSL
//     (min + max) / 2 = x, ou luminance wR R + wG G + wB B = x, dont la derivee
//     donne w . pentes = 1 ;
//   - une CUBIQUE d'Hermite par canal entre (0, 0, s0) et (1, 1, s1). Une
//     cubique conserve EXACTEMENT une invariance lineaire sur tout [0, 1] ;
//   - les pentes hors d'une plage « valide » sont bornees (exemple du texte :
//     [0,2 ; 5]), ou la saturation est reduite (exemple : 100 % -> 70 %).
//
// Ce fichier ne CALIBRE rien. Il fournit les conversions, le chargement des
// mesures et l'operateur du brevet parametre par ses inconnues (espace de
// travail, invariance, loi de saturation), plus des CONTROLES qui tournent a
// l'import : un instrument qui ne se verifie pas sur une reponse connue ne se
// croit pas (research/21, balance-partage.mjs).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";

const ICI = path.dirname(url.fileURLToPath(import.meta.url));
export const MESURES = path.resolve(ICI, "../research/mesures");

// ── Transferts ──────────────────────────────────────────────────────────────
export const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
export const l2s = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
/** Niveau sRGB 0..255 d'une valeur LINEAIRE sRGB, ecretee comme un export. */
export const niveau = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));
export const lineaireDeNiveau = (n) => s2l(n / 255);

// ── Matrices (Lindbloom), adaptation Bradford D65 <-> D50 ───────────────────
export const PP_XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
export const XYZ50_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
export const SRGB_XYZ65 = [[0.4124564, 0.3575761, 0.1804375], [0.2126729, 0.7151522, 0.072175], [0.0193339, 0.119192, 0.9503041]];
export const ap = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
const mul = (A, B) => A.map((ligne) => [0, 1, 2].map((j) => ligne[0] * B[0][j] + ligne[1] * B[1][j] + ligne[2] * B[2][j]));
/** sRGB lineaire (D65) -> ProPhoto lineaire (D50), et retour. */
export const PP_VERS_SRGB = mul(XYZ50_SRGB, PP_XYZ);
export const SRGB_VERS_PP = inverse3(PP_VERS_SRGB);
const IDENTITE = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];

// ── OKLab (Ottosson), sur sRGB lineaire ─────────────────────────────────────
export function oklab(rgb) {
  const [r, g, b] = rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

// ── HSL du brevet, sur un vecteur quelconque (pentes comprises) ─────────────
/** Teinte HSL en degres [0, 360) — formule du brevet, par sextant. */
export function teinteHSL([r, g, b]) {
  const M = Math.max(r, g, b), m = Math.min(r, g, b), d = M - m;
  if (d <= 0) return NaN;
  let h;
  if (M === r) h = 60 * ((g - b) / d);
  else if (M === g) h = 60 * ((b - r) / d) + 120;
  else h = 60 * ((r - g) / d) + 240;
  return ((h % 360) + 360) % 360;
}
/** Motif de teinte : la couleur pure de teinte h, min 0 et max 1. */
export function motif(h) {
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = 1 - Math.abs((hh % 2) - 1);
  const s = Math.floor(hh) % 6;
  return [[1, x, 0], [x, 1, 0], [0, 1, x], [0, x, 1], [x, 0, 1], [1, 0, x]][s];
}

// ── Espaces de travail candidats ────────────────────────────────────────────
// matrice : sRGB lineaire -> espace lineaire ; code/decode : courbe de transfert
// sur laquelle les courbes du brevet sont definies ; w : poids de la luminance
// de l'espace (ligne Y de sa matrice vers XYZ).
const g18 = { code: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / 1.8), decode: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1.8) };
const lin = { code: (v) => v, decode: (v) => v };
const trcSrgb = {
  code: (v) => Math.sign(v) * l2s(Math.abs(v)),
  decode: (v) => Math.sign(v) * s2l(Math.abs(v)),
};
export const ESPACES = {
  "ProPhoto lineaire": { vers: SRGB_VERS_PP, depuis: PP_VERS_SRGB, ...lin, w: PP_XYZ[1] },
  "ProPhoto gamma 1,8": { vers: SRGB_VERS_PP, depuis: PP_VERS_SRGB, ...g18, w: PP_XYZ[1] },
  "ProPhoto TRC sRGB (Melissa)": { vers: SRGB_VERS_PP, depuis: PP_VERS_SRGB, ...trcSrgb, w: PP_XYZ[1] },
  "sRGB lineaire": { vers: IDENTITE, depuis: IDENTITE, ...lin, w: SRGB_XYZ65[1] },
  "sRGB encode": { vers: IDENTITE, depuis: IDENTITE, ...trcSrgb, w: SRGB_XYZ65[1] },
};

// ── Les pentes du brevet ────────────────────────────────────────────────────
/**
 * Vecteur de pentes de teinte HSL `h`, de saturation-limite `S` (0..1), qui
 * satisfait l'invariance.
 *
 * Par le brevet : la teinte fixe le MOTIF (max, milieu, min) a une transformation
 * affine pres, donc s = m + (M - m) p. La saturation-limite (M - m) / (M + m) = S
 * et l'invariance lineaire w . s = 1 (luminance) ou (M + m) / 2 = 1 (lumiere HSL)
 * donnent m et M. `invariance` : "luminance" (poids w de l'espace), "lumiere"
 * (HSL), "moyenne" (poids egaux).
 *
 * En x = 1, l'Hospital rend la teinte de (1 - eps s) : l'ORDRE des composantes
 * s'inverse, donc la pente de hautes lumieres porte la teinte h + 180.
 */
export function pentes(h, S, w, invariance = "luminance") {
  const p = motif(h);
  if (S <= 0) return [1, 1, 1];
  // s = m + d p, avec d = M - m ; S = d / (2m + d) => m = d (1 - S) / (2 S).
  // Invariance : 1 = w . s = m (somme w) + d (w . p) pour la luminance.
  const q = (1 - S) / (2 * S);
  let d;
  if (invariance === "lumiere") d = 2 / (2 * q + 1);
  else {
    const ww = invariance === "moyenne" ? [1 / 3, 1 / 3, 1 / 3] : w;
    const sw = ww[0] + ww[1] + ww[2];
    const wp = ww[0] * p[0] + ww[1] * p[1] + ww[2] * p[2];
    d = 1 / (q * sw + wp);
  }
  const m = q * d;
  return p.map((c) => m + d * c);
}

/** Cubique d'Hermite (0,0,s0) -> (1,1,s1), un canal. */
export const hermite = (x, s0, s1) => x + (s0 - 1) * x * (1 - x) * (1 - x) - (s1 - 1) * x * x * (1 - x);

// ── Mesures ─────────────────────────────────────────────────────────────────
export function charge(nom) {
  const f = path.join(MESURES, `${nom}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
}
/** Un niveau est LISIBLE si aucun canal n'est ecrete par l'export. */
export const lisible = (rgb) => rgb.every((v) => v > 0.5 && v < 254.5);

// ── CONTROLES, a l'import ───────────────────────────────────────────────────
{
  const aller = ap(PP_VERS_SRGB, ap(SRGB_VERS_PP, [0.2, 0.5, 0.9]));
  if (Math.max(...aller.map((v, i) => Math.abs(v - [0.2, 0.5, 0.9][i]))) > 1e-9) throw new Error("matrices inverses fausses");
  const blanc = ap(SRGB_VERS_PP, [1, 1, 1]);
  if (Math.max(...blanc.map((v) => Math.abs(v - 1))) > 1e-4) throw new Error("le blanc sRGB n'arrive pas au blanc ProPhoto : adaptation fausse");
  for (const h of [0, 40, 90, 140, 220, 300, 330]) {
    for (const inv of ["luminance", "lumiere", "moyenne"]) {
      const w = PP_XYZ[1];
      const s = pentes(h, 0.6, w, inv);
      const ht = teinteHSL(s);
      if (Math.abs(((ht - h + 540) % 360) - 180) > 1e-9) throw new Error(`pentes : teinte ${ht} au lieu de ${h} (${inv})`);
      const M = Math.max(...s), m = Math.min(...s);
      if (Math.abs((M - m) / (M + m) - 0.6) > 1e-12) throw new Error("pentes : saturation-limite fausse");
      const cible = inv === "lumiere" ? (M + m) / 2 : inv === "moyenne" ? (s[0] + s[1] + s[2]) / 3 : w[0] * s[0] + w[1] * s[1] + w[2] * s[2];
      if (Math.abs(cible - 1) > 1e-12) throw new Error(`pentes : invariance ${inv} non tenue (${cible})`);
      // L'Hospital : la teinte de la courbe pres du noir tend vers celle des pentes.
      const e = 1e-7, pres = s.map((sc) => hermite(e, sc, 1));
      if (Math.abs(((teinteHSL(pres) - h + 540) % 360) - 180) > 1e-3) throw new Error("hermite : teinte au noir fausse");
    }
  }
  for (const [s0, s1] of [[1.7, 0.4], [0.2, 5]]) {
    if (Math.abs(hermite(0, s0, s1)) > 1e-15 || Math.abs(hermite(1, s0, s1) - 1) > 1e-15) throw new Error("hermite : bouts non cloues");
  }
  // Une cubique conserve une invariance lineaire sur TOUT [0, 1] (le brevet).
  const w = PP_XYZ[1], s0 = pentes(220, 0.6, w), s1 = pentes(40 + 180, 0.6, w);
  for (const x of [0.1, 0.37, 0.5, 0.83]) {
    const y = [0, 1, 2].map((c) => hermite(x, s0[c], s1[c]));
    const Y = w[0] * y[0] + w[1] * y[1] + w[2] * y[2];
    if (Math.abs(Y - x * (w[0] + w[1] + w[2])) > 1e-12) throw new Error("hermite : invariance non tenue a l'interieur");
  }
}
