// E3 — LE PROFIL D'UNE ROUE, LU DIRECTEMENT SUR LA CHROMA OKLab
//
// La direction du virage est reglee (research/22 : motif ProPhoto, ajout OKLab).
// Ce qui reste est un PROFIL scalaire : quelle chroma chaque niveau recoit. Sur
// une rampe grise l'entree n'a AUCUNE chroma, donc la chroma OKLab de la sortie
// EST le profil, sans supposer aucune direction : C(i) = hypot(a_out, b_out).
//
// On cherche la FORME et son ABSCISSE. Forme flexible C = A . X^p (1-X)^q, ajustee
// en log-lineaire (log C = log A + p log X + q log(1-X)). Le brevet predit, pour
// une cubique d'Hermite clouee en 0 et 1 avec une seule pente non triviale :
//   ombres  s1=1 : ecart = (s0-1) X (1-X)^2  ->  p=1, q=2, sommet X=1/3
//   hautes  s0=1 : ecart = -(s1-1) X^2 (1-X) ->  p=2, q=1, sommet X=2/3
// Le sommet X* = p/(p+q) est l'invariant robuste. On le lit dans quatre abscisses.
//
// CONTROLE : deux rampes fabriquees, meme direction, profils DIFFERENTS —
//   (a) cubique du brevet en ProPhoto lineaire (doit rendre p=1,q=2 en "lineaire")
//   (b) un GAIN par sigmoide  chroma = A . sig(X) . X  (doit rendre un AUTRE couple,
//       sommet decale, et ne PAS se faire passer pour la cubique).
import { s2l, l2s, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, oklab, pentes, hermite, motif, charge, lisible } from "./brevet-commun.mjs";

const chromaOklab = (rgbNiv) => { const lab = oklab(rgbNiv.map((c) => s2l(c / 255))); return Math.hypot(lab[1], lab[2]); };
const Loklab = (n) => oklab([s2l(n / 255), s2l(n / 255), s2l(n / 255)])[0];

const gam = (g) => (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / g);
const CODAGES = {
  "niveau sRGB": (n) => n / 255,
  "lineaire": (n) => s2l(n / 255),
  "gamma 1,8": (n) => gam(1.8)(s2l(n / 255)),
  "L OKLab": (n) => Loklab(n),
};

/** Ajuste log C = logA + p logX + q log(1-X), pondere par C^2. Rend p, q, sommet, A, residuLog. */
function ajusteForme(niveaux, chroma, X, { floor = 0.004 } = {}) {
  const pts = [];
  for (let k = 0; k < niveaux.length; k++) {
    const x = X(niveaux[k]), c = chroma[k];
    if (c <= floor || x <= 1e-4 || x >= 1 - 1e-4) continue;
    pts.push([Math.log(x), Math.log(1 - x), Math.log(c), c * c]);
  }
  // moindres carres ponderes a 3 inconnues (logA, p, q)
  let S = new Array(3 * 3).fill(0), rhs = [0, 0, 0];
  for (const [lx, l1, lc, w] of pts) {
    const g = [1, lx, l1];
    for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) S[a * 3 + b] += w * g[a] * g[b]; rhs[a] += w * g[a] * lc; }
  }
  const sol = resoudre3(S, rhs);
  if (!sol) return null;
  const [logA, p, q] = sol;
  let res = 0, nn = 0;
  for (const [lx, l1, lc, w] of pts) { const pred = logA + p * lx + q * l1; res += w * (pred - lc) ** 2; nn += w; }
  return { p, q, A: Math.exp(logA), sommet: p / (p + q), residuLog: Math.sqrt(res / nn), n: pts.length };
}
function resoudre3(S, r) {
  const m = [[S[0], S[1], S[2], r[0]], [S[3], S[4], S[5], r[1]], [S[6], S[7], S[8], r[2]]];
  for (let c = 0; c < 3; c++) {
    let piv = c; for (let i = c + 1; i < 3; i++) if (Math.abs(m[i][c]) > Math.abs(m[piv][c])) piv = i;
    if (Math.abs(m[piv][c]) < 1e-12) return null;
    [m[c], m[piv]] = [m[piv], m[c]];
    for (let i = 0; i < 3; i++) if (i !== c) { const f = m[i][c] / m[c][c]; for (let j = c; j < 4; j++) m[i][j] -= f * m[c][j]; }
  }
  return [m[0][3] / m[0][0], m[1][3] / m[1][1], m[2][3] / m[2][2]];
}

