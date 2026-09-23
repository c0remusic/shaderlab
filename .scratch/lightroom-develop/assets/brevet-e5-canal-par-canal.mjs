// QUESTION E5 — sur une image EN COULEUR, les courbes s'appliquent-elles CANAL PAR CANAL ?
//
// Le brevet B220 (FIG. 1B) applique R(r), G(g), B(b) : chaque canal passe par SA
// courbe, la luminance du pixel n'intervient pas. Notre twin colorGradingSpec, lui,
// calcule des poids de plage sur le L du pixel et ajoute une chroma OKLab.
//
// TEST SANS MODELE. Pour une scene, on lit sur la RAMPE GRISE la courbe de chaque
// canal en ProPhoto lineaire, pp_out_c(x) aux niveaux lisibles, interpolee. Puis on
// PREDIT la sortie des entrees colorees en appliquant a chaque canal ProPhoto de
// l'entree la courbe de ce canal. On compare, en niveaux sRGB par canal, a :
//   (cbc)  la prediction canal par canal (le brevet) ;
//   (twin) notre colorGradingSpec applique a l'entree ;
//   (lumA) variante pilotee par la luminance, ADDITIVE : delta de la rampe grise au
//          niveau de meme Y ProPhoto que le pixel, ajoute a chaque canal ;
//   (lumG) meme variante en GAIN (facteur pp_out/pp_in du gris de meme Y).
//
// CONTROLE d'abord : deux scenes SYNTHETIQUES dont on connait le mecanisme (une
// canal-par-canal, une pilotee-luminance-additive), pour verifier que le test
// retrouve le bon mecanisme ET distingue le mauvais.
//
// Copie (pas de modif de brevet-commun) des utilitaires necessaires.
import { readFileSync } from "node:fs";
import path from "node:path";
import url from "node:url";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";

const ICI = path.dirname(url.fileURLToPath(import.meta.url));
const MESURES = path.resolve(ICI, "../research/mesures");
const charge = (nom) => JSON.parse(readFileSync(path.join(MESURES, `${nom}.json`), "utf8"));

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => (l <= 0.0031308 ? l * 12.92 : 1.055 * Math.pow(l, 1 / 2.4) - 0.055);
const niveau = (lin) => 255 * l2s(Math.max(0, Math.min(1, lin)));
const linDeNiveau = (n) => s2l(n / 255);

const PP_XYZ = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XYZ50_SRGB = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
function inverse3(m) {
  const [a, b, c] = m[0], [d, e, f] = m[1], [g, h, i] = m[2];
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}
const mulM = (A, B) => A.map((L) => [0, 1, 2].map((j) => L[0] * B[0][j] + L[1] * B[1][j] + L[2] * B[2][j]));
const PP_VERS_SRGB = mulM(XYZ50_SRGB, PP_XYZ);
const SRGB_VERS_PP = inverse3(PP_VERS_SRGB);
const W_PP = PP_XYZ[1]; // poids Y ProPhoto

const lisible = (rgb) => rgb.every((v) => v > 0.5 && v < 254.5);

// niveaux sRGB [R,G,B] -> ProPhoto lineaire
const levelToPP = (lvl) => ap(SRGB_VERS_PP, [linDeNiveau(lvl[0]), linDeNiveau(lvl[1]), linDeNiveau(lvl[2])]);
// ProPhoto lineaire -> niveaux sRGB (ecretes comme un export)
const ppToLevel = (pp) => ap(PP_VERS_SRGB, pp).map(niveau);

// ── colorsys HLS <-> RGB (0..1), memes conventions que le plugin de mesure ──
function hls2rgb(h, l, s) {
  if (s === 0) return [l, l, l];
  const m2 = l <= 0.5 ? l * (1 + s) : l + s - l * s;
  const m1 = 2 * l - m2;
  const v = (hue) => {
    hue = ((hue % 1) + 1) % 1;
    if (hue < 1 / 6) return m1 + (m2 - m1) * 6 * hue;
    if (hue < 1 / 2) return m2;
    if (hue < 2 / 3) return m1 + (m2 - m1) * (2 / 3 - hue) * 6;
    return m1;
  };
  return [v(h + 1 / 3), v(h), v(h - 1 / 3)];
}
function rgb2hls(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2;
  if (mx === mn) return [0, l, 0];
  const d = mx - mn;
  const s = l <= 0.5 ? d / (mx + mn) : d / (2 - mx - mn);
  const rc = (mx - r) / d, gc = (mx - g) / d, bc = (mx - b) / d;
  let h;
  if (r === mx) h = bc - gc;
  else if (g === mx) h = 2 + rc - bc;
  else h = 4 + gc - rc;
  h = (((h / 6) % 1) + 1) % 1;
  return [h * 360, s, l];
}

