// E4 — LA ROUE GLOBALE EST-ELLE LA CONSTRUCTION DU BREVET, ET AVEC QUELS PENTES ?
//
// brevet-e4-globale : une cubique par canal AJUSTEE tient au plancher (0,35), mais
// les pentes PREDITES a S=0,6 laissent 9,5-15,6 niveaux. Donc c'est bien une
// cubique — reste a savoir si ses pentes AJUSTEES sont celles du brevet.
//
// On extrait s0, s1 par canal (moindres carres, comme brevet-courbes), puis on
// teste les trois signatures du brevet sur ces pentes :
//   1. teinteHSL(s0) = h et teinteHSL(s1) = h+180 (roue globale) ;
//   2. une invariance lineaire w.s = 1 : laquelle (Y ProPhoto, HSL, moyenne) ?
//   3. la saturation-limite (max-min)/(max+min) : quel S implique sat 60 ?
// Si les trois tiennent, la roue globale EST le brevet, et on lit le mapping
// sat -> S de Lightroom. Sinon on dit lequel casse.
import {
  s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, teinteHSL, charge, lisible,
} from "./brevet-commun.mjs";

const W = PP_XYZ[1];
const gam = (g) => ({ nom: `gamma ${g}`, code: (v) => Math.pow(Math.max(v, 0), 1 / g), decode: (v) => Math.pow(Math.max(v, 0), g) });
const lineaire = { nom: "lineaire", code: (v) => v, decode: (v) => v };
const trcSrgb = { nom: "TRC sRGB", code: (v) => l2s(Math.max(v, 0)), decode: (v) => s2l(Math.max(v, 0)) };
const CODAGES = [lineaire, gam(1.8), gam(2.2), trcSrgb];

const hermite = (x, s0, s1) => x + (s0 - 1) * x * (1 - x) * (1 - x) - (s1 - 1) * x * x * (1 - x);

function ajusteLibre(mesuree, E) {
  const pts = [];
  for (let i = 3; i <= 252; i++) {
    if (!lisible(mesuree[i])) continue;
    const X = E.code(s2l(i / 255));
    const pp = ap(SRGB_VERS_PP, mesuree[i].map((c) => s2l(c / 255)));
    pts.push([i, X, pp.map(E.code)]);
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
    const out = ap(PP_VERS_SRGB, [0, 1, 2].map((c) => E.decode(hermite(X, s0[c], s1[c]))));
    for (let c = 0; c < 3; c++) somme += Math.abs(niveau(out[c]) - mesuree[i][c]);
  }
  return { s0, s1, ecart: somme / (3 * pts.length) };
}

function signature(s) {
  const M = Math.max(...s), m = Math.min(...s);
  return {
    teinte: teinteHSL(s),
    S: (M - m) / (M + m),
    lum: W[0] * s[0] + W[1] * s[1] + W[2] * s[2], // invariance luminance Y ProPhoto
    hsl: (M + m) / 2,                              // invariance lumiere HSL
    moy: (s[0] + s[1] + s[2]) / 3,                 // invariance moyenne
  };
}

for (const [nom, h] of [["cg-glob-h040", 40], ["cg-glob-h220", 220]]) {
  const mes = charge(nom).rampe_rgb;
  console.log(`\n== ${nom}  (teinte cible ${h}, sat 60)`);
  for (const E of CODAGES) {
    const { s0, s1, ecart } = ajusteLibre(mes, E);
    const g0 = signature(s0), g1 = signature(s1);
    console.log(`  ${E.nom.padEnd(9)} ecart ${ecart.toFixed(2)}`);
    console.log(`     s0=[${s0.map((x) => x.toFixed(3)).join(", ")}]  teinte ${g0.teinte.toFixed(0)} (cible ${h})  S ${g0.S.toFixed(3)}  | lumY ${g0.lum.toFixed(3)} HSL ${g0.hsl.toFixed(3)} moy ${g0.moy.toFixed(3)}`);
    console.log(`     s1=[${s1.map((x) => x.toFixed(3)).join(", ")}]  teinte ${g1.teinte.toFixed(0)} (cible ${(h + 180) % 360})  S ${g1.S.toFixed(3)}  | lumY ${g1.lum.toFixed(3)} HSL ${g1.hsl.toFixed(3)} moy ${g1.moy.toFixed(3)}`);
  }
}

console.log("\nLECTURE : une invariance qui tient => sa colonne vaut 1,000 sur s0 ET s1.");
console.log("Le S implique le mapping sat60 -> S ; teinte s0~h et s1~h+180 => roue globale du brevet.");
