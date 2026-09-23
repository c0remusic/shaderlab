// L'ECART PAR CANAL EST-IL UN VECTEUR FOIS UN PROFIL COMMUN ?
//
// brevet-courbes.mjs : la cubique d'Hermite pure tient la roue GLOBALE au plancher
// de bruit (0,35 niveau), pas celle des OMBRES (2,15 au mieux). Deux lectures :
// (a) la courbe n'est pas une cubique mais reste SEPARABLE — ecart du canal c =
// v_c . phi(X), un vecteur de teinte fois un poids de plage commun, le poids
// n'etant simplement pas x (1 - x)^2 ; (b) elle n'est pas separable du tout.
//
// Test sans parametre : si l'ecart est separable, le RAPPORT entre deux canaux est
// CONSTANT le long de la rampe. On l'imprime, niveau par niveau, dans deux codages.
// On imprime aussi phi(X) normalise, pour lire sa forme.
import { s2l, l2s, ap, SRGB_VERS_PP, charge, lisible } from "./brevet-commun.mjs";

const trc = (v) => Math.sign(v) * l2s(Math.abs(v));
const CODAGES = [["lineaire", (v) => v], ["Melissa", trc]];
const NIV = [8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 224];

for (const nom of ["st-ombres-bleu", "st-hl-orange", "cg-glob-h040", "st-h220", "st-h060", "st-h300", "grading-moyens-vert"]) {
  const r = charge(nom).rampe_rgb;
  for (const [cn, code] of CODAGES) {
    console.log("");
    console.log("%s — %s", nom, cn);
    const lignes = [];
    for (const n of NIV) {
      if (!lisible(r[n])) { lignes.push([n, null]); continue; }
      const X = code(s2l(n / 255));
      const pp = ap(SRGB_VERS_PP, r[n].map((c) => s2l(c / 255))).map(code);
      lignes.push([n, pp.map((y) => y - X), X]);
    }
    // Canal de reference : celui de plus grand ecart absolu en moyenne.
    let ref = 0, best = -1;
    for (let c = 0; c < 3; c++) {
      const m = lignes.filter((l) => l[1]).reduce((s, l) => s + Math.abs(l[1][c]), 0);
      if (m > best) { best = m; ref = c; }
    }
    const tete = ["niv", "dR", "dG", "dB", "dR/ref", "dG/ref", "dB/ref", "ref/X"];
    console.log(tete.map((t) => t.padStart(9)).join(""));
    for (const [n, d, X] of lignes) {
      if (!d) { console.log(String(n).padStart(9) + "   illisible"); continue; }
      console.log([String(n), ...d.map((v) => v.toFixed(4)), ...d.map((v) => (v / d[ref]).toFixed(3)), (d[ref] / X).toFixed(3)]
        .map((t) => t.padStart(9)).join(""));
    }
  }
}
