// E4 — LA ROUE DES TONS MOYENS (grading-moyens-vert, teinte 140, sat 60).
//
// brevet-courbes : une cubique clouee a deux pentes rate (5,5 niveaux). Le brevet
// donne trois pistes du meme esprit pour une teinte qui n'apparait qu'au MILIEU et
// laisse noir et blanc neutres :
//   A. CUBIQUE PAR MORCEAUX, un noeud au pivot : valeur GRISE conservee au pivot,
//      pente TEINTEE au pivot, pentes NEUTRES (1) aux deux bouts. Deux segments
//      d'Hermite. La chroma nait dans les segments, nulle aux trois noeuds.
//   B. COMPOSITION (regle de chaine) : deux cubiques dont les pentes se multiplient
//      — une cubique globale teinte h et une cubique globale teinte h+180 composees
//      s'annulent aux bouts et laissent un residu teinte au milieu.
//   C. invariance lumiere HSL, dans un codage perceptuel (comme la globale).
//
// Metrique qui decide : ecart en niveaux sRGB (3 canaux). On compare au twin.
import {
  s2l, l2s, niveau, ap, PP_VERS_SRGB, PP_XYZ, pentes, charge, lisible,
} from "./brevet-commun.mjs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const W = PP_XYZ[1];
const gam = (g) => ({ nom: `gamma ${g}`, code: (v) => Math.pow(Math.max(v, 0), 1 / g), decode: (v) => Math.pow(Math.max(v, 0), g) });
const lineaire = { nom: "lineaire", code: (v) => v, decode: (v) => v };
const trcSrgb = { nom: "TRC sRGB", code: (v) => l2s(Math.max(v, 0)), decode: (v) => s2l(Math.max(v, 0)) };
const CODAGES = { lineaire, "gamma 1.8": gam(1.8), "gamma 2.2": gam(2.2), "TRC sRGB": trcSrgb };

// Hermite general sur [xa, xb], valeurs ya,yb, pentes ma,mb (dY/dX).
function hermiteSeg(X, xa, ya, ma, xb, yb, mb) {
  const dx = xb - xa, t = (X - xa) / dx;
  const h00 = 2 * t ** 3 - 3 * t ** 2 + 1, h10 = t ** 3 - 2 * t ** 2 + t;
  const h01 = -2 * t ** 3 + 3 * t ** 2, h11 = t ** 3 - t ** 2;
  return h00 * ya + h10 * dx * ma + h01 * yb + h11 * dx * mb;
}

// A. cubique par morceaux, noeud au pivot Xp (dans le codage), pente teintee sp.
function modeleKnot(h, S, E, inv, pivotLin) {
  const sp = pentes(h, S, W, inv);         // pente teintee au pivot (invariance w.sp=1)
  const Xp = E.code(pivotLin);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const X = E.code(s2l(i / 255));
    const pp = [0, 1, 2].map((c) => {
      const Y = X <= Xp
        ? hermiteSeg(X, 0, 0, 1, Xp, Xp, sp[c])
        : hermiteSeg(X, Xp, Xp, sp[c], 1, 1, 1);
      return E.decode(Y);
    });
    out.push(ap(PP_VERS_SRGB, pp).map((v) => niveau(v)));
  }
  return out;
}

// B. composition de deux cubiques globales de teintes opposees.
const cub = (x, s0, s1) => x + (s0 - 1) * x * (1 - x) * (1 - x) - (s1 - 1) * x * x * (1 - x);
function modeleCompo(h, S, E, inv) {
  const a0 = pentes(h, S, W, inv), a1 = pentes((h + 180) % 360, S, W, inv);       // teinte h partout
  const b0 = pentes((h + 180) % 360, S, W, inv), b1 = pentes(h, S, W, inv);       // teinte h+180 partout (inverse)
  const out = [];
  for (let i = 0; i < 256; i++) {
    const X = E.code(s2l(i / 255));
    const pp = [0, 1, 2].map((c) => E.decode(cub(cub(X, a0[c], a1[c]), b0[c], b1[c])));
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
function twinRampe(h, sat) {
  const p = [0, 0, 0, h, sat, 0, 0, 0, 0, 0, 0, 0, 50, 0];
  const out = [];
  for (let i = 0; i < 256; i++) { const x = s2l(i / 255); out.push(colorGradingSpec([x, x, x], p).map(niveau)); }
  return out;
}

const mes = charge("grading-moyens-vert").rampe_rgb;
const h = 140;

console.log("== grading-moyens-vert (teinte 140, sat 60)");
console.log("plancher 8 bits ~0,29 ; cubique clouee 2 pentes (brevet-courbes) = 5,5 ; twin =", ecart(twinRampe(h, 60), mes).toFixed(2));

console.log("\nA. CUBIQUE PAR MORCEAUX (noeud au pivot) — S et pivot optimaux");
for (const [en, E] of Object.entries(CODAGES)) for (const inv of ["luminance", "lumiere", "moyenne"]) {
  let best = { e: 1e9 };
  for (let S = 0.1; S <= 0.9; S += 0.02) for (let pv = 0.1; pv <= 0.9; pv += 0.02) {
    const e = ecart(modeleKnot(h, S, E, inv, pv), mes); if (e < best.e) best = { e, S, pv };
  }
  console.log(`  ${en.padEnd(10)} ${inv.padEnd(10)} S* ${best.S.toFixed(2)} pivot(lin) ${best.pv.toFixed(2)}  ecart ${best.e.toFixed(2)}`);
}

console.log("\nB. COMPOSITION de deux cubiques opposees — S optimal (pentes bout = neutres par construction)");
for (const [en, E] of Object.entries(CODAGES)) for (const inv of ["luminance", "lumiere", "moyenne"]) {
  let best = { e: 1e9 };
  for (let S = 0.1; S <= 0.95; S += 0.02) { const e = ecart(modeleCompo(h, S, E, inv), mes); if (e < best.e) best = { e, S }; }
  console.log(`  ${en.padEnd(10)} ${inv.padEnd(10)} S* ${best.S.toFixed(2)}  ecart ${best.e.toFixed(2)}`);
}

// profil du meilleur knot vs mesure
console.log("\nPROFIL — meilleur knot (lineaire/lumiere) vs mesure, dRB = r-b et dGR = g-r");
{
  let best = { e: 1e9 };
  for (let S = 0.1; S <= 0.9; S += 0.02) for (let pv = 0.1; pv <= 0.9; pv += 0.02) {
    const e = ecart(modeleKnot(h, S, lineaire, "lumiere", pv), mes); if (e < best.e) best = { e, S, pv };
  }
  const pred = modeleKnot(h, best.S, lineaire, "lumiere", best.pv);
  console.log(`  (S=${best.S.toFixed(2)}, pivot=${best.pv.toFixed(2)}, ecart ${best.e.toFixed(2)})`);
  console.log("  lvl   mes dGR  pred dGR   mes dRB  pred dRB");
  for (const i of [16, 32, 64, 96, 128, 160, 192, 224]) {
    console.log("  " + String(i).padStart(3)
      + (mes[i][1] - mes[i][0]).toFixed(1).padStart(8) + (pred[i][1] - pred[i][0]).toFixed(1).padStart(10)
      + (mes[i][0] - mes[i][2]).toFixed(1).padStart(10) + (pred[i][0] - pred[i][2]).toFixed(1).padStart(10));
  }
}