// ── Interpolateur lineaire, avec domaine ──
function interpolateur(xs, ys) {
  const idx = xs.map((_, i) => i).sort((a, b) => xs[a] - xs[b]);
  const X = idx.map((i) => xs[i]), Y = idx.map((i) => ys[i]);
  const xmin = X[0], xmax = X[X.length - 1];
  const f = (x) => {
    if (x <= xmin) return Y[0] + (Y[1] - Y[0]) * (x - X[0]) / (X[1] - X[0] || 1);
    if (x >= xmax) { const n = X.length; return Y[n - 2] + (Y[n - 1] - Y[n - 2]) * (x - X[n - 2]) / (X[n - 1] - X[n - 2] || 1); }
    let lo = 0, hi = X.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (X[m] <= x) lo = m; else hi = m; }
    return Y[lo] + (Y[hi] - Y[lo]) * (x - X[lo]) / (X[hi] - X[lo]);
  };
  return { f, xmin, xmax };
}

// ── Extraction des trois courbes depuis la rampe grise d'une scene ──
function courbes(scene, temoin) {
  const xs = [], R = [], G = [], B = [];
  let spread = 0;
  for (let i = 0; i < 256; i++) {
    const oin = temoin.rampe_rgb[i], oout = scene.rampe_rgb[i];
    if (!lisible(oin) || !lisible(oout)) continue;
    const ppin = levelToPP(oin); // gris neutre -> ProPhoto neutre
    spread = Math.max(spread, Math.max(...ppin) - Math.min(...ppin));
    const x = (ppin[0] + ppin[1] + ppin[2]) / 3;
    const ppout = levelToPP(oout);
    xs.push(x); R.push(ppout[0]); G.push(ppout[1]); B.push(ppout[2]);
  }
  return { R: interpolateur(xs, R), G: interpolateur(xs, G), B: interpolateur(xs, B), spread, n: xs.length };
}

// ── Predictions, entree = niveaux sRGB [R,G,B] ──
function predictions(lvlIn, cur, params) {
  const ppin = levelToPP(lvlIn);
  const Y = W_PP[0] * ppin[0] + W_PP[1] * ppin[1] + W_PP[2] * ppin[2]; // Y ProPhoto (=x_n du gris de meme Y)
  const xn = Y;
  const horsDom =
    ppin[0] < cur.R.xmin || ppin[0] > cur.R.xmax ||
    ppin[1] < cur.G.xmin || ppin[1] > cur.G.xmax ||
    ppin[2] < cur.B.xmin || ppin[2] > cur.B.xmax;
  const horsDomLum = xn < cur.R.xmin || xn > cur.R.xmax;

  const cbc = ppToLevel([cur.R.f(ppin[0]), cur.G.f(ppin[1]), cur.B.f(ppin[2])]);

  const gout = [cur.R.f(xn), cur.G.f(xn), cur.B.f(xn)];
  const lumA = ppToLevel([ppin[0] + (gout[0] - xn), ppin[1] + (gout[1] - xn), ppin[2] + (gout[2] - xn)]);
  const lumG = ppToLevel([ppin[0] * gout[0] / xn, ppin[1] * gout[1] / xn, ppin[2] * gout[2] / xn]);

  let twin = null;
  if (params) {
    const linIn = [linDeNiveau(lvlIn[0]), linDeNiveau(lvlIn[1]), linDeNiveau(lvlIn[2])];
    twin = colorGradingSpec(linIn, params).map(niveau);
  }
  return { cbc, lumA, lumG, twin, horsDom, horsDomLum };
}

// ── Le jeu d'entrees colorees d'une scene (input = temoin, output = scene) ──
function entreesColorees(scene, temoin) {
  const items = [];
  for (const champ of ["balayage", "balayage_l25", "balayage_l75", "balayage_sat50"]) {
    for (let i = 0; i < 256; i += 4) { // 64 teintes par balayage suffisent, pas de sur-echantillonnage
      const ti = temoin[champ][i], si = scene[champ][i];
      const inRgb = hls2rgb(ti[1] / 360, ti[3], ti[2]).map((v) => v * 255);
      const outRgb = hls2rgb(si[1] / 360, si[3], si[2]).map((v) => v * 255);
      items.push({ src: `${champ}@${Math.round(ti[0])}`, lvlIn: inRgb, meas: outRgb });
    }
  }
  for (let p = 0; p < temoin.patches.length; p++) {
    items.push({ src: `patch${p}`, lvlIn: temoin.patches[p], meas: scene.patches[p] });
  }
  return items;
}

