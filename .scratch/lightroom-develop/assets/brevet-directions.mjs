// LA DIRECTION DU VIRAGE, PAR TEINTE, CONTRE LES CONSTRUCTIONS DU BREVET
//
// Observable sans parametre : sur une rampe grise, le virage d'une seule roue
// deplace chaque niveau de pp = x (1,1,1) a pp_out. L'ecart pp_out - x, en
// ProPhoto LINEAIRE, est (presque) colineaire le long de la rampe
// (brevet-separable.mjs : h300 rend dB/dR = 1,00 et dG/dR = -0,40 du niveau 8 au
// niveau 224). Sa DIRECTION unitaire est donc une mesure par teinte, independante
// du profil de poids — et comme une application lineaire conserve la colinearite
// sur une entree grise, cette direction se transporte EXACTEMENT dans tout autre
// espace lineaire.
//
// Le brevet predit cette direction : les pentes au noir sont s = m + d p, ou p
// est le motif HSL de la teinte, d/m fixes par la saturation-limite S, et
// l'invariance fixe la composante grise. Ecart = s - 1. On compare, pour chaque
// teinte, l'angle 3D entre direction mesuree et direction predite, sous plusieurs
// invariances et plusieurs espaces de motif.
//
// ⚠️ La direction mesuree est une moyenne ponderee par la norme des ecarts (les
// niveaux ou le virage est fort pesent plus : c'est la que l'arrondi 8 bits pese
// le moins). On imprime aussi la part d'energie de la premiere composante : sous
// 0,99, l'ecart n'est pas separable et l'angle se lit avec prudence.
import { s2l, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, SRGB_XYZ65, motif, charge, lisible } from "./brevet-commun.mjs";

const norme = (v) => Math.hypot(v[0], v[1], v[2]);
const unit = (v) => { const n = norme(v); return v.map((c) => c / n); };
const angle = (a, b) => {
  const c = Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2]) / (norme(a) * norme(b));
  return (Math.acos(Math.min(1, c)) * 180) / Math.PI;
};

/** Premier vecteur propre de la matrice de covariance non centree des ecarts. */
function direction(rampe) {
  const C = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  let n = 0;
  for (let i = 6; i <= 250; i++) {
    if (!lisible(rampe[i])) continue;
    const x = s2l(i / 255);
    const pp = ap(SRGB_VERS_PP, rampe[i].map((c) => s2l(c / 255)));
    const d = pp.map((v) => (v - x) / Math.sqrt(x)); // relatif, adouci : les bas niveaux comptent sans dominer
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) C[a][b] += d[a] * d[b];
    n++;
  }
  // Puissance iteree.
  let v = [1, 0.3, -0.5];
  for (let k = 0; k < 200; k++) v = unit(ap(C, v));
  const lambda = v.reduce((s, _, a) => s + v[a] * ap(C, v)[a], 0);
  const trace = C[0][0] + C[1][1] + C[2][2];
  // Signe : oriente comme le motif (la plus grande composante positive).
  if (v[0] + v[1] + v[2] < 0 && Math.max(...v) < -Math.min(...v)) v = v.map((c) => -c);
  return { v, part: lambda / trace, n };
}

