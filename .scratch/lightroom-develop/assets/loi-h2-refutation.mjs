// REFUTATION DE L'HYPOTHESE 2 — ON CONTROLE L'INSTRUMENT SUR UNE REPONSE CONNUE
//
// CE QUE loi-h2-roue.mjs CONCLUT. Que l'ecretage est mort (vrai, et reproduit),
// que l'ECHANTILLONNAGE en (L, chroma) porte 70 % et 61 % de la divergence entre
// roues, et qu'il reste ~4 deg REELS apres appariement sur (L, chroma) — donc
// que le postulat « une seule loi » est entame.
//
// CE QUI MANQUE. Sa machinerie d'appariement (sections 9 et 11) n'a JAMAIS ete
// eprouvee sur une reponse connue. Son controle existant
// (loi-de-teinte-controle.mjs) eprouve le CLASSEUR DE FAMILLES, pas l'appariement.
// Or la question que l'appariement doit trancher est exactement : « deux roues
// sous UNE SEULE loi peuvent-elles rendre une difference non nulle ? »
//
// LE CONTROLE. On FABRIQUE deux roues sous UNE SEULE loi, en leur donnant le
// profil (L, chroma) REEL des deux roues mesurees — bissection de l'amplitude,
// niveau par niveau, jusqu'a retrouver la chroma observee. On passe ensuite ces
// rampes synthetiques dans SON lecteur et dans SES sections 3, 9 et 11, copies
// ligne pour ligne. La verite est connue : la difference entre roues vaut ZERO.
// Tout ce que son pipeline rapporte au-dessus de zero est son propre artefact.
//
// CONTROLE INVERSE. On refait le meme exercice avec DEUX lois separees d'un
// angle CONNU (+8 deg sur la roue globale). Si l'appariement ne rend pas ~8, il
// ne mesure pas ce qu'il pretend mesurer.
//
// TROIS LOIS GENERATRICES, toutes UNIQUES (la meme pour les deux roues) :
//   OKLAB   — addition du vecteur en OKLab. Angle constant par construction :
//             c'est l'etalon zero, il valide le generateur et le lecteur.
//   SRGBLIN — addition en sRGB lineaire. Angle lu en OKLab depend de L.
//   PPLIN   — addition en ProPhoto lineaire, la famille en tete du classement.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;

// ── SES OUTILS, COPIES LIGNE POUR LIGNE ─────────────────────────────────────
function niveauxDeRampe(rgb) {
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const v = rgb[n];
    const lin = [srgbToLinear(v[0] / 255), srgbToLinear(v[1] / 255), srgbToLinear(v[2] / 255)];
    const lab = linearSrgbToOklab(lin);
    const c = Math.hypot(lab[1], lab[2]);
    const ent = v.map((x) => Math.round(x));
    const bas = ent.some((x) => x <= 0);
    const haut = ent.some((x) => x >= 255);
    out.push({ n, L: lab[0], a: lab[1], b: lab[2], c, angle: deg(lab[1], lab[2]), bas, haut, ecrete: bas || haut });
  }
  return out;
}
function niveaux(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  return niveauxDeRampe(JSON.parse(readFileSync(f, "utf8")).rampe_rgb);
}
function resume(pts) {
  if (pts.length === 0) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.c * Math.cos(rad(p.angle)); sy += p.c * Math.sin(rad(p.angle)); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(pts.reduce((s, p) => s + ecartAngle(p.angle, moyen) ** 2, 0) / pts.length);
  return { k: pts.length, moyen, et, cMoy: pts.reduce((s, p) => s + p.c, 0) / pts.length };
}
/** SA section 9, telle quelle : produit cartesien sous tolerance sur (L, chroma). */
function apparier(ombres, globale, tolL, tolC) {
  const ds = [];
  for (const pg of globale) for (const po of ombres) {
    if (Math.abs(pg.L - po.L) > tolL) continue;
    if (Math.abs(pg.c - po.c) > tolC) continue;
    ds.push({ d: ecartAngle(pg.angle, po.angle), L: (pg.L + po.L) / 2, c: (pg.c + po.c) / 2, ng: pg.n, no: po.n });
  }
  if (ds.length === 0) return null;
  const m = ds.reduce((s, x) => s + x.d, 0) / ds.length;
  return {
    k: ds.length, m,
    L: ds.reduce((s, x) => s + x.L, 0) / ds.length,
    c: ds.reduce((s, x) => s + x.c, 0) / ds.length,
    ng: new Set(ds.map((x) => x.ng)).size,
    no: new Set(ds.map((x) => x.no)).size,
    ds,
  };
}

