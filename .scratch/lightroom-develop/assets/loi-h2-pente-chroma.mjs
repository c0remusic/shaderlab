// LA MESURE QU'IL AVAIT SUR DISQUE ET N'A PAS OUVERTE
//
// Sa section 9 dit que les deux roues ne se recouvrent en (L, chroma) que dans la
// QUEUE (L 0,70-0,95), et que « la non-existence de paires [dans les tons moyens]
// est structurelle, pas un manque de donnees ». C'est vrai de l'APPARIEMENT PAR
// COINCIDENCE. Ce n'est pas vrai de la question.
//
// Il manque une seule chose pour comparer les deux roues a chroma egale DANS LES
// TONS MOYENS : la MEME roue mesuree a plusieurs amplitudes. Elle est sur disque.
//   st-ombres-sat20   : SplitToningShadowHue=220, Saturation=20,  Balance=-100
//   st-h220           : idem, Saturation=60
//   st-ombres-sat100  : idem, Saturation=100
// Trois amplitudes, meme roue, meme teinte, meme balance, meme pixel d'entree.
//
// LE GESTE. A chaque niveau n, la chroma de la roue GLOBALE tombe ENTRE celle de
// la roue des ombres a sat=20 et a sat=60. On INTERPOLE donc l'angle de la roue
// des ombres a la chroma exacte de la roue globale — interpolation, jamais
// extrapolation, aucune hypothese de linearite au-dela de deux points voisins.
// La difference qui reste est mesuree a MEME NIVEAU D'ENTREE et MEME CHROMA :
// le test que sa section 9 fait, mais partout, au lieu de la seule queue.
//
// CONTROLE OBLIGATOIRE : la methode doit reproduire SON chiffre (+3,9 deg) dans
// SA zone d'appariement. Si elle ne le fait pas, elle ne mesure pas la meme chose
// et ce qu'elle dit ailleurs ne vaut rien.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };

const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const angleProPhotoLineaire = (h) =>
  deg(...linearSrgbToOklab(ap(XS, ap(PP, hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5)))).slice(1));

function niveaux(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) { console.log("MANQUE : %s", nom); process.exit(1); }
  return JSON.parse(readFileSync(f, "utf8")).rampe_rgb.map((v, n) => {
    const lab = linearSrgbToOklab(v.map((x) => srgbToLinear(x / 255)));
    const ent = v.map((x) => Math.round(x));
    return { n, L: lab[0], c: Math.hypot(lab[1], lab[2]), angle: deg(lab[1], lab[2]),
      ecrete: ent.some((x) => x <= 0 || x >= 255) };
  });
}
const S = { 20: niveaux("st-ombres-sat20"), 60: niveaux("st-h220"), 100: niveaux("st-ombres-sat100") };
const G = niveaux("cg-glob-h220");
const REF = angleProPhotoLineaire(220);

/** Angle de la roue des OMBRES au niveau n, interpole a la chroma `cible`.
 *  Rend null si la cible n'est pas ENCADREE par deux saturations mesurees. */
function ombresA(n, cible, seuil) {
  const pts = [20, 60, 100].map((s) => S[s][n])
    .filter((p) => !p.ecrete && p.c >= seuil)
    .sort((a, b) => a.c - b.c);
  for (let i = 0; i + 1 < pts.length; i++) {
    const p = pts[i], q = pts[i + 1];
    if (cible >= p.c && cible <= q.c) {
      const t = (cible - p.c) / (q.c - p.c);
      return { angle: p.angle + t * ecartAngle(q.angle, p.angle), L: p.L + t * (q.L - p.L), entre: [p.c, q.c] };
    }
  }
  return null;
}

function tableau(seuil, titre) {
  console.log("");
  console.log("── %s   (seuil de chroma %s)", titre, seuil);
  console.log("");
  console.log("tranche n   k    L glob  L omb interp  c commune   angle glob  angle omb  DIFF a (L,c) egaux   brut");
  console.log("".padEnd(112, "-"));
  const bornes = [[0, 51], [51, 102], [102, 153], [153, 204], [204, 256]];
  let sd = 0, sb = 0, sk = 0;
  const parTranche = [];
  for (const [a, b] of bornes) {
    const q = [];
    for (let n = a; n < b; n++) {
      const g = G[n];
      if (g.ecrete || g.c < seuil) continue;
      const o = ombresA(n, g.c, seuil);
      if (!o) continue;
      q.push({ n, g, o, brut: ecartAngle(g.angle, S[60][n].angle) });
    }
    if (q.length < 3) { console.log("%s %s   (moins de 3 niveaux encadres)", (a + "-" + (b - 1)).padEnd(11), String(q.length).padStart(3)); continue; }
    const moy = (f) => q.reduce((s, r) => s + f(r), 0) / q.length;
    const d = moy((r) => ecartAngle(r.g.angle, r.o.angle));
    const brut = moy((r) => r.brut);
    parTranche.push({ a, b, k: q.length, L: moy((r) => r.g.L), d, brut });
    sd += d * q.length; sb += brut * q.length; sk += q.length;
    console.log("%s %s %s %s %s %s %s %s %s",
      (a + "-" + (b - 1)).padEnd(11), String(q.length).padStart(3),
      moy((r) => r.g.L).toFixed(3).padStart(7), moy((r) => r.o.L).toFixed(3).padStart(13),
      moy((r) => r.g.c).toFixed(4).padStart(11),
      moy((r) => r.g.angle).toFixed(1).padStart(12), moy((r) => r.o.angle).toFixed(1).padStart(10),
      ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(20),
      ((brut >= 0 ? "+" : "") + brut.toFixed(1)).padStart(7));
  }
  if (sk) {
    console.log("");
    console.log("  ENSEMBLE %d niveaux : brut %s deg -> a (L, chroma) egaux %s deg",
      sk, (sb / sk).toFixed(1), (sd / sk).toFixed(1));
    console.log("  la correction de chroma retire %s deg sur %s, soit %s %% — SON chiffre dit 61 %%.",
      (sb / sk - sd / sk).toFixed(1), (sb / sk).toFixed(1),
      (100 * (1 - (sd / sk) / (sb / sk))).toFixed(0));
  }
  return parTranche;
}

