// E4 — la roue des tons moyens est-elle une CLOCHE DE CHROMA (decalage de VALEUR),
// et non une cubique du brevet (decalage par les PENTES) ?
//
// brevet-e4-moyens : knot et composition ratent (>=7) parce que le mecanisme du
// brevet (les pentes portent la teinte, la valeur reste grise aux noeuds) impose un
// CHANGEMENT DE SIGNE de la chroma de part et d'autre du pivot. La mesure, elle, est
// a signe UNIQUE (vert positif de 64 a 224) : une cloche.
//
// On teste donc le mecanisme OPPOSE : la valeur du canal se DECALE vers la teinte h
// au milieu et revient au gris aux bouts. pp_c = gris + A * cloche(X) * dev_c, ou
// dev = motif(h) - <motif> (deviation a somme nulle, donc gris preserve en moyenne).
// C'est, en primaires ProPhoto, exactement ce que fait notre twin en OKLab.
// Metrique qui decide : niveaux sRGB. Puis on verifie que la forme ne contredit pas
// les curseurs de LUMINANCE (cg-moyens-lum-p50, grading-global-lum-p50).
import { s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, motif, charge, lisible } from "./brevet-commun.mjs";

const gam = (g) => ({ nom: `gamma ${g}`, code: (v) => Math.pow(Math.max(v, 0), 1 / g), decode: (v) => Math.pow(Math.max(v, 0), g) });
const lineaire = { nom: "lineaire", code: (v) => v, decode: (v) => v };
const trcSrgb = { nom: "TRC sRGB", code: (v) => l2s(Math.max(v, 0)), decode: (v) => s2l(Math.max(v, 0)) };
const CODAGES = { lineaire, "gamma 1.8": gam(1.8), "gamma 2.2": gam(2.2), "TRC sRGB": trcSrgb };

const ecart = (pred, mes) => {
  let s = 0, n = 0;
  for (let i = 3; i <= 252; i++) { if (!lisible(mes[i])) continue; for (let c = 0; c < 3; c++) s += Math.abs(pred[i][c] - mes[i][c]); n++; }
  return s / (3 * n);
};

// Cloche gaussienne dans le codage E, centre c et largeur sigma (unites du codage),
// deviation de teinte a somme nulle (chroma sans deriver la valeur moyenne).
function modeleCloche(h, A, E, cen, sig, gaussienne = true) {
  const p = motif(h); const mp = (p[0] + p[1] + p[2]) / 3; const dev = p.map((v) => v - mp);
  const out = [];
  for (let i = 0; i < 256; i++) {
    const X = E.code(s2l(i / 255));
    const t = (X - cen) / sig;
    const w = gaussienne ? Math.exp(-0.5 * t * t) : 4 * Math.max(0, X) * Math.max(0, 1 - X); // cloche ou parabole
    const pp = [0, 1, 2].map((c) => E.decode(X + A * w * dev[c]));
    out.push(ap(PP_VERS_SRGB, pp).map((v) => niveau(v)));
  }
  return out;
}

const mes = charge("grading-moyens-vert").rampe_rgb;
const h = 140;
console.log("== grading-moyens-vert — CLOCHE DE CHROMA (decalage de valeur), niveaux sRGB");
console.log("   rappel : twin OKLab = 3,93 ; knot brevet = 7,0 ; composition = 10,6");
for (const [en, E] of Object.entries(CODAGES)) {
  let best = { e: 1e9 };
  for (let A = 0.05; A <= 0.6; A += 0.01) for (let cen = 0.2; cen <= 0.8; cen += 0.02) for (let sig = 0.1; sig <= 0.4; sig += 0.02) {
    const e = ecart(modeleCloche(h, A, E, cen, sig), mes); if (e < best.e) best = { e, A, cen, sig };
  }
  console.log(`  ${en.padEnd(10)} gauss  A* ${best.A.toFixed(2)} centre ${best.cen.toFixed(2)} sigma ${best.sig.toFixed(2)}  ecart ${best.e.toFixed(2)}`);
}
// parabole 4X(1-X) (cloche naturelle clouee a 0 et 1, un seul param A)
for (const [en, E] of Object.entries(CODAGES)) {
  let best = { e: 1e9 };
  for (let A = 0.05; A <= 0.6; A += 0.005) { const e = ecart(modeleCloche(h, A, E, 0, 0, false), mes); if (e < best.e) best = { e, A }; }
  console.log(`  ${en.padEnd(10)} parab  A* ${best.A.toFixed(3)} (4X(1-X))          ecart ${best.e.toFixed(2)}`);
}

// PROFIL du meilleur (gamma 1.8 gauss) vs mesure
console.log("\nPROFIL meilleur cloche vs mesure (dGR = g-r, dRB = r-b)");
{
  const E = gam(1.8); let best = { e: 1e9 };
  for (let A = 0.05; A <= 0.6; A += 0.005) for (let cen = 0.2; cen <= 0.8; cen += 0.01) for (let sig = 0.1; sig <= 0.4; sig += 0.01) {
    const e = ecart(modeleCloche(h, A, E, cen, sig), mes); if (e < best.e) best = { e, A, cen, sig };
  }
  const pred = modeleCloche(h, best.A, E, best.cen, best.sig);
  console.log(`  (A=${best.A.toFixed(2)}, centre ${best.cen.toFixed(2)}, sigma ${best.sig.toFixed(2)}, ecart ${best.e.toFixed(2)})`);
  console.log("  lvl  mes dGR pred dGR  mes dRB pred dRB");
  for (const i of [32, 64, 96, 128, 160, 192, 224]) {
    console.log("  " + String(i).padStart(3) + (mes[i][1] - mes[i][0]).toFixed(1).padStart(8) + (pred[i][1] - pred[i][0]).toFixed(1).padStart(9)
      + (mes[i][0] - mes[i][2]).toFixed(1).padStart(9) + (pred[i][0] - pred[i][2]).toFixed(1).padStart(8));
  }
}
