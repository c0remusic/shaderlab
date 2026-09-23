// LA SINGULARITE DE LA FAMILLE GAGNANTE
//
// Le gain local de ProPhoto lineaire vaut 0,22 deg/deg a la teinte 220 et 29,9 a
// la teinte 246. Un facteur 135 sur 26 degres de roue : ce n'est pas une pente,
// c'est un point singulier. Deux causes possibles, et une seule est benigne :
//   - la matrice est mal chainee (le blanc ne tomberait pas sur le blanc) ;
//   - le VECTEUR ab de la famille passe pres de ZERO a cette teinte, et l'angle
//     d'un vecteur nul tourne d'un demi-tour sans que rien ne bouge.
// La seconde serait disqualifiante : une roue de couleur de Lightroom donne une
// couleur SATUREE a chaque teinte, jamais une couleur neutre.
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const roue = (h) => hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
const labD = (h) => linearSrgbToOklab(ap(XS, ap(PP, roue(h)))).slice(1);
const labA = (h) => linearSrgbToOklab(roue(h).map(srgbToLinear)).slice(1);

console.log("1. LE CHAINAGE EST-IL BON ? (le blanc doit tomber sur le blanc)");
const blanc = ap(XS, ap(PP, [1, 1, 1]));
console.log("   XS . PP . (1,1,1) = [%s] — %s",
  blanc.map((v) => v.toFixed(5)).join(", "),
  blanc.every((v) => Math.abs(v - 1) < 1e-3) ? "NEUTRE, le chainage porte bien l'adaptation D50->D65." : "NON NEUTRE — adaptation chromatique manquante.");

console.log("");
console.log("2. LE VECTEUR ab DE LA FAMILLE D PASSE-T-IL PRES DE ZERO ?");
console.log("");
console.log("teinte    |ab| famille D    |ab| famille A    gain local D   rapport D/A");
console.log("".padEnd(76, "-"));
let minN = Infinity, minH = 0;
for (let h = 0; h < 360; h += 0.5) {
  const n = Math.hypot(...labD(h));
  if (n < minN) { minN = n; minH = h; }
}
for (const h of [180, 200, 220, 235, 240, 243, 244, 245, 246, 247, 248, 250, 255, 260, 270]) {
  const nD = Math.hypot(...labD(h)), nA = Math.hypot(...labA(h));
  const g = ecartAngle(deg(...labD(h + 0.25)), deg(...labD(h - 0.25))) / 0.5;
  console.log("%s %s %s %s %s", String(h).padStart(6), nD.toFixed(5).padStart(17),
    nA.toFixed(5).padStart(17), g.toFixed(2).padStart(14), (nD / nA).toFixed(3).padStart(13));
}
console.log("");
console.log("minimum de |ab| de la famille D : %s a la teinte %s deg.", minN.toFixed(5), minH.toFixed(1));
{
  const nMed = (() => { const v = []; for (let h = 0; h < 360; h += 1) v.push(Math.hypot(...labD(h))); v.sort((a, b) => a - b); return v[180]; })();
  console.log("mediane de |ab| sur le cercle : %s — le minimum vaut %s %% de la mediane.",
    nMed.toFixed(5), ((minN / nMed) * 100).toFixed(1));
  console.log("");
  if (minN / nMed < 0.15) {
    console.log("=> La famille D a un vecteur QUASI NUL a la teinte %s. Son angle y est", minH.toFixed(0));
    console.log("   indetermine et tourne de plus de 100 deg en quelques degres de roue.");
    console.log("   Une roue de Lightroom rend une couleur saturee a CHAQUE teinte : une");
    console.log("   loi qui s'annule sur la roue n'est pas la loi cherchee. Et l'inversion");
    console.log("   de la contre-epreuve 3 se fait EXACTEMENT sur ce point (246,1 / 246,7).");
  }
}

console.log("");
console.log("3. CE QUE LA SINGULARITE FAIT A L'INVERSION");
console.log("Combien de teintes de curseur rendent un angle a moins de 1 deg de l'angle");
console.log("mesure sur st-h220 ? Une inversion bien posee en rend une poignee.");
console.log("");
for (const vise of [-132.9, -122.9]) {
  const sols = [];
  let dedans = false;
  for (let h = 0; h < 360; h += 0.05) {
    const p = Math.abs(ecartAngle(vise, deg(...labD(h)))) < 1;
    if (p && !dedans) sols.push([h, h]);
    if (p) sols[sols.length - 1][1] = h;
    dedans = p;
  }
  const largeur = sols.reduce((s, [a, b]) => s + (b - a), 0);
  console.log("   angle %s deg : %d intervalle(s) de solutions, largeur totale %s deg de curseur.",
    vise.toFixed(1), sols.length, largeur.toFixed(2));
  console.log("      -> %s", sols.map(([a, b]) => `${a.toFixed(1)}-${b.toFixed(1)}`).join("  "));
}
console.log("");
console.log("Une bande de solutions large de moins d'un dixieme de degre veut dire que");
console.log("l'antecedent est PINCE : il rendra ~246 quel que soit l'angle mesure dans un");
console.log("large voisinage. La monotonie de la contre-epreuve 4 et l'accord a 0,6 deg de");
console.log("la contre-epreuve 3 sont tous deux des consequences de ce pincement.");
