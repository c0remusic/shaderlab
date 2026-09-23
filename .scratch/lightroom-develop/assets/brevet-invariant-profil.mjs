// LE PROFIL, PAS LE SCALAIRE : ou et dans quel sens l'invariance casse-t-elle ?
//
// brevet-invariant.mjs rend un ecart moyen par scene. Deux constats y restent
// muets : (1) sur plusieurs teintes des ombres a saturation 60, AUCUNE candidate
// ne tient (h060 : 7 a 8 niveaux) ; (2) les roues globale et des tons moyens
// designent la lumiere HSL en ProPhoto gamma 1,8, candidate qu'on n'a testee que
// dans trois codages. On imprime le profil SIGNE par niveau, et on elargit les
// codages de la lumiere HSL.
import { s2l, l2s, ap, SRGB_VERS_PP, PP_XYZ, charge, lisible } from "./brevet-commun.mjs";

const pp = (lin) => ap(SRGB_VERS_PP, lin);
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
const lum = (v) => (Math.max(...v) + Math.min(...v)) / 2;
const gam = (g) => (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / g);
const trc = (v) => Math.sign(v) * l2s(Math.abs(v));

function equiv(f, val) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f([m, m, m]) < val) lo = m; else hi = m; }
  return 255 * l2s((lo + hi) / 2);
}
const Y = (l) => dot(PP_XYZ[1], pp(l));

console.log("ECART SIGNE DE Y ProPhoto (niveau equivalent - niveau d'entree), par niveau");
console.log("  « . » = niveau illisible (un canal ecrete)");
const NIV = [8, 16, 32, 48, 64, 96, 128, 160, 192, 224, 248];
console.log("scene".padEnd(18) + NIV.map((n) => String(n).padStart(7)).join(""));
for (const nom of ["st-h000", "st-h040", "st-h060", "st-h090", "st-h140", "st-h180", "st-h220", "st-h300",
  "st-ombres-sat20", "st-ombres-bleu", "st-ombres-sat100", "st-hl-orange", "cg-glob-h040", "grading-moyens-vert"]) {
  const r = charge(nom).rampe_rgb;
  console.log(nom.padEnd(18) + NIV.map((n) => {
    if (!lisible(r[n])) return ".".padStart(7);
    const l = r[n].map((c) => s2l(c / 255));
    return (equiv(Y, Y(l)) - n).toFixed(1).padStart(7);
  }).join(""));
}

console.log("");
console.log("LUMIERE HSL (min+max)/2 DANS D'AUTRES CODAGES — roues globale et moyens");
const CODAGES = [
  ["ProPhoto lineaire", (l) => lum(pp(l))],
  ["ProPhoto gamma 1,6", (l) => lum(pp(l).map(gam(1.6)))],
  ["ProPhoto gamma 1,8", (l) => lum(pp(l).map(gam(1.8)))],
  ["ProPhoto gamma 2,0", (l) => lum(pp(l).map(gam(2.0)))],
  ["ProPhoto gamma 2,2", (l) => lum(pp(l).map(gam(2.2)))],
  ["ProPhoto TRC sRGB (Melissa)", (l) => lum(pp(l).map(trc))],
  ["sRGB lineaire", (l) => lum(l)],
  ["sRGB gamma 1,8", (l) => lum(l.map(gam(1.8)))],
];
const SC = ["cg-glob-h040", "cg-glob-h220", "grading-moyens-vert", "grading-global-lum-p50"];
console.log("codage".padEnd(30) + SC.map((s) => s.padStart(22)).join(""));
for (const [nom, f] of CODAGES) {
  console.log(nom.padEnd(30) + SC.map((s) => {
    const r = charge(s)?.rampe_rgb;
    if (!r) return "—".padStart(22);
    let sa = 0, n = 0;
    for (let i = 4; i <= 251; i++) {
      if (!lisible(r[i])) continue;
      const l = r[i].map((c) => s2l(c / 255));
      sa += Math.abs(equiv(f, f(l)) - i); n++;
    }
    return (sa / n).toFixed(3).padStart(22);
  }).join(""));
}
console.log("");
console.log("(grading-global-lum-p50 porte un curseur de Luminance : il ne doit tenir AUCUNE");
console.log(" invariance — c'est le temoin negatif de la colonne.)");
