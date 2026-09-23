// D'OU VIENT LA SINGULARITE A 246 ? Les valeurs intermediaires de la famille D.
// La famille interprete la couleur de roue sRGB comme des coordonnees ProPhoto,
// puis revient en sRGB lineaire. ProPhoto etant BEAUCOUP plus large que sRGB, le
// retour peut sortir de [0,1] — et `linearSrgbToOklab` d'une composante negative
// est une extrapolation, pas une couleur. On regarde si la region en litige
// (180-270, celle qui ne porte qu'un point mesure) est dans ce cas.
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";

const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const roue = (h) => hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;

console.log("teinte   roue sRGB          -> lineaire sRGB apres XS.PP (famille D)      |ab|    angle   etat");
console.log("".padEnd(104, "-"));
for (const h of [0, 40, 90, 140, 180, 200, 220, 230, 235, 240, 245, 246, 247, 250, 260, 270, 300, 330]) {
  const w = roue(h), o = ap(XS, ap(PP, w));
  const lab = linearSrgbToOklab(o);
  const hors = o.some((v) => v < 0 || v > 1);
  const tresHors = o.some((v) => v < -0.25);
  console.log("%s %s -> %s %s %s   %s", String(h).padStart(6),
    w.map((v) => v.toFixed(3)).join(" ").padEnd(17),
    o.map((v) => v.toFixed(4).padStart(9)).join(" "),
    Math.hypot(lab[1], lab[2]).toFixed(4).padStart(8), deg(lab[1], lab[2]).toFixed(1).padStart(8),
    tresHors ? "TRES hors gamut" : hors ? "hors gamut" : "dedans");
}
let n = 0, nTres = 0;
for (let h = 0; h < 360; h += 0.5) {
  const o = ap(XS, ap(PP, roue(h)));
  if (o.some((v) => v < 0 || v > 1)) n++;
  if (o.some((v) => v < -0.25)) nTres++;
}
console.log("");
console.log("Sur 720 teintes echantillonnees : %d hors de [0,1] (%s %%), dont %d au-dela de -0,25 (%s %%).",
  n, ((n / 720) * 100).toFixed(0), nTres, ((nTres / 720) * 100).toFixed(0));
console.log("");
console.log("Une composante lineaire negative n'est pas une couleur : `linearSrgbToOklab`");
console.log("y prend la racine cubique d'un nombre negatif et rend une EXTRAPOLATION. La");
console.log("famille D n'est donc pas definie par une couleur sur tout le cercle, et c'est");
console.log("dans ce regime que tombe le secteur 180-270 — celui qui ne porte qu'UN point");
console.log("mesure, et dont le script d'origine tire une « deformation monotone ».");
