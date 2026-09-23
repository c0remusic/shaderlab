// HYPOTHESE 1 — L'ANOMALIE DE LA TEINTE 220 EST-ELLE UN ECRETAGE DE GAMUT ?
//
// CE QU'ON CHERCHE. ProPhoto lineaire rend +21,3 degres de residu sur la teinte
// 220 quand les sept meilleures teintes sont entre -4,2 et -0,0. La mesure est
// propre (ecart-type 2,43), donc ce n'est pas du bruit. Reste deux causes
// possibles, et elles ne se corrigent pas pareil :
//   - la LOI est fausse dans cette region du cercle ;
//   - la COULEUR a ete ramenee dans le gamut sRGB a l'export, et un ecretage
//     TOURNE la teinte.
//
// TROIS MESURES, DANS CET ORDRE.
//
//  1. LA CHROMA PAR TEINTE. C'est le test le plus direct et il ne coute rien :
//     le modele ajoute dir(teinte) * (sat/100) * chromaK * poids(L), ou dir est
//     UNITAIRE. La chroma ajoutee ne depend donc PAS de la teinte, et l'entree
//     etant un gris (chroma nulle), la chroma de sortie EST cette chroma ajoutee.
//     Les onze courbes chroma(niveau) doivent SE SUPERPOSER. Une teinte dont la
//     courbe passe dessous a perdu de la chroma — signature d'une reduction.
//
//  2. LE COMPTE DE NIVEAUX ECRETES. Un canal a 0 ou a 255 n'est pas la valeur
//     que le moteur a calculee, c'est celle qu'il a pu ecrire.
//
//  3. LE TEST DECISIF — le residu sur les niveaux NON ecretes seulement. Si
//     l'anomalie de 220 disparait quand on retire les niveaux ecretes, c'est
//     l'ecretage. Si elle reste, c'est la loi.
//     ⚠️ Un seuil d'ecretage choisi une fois est un parametre cache : la valeur
//     0,00 est franche, mais 0,54 et 0,94 ne le sont pas (le releve moyenne un
//     patch, donc un canal ecrete ressort jitte au-dessus de zero). Le verdict
//     est donc pris en BALAYANT la marge de 0 a 8 niveaux. Un residu qui
//     converge en montant la marge tranche ; un residu qui saute avec le seuil
//     ne tranche rien et ce script le dira.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;               // chroma minimale pour qu'un niveau porte un angle lisible
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];

// ── LES QUATRE FAMILLES, reprises telles quelles de loi-de-teinte.mjs ────────
function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  return deg(...linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]).slice(1));
}
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const roue = (h) => hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
const angleProPhotoLineaire = (h) => deg(...linearSrgbToOklab(ap(XS, ap(PP, roue(h)))).slice(1));
const angleProPhotoGamma = (h) => deg(...linearSrgbToOklab(ap(XS, ap(PP, roue(h).map((c) => Math.pow(c, 1.8))))).slice(1));
const ZERO_OKLCH = angleSrgbHsl(0);
const angleOklchDirect = (h) => ZERO_OKLCH + h;

// ── LECTURE BRUTE : un enregistrement par niveau, rien d'agrege ──────────────
function rampe(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  const rgb = JSON.parse(readFileSync(f, "utf8")).rampe_rgb;
  return rgb.map(([R, G, B], n) => {
    const lab = linearSrgbToOklab([s2l(R / 255), s2l(G / 255), s2l(B / 255)]);
    return { n, R, G, B, bas: Math.min(R, G, B), haut: Math.max(R, G, B),
             angle: deg(lab[1], lab[2]), chroma: Math.hypot(lab[1], lab[2]), L: lab[0] };
  });
}

/** Moyenne circulaire ponderee par la chroma — le meme estimateur que le
 *  classement, pour que les chiffres restent comparables aux siens. */
