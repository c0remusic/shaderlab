// CONTROLE DE MON PROPRE ESTIMATEUR — la meme discipline que j'exige de lui.
//
// loi-h2-pente-chroma.mjs interpole l'angle de la roue des OMBRES a la chroma de
// la roue GLOBALE, au meme niveau d'entree, en s'appuyant sur les trois
// saturations 20 / 60 / 100. Avant de s'en servir pour contredire un chiffre, il
// faut prouver qu'il rend ZERO quand la loi est unique.
//
// FABRICATION. Quatre rampes synthetiques sous UNE SEULE loi : trois « roues des
// ombres » aux profils de chroma de sat20 / sat60 / sat100, et une « roue
// globale » au profil de cg-glob-h220. Les profils sont les profils REELS,
// niveau par niveau, par bissection de l'amplitude. Verite connue : 0,0 deg.
//
// CONTROLE INVERSE. La meme chose avec la roue globale decalee d'un angle CONNU
// en OKLab : l'estimateur doit le rendre.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ec = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.012;

const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const SX = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
const XP = [[1.3459433, -0.2556075, -0.0511118], [-0.5445989, 1.5081673, 0.0205351], [0, 0, 1.2118128]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const oter = (v) => { const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; return [v[0] - y, v[1] - y, v[2] - y]; };

const lireRampe = (nom) => JSON.parse(readFileSync(M + "/" + nom + ".json", "utf8")).rampe_rgb;
const lire = (rgb) => rgb.map((v, i) => {
  const lab = linearSrgbToOklab(v.map((x) => srgbToLinear(x / 255)));
  const e = v.map((x) => Math.round(x));
  return { n: i, L: lab[0], c: Math.hypot(lab[1], lab[2]), angle: deg(lab[1], lab[2]), ecrete: e.some((x) => x <= 0 || x >= 255) };
});

function direction(espace, h) {
  const g = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  if (espace === "SRGBLIN") { const u = oter(g.map(srgbToLinear)); const n = Math.hypot(...u); return u.map((x) => x / n); }
  const u = oter(g); const n = Math.hypot(...u); return u.map((x) => x / n);
}
function poser(espace, u, n, A, rot) {
  const g = srgbToLinear(n / 255);
  let lin;
  if (espace === "SRGBLIN") lin = [g + A * u[0], g + A * u[1], g + A * u[2]];
  else { const p = ap(XP, ap(SX, [g, g, g])); lin = ap(XS, ap(PP, [p[0] + A * u[0], p[1] + A * u[1], p[2] + A * u[2]])); }
  if (rot) {                                   // rotation CONNUE, appliquee en OKLab
    const lab = linearSrgbToOklab(lin);
    const c = Math.hypot(lab[1], lab[2]), a = deg(lab[1], lab[2]) + rot;
    lin = oklabToLinearSrgb([lab[0], c * Math.cos((a * Math.PI) / 180), c * Math.sin((a * Math.PI) / 180)]);
  }
  return lin.map((x) => Math.min(255, Math.max(0, Math.round(linearToSrgb(x) * 255))));
}
const chromaDe = (h8) => { const lab = linearSrgbToOklab(h8.map((x) => srgbToLinear(x / 255))); return Math.hypot(lab[1], lab[2]); };
function fabriquer(espace, h, profil, rot) {
  const u = direction(espace, h);
  return profil.map((p, n) => {
    if (p.c < 1e-6) return [n, n, n];
    let lo = 0, hi = 0.02;
    for (let i = 0; i < 80 && chromaDe(poser(espace, u, n, hi, rot)) < p.c; i++) hi *= 1.3;
    for (let i = 0; i < 90; i++) { const m = (lo + hi) / 2; if (chromaDe(poser(espace, u, n, m, rot)) < p.c) lo = m; else hi = m; }
    return poser(espace, u, n, (lo + hi) / 2, rot);
  });
}

/** MON estimateur, copie de loi-h2-pente-chroma.mjs. */
function estimer(S, G) {
  const pts = (n) => [20, 60, 100].map((s) => S[s][n]).filter((p) => !p.ecrete && p.c >= SEUIL).sort((a, b) => a.c - b.c);
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const g = G[n];
    if (g.ecrete || g.c < SEUIL) continue;
    const ps = pts(n);
    for (let i = 0; i + 1 < ps.length; i++) {
      if (g.c >= ps[i].c && g.c <= ps[i + 1].c) {
        const t = (g.c - ps[i].c) / (ps[i + 1].c - ps[i].c);
        out.push({ n, L: g.L, d: ec(g.angle, ps[i].angle + t * ec(ps[i + 1].angle, ps[i].angle)),
          brut: ec(g.angle, S[60][n].angle) });
        break;
      }
    }
  }
  return out;
}