// ── Analyse : erreurs moyennes par modele sur les entrees a sortie lisible ──
function analyse(scene, temoin, params, { verbose = false } = {}) {
  const cur = courbes(scene, temoin);
  const items = entreesColorees(scene, temoin);
  const acc = { cbc: [0, 0, 0], lumA: [0, 0, 0], lumG: [0, 0, 0], twin: [0, 0, 0] };
  let n = 0, nClip = 0, nHorsDom = 0, nHorsDomLum = 0;
  const echantillons = [];
  for (const it of items) {
    if (!lisible(it.meas) || !lisible(it.lvlIn)) { nClip++; continue; }
    const pr = predictions(it.lvlIn, cur, params);
    if (pr.horsDom) nHorsDom++;
    if (pr.horsDomLum) nHorsDomLum++;
    n++;
    const eabs = (a) => a.map((v, c) => Math.abs(v - it.meas[c]));
    const add = (key, pred) => { const e = eabs(pred); for (let c = 0; c < 3; c++) acc[key][c] += e[c]; return e; };
    const eCbc = add("cbc", pr.cbc);
    add("lumA", pr.lumA);
    add("lumG", pr.lumG);
    if (params) add("twin", pr.twin);
    if (verbose && echantillons.length < 12 && (it.src.startsWith("balayage@") || it.src.startsWith("patch"))) {
      echantillons.push({ src: it.src, meas: it.meas.map((v) => +v.toFixed(1)),
        cbc: pr.cbc.map((v) => +v.toFixed(1)), lumA: pr.lumA.map((v) => +v.toFixed(1)),
        eCbc: eCbc.map((v) => +v.toFixed(1)), horsDom: pr.horsDom });
    }
  }
  const moy = (a) => a.map((v) => +(v / n).toFixed(3));
  const glob = (a) => +((a[0] + a[1] + a[2]) / (3 * n)).toFixed(3);
  return {
    n, nClip, nHorsDom, nHorsDomLum, spread: cur.spread, domaine: [+cur.R.xmin.toFixed(3), +cur.R.xmax.toFixed(3)],
    cbc: { parCanal: moy(acc.cbc), moyen: glob(acc.cbc) },
    lumA: { parCanal: moy(acc.lumA), moyen: glob(acc.lumA) },
    lumG: { parCanal: moy(acc.lumG), moyen: glob(acc.lumG) },
    twin: params ? { parCanal: moy(acc.twin), moyen: glob(acc.twin) } : null,
    echantillons,
  };
}

// ══ CONTROLE : scenes synthetiques ═══════════════════════════════════════════
const hermite = (x, s0, s1) => x + (s0 - 1) * x * (1 - x) * (1 - x) - (s1 - 1) * x * x * (1 - x);

function sceneSynthetique(temoin, mecanisme) {
  // mecanisme(ppIn=[r,g,b], Y) -> ppOut=[r,g,b]
  const s = { nom: "synth", rampe_rgb: [], balayage: [], balayage_l25: [], balayage_l75: [], balayage_sat50: [], patches: [] };
  for (let i = 0; i < 256; i++) {
    const ppin = levelToPP(temoin.rampe_rgb[i]);
    const Y = W_PP[0] * ppin[0] + W_PP[1] * ppin[1] + W_PP[2] * ppin[2];
    s.rampe_rgb.push(ppToLevel(mecanisme(ppin, Y)));
  }
  for (const champ of ["balayage", "balayage_l25", "balayage_l75", "balayage_sat50"]) {
    for (let i = 0; i < 256; i++) {
      const ti = temoin[champ][i];
      const inRgb = hls2rgb(ti[1] / 360, ti[3], ti[2]).map((v) => v * 255);
      const ppin = levelToPP(inRgb);
      const Y = W_PP[0] * ppin[0] + W_PP[1] * ppin[1] + W_PP[2] * ppin[2];
      const outLvl = ppToLevel(mecanisme(ppin, Y)).map((v) => Math.max(0, Math.min(255, v)));
      const hls = rgb2hls(outLvl[0] / 255, outLvl[1] / 255, outLvl[2] / 255);
      // format mesure : [hin, hue, sat, lum] ; rgb2hls rend [hue, sat, lum]
      s[champ].push([ti[0], hls[0], hls[1], hls[2]]);
    }
  }
  for (const p of temoin.patches) {
    const ppin = levelToPP(p);
    const Y = W_PP[0] * ppin[0] + W_PP[1] * ppin[1] + W_PP[2] * ppin[2];
    s.patches.push(ppToLevel(mecanisme(ppin, Y)).map((v) => Math.max(0, Math.min(255, v))));
  }
  return s;
}