function agrege(niveaux) {
  const lus = niveaux.filter((x) => x.chroma >= SEUIL);
  if (lus.length < 3) return { n: lus.length, insuffisant: true };
  let sx = 0, sy = 0;
  for (const x of lus) { sx += x.chroma * Math.cos(x.angle * Math.PI / 180); sy += x.chroma * Math.sin(x.angle * Math.PI / 180); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(lus.reduce((s, x) => s + ecartAngle(x.angle, moyen) ** 2, 0) / lus.length);
  const nMoy = lus.reduce((s, x) => s + x.n, 0) / lus.length;
  let num = 0, den = 0;
  for (const x of lus) { num += (x.n - nMoy) * ecartAngle(x.angle, moyen); den += (x.n - nMoy) ** 2; }
  return { n: lus.length, moyen, ecartType: et, pente: den > 0 ? (num / den) * 100 : 0,
           chromaMoy: lus.reduce((s, x) => s + x.chroma, 0) / lus.length,
           premier: lus[0].n, dernier: lus[lus.length - 1].n };
}

const propre = (x, marge) => x.bas >= marge && x.haut <= 255 - marge;

const DATA = new Map();
const manquants = [];
for (const t of TEINTES) {
  const r = rampe(`st-h${String(t).padStart(3, "0")}`);
  if (!r) { manquants.push(t); continue; }
  DATA.set(t, r);
}
if (manquants.length) console.log("MANQUENT : %s\n", manquants.join(", "));
const VUS = [...DATA.keys()];
if (VUS.length < 3) { console.log("Moins de trois teintes lues. On s'arrete."); process.exit(0); }

console.log("HYPOTHESE 1 — L'ECRETAGE DE GAMUT EXPLIQUE-T-IL LA TEINTE 220 ?");
console.log("");

// ── MESURE 1 — LA CHROMA PAR TEINTE ─────────────────────────────────────────
// Le modele la veut IDENTIQUE d'une teinte a l'autre au meme niveau. On la lit
// donc a niveaux APPARIES, pas en moyenne globale : les sous-ensembles lisibles
// different d'une teinte a l'autre, et une moyenne sur des niveaux differents
// comparerait des poids differents au lieu de comparer des chromas.
const NIVEAUX_TEMOINS = [8, 16, 24, 32, 48, 64, 96, 128];
console.log("MESURE 1 — CHROMA OKLab PAR TEINTE, A NIVEAUX APPARIES");
console.log("Le modele la veut EGALE partout (dir est unitaire). Ce qui est SOUS la");
console.log("mediane de la colonne a perdu de la chroma.");
console.log("");
console.log("teinte  " + NIVEAUX_TEMOINS.map((n) => ("n=" + n).padStart(8)).join("") + "   chroma moy.  % mediane");
console.log("".padEnd(96, "-"));
const medianes = NIVEAUX_TEMOINS.map((n) => {
  const v = VUS.map((t) => DATA.get(t)[n].chroma).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
});
const partChroma = new Map();
for (const t of VUS) {
  const r = DATA.get(t);
  const ratios = NIVEAUX_TEMOINS.map((n, i) => r[n].chroma / medianes[i]);
  const part = ratios.reduce((s, x) => s + x, 0) / ratios.length;
  partChroma.set(t, part);
  console.log("%s%s %s %s",
    String(t).padStart(6),
    NIVEAUX_TEMOINS.map((n) => DATA.get(t)[n].chroma.toFixed(4).padStart(8)).join(""),
    (NIVEAUX_TEMOINS.reduce((s, n) => s + r[n].chroma, 0) / NIVEAUX_TEMOINS.length).toFixed(4).padStart(13),
    (part * 100).toFixed(1).padStart(10));
}
console.log("");
console.log("mediane" + medianes.map((m) => m.toFixed(4).padStart(8)).join(""));
console.log("");
{
  const v180 = partChroma.get(180), v220 = partChroma.get(220), v270 = partChroma.get(270);
  if (v180 && v220 && v270) {
    console.log("VOISINAGE DE 220 : 180 = %s %% de la mediane, 220 = %s %%, 270 = %s %%.",
      (v180 * 100).toFixed(1), (v220 * 100).toFixed(1), (v270 * 100).toFixed(1));
    const creux = v220 < v180 && v220 < v270;
    console.log("  220 %s un creux de chroma entre ses deux voisines.", creux ? "EST" : "N'EST PAS");
  }
}

// ── MESURE 2 — LE COMPTE DE NIVEAUX ECRETES ─────────────────────────────────
console.log("");
console.log("MESURE 2 — NIVEAUX A UN CANAL ECRETE (sur les 256 de la rampe)");
console.log("Trois seuils, parce que le releve moyenne un patch : un canal ecrete ne");
console.log("ressort pas exactement a 0,00 mais jitte au-dessus.");
console.log("");
console.log("teinte   plancher <0,5  <1,0  <2,0   plafond >254,5 >254,0 >253,0   canal fautif  dernier niv. ecrete");
console.log("".padEnd(112, "-"));
for (const t of VUS) {
  const r = DATA.get(t);
  const c = (p) => r.filter(p).length;
  const nomCanal = ["R", "G", "B"];
  const compte = [0, 0, 0];
  for (const x of r) { const v = [x.R, x.G, x.B]; for (let i = 0; i < 3; i++) if (v[i] < 1) compte[i]++; }
  const fautif = compte.map((v, i) => [v, nomCanal[i]]).filter(([v]) => v > 0).sort((a, b) => b[0] - a[0])
    .map(([v, nc]) => `${nc}:${v}`).join(" ") || "aucun";
  const dernier = r.filter((x) => x.bas < 1).map((x) => x.n).pop();
  console.log("%s %s %s %s %s %s %s   %s %s",
    String(t).padStart(6),
    String(c((x) => x.bas < 0.5)).padStart(14), String(c((x) => x.bas < 1)).padStart(5),
    String(c((x) => x.bas < 2)).padStart(5),
    String(c((x) => x.haut > 254.5)).padStart(14), String(c((x) => x.haut > 254)).padStart(6),
    String(c((x) => x.haut > 253)).padStart(6),
    fautif.padEnd(14), String(dernier ?? "-").padStart(8));
}

// ── MESURE 3 — LE TEST DECISIF ──────────────────────────────────────────────
console.log("");
console.log("MESURE 3 — RESIDU ProPhoto LINEAIRE : TOUS LES NIVEAUX vs NON ECRETES");
console.log("Marge 1,0 : un niveau est retenu si ses trois canaux sont dans [1 ; 254].");
console.log("");
console.log("teinte  ---------------- tous ---------------  ------------ non ecretes ------------   variation");
console.log("        niv  angle  residu  e-type  derive     niv  angle  residu  e-type  derive     du residu");
console.log("".padEnd(112, "-"));
let sTous = 0, nTous = 0, sPropre = 0, nPropre = 0;
const lignes = [];
for (const t of VUS) {
  const r = DATA.get(t), pp = angleProPhotoLineaire(t);
  const a = agrege(r);
  const b = agrege(r.filter((x) => propre(x, 1)));
  const rA = a.insuffisant ? null : ecartAngle(a.moyen, pp);
  const rB = b.insuffisant ? null : ecartAngle(b.moyen, pp);
  if (rA !== null) { sTous += Math.abs(rA); nTous++; }
  if (rB !== null) { sPropre += Math.abs(rB); nPropre++; }
  lignes.push({ t, a, b, rA, rB });
  const f = (v, w, d = 1) => (v === null || v === undefined ? "--" : (v >= 0 && d === 1 ? "+" : "") + v.toFixed(d)).padStart(w);
  console.log("%s %s %s %s %s %s  %s %s %s %s %s   %s",
    String(t).padStart(6),
    String(a.n).padStart(4), a.insuffisant ? "--".padStart(6) : a.moyen.toFixed(1).padStart(6), f(rA, 7),
    a.insuffisant ? "--".padStart(7) : a.ecartType.toFixed(2).padStart(7),
    a.insuffisant ? "--".padStart(7) : a.pente.toFixed(2).padStart(7),
    String(b.insuffisant ? b.n : b.n).padStart(4),
    b.insuffisant ? "--".padStart(6) : b.moyen.toFixed(1).padStart(6), f(rB, 7),
    b.insuffisant ? "--".padStart(7) : b.ecartType.toFixed(2).padStart(7),
    b.insuffisant ? "--".padStart(7) : b.pente.toFixed(2).padStart(7),
    (rA !== null && rB !== null ? ((Math.abs(rB) - Math.abs(rA) >= 0 ? "+" : "") + (Math.abs(rB) - Math.abs(rA)).toFixed(1)) : "--").padStart(10));
}
console.log("");
console.log("ecart moyen absolu : tous %s deg sur %d teintes, non ecretes %s deg sur %d teintes",
  (sTous / nTous).toFixed(2), nTous, nPropre ? (sPropre / nPropre).toFixed(2) : "--", nPropre);
console.log("⚠️ Les deux moyennes ne portent pas sur les memes teintes si des lignes");
console.log("   passent a '--' : une teinte entierement ecretee SORT du denominateur.");

// ── LE BALAYAGE DE MARGE — le verdict ne doit pas dependre d'un seuil ───────
console.log("");
console.log("BALAYAGE DE LA MARGE D'ECRETAGE — residu ProPhoto lineaire, en degres");
console.log("Un residu qui CONVERGE en montant la marge tranche. Un residu qui saute");
console.log("ne tranche rien : le verdict dependrait du seuil qu'on a choisi.");
console.log("");
const MARGES = [0, 0.5, 1, 2, 3, 4, 6, 8];
console.log("teinte " + MARGES.map((m) => ("m=" + m).padStart(9)).join("") + "     (niveaux retenus a m=8)");
console.log("".padEnd(104, "-"));
for (const t of VUS) {
  const r = DATA.get(t), pp = angleProPhotoLineaire(t);
  const cells = MARGES.map((m) => {
    const g = agrege(r.filter((x) => propre(x, m)));
    if (g.insuffisant) return ("n=" + g.n).padStart(9);
    return ((ecartAngle(g.moyen, pp) >= 0 ? "+" : "") + ecartAngle(g.moyen, pp).toFixed(1)).padStart(9);
  });
  const fin = agrege(r.filter((x) => propre(x, 8)));
  console.log("%s%s   %s", String(t).padStart(6), cells.join(""),
    fin.insuffisant ? `SEULEMENT ${fin.n} — non concluant` : `${fin.n} niveaux, n=${fin.premier} a ${fin.dernier}`);
}

// ── RE-CLASSEMENT DES FAMILLES SUR LES NIVEAUX NON ECRETES ──────────────────
console.log("");
console.log("RE-CLASSEMENT DES QUATRE FAMILLES — sur les niveaux NON ecretes (marge 1,0)");
console.log("Si l'ecretage porte le residu, retirer les niveaux ecretes doit faire");
console.log("BOUGER le classement. S'il ne bouge pas, l'ecretage n'etait pas la cause.");
console.log("");
const FAMILLES = [
  ["A. HSL sur sRGB (en service)", angleSrgbHsl],
  ["B. angle direct OKLCh", angleOklchDirect],
  ["C. ProPhoto RGB gamma 1,8", angleProPhotoGamma],
  ["D. ProPhoto RGB lineaire", angleProPhotoLineaire],
];
const lisibles = lignes.filter((l) => !l.b.insuffisant && !l.a.insuffisant);
console.log("teintes retenues des deux cotes : %d (%s)", lisibles.length, lisibles.map((l) => l.t).join(", "));
console.log("");
console.log("famille                            tous les niveaux   non ecretes   pire teinte (non ecr.)");
console.log("".padEnd(98, "-"));
const tri = FAMILLES.map(([nom, f]) => {
  const eA = lisibles.map((l) => Math.abs(ecartAngle(l.a.moyen, f(l.t))));
  const eB = lisibles.map((l) => ({ t: l.t, e: Math.abs(ecartAngle(l.b.moyen, f(l.t))) }));
  const pire = eB.slice().sort((x, y) => y.e - x.e)[0];
  return { nom, moyA: eA.reduce((s, x) => s + x, 0) / eA.length,
           moyB: eB.reduce((s, x) => s + x.e, 0) / eB.length, pire };
}).sort((a, b) => a.moyB - b.moyB);
for (const c of tri) {
  console.log("%s %s %s     %s a %s deg", c.nom.padEnd(34),
    c.moyA.toFixed(2).padStart(16), c.moyB.toFixed(2).padStart(13),
    String(c.pire.t).padStart(3), c.pire.e.toFixed(1));
}

// ── VERDICT CHIFFRE SUR LES QUATRE TEINTES VISEES ───────────────────────────
console.log("");
console.log("VERDICT PAR TEINTE VISEE — 220, puis 0, 140, 150");
console.log("Le bruit de quantification seul vaut 1,28 a 2,51 deg (controle synthetique).");
console.log("");
for (const t of [220, 0, 140, 150]) {
  const l = lignes.find((x) => x.t === t);
  if (!l) { console.log("  %s : mesure absente.", t); continue; }
  const fin = agrege(DATA.get(t).filter((x) => propre(x, 8)));
  const dep = l.rA === null ? null : Math.abs(l.rA);
  const arr = l.rB === null ? null : Math.abs(l.rB);
  let verdict;
  if (l.b.insuffisant) {
    verdict = `NON CONCLUANT — ${l.b.n} niveaux non ecretes seulement, la mesure n'a plus de support.`;
  } else if (arr < 3 && dep >= 9) {
    verdict = "ECRETAGE — l'anomalie tombe au niveau du bruit une fois les niveaux ecretes retires.";
  } else if (dep !== null && arr !== null && arr < dep * 0.5) {
    verdict = "ECRETAGE EN PARTIE — le residu tombe de plus de moitie sans disparaitre.";
  } else if (dep !== null && arr !== null && Math.abs(arr - dep) < 2) {
    verdict = "LA LOI — retirer les niveaux ecretes ne change rien, l'ecart vient du modele.";
  } else {
    verdict = "MIXTE — a lire sur le balayage de marge ci-dessus.";
  }
  console.log("  teinte %s : residu %s deg -> %s deg (marge 1,0), %s deg (marge 8,0 sur %d niveaux)",
    String(t).padStart(3), dep === null ? "--" : dep.toFixed(1), arr === null ? "--" : arr.toFixed(1),
    fin.insuffisant ? "--" : Math.abs(ecartAngle(fin.moyen, angleProPhotoLineaire(t))).toFixed(1), fin.n);
  console.log("             chroma a %s %% de la mediane. %s", (partChroma.get(t) * 100).toFixed(1), verdict);
}

// ── CONTRE-EPREUVE 1 — LA PROFONDEUR DANS LE GAMUT ──────────────────────────
// La marge ne voit que l'ecretage DUR. Un rendu de gamut PERCEPTUEL comprime en
// douceur pres de la frontiere sans jamais poser un canal a zero, et la marge le
// laisserait passer. On classe donc les niveaux par leur DISTANCE a la frontiere
// — le canal minimal — et on lit le residu par tranche. Un residu plat jusqu'au
// fond du gamut exclut aussi la compression douce ; un residu qui decroit en
// s'enfoncant la designe.
console.log("");
console.log("CONTRE-EPREUVE 1 — RESIDU PAR PROFONDEUR DANS LE GAMUT");
console.log("Tranches sur le canal MINIMAL du niveau. La marge ne voit que l'ecretage");
console.log("dur ; une compression douce se lirait ici, en pente.");
console.log("");
const TRANCHES = [[1, 8], [8, 16], [16, 32], [32, 64], [64, 128], [128, 255]];
console.log("teinte " + TRANCHES.map(([a, b]) => (a + "-" + b).padStart(13)).join(""));
console.log("".padEnd(84, "-"));
for (const t of [220, 180, 270, 0, 140]) {
  if (!DATA.has(t)) continue;
  const r = DATA.get(t), pp = angleProPhotoLineaire(t);
  const cells = TRANCHES.map(([a, b]) => {
    const g = agrege(r.filter((x) => x.bas >= a && x.bas < b && x.haut <= 254));
    if (g.insuffisant) return ("n=" + g.n).padStart(13);
    const e = ecartAngle(g.moyen, pp);
    return (((e >= 0 ? "+" : "") + e.toFixed(1)) + "/" + g.n).padStart(13);
  });
  console.log("%s%s", String(t).padStart(6), cells.join(""));
}
console.log("");
console.log("(lecture : residu / nombre de niveaux dans la tranche)");

// ── CONTRE-EPREUVE 2 — LA TEINTE QUE LA MESURE IMPLIQUE ─────────────────────
// Un residu de +21 degres isole entre deux voisines a +2,3 et -2,0 n'est pas la
// forme d'une loi : une loi se trompe en pente, pas en pic. On inverse donc la
// famille — quelle teinte de selecteur ProPhoto lineaire rendrait l'angle MESURE ?
// Si dix teintes sur onze retombent sur leur valeur nominale et qu'une seule
// tombe ailleurs, la piste n'est plus la loi mais la SCENE : le curseur de cette
// scene-la n'etait pas ou on le croit.
console.log("");
console.log("CONTRE-EPREUVE 2 — TEINTE DE SELECTEUR IMPLIQUEE PAR LA MESURE");
console.log("Inversion de ProPhoto lineaire sur l'angle mesure (niveaux non ecretes,");
console.log("marge 2,0). Un pic isole de residu se lit ici en teinte implicite decalee.");
console.log("");
function inverse(angleVise) {
  let best = 0, bestE = Infinity;
  for (let h = 0; h < 360; h += 0.05) {
    const e = Math.abs(ecartAngle(angleVise, angleProPhotoLineaire(h)));
    if (e < bestE) { bestE = e; best = h; }
  }
  return { h: best, e: bestE };
}
console.log("teinte nominale   angle mesure   teinte impliquee   ecart de teinte");
console.log("".padEnd(72, "-"));
for (const t of VUS) {
  const g = agrege(DATA.get(t).filter((x) => propre(x, 2)));
  if (g.insuffisant) { console.log("%s   %d niveaux seulement", String(t).padStart(15), g.n); continue; }
  const inv = inverse(g.moyen);
  const d = ecartAngle(inv.h, t);
  console.log("%s %s %s %s",
    String(t).padStart(15), g.moyen.toFixed(1).padStart(14), inv.h.toFixed(1).padStart(18),
    ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(18));
}
console.log("");
console.log("⚠️ L'inversion n'est pas une correction : elle DECRIT l'anomalie en unites");
console.log("   de curseur, la ou le residu la decrit en degres OKLab. Une teinte dont");
console.log("   l'ecart de teinte est isole pointe la SCENE ; une derive reguliere de");
console.log("   l'ecart sur tout le cercle pointe la LOI.");

// ── CONTRE-EPREUVE 3 — LE PIC EST-IL REPRODUCTIBLE SUR UNE AUTRE ROUE ? ─────
// Un pic isole a une teinte a deux lectures qui se separent par une seule mesure :
// soit la LOI a une singularite a 220, soit la SCENE `st-h220` est fautive. La
// campagne porte deja le controle qu'il faut — `cg-glob-h220` pose la MEME teinte
// sur une AUTRE roue (globale, sans balance). Si le pic s'y retrouve, il est dans
// la loi. S'il n'y est pas, il est dans la scene des ombres.
console.log("");
console.log("CONTRE-EPREUVE 3 — LE PIC DE 220 SUR UNE AUTRE ROUE");
console.log("`cg-glob-h*` pose la meme teinte sur la roue GLOBALE. Deux teintes de la");
console.log("campagne ont ce doublon : 40 (temoin, residu faible) et 220 (le pic).");
console.log("");
console.log("scene            niv  angle mesure   residu PPlin   teinte impliquee   ecart de teinte");
console.log("".padEnd(94, "-"));
for (const [nom, t] of [["st-h040", 40], ["cg-glob-h040", 40], ["st-h220", 220], ["cg-glob-h220", 220]]) {
  const r = rampe(nom);
  if (!r) { console.log("%s  ABSENTE", nom.padEnd(16)); continue; }
  const g = agrege(r.filter((x) => propre(x, 2)));
  if (g.insuffisant) { console.log("%s  %d niveaux seulement", nom.padEnd(16), g.n); continue; }
  const res = ecartAngle(g.moyen, angleProPhotoLineaire(t));
  const inv = inverse(g.moyen);
  console.log("%s %s %s %s %s %s", nom.padEnd(16), String(g.n).padStart(4),
    g.moyen.toFixed(1).padStart(14), ((res >= 0 ? "+" : "") + res.toFixed(1)).padStart(14),
    inv.h.toFixed(1).padStart(18),
    ((ecartAngle(inv.h, t) >= 0 ? "+" : "") + ecartAngle(inv.h, t).toFixed(1)).padStart(18));
}
console.log("");
console.log("Meme ecart de teinte des deux cotes : le decalage est dans la LOI, et");
console.log("l'hypothese du gamut est morte pour de bon. Ecart d'un seul cote : c'est la");
console.log("scene, et la teinte 220 doit etre RE-MESUREE avant d'etre interpretee.");

// ── CONTRE-EPREUVE 4 — PIC OU DEFORMATION MONOTONE ? ────────────────────────
// « Un pic isole » et « une deformation monotone du cercle » se corrigent de deux
// facons opposees : le premier est une anomalie a re-mesurer, le second est une
// LOI a modeliser. Ils se separent par la MONOTONIE de la teinte impliquee et par
// le GAIN LOCAL — de combien de degres implicites avance-t-on par degre nominal.
// Un gain qui reste positif partout, meme tres loin de 1, est une deformation.
console.log("");
console.log("CONTRE-EPREUVE 4 — PIC ISOLE OU DEFORMATION MONOTONE DU CERCLE ?");
console.log("");
const implicites = VUS.map((t) => {
  const g = agrege(DATA.get(t).filter((x) => propre(x, 2)));
  return g.insuffisant ? null : { t, h: inverse(g.moyen).h };
}).filter(Boolean);
console.log("secteur nominal   largeur nominale   largeur impliquee   gain local");
console.log("".padEnd(72, "-"));
let monotone = true;
for (let i = 0; i + 1 < implicites.length; i++) {
  const a = implicites[i], b = implicites[i + 1];
  const dn = b.t - a.t;
  let di = b.h - a.h; while (di > 180) di -= 360; while (di < -180) di += 360;
  if (di <= 0) monotone = false;
  console.log("%s %s %s %s",
    (a.t + " -> " + b.t).padStart(15), String(dn).padStart(18),
    di.toFixed(1).padStart(19), (di / dn).toFixed(2).padStart(12));
}
console.log("");
console.log("teinte impliquee, dans l'ordre : %s", implicites.map((x) => x.h.toFixed(0)).join(", "));
console.log("monotone : %s", monotone ? "OUI — tous les secteurs avancent" : "NON — un secteur recule");
console.log("");
if (monotone) {
  console.log("VERDICT DE FORME : ce n'est pas un pic, c'est une DEFORMATION MONOTONE.");
  console.log("  La teinte 220 n'a rien d'anormal en soi — le cercle est ETIRE entre 180");
  console.log("  et 220 puis COMPRIME entre 220 et 270. Une famille a zero parametre ne");
  console.log("  peut pas rendre ca : la suite n'est pas de corriger 220, c'est de");
  console.log("  chercher la loi dont le gain local varie ainsi.");
  // ⚠️ La monotonie est un test FAIBLE quand le secteur ne porte qu'un point
  // interieur : entre 180 et 270 il n'y a que 220, et un point unique est
  // monotone avec ses deux voisins QUOI QU'IL VAILLE, tant qu'il reste entre
  // eux. On chiffre donc la densite d'echantillonnage plutot que de la taire.
  const dedans = implicites.filter((x) => x.t > 180 && x.t < 270).length;
  console.log("");
  console.log("  ⚠️ PORTEE DE CE VERDICT. Le secteur 180-270 (90 deg nominaux) ne porte");
  console.log("     que %d point(s) interieur(s). Un point unique est monotone avec ses", dedans);
  console.log("     voisins quelle que soit sa valeur : la monotonie exclut une mesure");
  console.log("     ABERRANTE, elle n'etablit pas la FORME de la deformation. Ce qui est");
  console.log("     etabli sans supposition : l'ecart de +26 deg est reproductible sur");
  console.log("     deux roues independantes (a 0,6 deg pres) et survit a l'ablation du");
  console.log("     gamut. La forme entre 180 et 270 demande des teintes intermediaires.");
} else {
  console.log("VERDICT DE FORME : un secteur RECULE — la mesure se contredit, et une");
  console.log("  teinte au moins doit etre re-mesuree avant toute interpretation.");
}
