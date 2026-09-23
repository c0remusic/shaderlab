// E3 — LA FUSION, ET LA FORME DES HAUTES LUMIERES
//
// (1) FUSION (blending). Chroma OKLab au niveau 160 mesuree convexe :
//     0.0119/0.0146/0.0161/0.0206/0.0292 pour 0/25/50/75/100. On lit le PROFIL
//     entier a chaque dose : la fusion elargit-elle les cloches (bave vers les
//     medians) ou multiplie-t-elle l'amplitude ? Sommet et largeur par dose.
// (2) HAUTES LUMIERES. Le brevet met la teinte dans la PENTE EN 1, valeur clouee au
//     blanc : la cubique hautes est X^2 (1-X), clouee aux DEUX bouts, sommet vers 2/3.
//     On verifie (a) que st-hl-orange est cloue aux deux bouts (pas un gain
//     multiplicatif qui culmine au noir), (b) que sa DIRECTION est bien l'orange 40
//     (motif ProPhoto via OKLab), donc l'ordre inverse h+180 du brevet REND la teinte h.
import { s2l, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, oklab, pentes, motif, charge, lisible } from "./brevet-commun.mjs";

const chroma = (rgbNiv) => { const l = oklab(rgbNiv.map((c) => s2l(c / 255))); return Math.hypot(l[1], l[2]); };
const abv = (rgbNiv) => { const l = oklab(rgbNiv.map((c) => s2l(c / 255))); return [l[1], l[2]]; };

function profil(rampe) { const m = new Map(); for (let i = 3; i <= 252; i++) if (lisible(rampe[i])) m.set(i, chroma(rampe[i])); return m; }
function sommet(m) { let bi = 0, bc = -1; for (const [i, c] of m) if (c > bc) { bc = c; bi = i; } return [bi, bc]; }
/** Largeur a mi-hauteur, en niveaux, du profil de chroma. */
function fwhm(m) { const [bi, bc] = sommet(m); const h = bc / 2; const ns = [...m.keys()].sort((a, b) => a - b);
  let lo = ns[0], hi = ns[ns.length - 1];
  for (const i of ns) { if (i < bi && m.get(i) < h) lo = i; } for (let k = ns.length - 1; k >= 0; k--) { if (ns[k] > bi && m.get(ns[k]) < h) hi = ns[k]; }
  return [lo, hi, hi - lo]; }

console.log("=== FUSION : profil de chroma OKLab par dose ===");
const FUS = [["cg-fusion-0", 0], ["cg-fusion-25", 25], ["st-duo", 50], ["cg-fusion-75", 75], ["cg-fusion-100", 100]];
const niveaux = [8, 32, 64, 96, 128, 160, 190, 220, 240];
console.log("dose".padEnd(6) + niveaux.map((n) => String(n).padStart(8)).join("") + "   sommet    FWHM  chroma@160");
const prof = {};
for (const [nom, d] of FUS) {
  const r = charge(nom)?.rampe_rgb; if (!r) continue; const m = profil(r); prof[d] = m;
  const [bi, bc] = sommet(m); const [lo, hi, w] = fwhm(m);
  console.log(String(d).padEnd(6) + niveaux.map((n) => (m.has(n) ? m.get(n).toFixed(4) : " -").padStart(8)).join("") +
    ("  " + bi + "@" + bc.toFixed(3)).padStart(11) + (lo + "-" + hi + "(" + w + ")").padStart(12) + (m.get(160) ?? 0).toFixed(4).padStart(9));
}
// La fusion multiplie-t-elle le profil, ou le deforme-t-elle ? Rapport profil(dose)/profil(50) niveau par niveau.
console.log("");
console.log("rapport chroma(dose)/chroma(fusion50) par niveau — plat => amplitude pure ; croissant vers les medians => elargissement");
console.log("dose".padEnd(6) + niveaux.map((n) => String(n).padStart(8)).join(""));
for (const [nom, d] of FUS) {
  const m = prof[d], m50 = prof[50]; if (!m) continue;
  console.log(String(d).padEnd(6) + niveaux.map((n) => (m.has(n) && m50.has(n) && m50.get(n) > 1e-4 ? (m.get(n) / m50.get(n)).toFixed(3) : " -").padStart(8)).join(""));
}

console.log("");
console.log("=== HAUTES LUMIERES : cloue aux deux bouts, et direction orange 40 ===");
const rHl = charge("st-hl-orange").rampe_rgb; const mHl = profil(rHl);
console.log("profil st-hl-orange :"); console.log("  " + [8, 32, 64, 96, 128, 160, 190, 205, 220, 240, 250].map((n) => n + ":" + (mHl.get(n) ?? 0).toFixed(4)).join("  "));
const [biHl, bcHl] = sommet(mHl);
console.log("  sommet au niveau %d (chroma %s) ; chroma au noir(8)=%s, au blanc(250)=%s -> bell clouee, PAS un gain multiplicatif (qui culminerait au noir)",
  biHl, bcHl.toFixed(4), (mHl.get(8) ?? 0).toFixed(4), (mHl.get(250) ?? 0).toFixed(4));
// direction mesuree vs motif ProPhoto de l'orange (h=40) ajoute en OKLab
function dirMesuree(m, rampe) { let a = 0, b = 0; for (const [i] of m) { const [x, y] = abv(rampe[i]); const w = Math.hypot(x, y); a += w * x; b += w * y; } const n = Math.hypot(a, b); return [a / n, b / n]; }
function dirMotifOklab(h) { // motif ProPhoto -> sRGB lineaire -> OKLab, composante chroma unitaire
  const p = motif(h); const gris = (p[0] + p[1] + p[2]) / 3; const dev = p.map((c) => c - gris); // chroma pure en ProPhoto
  const lin = ap(PP_VERS_SRGB, dev); // direction en sRGB lineaire (petite perturbation autour du gris)
  // OKLab est non lineaire ; on lit la direction en derivant autour d'un gris moyen
  const g0 = 0.25, base = oklab([g0, g0, g0]), pert = oklab([g0 + 1e-3 * lin[0], g0 + 1e-3 * lin[1], g0 + 1e-3 * lin[2]]);
  const da = pert[1] - base[1], db = pert[2] - base[2]; const n = Math.hypot(da, db); return [da / n, db / n];
}
const dHl = dirMesuree(mHl, rHl); const dMot = dirMotifOklab(40);
const ang = (Math.acos(Math.max(-1, Math.min(1, dHl[0] * dMot[0] + dHl[1] * dMot[1]))) * 180) / Math.PI;
console.log("  direction mesuree OKLab [%s]  motif ProPhoto(40) en OKLab [%s]  angle %s deg",
  dHl.map((v) => v.toFixed(3)).join(","), dMot.map((v) => v.toFixed(3)).join(","), ang.toFixed(1));
// controle : la meme mesure sur les ombres bleu 220 doit pointer a ~180 de l'orange
const rSh = charge("st-ombres-bleu").rampe_rgb, mSh = profil(rSh); const dSh = dirMesuree(mSh, rSh); const dMotB = dirMotifOklab(220);
const angB = (Math.acos(Math.max(-1, Math.min(1, dSh[0] * dMotB[0] + dSh[1] * dMotB[1]))) * 180) / Math.PI;
console.log("  controle ombres 220 : mesure [%s] motif(220) [%s] angle %s deg", dSh.map((v) => v.toFixed(3)).join(","), dMotB.map((v) => v.toFixed(3)).join(","), angB.toFixed(1));
