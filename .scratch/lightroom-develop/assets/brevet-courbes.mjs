// LES COURBES PAR CANAL SONT-ELLES DES CUBIQUES D'HERMITE, ET DANS QUEL CODAGE ?
//
// Le brevet B220 construit trois courbes R(x), G(x), B(x), clouees en (0,0) et
// (1,1), une CUBIQUE d'Hermite par canal determinee par ses deux pentes. Sur une
// rampe grise, la sortie mesuree, ramenee dans l'espace de travail, EST la
// courbe : pp_c = C_c(x). On l'ajuste donc directement.
//
// Pour un codage E candidat, X = E(x) et Y_c = E(pp_c). La cubique s'ecrit
//   Y_c - X = (s0 - 1) X (1 - X)^2 - (s1 - 1) X^2 (1 - X)
// LINEAIRE en (s0, s1) : moindres carres a deux inconnues par canal, aucune
// iteration. Le codage juste est celui ou la cubique reproduit la mesure a
// l'arrondi 8 bits pres ; un mauvais codage tord la courbe et laisse un residu
// structure.
//
// Seules les scenes a BALANCE 0 entrent ici : si la balance deforme l'abscisse
// (le binaire porte un balanceMapAlpha de carte homographique), une rampe a
// Balance -100 n'est pas une cubique en X, et la melanger jugerait la balance au
// lieu de la courbe. Fusion vaut 50 par defaut dans toutes ces scenes.
//
// ⚠️ CONTROLE : une rampe fabriquee par le brevet dans un codage connu doit etre
// reconnue dans CE codage, avec un residu au plancher de quantification.
import { s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, pentes, hermite, charge, lisible } from "./brevet-commun.mjs";

const gam = (g) => [(v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / g), (v) => Math.sign(v) * Math.pow(Math.abs(v), g)];
const trc = [(v) => Math.sign(v) * l2s(Math.abs(v)), (v) => Math.sign(v) * s2l(Math.abs(v))];
const CODAGES = [
  ["lineaire", [(v) => v, (v) => v]],
  ["gamma 1,8", gam(1.8)],
  ["gamma 2,2", gam(2.2)],
  ["TRC sRGB (Melissa)", trc],
];

/** Ajuste s0, s1 par canal ; rend { s0[3], s1[3], ecart (niveaux sRGB), n }. */
function ajuste(rampe, [code, decode]) {
  const pts = [];
  for (let i = 3; i <= 252; i++) {
    if (!lisible(rampe[i])) continue;
    const X = code(s2l(i / 255));
    const pp = ap(SRGB_VERS_PP, rampe[i].map((c) => s2l(c / 255)));
    pts.push([i, X, pp.map(code)]);
  }
  const s0 = [], s1 = [];
  for (let c = 0; c < 3; c++) {
    let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
    for (const [, X, Yc] of pts) {
      const a = X * (1 - X) * (1 - X), b = -X * X * (1 - X), y = Yc[c] - X;
      aa += a * a; ab += a * b; bb += b * b; ay += a * y; by += b * y;
    }
    const det = aa * bb - ab * ab;
    s0.push(1 + (ay * bb - by * ab) / det);
    s1.push(1 + (aa * by - ab * ay) / det);
  }
  let somme = 0;
  for (const [i, X] of pts) {
    const out = ap(PP_VERS_SRGB, [0, 1, 2].map((c) => decode(hermite(X, s0[c], s1[c]))));
    for (let c = 0; c < 3; c++) somme += Math.abs(niveau(out[c]) - rampe[i][c]);
  }
  return { s0, s1, ecart: somme / (3 * pts.length), n: pts.length };
}

function rampeBrevetCodee([code, decode], h, S) {
  const s0 = pentes(h, S, PP_XYZ[1]);
  return Array.from({ length: 256 }, (_, i) => {
    const X = code(s2l(i / 255));
    const pp = [0, 1, 2].map((c) => decode(hermite(X, s0[c], 1)));
    return ap(PP_VERS_SRGB, pp).map((v) => Math.round(niveau(v) * 100) / 100);
  });
}

function tableau(titre, scenes) {
  console.log("");
  console.log(titre);
  console.log("scene".padEnd(26) + CODAGES.map(([n]) => n.padStart(20)).join("") + "     n");
  for (const [nom, r] of scenes) {
    const res = CODAGES.map(([, c]) => ajuste(r, c));
    const b = res.reduce((bb, v, k) => (v.ecart < res[bb].ecart ? k : bb), 0);
    console.log(nom.padEnd(26) + res.map((v, k) => ((k === b ? "*" : "") + v.ecart.toFixed(2)).padStart(20)).join("") + String(res[0].n).padStart(6));
  }
}

tableau("CONTROLE — rampes du brevet fabriquees dans un codage connu (doit designer ce codage)", [
  ["brevet lineaire h220", rampeBrevetCodee(CODAGES[0][1], 220, 0.6)],
  ["brevet gamma 1,8 h220", rampeBrevetCodee(CODAGES[1][1], 220, 0.6)],
  ["brevet Melissa h040", rampeBrevetCodee(CODAGES[3][1], 40, 0.6)],
]);

const SCENES = ["st-ombres-bleu", "st-hl-orange", "st-duo", "cg-fusion-0", "cg-fusion-25", "cg-fusion-75", "cg-fusion-100",
  "grading-ombres-bleu", "grading-hl-orange", "grading-fusion-0", "grading-fusion-100", "cg-glob-h040", "cg-glob-h220", "grading-moyens-vert"];
tableau("MESURES — ecart de la meilleure cubique d'Hermite, en niveaux sRGB", SCENES.map((n) => [n, charge(n)?.rampe_rgb]).filter(([, r]) => r));

console.log("");
console.log("PENTES AJUSTEES (codage lineaire et Melissa) — s0 porte la roue des ombres, s1 celle des hautes");
for (const nom of ["st-ombres-bleu", "st-hl-orange", "st-duo"]) {
  const r = charge(nom).rampe_rgb;
  for (const k of [0, 3]) {
    const v = ajuste(r, CODAGES[k][1]);
    console.log("  %s %s  s0 = [%s]  s1 = [%s]", nom.padEnd(16), CODAGES[k][0].padEnd(20),
      v.s0.map((x) => x.toFixed(3)).join(", "), v.s1.map((x) => x.toFixed(3)).join(", "));
  }
}
