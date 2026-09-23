// REFUTATION E3 — la FORME du profil, jugee en NIVEAUX sRGB (la metrique qui decide).
//
// L'E3 affirme : le profil d'une roue est une CUBIQUE D'HERMITE clouee du brevet,
// et "la PLAGE place le sommet (MapAlpha par roue)". Les scripts E3 ne l'ont JAMAIS
// juge en niveaux : brevet-e3-modele injecte le profil MESURE de st-duo comme
// canonique (tautologique pour la forme) et n'y teste que la BALANCE. La seule
// mesure en niveaux de la forme vient de brevet-courbes (cubique a 6 pentes LIBRES).
//
// Ici je teste trois choses, toutes en niveaux sRGB, 3 canaux, niveaux lisibles :
//  (A) le modele CONTRAINT du brevet (direction = motif ProPhoto + invariance Y
//      ProPhoto, une seule amplitude S libre) reproduit-il chaque roue ? dans quel
//      espace ? — le brevet a une pente par bout, pas six pentes libres.
//  (B) la roue MOYENS (midtone, hors du brevet qui ne connait que ombres/hautes)
//      est-elle une cubique du brevet dont un MapAlpha (divMap sur l'abscisse, ou
//      conjugaison D^-1 o C o D) a glisse le sommet au centre ? scan de a et S.
//  (C) pouvoir de l'instrument ajusteForme : distingue-t-il une cubique d'Hermite
//      d'une cloche NON cubique de meme sommet ? (borne du controle de brevet-e3-profils)
import { s2l, l2s, ap, PP_VERS_SRGB, PP_XYZ, oklab, pentes, hermite, motif, charge, lisible } from "./brevet-commun.mjs";

const renduNiveaux = (pp) => ap(PP_VERS_SRGB, pp).map((v) => 255 * l2s(Math.max(0, Math.min(1, v))));
const chromaOk = (rgbNiv) => { const l = oklab(rgbNiv.map((c) => s2l(c / 255))); return Math.hypot(l[1], l[2]); };

// Espaces ou l'abscisse de la cubique peut vivre. La cubique agit sur X(espace),
// puis on repasse en lineaire ProPhoto pour composer les canaux.
const g = (gam) => ({ code: (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / gam), decode: (v) => Math.sign(v) * Math.pow(Math.abs(v), gam) });
const ESP = {
  "lineaire": { code: (v) => v, decode: (v) => v },
  "gamma 1,8": g(1.8),
  "gamma 2,2": g(2.2),
  "sRGB(Melissa)": { code: (v) => Math.sign(v) * l2s(Math.abs(v)), decode: (v) => Math.sign(v) * s2l(Math.abs(v)) },
};

// Ecart moyen en niveaux (3 canaux) entre une rampe rendue et la mesure.
function ecartNiveaux(rampeMes, rendreNiv) {
  let s = 0, n = 0;
  for (let i = 3; i <= 252; i++) {
    if (!lisible(rampeMes[i])) continue;
    const out = rendreNiv(i);
    for (let c = 0; c < 3; c++) s += Math.abs(out[c] - rampeMes[i][c]);
    n++;
  }
  return n ? s / (3 * n) : NaN;
}

// (A) modele CONTRAINT du brevet : hue -> pentes (motif ProPhoto + Y ProPhoto), amplitude S.
//     ombres : s0 = pentes(h,S), s1 = 1.  hautes : s0 = 1, s1 = pentes(h+180,S).
function rampeBrevet(h, S, cote, espace) {
  const E = ESP[espace];
  const s0 = cote === "ombres" ? pentes(h, S, PP_XYZ[1]) : [1, 1, 1];
  const s1 = cote === "hautes" ? pentes(h + 180, S, PP_XYZ[1]) : [1, 1, 1];
  return (i) => {
    const X = E.code(s2l(i / 255));              // abscisse dans l'espace de la cubique
    const y = [0, 1, 2].map((c) => hermite(X, s0[c], s1[c]));
    const pp = y.map((v) => E.decode(v));         // retour en lineaire ProPhoto
    return renduNiveaux(pp);
  };
}
// meilleure amplitude S (grille) et meilleur espace pour une roue simple.
function meilleurBrevet(rampeMes, h, cote) {
  let best = { e: Infinity };
  for (const espace of Object.keys(ESP)) {
    for (let S = 0.1; S <= 0.98; S += 0.02) {
      const e = ecartNiveaux(rampeMes, rampeBrevet(h, S, cote, espace));
      if (e < best.e) best = { e, S: +S.toFixed(2), espace };
    }
  }
  return best;
}

