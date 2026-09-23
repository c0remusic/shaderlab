// E4 — jusqu'ou descend le modele du brevet a pentes PREDITES sur la roue globale,
// une fois le bon S et une eventuelle rotation de teinte pris en compte.
//
// brevet-e4-globale-pentes a montre : structure du brevet OUI (s0 porte h, s1
// porte h+180), mais teinte tournee de ~5 deg et S implique ~0,32 (et non 0,6),
// symetrique seulement en codage LINEAIRE. On mesure ici l'ecart du modele PREDIT
// (aucun ajustement par canal) en fonction de (S, offset de teinte, codage,
// invariance), pour situer le plancher atteignable par le brevet parametrique
// face au plancher 8 bits (0,35) et a notre twin.
import {
  s2l, l2s, niveau, ap, PP_VERS_SRGB, PP_XYZ, pentes, charge, lisible,
} from "./brevet-commun.mjs";

const W = PP_XYZ[1];
const hermite = (x, s0, s1) => x + (s0 - 1) * x * (1 - x) * (1 - x) - (s1 - 1) * x * x * (1 - x);
const gam = (g) => ({ nom: `gamma ${g}`, code: (v) => Math.pow(Math.max(v, 0), 1 / g), decode: (v) => Math.pow(Math.max(v, 0), g) });
const lineaire = { nom: "lineaire", code: (v) => v, decode: (v) => v };
const trcSrgb = { nom: "TRC sRGB", code: (v) => l2s(Math.max(v, 0)), decode: (v) => s2l(Math.max(v, 0)) };
const CODAGES = { lineaire, "gamma 1.8": gam(1.8), "TRC sRGB": trcSrgb };

function modelePredit(h, S, E, inv, offset = 0) {
  const s0 = pentes(h + offset, S, W, inv);
  const s1 = pentes((h + 180 + offset) % 360, S, W, inv);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const X = E.code(s2l(i / 255));
    const pp = [0, 1, 2].map((c) => E.decode(hermite(X, s0[c], s1[c])));
    out.push(ap(PP_VERS_SRGB, pp).map((v) => niveau(v)));
  }
  return out;
}
function ecart(pred, mes) {
  let s = 0, n = 0;
  for (let i = 3; i <= 252; i++) {
    if (!lisible(mes[i])) continue;
    for (let c = 0; c < 3; c++) s += Math.abs(pred[i][c] - mes[i][c]);
    n++;
  }
  return s / (3 * n);
}

for (const [nom, h] of [["cg-glob-h040", 40], ["cg-glob-h220", 220]]) {
  const mes = charge(nom).rampe_rgb;
  console.log(`\n== ${nom}`);
  // 1) meilleur S par codage/invariance, teinte nominale (offset 0)
  console.log("  S optimal, teinte NOMINALE (offset 0) :");
  for (const [en, E] of Object.entries(CODAGES)) for (const inv of ["luminance", "lumiere", "moyenne"]) {
    let best = { e: 1e9 };
    for (let S = 0.05; S <= 0.7; S += 0.01) { const e = ecart(modelePredit(h, S, E, inv), mes); if (e < best.e) best = { e, S }; }
    console.log(`    ${en.padEnd(10)} ${inv.padEnd(10)} S* ${best.S.toFixed(2)}  ecart ${best.e.toFixed(2)}`);
  }
  // 2) meilleur (S, offset teinte) en lineaire/luminance et lineaire/lumiere
  console.log("  S et OFFSET de teinte optimaux :");
  for (const [en, E] of Object.entries(CODAGES)) for (const inv of ["luminance", "lumiere"]) {
    let best = { e: 1e9 };
    for (let S = 0.05; S <= 0.7; S += 0.01) for (let off = -12; off <= 12; off += 1) {
      const e = ecart(modelePredit(h, S, E, inv, off), mes); if (e < best.e) best = { e, S, off };
    }
    console.log(`    ${en.padEnd(10)} ${inv.padEnd(10)} S* ${best.S.toFixed(2)} offset ${String(best.off).padStart(3)}  ecart ${best.e.toFixed(2)}`);
  }
}
