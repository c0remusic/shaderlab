// LE MECANISME DE LA SINGULARITE A 246 : une composante LMS traverse zero.
// OKLab prend la racine cubique de l, m, s. La derivee de cbrt est infinie en 0 :
// si une composante change de signe sur le cercle des teintes, l'angle ab y tourne
// arbitrairement vite. On regarde si c'est le cas, et ou.
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";

const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
// La matrice sRGB lineaire -> LMS d'OKLab (Bjorn Ottosson).
const LMS = [[0.4122214708, 0.5363325363, 0.0514459929],
             [0.2119034982, 0.6806995451, 0.1073969566],
             [0.0883024619, 0.2817188376, 0.6299787005]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const roue = (h) => hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
const lms = (h) => ap(LMS, ap(XS, ap(PP, roue(h))));

console.log("teinte        l          m          s      signe   composante la plus proche de zero");
console.log("".padEnd(84, "-"));
for (const h of [180, 200, 220, 235, 240, 243, 245, 246, 247, 250, 260, 270]) {
  const v = lms(h);
  const i = v.map((x, k) => [Math.abs(x), k]).sort((a, b) => a[0] - b[0])[0][1];
  console.log("%s %s   %s   %s", String(h).padStart(6),
    v.map((x) => x.toFixed(5).padStart(10)).join(" "),
    v.map((x) => (x < 0 ? "-" : "+")).join(""), ("lms"[i] + " = " + v[i].toFixed(5)));
}
for (let k = 0; k < 3; k++) {
  let prev = lms(0)[k], croise = [];
  for (let h = 0.25; h < 360; h += 0.25) {
    const v = lms(h)[k];
    if (prev < 0 !== v < 0) croise.push(h);
    prev = v;
  }
  console.log("");
  console.log("composante %s : %d traversee(s) de zero sur le cercle%s", "lms"[k], croise.length,
    croise.length ? " — aux teintes " + croise.map((x) => x.toFixed(1)).join(", ") : "");
}
console.log("");
console.log("Une traversee de zero d'une composante LMS est une SINGULARITE de la famille :");
console.log("cbrt y a une derivee infinie, l'angle ab y tourne sans borne, et la loi n'y");
console.log("est plus une rotation lisse du cercle des teintes.");