console.log("LES DEUX ROUES A (L, CHROMA) EGAUX — PARTOUT, PAS SEULEMENT DANS LA QUEUE");
console.log("");
console.log("Teinte 220. Reference ProPhoto lineaire = %s deg.", REF.toFixed(1));
tableau(0.02, "seuil de chroma de son script");
tableau(0.012, "seuil abaisse — controle de robustesse");

// ── LE CONTROLE : SA ZONE ───────────────────────────────────────────────────
console.log("");
console.log("CONTROLE DE LA METHODE — SA zone d'appariement");
console.log("");
console.log("Son appariement (tol 0,04 / 0,004) vit sur les niveaux 177-205 cote ombres et");
console.log("173-222 cote globale, L moyen 0,795, et rend +3,9 deg. La methode par");
console.log("interpolation doit y retrouver le meme nombre.");
console.log("");
for (const [a, b, seuil] of [[173, 222, 0.012], [173, 222, 0.008], [153, 203, 0.012]]) {
  const q = [];
  for (let n = a; n <= b; n++) {
    const g = G[n];
    if (g.ecrete || g.c < seuil) continue;
    const o = ombresA(n, g.c, seuil);
    if (!o) continue;
    q.push({ g, o, brut: ecartAngle(g.angle, S[60][n].angle) });
  }
  if (q.length < 3) { console.log("  n %d-%d (seuil %s) : %d niveaux — insuffisant", a, b, seuil, q.length); continue; }
  const moy = (f) => q.reduce((s, r) => s + f(r), 0) / q.length;
  console.log("  n %d-%d (seuil %s) : %d niveaux, L %s, brut %s deg, a (L,c) egaux %s deg",
    a, b, seuil, q.length, moy((r) => r.g.L).toFixed(3),
    moy((r) => r.brut).toFixed(1),
    moy((r) => ecartAngle(r.g.angle, r.o.angle)).toFixed(1));
}

// ── LA DIFFERENCE EST-ELLE UNE FONCTION DE L ? ──────────────────────────────
console.log("");
console.log("LA DIFFERENCE A (L, CHROMA) EGAUX, NIVEAU PAR NIVEAU — est-elle constante ?");
console.log("");
const serie = [];
for (let n = 0; n <= 255; n++) {
  const g = G[n];
  if (g.ecrete || g.c < 0.012) continue;
  const o = ombresA(n, g.c, 0.012);
  if (!o) continue;
  serie.push({ n, L: g.L, d: ecartAngle(g.angle, o.angle) });
}
if (serie.length > 4) {
  const mL = serie.reduce((s, x) => s + x.L, 0) / serie.length;
  const mD = serie.reduce((s, x) => s + x.d, 0) / serie.length;
  let num = 0, den = 0;
  for (const x of serie) { num += (x.L - mL) * (x.d - mD); den += (x.L - mL) ** 2; }
  const pente = num / den;
  console.log("  %d niveaux, L de %s a %s", serie.length,
    Math.min(...serie.map((x) => x.L)).toFixed(3), Math.max(...serie.map((x) => x.L)).toFixed(3));
  console.log("  difference = %s + %s * (L - %s)   ->  a L=0,40 : %s deg ; a L=0,60 : %s deg ; a L=0,80 : %s deg",
    mD.toFixed(1), pente.toFixed(1), mL.toFixed(2),
    (mD + pente * (0.4 - mL)).toFixed(1), (mD + pente * (0.6 - mL)).toFixed(1), (mD + pente * (0.8 - mL)).toFixed(1));
  console.log("");
  console.log("  Une difference qui DEPEND de L n'a pas une valeur unique. Son +3,9 deg est");
  console.log("  la valeur de cette fonction a L=0,795 — le seul endroit ou des paires");
  console.log("  fortuites existent, et le minimum de la courbe sur la plage utile.");
}

// ── RESIDU DE CHAQUE ROUE CONTRE LA LOI EN TETE ────────────────────────────
console.log("");
console.log("RESIDU CONTRE ProPhoto LINEAIRE, A CHROMA EGALE (seuil 0,012)");
console.log("");
console.log("tranche n   k   L moyen   ombres (interp. a la chroma globale)   globale   ecart");
console.log("".padEnd(92, "-"));
for (const [a, b] of [[51, 102], [102, 153], [153, 204], [204, 256]]) {
  const q = [];
  for (let n = a; n < b; n++) {
    const g = G[n];
    if (g.ecrete || g.c < 0.012) continue;
    const o = ombresA(n, g.c, 0.012);
    if (o) q.push({ g, o });
  }
  if (q.length < 3) continue;
  const moy = (f) => q.reduce((s, r) => s + f(r), 0) / q.length;
  const ro = ecartAngle(moy((r) => r.o.angle), REF), rg = ecartAngle(moy((r) => r.g.angle), REF);
  console.log("%s %s %s %s %s %s",
    (a + "-" + (b - 1)).padEnd(11), String(q.length).padStart(3), moy((r) => r.g.L).toFixed(3).padStart(8),
    ((ro >= 0 ? "+" : "") + ro.toFixed(1)).padStart(38),
    ((rg >= 0 ? "+" : "") + rg.toFixed(1)).padStart(10),
    ((rg - ro >= 0 ? "+" : "") + (rg - ro).toFixed(1)).padStart(8));
}