// ── LES LOIS GENERATRICES ───────────────────────────────────────────────────
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const SX = [[0.4360747, 0.3850649, 0.1430804], [0.2225045, 0.7168786, 0.0606169], [0.0139322, 0.0971045, 0.7141733]];
const XP = [[1.3459433, -0.2556075, -0.0511118], [-0.5445989, 1.5081673, 0.0205351], [0, 0, 1.2118128]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const oter = (v) => { const y = 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; return [v[0] - y, v[1] - y, v[2] - y]; };

/** Direction unitaire de la teinte dans l'espace demande, luminance retiree. */
function direction(espace, h) {
  const g = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  if (espace === "OKLAB") {
    const lab = linearSrgbToOklab(ap(XS, ap(PP, g)));      // la famille en tete
    const n = Math.hypot(lab[1], lab[2]);
    return [lab[1] / n, lab[2] / n];
  }
  if (espace === "SRGBLIN") {
    const u = oter(g.map(srgbToLinear));
    const n = Math.hypot(...u);
    return u.map((x) => x / n);
  }
  if (espace === "PPLIN") {
    const u = oter(g);                                      // g lu comme ProPhoto lineaire
    const n = Math.hypot(...u);
    return u.map((x) => x / n);
  }
  throw new Error("espace inconnu " + espace);
}
/** Pose l'amplitude A sur le gris de niveau n, rend un triplet sRGB 0-255. */
function poser(espace, u, n, A, quantifier) {
  const g = srgbToLinear(n / 255);
  let lin;
  if (espace === "OKLAB") {
    const lab = linearSrgbToOklab([g, g, g]);
    lin = oklabToLinearSrgb([lab[0], lab[1] + A * u[0], lab[2] + A * u[1]]);
  } else if (espace === "SRGBLIN") {
    lin = [g + A * u[0], g + A * u[1], g + A * u[2]];
  } else {
    const p = ap(XP, ap(SX, [g, g, g]));                    // gris -> ProPhoto lineaire
    const q = [p[0] + A * u[0], p[1] + A * u[1], p[2] + A * u[2]];
    lin = ap(XS, ap(PP, q));
  }
  const huit = lin.map((x) => {
    const s = linearToSrgb(x) * 255;
    const b = Math.min(255, Math.max(0, s));
    return quantifier ? Math.round(b) : b;
  });
  return huit;
}
const chromaDe = (huit) => {
  const lab = linearSrgbToOklab(huit.map((x) => srgbToLinear(x / 255)));
  return Math.hypot(lab[1], lab[2]);
};
/** Bissection : l'amplitude qui reproduit EXACTEMENT la chroma observee. */
function amplitudePour(espace, u, n, cible, quantifier) {
  let lo = 0, hi = 0.02;
  for (let i = 0; i < 80 && chromaDe(poser(espace, u, n, hi, quantifier)) < cible; i++) hi *= 1.3;
  if (chromaDe(poser(espace, u, n, hi, quantifier)) < cible) return hi;   // hors de portee : on sature
  for (let i = 0; i < 90; i++) {
    const mid = (lo + hi) / 2;
    if (chromaDe(poser(espace, u, n, mid, quantifier)) < cible) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}
/** Fabrique une rampe synthetique au profil (L, chroma) d'une scene reelle. */
function fabriquer(espace, hGen, scene, quantifier) {
  const u = direction(espace, hGen);
  const rgb = [];
  for (let n = 0; n <= 255; n++) {
    const cible = scene[n].c;
    if (cible < 1e-6) { const g = quantifier ? n : n; rgb.push([g, g, g]); continue; }
    const A = amplitudePour(espace, u, n, cible, quantifier);
    rgb.push(poser(espace, u, n, A, quantifier));
  }
  return niveauxDeRampe(rgb);
}

// ── LES SCENES REELLES, POUR LEUR PROFIL ────────────────────────────────────
const REEL = {};
for (const nom of ["st-h040", "cg-glob-h040", "st-h220", "cg-glob-h220"]) {
  const p = niveaux(nom);
  if (!p) { console.log("MANQUE : %s", nom); process.exit(1); }
  REEL[nom] = p;
}
const utiles = (p) => p.filter((q) => q.c >= SEUIL);
const propres = (p) => utiles(p).filter((q) => !q.ecrete);

console.log("REFUTATION H2 — l'appariement sur (L, chroma) rend-il ZERO quand la loi EST unique ?");
console.log("");
console.log("Deux roues synthetiques par ligne, MEME loi, MEME teinte, et le profil");
console.log("(L, chroma) exact des deux roues reelles. La verite est 0,0 deg partout.");
console.log("");

const TOL = [[0.08, 0.008], [0.04, 0.004], [0.02, 0.002], [0.01, 0.001], [0.005, 0.0005]];

function campagne(titre, espace, hOmbres, hGlobale, quantifier) {
  console.log("── %s   (loi %s, quantification 8 bits : %s)", titre, espace, quantifier ? "OUI" : "non");
  const vrai = ecartAngle(
    (() => { const u = direction(espace, hGlobale); return espace === "OKLAB" ? deg(u[0], u[1]) : 0; })(),
    (() => { const u = direction(espace, hOmbres); return espace === "OKLAB" ? deg(u[0], u[1]) : 0; })());
  console.log("");
  console.log("teinte  brut (sect.3)  appar. 0,04/0,004 (sect.9)   L moyen  paires  niv.omb  niv.glob");
  console.log("".padEnd(96, "-"));
  const garde = {};
  for (const t of [40, 220]) {
    const so = REEL["st-h" + String(t).padStart(3, "0")];
    const sg = REEL["cg-glob-h" + String(t).padStart(3, "0")];
    const fo = fabriquer(espace, t + hOmbres, so, quantifier);
    const fg = fabriquer(espace, t + hGlobale, sg, quantifier);
    garde[t] = { fo, fg };
    const brut = ecartAngle(resume(utiles(fg)).moyen, resume(utiles(fo)).moyen);
    const a = apparier(propres(fo), propres(fg), 0.04, 0.004);
    console.log("%s %s %s %s %s %s %s",
      String(t).padStart(6), brut.toFixed(1).padStart(14),
      a ? ((a.m >= 0 ? "+" : "") + a.m.toFixed(1)).padStart(27) : "aucune paire".padStart(27),
      a ? a.L.toFixed(3).padStart(9) : "-".padStart(9),
      a ? String(a.k).padStart(7) : "-".padStart(7),
      a ? String(a.no).padStart(8) : "-".padStart(8),
      a ? String(a.ng).padStart(9) : "-".padStart(9));
  }
  console.log("");
  console.log("  balayage de tolerance (sa section 11) :");
  console.log("  tol L   tol c     t40: paires  diff  L moyen |  t220: paires  diff  L moyen");
  console.log("  " + "".padEnd(88, "-"));
  for (const [tl, tc] of TOL) {
    const l = [tl.toFixed(3).padStart(7), tc.toFixed(4).padStart(8)];
    for (const t of [40, 220]) {
      const a = apparier(propres(garde[t].fo), propres(garde[t].fg), tl, tc);
      l.push(a ? String(a.k).padStart(12) : "0".padStart(12));
      l.push(a ? ((a.m >= 0 ? "+" : "") + a.m.toFixed(1)).padStart(6) : "     -");
      l.push(a ? a.L.toFixed(3).padStart(8) : "       -");
    }
    console.log("  %s %s %s %s %s | %s %s %s", ...l);
  }
  console.log("");
  return garde;
}

// 1. ETALON ZERO — la loi EST en OKLab, l'angle est constant par construction.
campagne("ETALON ZERO", "OKLAB", 0, 0, true);

// 2. LE CONTROLE QUI MANQUE — une seule loi, non-OKLab, les deux profils reels.
campagne("UNE SEULE LOI, sRGB lineaire", "SRGBLIN", 0, 0, true);
campagne("UNE SEULE LOI, ProPhoto lineaire", "PPLIN", 0, 0, true);
campagne("UNE SEULE LOI, ProPhoto lineaire, SANS quantification", "PPLIN", 0, 0, false);

// 3. CONTROLE INVERSE — deux lois separees de +8 deg sur la roue globale.
campagne("DEUX LOIS a +8 deg (globale decalee), ProPhoto lineaire", "PPLIN", 0, 8, true);
campagne("DEUX LOIS a +8 deg (globale decalee), sRGB lineaire", "SRGBLIN", 0, 8, true);

// ── 4. OU VIT SON ECHANTILLON APPARIE, SUR LES VRAIES DONNEES ───────────────
console.log("── OU VIT SON ECHANTILLON APPARIE — donnees REELLES");
console.log("");
console.log("Sa section 9 dit « le seul test sans confondant ». On regarde de quels");
console.log("niveaux les paires sortent, et combien de niveaux DISTINCTS y participent.");
console.log("");
console.log("tol L   tol c    teinte  paires  niv.omb  niv.glob  L moyen  n omb (min-max)  n glob (min-max)  diff");
console.log("".padEnd(116, "-"));
for (const [tl, tc] of TOL) {
  for (const t of [40, 220]) {
    const o = propres(REEL["st-h" + String(t).padStart(3, "0")]);
    const g = propres(REEL["cg-glob-h" + String(t).padStart(3, "0")]);
    const a = apparier(o, g, tl, tc);
    if (!a) { console.log("%s %s %s   aucune paire", tl.toFixed(3).padStart(6), tc.toFixed(4).padStart(8), String(t).padStart(7)); continue; }
    const no = a.ds.map((x) => x.no), ng = a.ds.map((x) => x.ng);
    console.log("%s %s %s %s %s %s %s %s %s %s",
      tl.toFixed(3).padStart(6), tc.toFixed(4).padStart(8), String(t).padStart(7),
      String(a.k).padStart(7), String(a.no).padStart(8), String(a.ng).padStart(9),
      a.L.toFixed(3).padStart(8),
      (Math.min(...no) + "-" + Math.max(...no)).padStart(16),
      (Math.min(...ng) + "-" + Math.max(...ng)).padStart(17),
      ((a.m >= 0 ? "+" : "") + a.m.toFixed(1)).padStart(6));
  }
}
console.log("");
console.log("Rappel : le niveau moyen pondere de la roue des ombres est 108,8 (h40) et");
console.log("106,2 (h220). Un appariement qui ne vit qu'au-dessus de n=200 ne mesure pas");
console.log("la roue des ombres la ou elle travaille.");