function profil(rampe) {
  const niv = [], ch = [];
  for (let i = 3; i <= 252; i++) { if (!lisible(rampe[i])) continue; niv.push(i); ch.push(chromaOklab(rampe[i])); }
  return { niv, ch };
}

// ── Rampes de controle ───────────────────────────────────────────────────────
function rampeCubique(h, S) { // cubique du brevet, ombres seules, en ProPhoto LINEAIRE
  const s0 = pentes(h, S, PP_XYZ[1]);
  return Array.from({ length: 256 }, (_, i) => {
    const X = s2l(i / 255);
    const pp = [0, 1, 2].map((c) => hermite(X, s0[c], 1));
    return ap(PP_VERS_SRGB, pp).map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
  });
}
function rampeGainSigmoide(h, S, c0 = 0.13, largeur = 0.09) { // MEME direction, profil = sigmoide . lin
  const dir = pentes(h, S, PP_XYZ[1]).map((c) => c - 1); // direction ProPhoto de la roue
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255), L = Loklab(i);
    const sig = 1 / (1 + Math.exp((L - c0) / largeur)); // plateau en bas, chute — comme research/18
    const pp = [0, 1, 2].map((c) => x + 0.5 * sig * x * dir[c]);
    return ap(PP_VERS_SRGB, pp).map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
  });
}

function ligne(nom, rampe) {
  const { niv, ch } = profil(rampe);
  const cmax = Math.max(...ch), imax = niv[ch.indexOf(cmax)];
  let out = nom.padEnd(22) + ("Cmax=" + cmax.toFixed(4) + "@" + imax).padEnd(18);
  for (const [cn, X] of Object.entries(CODAGES)) {
    const f = ajusteForme(niv, ch, X);
    out += (cn + ": p=" + f.p.toFixed(2) + " q=" + f.q.toFixed(2) + " X*=" + f.sommet.toFixed(3) + " (n" + niv[Math.round(f.sommet * 255) >= 0 ? 0 : 0] + ")").padEnd(1);
    out += " | ";
  }
  console.log(out);
  return { niv, ch };
}

console.log("=== CONTROLE (formes fabriquees, meme direction, profils differents) ===");
console.log("chaque cellule : forme ajustee C = A X^p (1-X)^q par abscisse ; sommet X* = p/(p+q)");
ligne("cubique brevet h220", rampeCubique(220, 0.6));
ligne("gain sigmoide h220", rampeGainSigmoide(220, 0.6));
console.log("  attendu cubique -> en 'lineaire' p~1 q~2 X*~0.33 ; le gain doit differer nettement");

console.log("");
console.log("=== MESURES : roues simples ===");
const SCENES = ["st-ombres-bleu", "st-h220", "st-hl-orange", "cg-glob-h040", "cg-glob-h220", "grading-moyens-vert"];
const prof = {};
for (const s of SCENES) { const r = charge(s)?.rampe_rgb; if (r) prof[s] = ligne(s, r); }

console.log("");
console.log("=== PROFIL DE CHROMA lu au niveau (ombres vs hautes vs global) ===");
console.log("niveau".padEnd(8) + [8, 16, 32, 48, 64, 96, 128, 160, 190, 220, 240].map((n) => String(n).padStart(8)).join(""));
for (const s of SCENES) {
  if (!prof[s]) continue;
  const { niv, ch } = prof[s]; const map = new Map(niv.map((n, k) => [n, ch[k]]));
  console.log(s.padEnd(8) + [8, 16, 32, 48, 64, 96, 128, 160, 190, 220, 240].map((n) => (map.has(n) ? map.get(n).toFixed(4) : "  -").padStart(8)).join(""));
}