console.log("=== (A) MODELE CONTRAINT DU BREVET (une amplitude S, une pente par bout) en niveaux sRGB ===");
console.log("roue            hue cote      meilleur S   espace         ecart(niveaux)   [rappel brevet-courbes 6-pentes-libres]");
const A = [
  ["st-ombres-bleu", 220, "ombres", "2.15 (g2.2)"],
  ["st-hl-orange", 40, "hautes", "1.11 (lin)"],
  ["cg-glob-h040", 40, "ombres", "0.37 (g1.8)"],   // globale ~ ombres pleine rampe
  ["cg-glob-h220", 220, "ombres", "0.35 (lin)"],
];
for (const [scene, h, cote, rappel] of A) {
  const r = charge(scene)?.rampe_rgb; if (!r) continue;
  const b = meilleurBrevet(r, h, cote);
  console.log(scene.padEnd(16) + String(h).padStart(3) + " " + cote.padEnd(8) + String(b.S).padStart(9) + "   " + b.espace.padEnd(14) + b.e.toFixed(2).padStart(10) + "        " + rappel);
}

console.log("");
console.log("=== (B) LA ROUE MOYENS EST-ELLE UNE CUBIQUE DU BREVET GLISSEE PAR UN MapAlpha ? ===");
console.log("Le brevet ne connait QUE ombres (sommet ~1/3) et hautes (~2/3). Une roue midtone");
console.log("centree (~1/2) doit venir d'un MapAlpha (divMap) sur l'abscisse. Scan a x S x espace x cote.");
const divMap = (x, a) => (a * x) / (a * x + 1 - x);
function rampeMoyensConj(h, S, a, cote, espace, mode) {
  const E = ESP[espace];
  const s0 = cote === "ombres" ? pentes(h, S, PP_XYZ[1]) : [1, 1, 1];
  const s1 = cote === "hautes" ? pentes(h + 180, S, PP_XYZ[1]) : [1, 1, 1];
  return (i) => {
    let X = E.code(s2l(i / 255));
    X = divMap(X, a);                                  // C o D : remap de l'abscisse
    let y = [0, 1, 2].map((c) => hermite(X, s0[c], s1[c]));
    if (mode === "conj") y = y.map((v) => divMap(v, 1 / a)); // D^-1 o C o D : + demap de l'ordonnee
    const pp = y.map((v) => E.decode(v));
    return renduNiveaux(pp);
  };
}
{
  const r = charge("grading-moyens-vert").rampe_rgb;
  let best = { e: Infinity };
  for (const cote of ["ombres", "hautes"]) {
    for (const mode of ["remap", "conj"]) {
      for (const espace of Object.keys(ESP)) {
        for (let S = 0.2; S <= 0.98; S += 0.04) {
          for (let a = 0.2; a <= 5; a *= 1.15) {
            const e = ecartNiveaux(r, rampeMoyensConj(140, S, a, cote, espace, mode));
            if (e < best.e) best = { e, S: +S.toFixed(2), a: +a.toFixed(2), cote, espace, mode };
          }
        }
      }
    }
  }
  console.log("grading-moyens-vert : meilleure cubique-glissee  ecart=%s niveaux  (S=%s a=%s %s %s %s)",
    best.e.toFixed(2), best.S, best.a, best.cote, best.espace, best.mode);
  console.log("  rappel brevet-courbes : meilleure cubique 6-pentes-libres = 5.50 niveaux (\"pas une cubique\")");
  console.log("  plancher 8 bits ~ 0.29 ; globale ~ 0.37. Un ecart >> plancher = le mecanisme NE reproduit PAS la roue.");
}

