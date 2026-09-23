// E1 — LA GRANDEUR CONSERVEE EST-ELLE UNE LUMINANCE LINEAIRE w', ET LAQUELLE ?
//
// Trois lectures de la meme question, sur les pentes mesurees au noir :
//   (1) w'.s = 1 pour toutes les teintes ? (moindres carres, residu par teinte) ;
//   (2) w' impose : Y ProPhoto, Rec709, Rec601 (NTSC) — w'.s doit valoir 1 ;
//   (3) l'espace ou w' agit (ProPhoto lin / sRGB lin) via le meme fit.
// h060 (jaune pur, R=G) est suivi comme temoin du residu irreductible.
//
// Le brief demande AU PLUS un parametre libre : une luminance NOMMEE (Rec601...)
// en a zero ; un w' ajuste en a deux (wG, wB). On rapporte les deux.
import { s2l, ap, SRGB_VERS_PP, PP_XYZ, SRGB_XYZ65, pentes, charge, lisible } from "./brevet-commun.mjs";

const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
function fitS0(rampe, canal, nmax = 96) {
  let num = 0, den = 0, n = 0;
  for (let i = 4; i <= nmax; i++) {
    if (!lisible(rampe[i])) continue;
    if (rampe[i][canal] < 0.6 || rampe[i][canal] > 254) continue;
    const x = s2l(i / 255);
    const pp = ap(SRGB_VERS_PP, rampe[i].map((c) => s2l(c / 255)))[canal];
    const base = x * (1 - x) * (1 - x);
    num += base * (pp - x); den += base * base; n++;
  }
  return n >= 3 ? 1 + num / den : null;
}
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
// pentes mesurees en ProPhoto lin ; bleu manquant (jaunes) complete par pente brevet Y (poids ~0)
const S_MES = TEINTES.map((h) => {
  const r = charge(`st-h${String(h).padStart(3, "0")}`).rampe_rgb;
  const sY = pentes(h, 0.6, PP_XYZ[1]);
  return [h, [0, 1, 2].map((c) => fitS0(r, c) ?? sY[c]), [0, 1, 2].map((c) => fitS0(r, c) == null)];
});

// (1) meilleur w' (somme 1) tel que w'.s = 1 : moindres carres sur (wG, wB).
function fitW() {
  // w = (1-wG-wB, wG, wB). minimise sum (w.s - 1)^2.
  // lineaire : w.s - 1 = (s0-1) + wG(s1-s0) + wB(s2-s0). moindres carres 2x2.
  let aa = 0, ab = 0, bb = 0, ay = 0, by = 0;
  for (const [, s] of S_MES) {
    const x1 = s[1] - s[0], x2 = s[2] - s[0], y = 1 - s[0];
    aa += x1 * x1; ab += x1 * x2; bb += x2 * x2; ay += x1 * y; by += x2 * y;
  }
  const det = aa * bb - ab * ab;
  const wG = (ay * bb - by * ab) / det, wB = (aa * by - ab * ay) / det;
  return [1 - wG - wB, wG, wB];
}
const W_FIT = fitW();

const CANDS = [
  ["Y ProPhoto D50", PP_XYZ[1]],
  ["Y Rec709 (sRGB lin)", SRGB_XYZ65[1]],
  ["Rec601 / NTSC luma", [0.299, 0.587, 0.114]],
  ["blend 0.30/0.59/0.11", [0.30, 0.59, 0.11]],
  ["w' ajuste", W_FIT],
];

console.log("w' ajuste (ProPhoto lin) = [%s]", W_FIT.map((x) => x.toFixed(3)).join(", "));
console.log("");
console.log("w'.s par teinte (=1 si la luminance w' est conservee au noir)");
console.log("teinte".padEnd(7) + CANDS.map(([n]) => n.slice(0, 13).padStart(15)).join(""));
const rms = CANDS.map(() => 0);
for (const [h, s] of S_MES) {
  const cells = CANDS.map(([, w], k) => { const v = dot(w, s); rms[k] += (v - 1) ** 2; return v; });
  const tag = h === 60 ? "*h060" : "h" + String(h).padStart(3, "0");
  console.log(tag.padEnd(7) + cells.map((c) => c.toFixed(3).padStart(15)).join(""));
}
console.log("RMS(w.s-1)".padEnd(7) + rms.map((e) => Math.sqrt(e / S_MES.length).toFixed(3).padStart(15)).join(""));
console.log("");
console.log("RMS SANS h060 (le jaune pur, temoin du residu irreductible)");
const rms2 = CANDS.map(() => 0);
let n2 = 0;
for (const [h, s] of S_MES) { if (h === 60) continue; n2++; CANDS.forEach(([, w], k) => rms2[k] += (dot(w, s) - 1) ** 2); }
console.log("".padEnd(7) + rms2.map((e) => Math.sqrt(e / n2).toFixed(3).padStart(15)).join(""));
