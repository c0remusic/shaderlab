// NOTRE TWIN, APPLIQUE CANAL PAR CANAL EN PROPHOTO : combien gagne-t-on sur la couleur ?
//
// ⚠️ MESURE D'AVANT LE CHANGEMENT. Ce script a ete lance le 2026-09-29 contre le
// colorGradingSpec d'ALORS (operateur OKLab applique au pixel), et ses chiffres ont
// decide la tranche : 14,68 -> 9,08 niveaux sur les entrees colorees de 32 scenes.
// Depuis le commit qui l'a posee, colorGradingSpec EST le canal par canal : relance
// aujourd'hui, la colonne « twin » vaut la colonne « canal ». Pour la rejouer, lancer
// ce script sur l'arbre d'avant (git show <commit>^:src/render/effects/colorGrading.ts).
//
// research/23 a etabli que Lightroom applique au pixel TROIS COURBES 1D, une par
// canal, en primaires ProPhoto (lues sur la rampe grise et reappliquees aux entrees
// colorees : 0,44-0,55 niveau). Notre twin, lui, calcule ses poids de plage sur le
// L du pixel et ajoute une chroma OKLab : sur les entrees colorees il rate de 4,6 a
// 23,0 niveaux, et c'est la STRUCTURE qui rate, pas les constantes.
//
// LA TRANCHE LA MOINS RISQUEE. Garder notre operateur EXACTEMENT tel quel sur le
// gris, mais l'appliquer canal par canal : pour un pixel de valeurs ProPhoto
// (pR, pG, pB), la sortie du canal c est le canal c (en ProPhoto) de notre
// operateur applique au GRIS de valeur pc. Trois evaluations par pixel, aucune
// table de donnees. Sur une rampe grise les deux formes sont IDENTIQUES par
// construction — donc les treize scenes de verifier-grading ne bougent pas, et
// seules les entrees colorees changent.
//
// Trois predicteurs contre la mesure Lightroom, en niveaux sRGB par canal :
//   (a) twin      — colorGradingSpec applique au pixel (en service) ;
//   (b) canal     — le meme operateur, canal par canal en ProPhoto (la tranche) ;
//   (c) plafond   — les courbes grises de LIGHTROOM reappliquees canal par canal
//                   (brevet-e5) : ce qu'on atteindrait avec des courbes grises parfaites.
// Deux jeux d'echantillons : les LISIBLES (aucun canal ecrete ni a l'entree ni a la
// sortie mesuree, le jeu de brevet-e5) et TOUS (ecretage compris, compare ecrete a
// ecrete comme un export).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const ICI = path.dirname(url.fileURLToPath(import.meta.url));
const MESURES = path.resolve(ICI, "../research/mesures");
const charge = (nom) => {
  const f = path.join(MESURES, `${nom}.json`);
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const niveau = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));
const linDeNiveau = (n) => s2l(n / 255);
const PP_XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XYZ50_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => [0, 1, 2].map((i) => m[i][0] * v[0] + m[i][1] * v[1] + m[i][2] * v[2]);
const mulM = (A, B) => A.map((L) => [0, 1, 2].map((j) => L[0] * B[0][j] + L[1] * B[1][j] + L[2] * B[2][j]));
function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [[(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det]];
}
const PP_VERS_SRGB = mulM(XYZ50_SRGB, PP_XYZ);
const SRGB_VERS_PP = inverse3(PP_VERS_SRGB);
const lisible = (rgb) => rgb.every((v) => v > 0.5 && v < 254.5);

/** (b) Notre operateur, canal par canal en ProPhoto. Entree/sortie : sRGB lineaire. */
export function canalParCanal(linSrgb, params) {
  const pp = ap(SRGB_VERS_PP, linSrgb);
  const out = [0, 1, 2].map((c) => {
    const x = pp[c];                                   // le gris de meme valeur, sur ce canal
    const g = colorGradingSpec([x, x, x], params);     // notre operateur, sur le gris
    return ap(SRGB_VERS_PP, g)[c];                     // canal c de sa sortie, en ProPhoto
  });
  return ap(PP_VERS_SRGB, out);
}

