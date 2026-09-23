// E3 — TEST DECISIF : LA BALANCE EST-ELLE UN REMAP HOMOGRAPHIQUE DE L'ABSCISSE ?
//
// Sans modele de direction ni de forme : on prend st-duo (balance 0) comme profil
// CANONIQUE mesure (vecteur chroma OKLab a chaque niveau), et on PREDIT chaque
// st-balance-* en pre-deformant son abscisse par la divMap
//   f(x,a) = a x/(a x + 1 - x),  a(b) = (255 - c(b))/c(b),  c(b) = 127.6 - 1.02 b.
//   C_b(x) ~ C_0( f(x, a(b)) )     [f en abscisse sRGB ENCODEE ; croisement mesure a 128]
// La luminance L est prise de la mesure cible (on teste la CHROMA/balance, pas L).
// On juge en NIVEAUX sRGB, 3 canaux, contre un CONTROLE = identite (pas de remap).
import { s2l, l2s, oklab, charge, lisible } from "./brevet-commun.mjs";

function oklabInv([L, a, b]) {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b, m_ = L - 0.1055613458 * a - 0.0638541728 * b, s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  return [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
}
const niveau = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));
const cible = (b) => 127.58 - 1.020 * b;
const aDe = (b) => (255 - cible(b)) / cible(b);
const divMap = (x, a) => (a * x) / (a * x + 1 - x);

// Profil canonique : L, a, b mesures de st-duo a chaque niveau (0..255), interpolables.
const duo = charge("st-duo").rampe_rgb;
const LAB = duo.map((rgb) => oklab(rgb.map((c) => s2l(c / 255))));
function labInterp(niv) { // niv fractionnaire 0..255
  const i = Math.max(0, Math.min(254, Math.floor(niv))), t = niv - i;
  return [0, 1, 2].map((k) => LAB[i][k] * (1 - t) + LAB[i + 1][k] * t);
}

console.log("=== Balance = remap homographique : ecart en niveaux sRGB (canonique = st-duo, a0=%s) ===", aDe(0).toFixed(3));
console.log("scene".padEnd(18) + "remap divMap".padStart(14) + "controle identite".padStart(20) + "   n");
for (const [nom, b] of [["st-balance-m100", -100], ["st-balance-m50", -50], ["st-duo", 0], ["st-balance-p50", 50], ["st-balance-p100", 100]]) {
  const r = charge(nom)?.rampe_rgb; if (!r) continue;
  const a = aDe(b) / aDe(0); // remap relatif au canonique (a0 ~ 1)
  let eR = 0, eI = 0, n = 0;
  for (let i = 3; i <= 252; i++) {
    if (!lisible(r[i])) continue;
    const Lc = oklab(r[i].map((c) => s2l(c / 255)))[0]; // L mesure de la cible
    // remap : abscisse de la scene b -> abscisse canonique
    const nivCan = 255 * divMap(i / 255, a);
    const abR = labInterp(nivCan), abI = labInterp(i);
    const outR = oklabInv([Lc, abR[1], abR[2]]), outI = oklabInv([Lc, abI[1], abI[2]]);
    for (let c = 0; c < 3; c++) { eR += Math.abs(niveau(outR[c]) - r[i][c]); eI += Math.abs(niveau(outI[c]) - r[i][c]); }
    n++;
  }
  console.log(nom.padEnd(18) + (eR / (3 * n)).toFixed(2).padStart(14) + (eI / (3 * n)).toFixed(2).padStart(20) + String(n).padStart(6));
}

// ── Cloches = structure : une cubique clouee en 0 et 1 EST une cloche ──────────
// X^p (1-X)^q, sommet X* = p/(p+q). Les sommets mesures (script profils, abscisse
// L OKLab) contre les centres de research/19 (ajustes en gaussienne sur L OKLab).
console.log("");
console.log("=== Les cloches de research/19 sont la structure du clouage (sommet en L OKLab) ===");
console.log("roue          sommet mesure (L OKLab)   centre research/19   forme");
const rows = [
  ["ombres", "st-ombres-bleu", 0.130, "concentree bas (grand q)"],
  ["moyens", "grading-moyens-vert", 0.570, "cloche etroite au centre (p~q~3)"],
  ["hautes", "st-hl-orange", 0.810, "concentree haut (grand p)"],
  ["globale", "cg-glob-h040", 0.450, "cloche large ~ cubique pure (p~q~0.75)"],
];
const Loklab = (n) => oklab([s2l(n / 255), s2l(n / 255), s2l(n / 255)])[0];
for (const [roue, scene, centre19, forme] of rows) {
  const r = charge(scene).rampe_rgb; let bi = 0, bc = -1;
  for (let i = 3; i <= 252; i++) { if (!lisible(r[i])) continue; const c = Math.hypot(...oklab(r[i].map((v) => s2l(v / 255))).slice(1)); if (c > bc) { bc = c; bi = i; } }
  console.log(roue.padEnd(14) + (Loklab(bi).toFixed(3) + " (niv " + bi + ")").padStart(22) + String(centre19).padStart(20) + "   " + forme);
}
console.log("");
console.log("Une bell clouee aux deux bouts n'est pas une bizarrerie a expliquer : c'est ce que");
console.log("noir->noir et blanc->blanc IMPOSENT. La plage (ombres/moyens/hautes) place son sommet ;");
console.log("balance le glisse ; fusion l'elargit. research/19 mesurait la structure, pas une anomalie.");