const PROFIL = { 20: lire(lireRampe("st-ombres-sat20")), 60: lire(lireRampe("st-h220")), 100: lire(lireRampe("st-ombres-sat100")) };
const PG = lire(lireRampe("cg-glob-h220"));

console.log("CONTROLE DE L'ESTIMATEUR PAR INTERPOLATION");
console.log("");
console.log("Quatre rampes fabriquees sous une SEULE loi, aux profils de chroma REELS de");
console.log("sat20 / sat60 / sat100 / globale. La verite est celle de la colonne « pose ».");
console.log("");
console.log("loi        rotation posee  k    brut   estime a (L,c) egaux   erreur de l'estimateur");
console.log("".padEnd(100, "-"));
for (const espace of ["PPLIN", "SRGBLIN"]) {
  for (const rot of [0, 6, -10]) {
    const S = {};
    for (const s of [20, 60, 100]) S[s] = lire(fabriquer(espace, 220, PROFIL[s], 0));
    const G = lire(fabriquer(espace, 220, PG, rot));
    const r = estimer(S, G);
    if (r.length < 5) { console.log("%s %s   trop peu de niveaux encadres (%d)", espace.padEnd(10), String(rot).padStart(14), r.length); continue; }
    const m = r.reduce((s, x) => s + x.d, 0) / r.length;
    const b = r.reduce((s, x) => s + x.brut, 0) / r.length;
    console.log("%s %s %s %s %s %s",
      espace.padEnd(10), ((rot >= 0 ? "+" : "") + rot).padStart(14), String(r.length).padStart(4),
      b.toFixed(1).padStart(7), m.toFixed(1).padStart(22), (m - rot).toFixed(1).padStart(24));
  }
}
console.log("");
console.log("Colonne « erreur » = ce que mon estimateur invente. Elle doit tenir sous le");
console.log("plancher de bruit (1,28 a 2,51 deg) pour que le chiffre de 5,4 a 5,9 deg");
console.log("mesure sur les VRAIES donnees veuille dire quelque chose.");
console.log("");
console.log("Meme controle, par tranche de niveau, loi unique (rotation posee = 0) :");
console.log("");
for (const espace of ["PPLIN", "SRGBLIN"]) {
  const S = {};
  for (const s of [20, 60, 100]) S[s] = lire(fabriquer(espace, 220, PROFIL[s], 0));
  const G = lire(fabriquer(espace, 220, PG, 0));
  const r = estimer(S, G);
  const l = [espace.padEnd(10)];
  for (const [a, b] of [[0, 51], [51, 102], [102, 153], [153, 204], [204, 256]]) {
    const q = r.filter((x) => x.n >= a && x.n < b);
    l.push(q.length >= 3 ? (q.reduce((s, x) => s + x.d, 0) / q.length).toFixed(1).padStart(9) : "        -");
  }
  console.log("%s %s %s %s %s %s", ...l);
}
console.log("%s %s %s %s %s %s", "tranches :".padEnd(10), "0-50".padStart(9), "51-101".padStart(9),
  "102-152".padStart(9), "153-203".padStart(9), "204-255".padStart(9));
console.log("");
console.log("Pour memoire, les VRAIES donnees aux memes tranches : +4,5  +7,2  +5,6  +5,4  +3,1");
