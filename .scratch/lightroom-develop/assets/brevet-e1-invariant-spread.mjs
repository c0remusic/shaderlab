// E1 — QUELLE GRANDEUR EST CONSERVEE ? Test par HUE-SPREAD, sans parametre.
//
// Les onze scenes st-h* partagent Balance -100, Fusion 50, sat 60 : seule la
// TEINTE change. Un operateur qui conserve la grandeur J (chaque cubique par canal
// verifie J(C(u)) = u) donne J(sortie) = phi(x), ou phi est la deformation
// d'abscisse de la balance — la MEME pour les onze teintes. Donc :
//
//   la vraie grandeur J* a un ecart de niveau-equivalent INDEPENDANT de la teinte
//   (il ne reste que phi) ; une fausse grandeur a un ecart qui DEPEND de la teinte.
//
// On mesure donc, par candidate et par niveau, l'ECART-TYPE de l'ecart a travers
// les onze teintes. Le gagnant minimise cet ecart-type (pas forcement l'ecart
// moyen, qui porte la balance). Metrique de decision : ecart-type moyen sur les
// niveaux, en niveaux sRGB.
//
// CONTROLE : une rampe FABRIQUEE en conservant une grandeur connue doit designer
// cette grandeur (spread ~ plancher de quantification), et une AUTRE grandeur doit
// montrer un spread franchement plus grand.
import { s2l, l2s, niveau, ap, SRGB_VERS_PP, PP_VERS_SRGB, PP_XYZ, SRGB_XYZ65, pentes, hermite, charge, lisible } from "./brevet-commun.mjs";

const pp = (lin) => ap(SRGB_VERS_PP, lin);
const dot = (w, v) => w[0] * v[0] + w[1] * v[1] + w[2] * v[2];
const lumHSL = (v) => (Math.max(...v) + Math.min(...v)) / 2;
const g = (gam) => (v) => Math.sign(v) * Math.pow(Math.abs(v), 1 / gam);
const enc = (v) => Math.sign(v) * l2s(Math.abs(v));

// Candidates : sRGB LINEAIRE -> scalaire croissant sur le gris.
const CANDIDATES = [
  ["Y ProPhoto lin", (l) => dot(PP_XYZ[1], pp(l))],
  ["Rec601 en ProPhoto lin", (l) => dot([0.299, 0.587, 0.114], pp(l))],
  ["w' [.314,.580,.106] PP lin", (l) => dot([0.314, 0.580, 0.106], pp(l))],
  ["Y Rec709 lin", (l) => dot(SRGB_XYZ65[1], l)],
  ["moyenne ProPhoto lin", (l) => { const p = pp(l); return (p[0] + p[1] + p[2]) / 3; }],
  ["HSL lightness ProPhoto lin", (l) => lumHSL(pp(l))],
  ["HSL lightness ProPhoto g1.8", (l) => lumHSL(pp(l).map(g(1.8)))],
  ["HSL lightness ProPhoto g2.2", (l) => lumHSL(pp(l).map(g(2.2)))],
  ["HSL lightness sRGB encode", (l) => lumHSL(l.map(enc))],
  ["HSL lightness sRGB lin", (l) => lumHSL(l)],
  ["HSV value ProPhoto lin (max)", (l) => Math.max(...pp(l))],
];

function equiv(f, val) {
  let lo = 0, hi = 1;
  for (let i = 0; i < 50; i++) { const m = (lo + hi) / 2; if (f([m, m, m]) < val) lo = m; else hi = m; }
  return 255 * l2s((lo + hi) / 2);
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
const NIV = [8, 16, 24, 32, 48, 64, 96, 128, 160, 192, 224];

function spread(scenes) {
  // scenes : [{h, rampe}]. Rend, par candidate : ecart-type moyen (sur niveaux) de
  // l'ecart niveau-equivalent a travers les teintes, et ecart moyen (la balance).
  return CANDIDATES.map(([, f]) => {
    let sStd = 0, nStd = 0, sMoy = 0;
    for (const n of NIV) {
      const ec = [];
      for (const { rampe } of scenes) {
        if (!lisible(rampe[n])) continue;
        const l = rampe[n].map((c) => s2l(c / 255));
        ec.push(equiv(f, f(l)) - n);
      }
      if (ec.length < 6) continue; // niveau trop ecrete pour juger le spread
      const moy = ec.reduce((a, b) => a + b, 0) / ec.length;
      const varr = ec.reduce((a, b) => a + (b - moy) * (b - moy), 0) / ec.length;
      sStd += Math.sqrt(varr); sMoy += moy; nStd++;
    }
    return { std: sStd / nStd, moy: sMoy / nStd, nNiv: nStd };
  });
}

function imprime(titre, scenes) {
  console.log("");
  console.log(titre);
  const r = spread(scenes);
  const best = r.reduce((b, v, k) => (v.std < r[b].std ? k : b), 0);
  console.log("candidate".padEnd(32) + "spread(std)".padStart(12) + "biais(moy)".padStart(12));
  r.forEach((v, k) => {
    console.log(CANDIDATES[k][0].padEnd(32) + ((k === best ? "*" : " ") + v.std.toFixed(3)).padStart(12) + v.moy.toFixed(2).padStart(12));
  });
}

// ── CONTROLES : rampes fabriquees en conservant une grandeur connue ──────────
const quant = (lin) => lin.map((v) => Math.round(niveau(v) * 100) / 100);
function rampeFab(h, S, invariance) {
  const s0 = pentes(h, S, PP_XYZ[1], invariance);
  return Array.from({ length: 256 }, (_, i) => {
    const x = s2l(i / 255);
    return quant(ap(PP_VERS_SRGB, [0, 1, 2].map((c) => hermite(x, s0[c], 1))));
  });
}
imprime("CONTROLE A — rampes conservant Y ProPhoto (doit designer #1, spread minimal)",
  TEINTES.map((h) => ({ h, rampe: rampeFab(h, 0.6, "luminance") })));
imprime("CONTROLE B — rampes conservant la lumiere HSL (doit designer une HSL lightness)",
  TEINTES.map((h) => ({ h, rampe: rampeFab(h, 0.6, "lumiere") })));

// ── MESURES ──────────────────────────────────────────────────────────────────
imprime("MESURES LIGHTROOM — st-h* (spread minimal = grandeur conservee)",
  TEINTES.map((h) => ({ h, rampe: charge(`st-h${String(h).padStart(3, "0")}`).rampe_rgb })));