/** Ecart predit s - 1, exprime en ProPhoto lineaire. */
function predit(h, S, { motifEn, invariance }) {
  // motifEn : matrice ProPhoto lineaire -> espace ou le motif HSL est defini.
  const M = motifEn.m, Mi = motifEn.mi;
  const p = motif(h);
  const q = (1 - S) / (2 * S);
  let w;
  if (invariance === "Y ProPhoto") w = ap(transpose(Mi), PP_XYZ[1]); // w . pp = w' . esp
  else if (invariance === "moyenne ProPhoto") w = ap(transpose(Mi), [1 / 3, 1 / 3, 1 / 3]);
  else if (invariance === "Y dans l'espace du motif") w = motifEn.w;
  else if (invariance === "lumiere HSL") w = null;
  let d;
  if (!w) d = 2 / (2 * q + 1);
  else {
    const sw = w[0] + w[1] + w[2], wp = w[0] * p[0] + w[1] * p[1] + w[2] * p[2];
    d = sw / (q * sw + wp); // w . s = sw : l'invariance tient le gris (1,1,1) fixe
  }
  const m = q * d;
  const s = p.map((c) => m + d * c);
  return ap(M === null ? [[1, 0, 0], [0, 1, 0], [0, 0, 1]] : Mi, s.map((c) => c - 1));
}
function transpose(m) { return [0, 1, 2].map((i) => [0, 1, 2].map((j) => m[j][i])); }
const I3 = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
const ESP = {
  "ProPhoto": { m: I3, mi: I3, w: PP_XYZ[1] },
  "sRGB": { m: PP_VERS_SRGB, mi: SRGB_VERS_PP, w: SRGB_XYZ65[1] },
};

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const mes = TEINTES.map((t) => [t, direction(charge(`st-h${String(t).padStart(3, "0")}`).rampe_rgb)]);

console.log("DIRECTION MESUREE (ProPhoto lineaire, unitaire) et part de la 1re composante");
for (const [t, d] of mes) {
  console.log("  h%s  [%s]  part %s  n %d", String(t).padStart(3, "0"), d.v.map((c) => c.toFixed(3).padStart(7)).join(""), d.part.toFixed(4), d.n);
}

const CONSTR = [];
for (const [en, e] of Object.entries(ESP)) {
  for (const inv of ["Y ProPhoto", "moyenne ProPhoto", "Y dans l'espace du motif", "lumiere HSL"]) {
    CONSTR.push([`motif ${en}, ${inv}`, { motifEn: e, invariance: inv }]);
  }
}
console.log("");
console.log("ANGLE 3D (degres) entre direction mesuree et predite, S = 0,6");
console.log("construction".padEnd(42) + TEINTES.map((t) => String(t).padStart(6)).join("") + "   moy");
for (const [nom, c] of CONSTR) {
  const a = mes.map(([t, d]) => angle(d.v, predit(t, 0.6, c)));
  console.log(nom.padEnd(42) + a.map((x) => x.toFixed(1).padStart(6)).join("") + (a.reduce((s, x) => s + x, 0) / a.length).toFixed(2).padStart(7));
}

// Decomposition : la direction mesuree = composante CHROMATIQUE + composante GRISE.
// Si la teinte est juste et seule la luminance differe, l'angle apres retrait de la
// composante grise (projection sur le plan orthogonal a (1,1,1)) doit tomber a ~0.
console.log("");
console.log("MEME ANGLE APRES RETRAIT DE LA COMPOSANTE GRISE (projection orthogonale a 1,1,1)");
const sansGris = (v) => { const g = (v[0] + v[1] + v[2]) / 3; return v.map((c) => c - g); };
for (const [nom, c] of CONSTR.filter(([n]) => n.includes("Y ProPhoto") || n.includes("HSL"))) {
  const a = mes.map(([t, d]) => angle(sansGris(d.v), sansGris(predit(t, 0.6, c))));
  console.log(nom.padEnd(42) + a.map((x) => x.toFixed(1).padStart(6)).join("") + (a.reduce((s, x) => s + x, 0) / a.length).toFixed(2).padStart(7));
}
console.log("");
console.log("COMPOSANTE GRISE MESUREE : (dR+dG+dB)/3 rapportee a la norme chromatique");
console.log("  (la composante grise PREDITE sous Y ProPhoto en regard)");
for (const [t, d] of mes) {
  const g = (d.v[0] + d.v[1] + d.v[2]) / 3, ch = norme(sansGris(d.v));
  const p = predit(t, 0.6, CONSTR[0][1]); const gp = (p[0] + p[1] + p[2]) / 3, chp = norme(sansGris(p));
  console.log("  h%s  mesuree %s   predite %s", String(t).padStart(3, "0"), (g / ch).toFixed(3).padStart(7), (gp / chp).toFixed(3).padStart(7));
}
