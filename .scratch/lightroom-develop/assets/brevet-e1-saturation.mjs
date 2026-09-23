// E1 — la brillance jaune est-elle un effet de SATURATION, et un temoin par niveau.
// Le brief demande de regarder st-ombres-sat100 et les magnitudes par niveau.
import { s2l, ap, SRGB_VERS_PP, PP_XYZ, charge, lisible } from "./brevet-commun.mjs";
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
function fitS0(rampe, canal, nmax = 96) {
  let num = 0, den = 0, n = 0;
  for (let i = 4; i <= nmax; i++) {
    if (!lisible(rampe[i])) continue;
    if (rampe[i][canal] < 0.6 || rampe[i][canal] > 254) continue;
    const x = s2l(i / 255);
    const pp = ap(SRGB_VERS_PP, rampe[i].map((c) => s2l(c / 255)))[canal];
    const b = x * (1 - x) * (1 - x); num += b * (pp - x); den += b * b; n++;
  }
  return n >= 3 ? 1 + num / den : null;
}
const rec601 = [0.299, 0.587, 0.114];
console.log("scene              slopes(R,G,B)                 w.s(Y-PP) w.s(Rec601)  S_HSL");
for (const nom of ["st-ombres-sat20", "st-ombres-bleu", "st-ombres-sat100", "st-h060", "st-h000"]) {
  const r = charge(nom).rampe_rgb; const s = [0, 1, 2].map((c) => fitS0(r, c) ?? 0);
  const M = Math.max(...s), m = Math.min(...s);
  console.log(nom.padEnd(18) + ("[" + s.map((v) => v.toFixed(3)).join(",") + "]").padEnd(26)
    + dot(PP_XYZ[1], s).toFixed(3).padStart(9) + dot(rec601, s).toFixed(3).padStart(11) + ((M - m) / (M + m)).toFixed(3).padStart(8));
}
console.log("");
console.log("h060 par niveau : dY/Y de la sortie mesuree (Y ProPhoto), et lisibilite");
const r = charge("st-h060").rampe_rgb;
for (const n of [8, 16, 32, 64, 128, 192]) {
  const x = s2l(n / 255);
  const y = dot(PP_XYZ[1], ap(SRGB_VERS_PP, r[n].map((c) => s2l(c / 255))));
  console.log("  n" + String(n).padStart(3) + "  dY/Y " + ((y / x - 1) * 100).toFixed(1).padStart(6) + "%  lisible=" + lisible(r[n]));
}