// ── Entrees colorees (lues sur temoin4) et sorties mesurees ──
function hls2rgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s, m1 = 2 * l - m2;
  const v = (t) => { t = ((t % 1) + 1) % 1; return t < 1 / 6 ? m1 + (m2 - m1) * 6 * t : t < 1 / 2 ? m2 : t < 2 / 3 ? m1 + (m2 - m1) * (2 / 3 - t) * 6 : m1; };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}
function entrees(scene, temoin) {
  const items = [];
  for (const champ of ["balayage", "balayage_l25", "balayage_l75", "balayage_sat50"]) {
    for (let i = 0; i < 256; i += 4) {
      const ti = temoin[champ][i], si = scene[champ][i];
      items.push({ inn: hls2rgb(ti[1] / 360, ti[3], ti[2]).map((v) => v * 255), meas: hls2rgb(si[1] / 360, si[3], si[2]).map((v) => v * 255) });
    }
  }
  for (let p = 0; p < temoin.patches.length; p++) items.push({ inn: temoin.patches[p], meas: scene.patches[p] });
  return items;
}
/** (c) Courbes grises de Lightroom, interpolees en ProPhoto (plafond). */
function courbesLR(scene, temoin) {
  const pts = [];
  for (let i = 0; i < 256; i++) {
    if (!lisible(temoin.rampe_rgb[i]) || !lisible(scene.rampe_rgb[i])) continue;
    const pin = ap(SRGB_VERS_PP, temoin.rampe_rgb[i].map((v) => linDeNiveau(v)));
    pts.push([(pin[0] + pin[1] + pin[2]) / 3, ap(SRGB_VERS_PP, scene.rampe_rgb[i].map((v) => linDeNiveau(v)))]);
  }
  pts.sort((a, b) => a[0] - b[0]);
  return (x, c) => {
    let k = 1;
    while (k < pts.length - 1 && pts[k][0] < x) k++;
    const [x0, y0] = pts[k - 1], [x1, y1] = pts[k];
    return y0[c] + (y1[c] - y0[c]) * (x - x0) / (x1 - x0 || 1);
  };
}

// ── Reglages des scenes (ordre du uniform : ombres h/s/l, moyens, hautes, globale, fusion, balance) ──
const R = (o = {}) => {
  const d = { shHue: 0, shSat: 0, shLum: 0, mHue: 0, mSat: 0, mLum: 0, hHue: 0, hSat: 0, hLum: 0, gHue: 0, gSat: 0, gLum: 0, blending: 50, balance: 0, ...o };
  return [d.shHue, d.shSat, d.shLum, d.mHue, d.mSat, d.mLum, d.hHue, d.hSat, d.hLum, d.gHue, d.gSat, d.gLum, d.blending, d.balance];
};
const duo = { shHue: 220, shSat: 60, hHue: 40, hSat: 60 };
const SCENES = {
  "st-ombres-bleu": R({ shHue: 220, shSat: 60 }),
  "st-hl-orange": R({ hHue: 40, hSat: 60 }),
  "st-duo": R(duo),
  "st-balance-m100": R({ ...duo, balance: -100 }),
  "st-balance-m50": R({ ...duo, balance: -50 }),
  "st-balance-p50": R({ ...duo, balance: 50 }),
  "st-balance-p100": R({ ...duo, balance: 100 }),
  "cg-fusion-0": R({ ...duo, blending: 0 }),
  "cg-fusion-25": R({ ...duo, blending: 25 }),
  "cg-fusion-75": R({ ...duo, blending: 75 }),
  "cg-fusion-100": R({ ...duo, blending: 100 }),
  "grading-moyens-vert": R({ mHue: 140, mSat: 60 }),
  "cg-glob-h040": R({ gHue: 40, gSat: 60 }),
  "cg-glob-h220": R({ gHue: 220, gSat: 60 }),
  "st-ombres-sat20": R({ shHue: 220, shSat: 20, balance: -100 }),
  "st-ombres-sat100": R({ shHue: 220, shSat: 100, balance: -100 }),
  "cg-hl-lum-p50": R({ hLum: 50 }),
  "cg-moyens-lum-p50": R({ mLum: 50 }),
  "cg-ombres-lum-p50": R({ shLum: 50 }),
  "cg-ombres-lum-m50": R({ shLum: -50 }),
  "grading-global-lum-p50": R({ gLum: 50 }),
};
for (const h of [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330]) SCENES[`st-h${String(h).padStart(3, "0")}`] = R({ shHue: h, shSat: 60, balance: -100 });

