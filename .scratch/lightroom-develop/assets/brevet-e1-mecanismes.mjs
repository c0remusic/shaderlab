// E1 — PREDICTION DES PENTES AU NOIR PAR PLUSIEURS MECANISMES, contre la mesure.
//
// Mesure de reference : les pentes ajustees par canal (brevet-e1-pentes-mesurees).
// Chaque mecanisme predit un vecteur de pentes s(h) ; le juge est (a) la luminance
// Y ProPhoto implicite w.s (mesuree : 0,98 aux rouges/bleus -> 1,40 au jaune) et
// (b) la composante grise de la DIRECTION s-1, projetee hors du gris, la metrique
// du brief. Un mecanisme a AU PLUS un parametre libre (S, l'echelle de saturation).
//
// Mecanismes :
//   Y     : brevet, invariance Y ProPhoto lineaire (max jaune epingle a 1) ;
//   HSL   : brevet, invariance lumiere HSL (min+max)/2 ;
//   OKLab : notre twin (ajout de chroma a L d'OKLab constant) ;
//   W     : brevet, invariance luminance lineaire w' ajustee (poids vert/bleu).
import { s2l, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, pentes, hermite, motif, oklab, niveau, charge, lisible } from "./brevet-commun.mjs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
const norme = (v) => Math.hypot(v[0], v[1], v[2]);
const sansGris = (v) => { const g = (v[0] + v[1] + v[2]) / 3; return v.map((c) => c - g); };
const grisRel = (s) => { const d = s.map((c) => c - 1); const g = (d[0] + d[1] + d[2]) / 3, ch = norme(sansGris(d)); return ch > 1e-9 ? g / ch : 0; };

// ── pentes mesurees (fit par canal, bas niveaux, canal lisible) ──────────────
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
function pentesMesurees(h) {
  const r = charge(`st-h${String(h).padStart(3, "0")}`).rampe_rgb;
  return [0, 1, 2].map((c) => fitS0(r, c));
}

// ── OKLab : pentes du twin, fit de la meme facon sur une rampe fabriquee ────
function pentesTwin(h, sat) {
  const p = [h, sat, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, -100];
  const rampe = Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    return colorGradingSpec([x, x, x], p).map((v) => niveau(v));
  });
  return [0, 1, 2].map((c) => fitS0(rampe, c));
}

// ── invariance W ajustee : pentes = motif borne par w'.s = 1 et saturation S ──
function pentesW(h, S, w) { return pentes(h, S, w, "luminance"); }

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const MES = TEINTES.map((h) => [h, pentesMesurees(h)]);

// w.s mesure (bleu manquant -> complete par pente brevet Y, poids ~0)
function ws(h, s) {
  const sY = pentes(h, 0.6, PP_XYZ[1]);
  return dot(PP_XYZ[1], s.map((v, c) => v == null ? sY[c] : v));
}

// Ajustement de S pour Y et HSL : minimise l'erreur sur w.s (echelle de saturation).
function fitS(inv, w) {
  let best = 0.6, bE = 1e9;
  for (let S = 0.30; S <= 0.98; S += 0.005) {
    let e = 0;
    for (const [h, sm] of MES) {
      const sp = pentes(h, S, w, inv);
      e += (dot(PP_XYZ[1], sp) - ws(h, sm)) ** 2;
    }
    if (e < bE) { bE = e; best = S; }
  }
  return best;
}
// Ajustement de w' (vert, bleu ; rouge = 1 - vert - bleu... non, on garde somme ldc)
// On ajuste (wG, wB), wR = libre aussi ; contrainte : le brevet normalise par w.s,
// donc seule la DIRECTION de w' compte -> on fixe la somme a celle de ProPhoto (~1).
function fitW(S) {
  let best = PP_XYZ[1], bE = 1e9;
  for (let wG = 0.45; wG <= 0.75; wG += 0.01) {
    for (let wB = 0.0; wB <= 0.30; wB += 0.01) {
      const wR = 1 - wG - wB; if (wR <= 0) continue;
      const w = [wR, wG, wB];
      let e = 0;
      for (const [h, sm] of MES) {
        const sp = pentes(h, S, w, "luminance");
        // erreur sur la composante grise de direction, la metrique du brief
        e += (grisRel(sp) - grisRel(sm.map((v, c) => v == null ? sp[c] : v))) ** 2;
      }
      if (e < bE) { bE = e; best = w; }
    }
  }
  return best;
}

const S_Y = fitS("luminance", PP_XYZ[1]);
const S_H = fitS("lumiere", PP_XYZ[1]);
const S_W0 = 0.6;
const W = fitW(S_W0);
console.log("Parametres ajustes : S(Y)=%s  S(HSL)=%s  w'=[%s] (S=%s)",
  S_Y.toFixed(3), S_H.toFixed(3), W.map((x) => x.toFixed(3)).join(","), S_W0.toFixed(2));

const MECS = [
  ["Y ProPhoto", (h) => pentes(h, S_Y, PP_XYZ[1], "luminance")],
  ["HSL lightness", (h) => pentes(h, S_H, PP_XYZ[1], "lumiere")],
  ["OKLab twin", (h) => pentesTwin(h, 60)],
  ["w' ajuste", (h) => pentesW(h, S_W0, W)],
];

console.log("");
console.log("w.s (Y ProPhoto de la pente) — mesure vs mecanismes  (1 = Y conservee)");
console.log("teinte".padEnd(7) + "mesure".padStart(8) + MECS.map(([n]) => n.padStart(15)).join(""));
const err = MECS.map(() => 0);
for (const [h, sm] of MES) {
  const wm = ws(h, sm);
  const cells = MECS.map(([, f], k) => { const s = f(h); const w = dot(PP_XYZ[1], s.map((v, c) => v == null ? 1 : v)); err[k] += (w - wm) ** 2; return w; });
  console.log(("h" + String(h).padStart(3, "0")).padEnd(7) + wm.toFixed(3).padStart(8) + cells.map((c) => c.toFixed(3).padStart(15)).join(""));
}
console.log("RMS(w.s)".padEnd(7) + "".padStart(8) + err.map((e) => Math.sqrt(e / MES.length).toFixed(3).padStart(15)).join(""));

console.log("");
console.log("COMPOSANTE GRISE de la direction s-1 (metrique du brief) — mesure vs mecanismes");
console.log("teinte".padEnd(7) + "mesure".padStart(8) + MECS.map(([n]) => n.padStart(15)).join(""));
const errG = MECS.map(() => 0);
for (const [h, sm] of MES) {
  const gm = grisRel(sm.map((v, c) => v == null ? pentes(h, 0.6, PP_XYZ[1])[c] : v));
  const cells = MECS.map(([, f], k) => { const g = grisRel(f(h)); errG[k] += (g - gm) ** 2; return g; });
  console.log(("h" + String(h).padStart(3, "0")).padEnd(7) + gm.toFixed(3).padStart(8) + cells.map((c) => c.toFixed(3).padStart(15)).join(""));
}
console.log("RMS(gris)".padEnd(7) + "".padStart(8) + errG.map((e) => Math.sqrt(e / MES.length).toFixed(3).padStart(15)).join(""));
