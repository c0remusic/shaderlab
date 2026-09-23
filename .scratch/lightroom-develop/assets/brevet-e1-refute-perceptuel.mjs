// E1 REFUTATION (2) — l'explorateur n'a JAMAIS juge une lightness PERCEPTUELLE sur
// la metrique qui decide (hue-spread en niveaux sRGB). Il a couronne « w'-fit »
// (luma lineaire ~Rec601, 2 params libres) comme meilleur modele unique. Or dans mon
// brevet-e1-refute-codage, OKLab L rend le spread le PLUS BAS (1,572 < 1,690). Ici on
// confirme sur d'autres lightness perceptuelles et on IMPRIME le profil par teinte :
// l'anomalie du jaune sous Y ProPhoto (+6,7 niveaux) disparait-elle sous OKLab L ?
//
// CONTROLE : rampes fabriquees a OKLab L CONSTANT (chroma OKLab fixe, clip de gamut a
// teinte constante — le mecanisme du twin) ; le spread doit designer OKLab L au
// plancher, et Y ProPhoto doit y sortir GRAND (une luma lineaire ne conserve pas L).
import { s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, SRGB_XYZ65, oklab, motif, charge, lisible } from "./brevet-commun.mjs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";

const pp = (lin) => ap(SRGB_VERS_PP, lin);
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];

// CIELAB L* sur un blanc de reference : monotone en la luminance Y de l'espace, donc
// EQUIVALENT (pour le spread) a conserver cette Y. Deux versions pour le montrer.
const Lstar = (Y) => (Y > 0.008856 ? 116 * Math.cbrt(Y) - 16 : 903.3 * Y);
const CANDIDATES = [
  ["Y ProPhoto lin", (l) => dot(PP_XYZ[1], pp(l))],
  ["Rec601 PP lin", (l) => dot([0.299, 0.587, 0.114], pp(l))],
  ["w'-fit PP lin", (l) => dot([0.314, 0.580, 0.106], pp(l))],
  ["L* (Y Rec709/D65)", (l) => Lstar(dot(SRGB_XYZ65[1], l))],
  ["L* (Y ProPhoto/D50)", (l) => Lstar(dot(PP_XYZ[1], pp(l)))],
  ["OKLab L", (l) => oklab(l)[0]],
];

function equiv(f, val) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f([m, m, m]) < val) lo = m; else hi = m; }
  return 255 * l2s((lo + hi) / 2);
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const NIV = [8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 224];

function spread(scenes) {
  return CANDIDATES.map(([, f]) => {
    let sStd = 0, sMoy = 0, nStd = 0;
    for (const n of NIV) {
      const ec = [];
      for (const { rampe } of scenes) { if (lisible(rampe[n])) ec.push(equiv(f, f(rampe[n].map((c) => s2l(c / 255)))) - n); }
      if (ec.length < 6) continue;
      const moy = ec.reduce((a, b) => a + b, 0) / ec.length;
      sStd += Math.sqrt(ec.reduce((a, b) => a + (b - moy) ** 2, 0) / ec.length); sMoy += moy; nStd++;
    }
    return { std: sStd / nStd, moy: sMoy / nStd };
  });
}
function imprime(titre, scenes) {
  console.log("\n" + titre);
  const r = spread(scenes);
  const best = r.reduce((b, v, k) => (v.std < r[b].std ? k : b), 0);
  console.log("candidate".padEnd(24) + "spread(std)".padStart(12) + "biais(moy)".padStart(12));
  r.forEach((v, k) => console.log(CANDIDATES[k][0].padEnd(24) + ((k === best ? "*" : " ") + v.std.toFixed(3)).padStart(12) + v.moy.toFixed(2).padStart(12)));
}

// ── CONTROLE : rampe a OKLab L CONSTANT, chroma OKLab fixe le long du niveau, clip ──
// Pour un gris x (lineaire), L=oklab([x,x,x]).x ; on ajoute k*dir(h) en (a,b) et on
// clippe a teinte constante (bissection de la chroma), comme le twin.
const clamp01 = (v) => Math.min(1, Math.max(0, v));
function dirHue(h) { const [r, g, b] = motif(h); const lab = linearSrgbToOklab([s2l(r), s2l(g), s2l(b)]); const c = Math.hypot(lab[1], lab[2]) || 1; return [lab[1] / c, lab[2] / c]; }
function dedans(c) { return c.every((v) => v >= -1e-6 && v <= 1 + 1e-6); }
function clipGamut(lab) {
  const d = oklabToLinearSrgb(lab); if (dedans(d)) return d.map(clamp01);
  let lo = 0, hi = 1; for (let i = 0; i < 20; i++) { const s = (lo + hi) / 2; if (dedans(oklabToLinearSrgb([lab[0], lab[1] * s, lab[2] * s]))) lo = s; else hi = s; }
  return oklabToLinearSrgb([lab[0], lab[1] * lo, lab[2] * lo]).map(clamp01);
}
const quant = (lin) => lin.map((v) => Math.round(niveau(v) * 100) / 100);
function rampeOKL(h, k) {
  const [da, db] = dirHue(h);
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255); const lab = linearSrgbToOklab([x, x, x]);
    return quant(clipGamut([lab[0], lab[1] + k * da, lab[2] + k * db]));
  });
}
imprime("CONTROLE E — rampes a OKLab L CONSTANT + chroma fixe (doit designer OKLab L)",
  TEINTES.map((h) => ({ h, rampe: rampeOKL(h, 0.10) })));

// ── MESURES ────────────────────────────────────────────────────────────────
const scenes = TEINTES.map((h) => ({ h, rampe: charge(`st-h${String(h).padStart(3, "0")}`).rampe_rgb }));
imprime("MESURES LIGHTROOM — st-h*", scenes);

// ── PROFIL par teinte : equiv-error de Y ProPhoto vs OKLab L, plusieurs niveaux ──
console.log("\nPROFIL equiv-error (niveaux sRGB) par teinte — Y ProPhoto vs OKLab L");
console.log("  teintes:".padEnd(22) + TEINTES.map((h) => String(h).padStart(6)).join(""));
for (const [nom, f] of [CANDIDATES[0], CANDIDATES[5]]) {
  for (const n of [24, 48, 96, 160]) {
    const ligne = TEINTES.map((h, k) => { const r = scenes[k].rampe[n]; return lisible(r) ? (equiv(f, f(r.map((c) => s2l(c / 255)))) - n).toFixed(1).padStart(6) : "   .  "; }).join("");
    console.log(("  " + nom + " n" + n).padEnd(22) + ligne);
  }
}