function controle() {
  const t4 = charge("temoin4");
  console.log("\n════ CONTROLE (scenes synthetiques, mecanisme connu) ════");

  // Mecanisme A : CANAL PAR CANAL — trois cubiques distinctes (virage bleu/orange).
  const sR = [1.4, 0.7], sG = [1.0, 1.0], sB = [0.6, 1.4];
  const mecaCBC = (pp) => [hermite(Math.min(1, pp[0]), sR[0], sR[1]),
                           hermite(Math.min(1, pp[1]), sG[0], sG[1]),
                           hermite(Math.min(1, pp[2]), sB[0], sB[1])];
  const rA = analyse(sceneSynthetique(t4, mecaCBC), t4, null);
  console.log("A) mecanisme CANAL-PAR-CANAL :  n=%d horsDom=%d", rA.n, rA.nHorsDom);
  console.log("   cbc  moyen=%s  (attendu ~plancher 8 bits)", rA.cbc.moyen);
  console.log("   lumA moyen=%s   lumG moyen=%s  (attendu >> cbc)", rA.lumA.moyen, rA.lumG.moyen);

  // Mecanisme B : PILOTE-LUMINANCE ADDITIF — teinte fn du Y du gris, ajoutee a tous les canaux.
  const deltaLum = (Y) => { const t = 4 * Y * (1 - Y); return [0.06 * t, 0.00 * t, -0.05 * t]; };
  const mecaLUM = (pp, Y) => { const d = deltaLum(Y); return [pp[0] + d[0], pp[1] + d[1], pp[2] + d[2]]; };
  const rB = analyse(sceneSynthetique(t4, mecaLUM), t4, null);
  console.log("B) mecanisme PILOTE-LUMINANCE additif :  n=%d horsDom=%d", rB.n, rB.nHorsDom);
  console.log("   lumA moyen=%s  (attendu ~plancher)   cbc moyen=%s  (attendu >> lumA)", rB.lumA.moyen, rB.cbc.moyen);
  console.log("   verdict discrimination :", rA.cbc.moyen < rA.lumA.moyen * 0.5 && rB.lumA.moyen < rB.cbc.moyen * 0.5 ? "OK — le test separe les deux" : "ECHEC");
}

// ══ SCENES REELLES ═══════════════════════════════════════════════════════════
const P0 = () => [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0];
const scenes = {
  "st-h000":    (() => { const p = P0(); p[0] = 0;   p[1] = 60; p[13] = -100; return p; })(),
  "st-h220":    (() => { const p = P0(); p[0] = 220; p[1] = 60; p[13] = -100; return p; })(),
  "st-h300":    (() => { const p = P0(); p[0] = 300; p[1] = 60; p[13] = -100; return p; })(),
  "st-ombres-bleu": (() => { const p = P0(); p[0] = 220; p[1] = 60; return p; })(),
  "st-hl-orange":   (() => { const p = P0(); p[6] = 40;  p[7] = 60; return p; })(),
  "st-duo":     (() => { const p = P0(); p[0] = 220; p[1] = 60; p[6] = 40; p[7] = 60; return p; })(),
  "cg-glob-h040":   (() => { const p = P0(); p[9] = 40;  p[10] = 60; return p; })(),
  "grading-moyens-vert": (() => { const p = P0(); p[3] = 140; p[4] = 60; return p; })(),
};

function reelles() {
  const t4 = charge("temoin4");
  console.log("\n════ SCENES REELLES (erreur moyenne, niveaux sRGB par canal) ════");
  console.log("scene                | n  clip hDom | cbc(brevet)          | twin(OKLab)          | lumA(add)  | lumG(gain)");
  const table = [];
  for (const [nom, params] of Object.entries(scenes)) {
    const scene = charge(nom);
    const r = analyse(scene, t4, params);
    table.push({ nom, r });
    const fmt = (m) => `${String(m.moyen).padEnd(5)} [${m.parCanal.join(",")}]`;
    console.log(
      "%s | %s %s %s | %s | %s | %s | %s",
      nom.padEnd(20), String(r.n).padStart(2), String(r.nClip).padStart(3), String(r.nHorsDom).padStart(3),
      fmt(r.cbc).padEnd(20), fmt(r.twin).padEnd(20), String(r.lumA.moyen).padEnd(6), String(r.lumG.moyen)
    );
  }
  // Profil detaille sur st-duo et grading-moyens-vert
  for (const nom of ["st-duo", "grading-moyens-vert", "cg-glob-h040"]) {
    const scene = charge(nom);
    const r = analyse(scene, t4, scenes[nom], { verbose: true });
    console.log(`\n── profil ${nom} (domaine courbe x∈[${r.domaine}], spread gris ${r.spread.toExponential(1)}) ──`);
    for (const e of r.echantillons) {
      console.log("  %s meas=%s  cbc=%s (|e|=%s%s)", e.src.padEnd(14),
        JSON.stringify(e.meas), JSON.stringify(e.cbc), JSON.stringify(e.eCbc), e.horsDom ? " HORS-DOM" : "");
    }
  }
  return table;
}

controle();
reelles();
