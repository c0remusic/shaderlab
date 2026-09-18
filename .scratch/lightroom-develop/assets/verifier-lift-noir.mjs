// « Un decalage de L en OKLab ne PEUT PAS lever un noir absolu » — vrai ou faux ?
//
// Cette phrase est ecrite dans docs/ROADMAP.md et dans le ticket 06, et elle
// PORTE l'hypothese ouverte (« les luminances agissent en lumiere lineaire »).
// Une affirmation qui porte une hypothese se verifie avant qu'on s'appuie dessus.
//
// Ce script mesure trois choses, sur le niveau 0 et quelques voisins :
//   1. ce que NOTRE operateur rend a `Luminance des ombres` +50 ;
//   2. ce qu'un decalage de L en OKLab PEUT rendre, en poussant le decalage ;
//   3. le decalage de L qu'il faudrait pour atteindre les 14,33 de Lightroom.
//
// Lance par : npx tsx .scratch/lightroom-develop/assets/verifier-lift-noir.mjs
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { oklabToLinearSrgb, linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const niveau = (lin) => l2s(Math.max(0, Math.min(1, lin))) * 255;

// 14 parametres : 0..2 ombres teinte/sat/lum ; 3..5 tons moyens ; 6..8 hautes
// lumieres ; 9..11 global ; 12 fusion ; 13 balance.
const p = (lum) => [0, 0, lum, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0];

console.log("1. NOTRE OPERATEUR, Luminance des ombres +50");
console.log("   entree   ->  sortie (niveau sRGB)");
for (const n of [0, 1, 2, 4, 8, 16, 32]) {
  const lin = s2l(n / 255);
  const out = colorGradingSpec([lin, lin, lin], p(50));
  console.log("   %s -> %s", String(n).padStart(3), niveau(out[0]).toFixed(2).padStart(7));
}

console.log("");
console.log("2. CE QU'UN DECALAGE DE L EN OKLAB PEUT RENDRE AU NOIR ABSOLU");
console.log("   (L = 0 en entree, decalage applique tel quel, sans poids ni fraction)");
console.log("   dL      L sortie   lineaire     niveau sRGB");
for (const dL of [0.01, 0.05, 0.1, 0.2, 0.3, 0.5]) {
  const lin = oklabToLinearSrgb([dL, 0, 0])[0];
  console.log("   %s %s %s %s",
    dL.toFixed(2).padStart(5),
    dL.toFixed(4).padStart(10),
    lin.toExponential(3).padStart(12),
    niveau(lin).toFixed(2).padStart(12));
}

console.log("");
console.log("3. LE dL QU'IL FAUDRAIT POUR ATTEINDRE LES 14,33 DE LIGHTROOM");
const cible = s2l(14.33 / 255);
let lo = 0, hi = 1;
for (let i = 0; i < 60; i++) {
  const mid = (lo + hi) / 2;
  if (oklabToLinearSrgb([mid, 0, 0])[0] < cible) lo = mid; else hi = mid;
}
console.log("   cible lineaire : %s", cible.toExponential(4));
console.log("   dL necessaire  : %s", lo.toFixed(4));
console.log("   (a comparer au dL que notre operateur applique : (50/100)*lumK*poids)");
console.log("   lumK = 0.074 -> dL nominal max = %s", (0.5 * 0.074).toFixed(4));

console.log("");
console.log("4. ET SI LA LUMINANCE ETAIT UN OFFSET EN LUMIERE LINEAIRE ?");
console.log("   offset lineaire qui porte le niveau 0 a 14,33 : %s", cible.toExponential(4));
console.log("   ce que cet offset ferait aux niveaux clairs (additif pur) :");
for (const n of [0, 8, 32, 128, 255]) {
  const lin = s2l(n / 255);
  console.log("   %s -> %s", String(n).padStart(3), niveau(lin + cible).toFixed(2).padStart(7));
}