console.log("");
console.log("=== (C) POUVOIR DE ajusteForme : cubique d'Hermite vs cloche NON cubique de MEME sommet ===");
// meme direction (motif ProPhoto h220), meme sommet vise, formes sous-jacentes differentes.
function ajuste(niv, ch, X) {
  const pts = [];
  for (let k = 0; k < niv.length; k++) { const x = X(niv[k]), c = ch[k]; if (c <= 0.004 || x <= 1e-4 || x >= 1 - 1e-4) continue; pts.push([Math.log(x), Math.log(1 - x), Math.log(c), c * c]); }
  let S = new Array(9).fill(0), rhs = [0, 0, 0];
  for (const [lx, l1, lc, w] of pts) { const gg = [1, lx, l1]; for (let a = 0; a < 3; a++) { for (let b = 0; b < 3; b++) S[a * 3 + b] += w * gg[a] * gg[b]; rhs[a] += w * gg[a] * lc; } }
  const m = [[S[0], S[1], S[2], rhs[0]], [S[3], S[4], S[5], rhs[1]], [S[6], S[7], S[8], rhs[2]]];
  for (let c = 0; c < 3; c++) { let p = c; for (let i = c + 1; i < 3; i++) if (Math.abs(m[i][c]) > Math.abs(m[p][c])) p = i;[m[c], m[p]] = [m[p], m[c]]; for (let i = 0; i < 3; i++) if (i !== c) { const f = m[i][c] / m[c][c]; for (let j = c; j < 4; j++) m[i][j] -= f * m[c][j]; } }
  const p = m[1][3] / m[1][1], q = m[2][3] / m[2][2];
  return { p, q, sommet: p / (p + q) };
}
const X18 = (n) => Math.sign(s2l(n / 255)) * Math.pow(Math.abs(s2l(n / 255)), 1 / 1.8);
// direction ProPhoto de la roue ombres 220
const dir = pentes(220, 0.6, PP_XYZ[1]).map((c) => c - 1);
// (a) cubique d'Hermite en gamma 1,8 : offset = poids . dir avec poids = X(1-X)^2 (sommet 1/3 en g1,8)
// (b) cloche NON cubique de meme sommet 1/3 : poids = beta X^1(1-X)^5 (plus etroite), remise a l'echelle
// (c) cloche NON cubique plus large : poids = X^0.5 (1-X)^1
function rampePoids(poids) {
  return Array.from({ length: 256 }, (_, i) => {
    const Xg = X18(i); const w = poids(Math.min(1, Math.max(0, Xg)));
    const ppDev = dir.map((d) => 0.12 * w * d);
    const base = s2l(i / 255);
    const pp = [0, 1, 2].map((c) => base + ppDev[c]);
    return renduNiveaux(pp);
  });
}
function litForme(nom, rampe) {
  const niv = [], ch = [];
  for (let i = 3; i <= 252; i++) { if (!lisible(rampe[i])) continue; niv.push(i); ch.push(chromaOk(rampe[i])); }
  const f = ajuste(niv, ch, X18);
  console.log("  " + nom.padEnd(34) + "p=" + f.p.toFixed(2) + " q=" + f.q.toFixed(2) + " sommet(g1,8)=" + f.sommet.toFixed(3));
}
litForme("Hermite cubique X(1-X)^2 (sommet1/3)", rampePoids((x) => x * (1 - x) * (1 - x)));
litForme("bell etroite X(1-X)^5 (meme cote)", rampePoids((x) => x * Math.pow(1 - x, 5)));
litForme("bell large X^0.5(1-X)^1", rampePoids((x) => Math.pow(x, 0.5) * (1 - x)));
litForme("gaussienne centre 0.28 sigma .12", rampePoids((x) => Math.exp(-((x - 0.28) ** 2) / (2 * 0.12 * 0.12))));
console.log("  -> si p,q different nettement, l'instrument distingue la FORME (pas seulement le sommet).");
console.log("  -> s'ils se ressemblent, le controle de brevet-e3-profils ne prouve que 'cloche interieure', pas 'Hermite'.");
