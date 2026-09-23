// LE PIRE ECART DE TOUTE LA CAMPAGNE : 128,4 niveaux sur st-ombres-sat100.
//
// Un chiffre pareil se regarde avant d'etre rapporte — il peut etre un defaut de
// modele, un ecretage, ou une scene reconstruite de travers. On imprime les trois
// canaux autour du niveau fautif, des deux cotes.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niv = (v) => l2s(v) * 255;

const lr = JSON.parse(readFileSync(`${M}/st-ombres-sat100.json`, "utf8")).rampe_rgb;
const p = new Array(14).fill(0);
p[0] = 220; p[1] = 100; p[12] = 50; p[13] = -100;

console.log("st-ombres-sat100 — teinte 220, saturation 100, balance -100");
console.log("");
console.log("  niv |  Lightroom R  V  B  | twin R  V  B  |  ecarts  | chroma LR / twin");
console.log("".padEnd(88, "-"));
for (const n of [64, 96, 128, 150, 158, 166, 190, 220]) {
  const lin = s2l(n / 255);
  const out = colorGradingSpec([lin, lin, lin], p);
  const t = out.map(niv);
  const cLR = Math.hypot(...linearSrgbToOklab(lr[n].map((v) => s2l(v / 255))).slice(1));
  const cT = Math.hypot(...linearSrgbToOklab(out).slice(1));
  console.log("  %s | %s | %s | %s | %s / %s",
    String(n).padStart(3),
    lr[n].map((v) => String(v).padStart(4)).join("").padEnd(15),
    t.map((v) => v.toFixed(0).padStart(4)).join("").padEnd(13),
    t.map((v, i) => (v - lr[n][i]).toFixed(0).padStart(5)).join(""),
    cLR.toFixed(4), cT.toFixed(4));
}
console.log("");
let ecretesLR = 0, ecretesTwin = 0;
for (let n = 0; n <= 255; n++) {
  const lin = s2l(n / 255);
  const out = colorGradingSpec([lin, lin, lin], p).map(niv);
  if (lr[n].some((v) => v <= 0.5 || v >= 254.5)) ecretesLR++;
  if (out.some((v) => v <= 0.5 || v >= 254.5)) ecretesTwin++;
}
console.log("niveaux dont un canal touche une borne : Lightroom %d, twin %d", ecretesLR, ecretesTwin);
console.log("");
console.log("Si le twin ecrete beaucoup plus que Lightroom, le pire cas est une");
console.log("SUR-APPLICATION qui sort du gamut — coherent avec le rapport de chroma");
console.log("mesure a sat100 (1,409 observe contre 1,667 si proportionnel).");