// ── Controle : sur une rampe grise, (a) et (b) doivent etre identiques ──
{
  let pire = 0;
  for (const p of Object.values(SCENES)) {
    for (let i = 0; i < 256; i += 5) {
      const x = linDeNiveau(i);
      const a = colorGradingSpec([x, x, x], p).map(niveau), b = canalParCanal([x, x, x], p).map(niveau);
      pire = Math.max(pire, ...a.map((v, c) => Math.abs(v - b[c])));
    }
  }
  console.log("CONTROLE rampe grise : ecart max entre twin et canal-par-canal = %s niveau (attendu ~0)", pire.toExponential(2));
  if (pire > 0.01) throw new Error("le canal-par-canal n'est pas identique au twin sur le gris : la tranche changerait les 13 scenes");
}

const t4 = charge("temoin4");
console.log("");
console.log("ERREUR MOYENNE SUR LES ENTREES COLOREES, niveaux sRGB par canal");
console.log("scene                     |  lisibles : twin   canal  plafond  n  |  tous : twin   canal");
console.log("".padEnd(96, "-"));
const tot = { lt: 0, lc: 0, lp: 0, at: 0, ac: 0, n: 0 };
for (const [nom, params] of Object.entries(SCENES)) {
  const scene = charge(nom);
  if (!scene) { console.log("%s manquante", nom.padEnd(25)); continue; }
  const lr = courbesLR(scene, t4);
  let lt = 0, lc = 0, lp = 0, nl = 0, at = 0, ac = 0, na = 0;
  for (const it of entrees(scene, t4)) {
    const lin = it.inn.map(linDeNiveau);
    const tw = colorGradingSpec(lin, params).map(niveau);
    const cp = canalParCanal(lin, params).map(niveau);
    const e = (pr) => pr.reduce((s, v, c) => s + Math.abs(v - it.meas[c]), 0) / 3;
    at += e(tw); ac += e(cp); na++;
    if (lisible(it.inn) && lisible(it.meas)) {
      const pin = ap(SRGB_VERS_PP, lin);
      const pl = ap(PP_VERS_SRGB, [0, 1, 2].map((c) => lr(pin[c], c))).map(niveau);
      lt += e(tw); lc += e(cp); lp += e(pl); nl++;
    }
  }
  tot.lt += lt / nl; tot.lc += lc / nl; tot.lp += lp / nl; tot.at += at / na; tot.ac += ac / na; tot.n++;
  console.log("%s | %s %s %s %s | %s %s", nom.padEnd(25), (lt / nl).toFixed(2).padStart(15), (lc / nl).toFixed(2).padStart(6),
    (lp / nl).toFixed(2).padStart(8), String(nl).padStart(3), (at / na).toFixed(2).padStart(12), (ac / na).toFixed(2).padStart(6));
}
console.log("".padEnd(96, "-"));
console.log("%s | %s %s %s     | %s %s", ("MOYENNE (" + tot.n + " scenes)").padEnd(25), (tot.lt / tot.n).toFixed(2).padStart(15),
  (tot.lc / tot.n).toFixed(2).padStart(6), (tot.lp / tot.n).toFixed(2).padStart(8), (tot.at / tot.n).toFixed(2).padStart(12), (tot.ac / tot.n).toFixed(2).padStart(6));
