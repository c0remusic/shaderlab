// HYPOTHESE 2 — LA DIVERGENCE ENTRE ROUES : LOI PAR ROUE, OU ARTEFACT D'AMPLITUDE ?
//
// CE QUI EST EN JEU. Le residu ProPhoto lineaire vaut -4,2 deg sur la roue des
// ombres a la teinte 40 et -18,7 sur la roue GLOBALE a la meme teinte ; +21,3
// contre +31,3 a la teinte 220. Les ecarts-types sont de 2,4 a 3,9 deg, donc les
// differences (14,5 et 10,0) sont loin au-dessus du bruit. Lu naivement, ca
// refute « un seul modele de melange, donc une seule loi de teinte ».
//
// L'EXPLICATION ALTERNATIVE. ColorGradeGlobalSat=60 n'a aucune raison d'etre la
// MEME echelle que SplitToningShadowSaturation=60. Une chroma plus forte sort
// davantage du gamut sRGB ; l'ecretage par canal TOURNE la teinte. La difference
// serait alors un artefact d'amplitude, pas une loi par roue.
//
// COMMENT ON TRANCHE. Quatre mesures, de la plus faible a la plus forte :
//   1. le rapport des chromas entre les deux roues ;
//   2. le nombre de niveaux ecretes de chaque ;
//   3. le residu des mesures globales sur les niveaux NON ecretes ;
//   4. LA COMPARAISON A CHROMA EGALE — si la difference s'evanouit quand on
//      compare les deux roues sur la meme bande de chroma, c'est un artefact ;
//      si elle survit, c'est une loi par roue.
// Plus un cinquieme, predictif : on SIMULE l'ecretage. On part de la direction
// que la roue des ombres donne a chroma nulle, on la pousse jusqu'a la chroma
// observee sur la roue globale, on ecrete et on quantifie comme un export 8 bits,
// et on regarde de combien l'angle a tourne. Si la rotation predite vaut la
// difference observee, l'artefact est demontre et pas seulement plausible.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;

// La famille en tete du classement, reprise telle quelle du lecteur de campagne.
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function angleProPhotoLineaire(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  return deg(...linearSrgbToOklab(ap(XS, ap(PP, rgb))).slice(1));
}

// ── LECTURE : un niveau = un point (L, chroma, angle, ecrete ?) ──────────────
function niveaux(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  const rgb = JSON.parse(readFileSync(f, "utf8")).rampe_rgb;
  const out = [];
  for (let n = 0; n <= 255; n++) {
    const v = rgb[n];
    const lin = [srgbToLinear(v[0] / 255), srgbToLinear(v[1] / 255), srgbToLinear(v[2] / 255)];
    const lab = linearSrgbToOklab(lin);
    const c = Math.hypot(lab[1], lab[2]);
    const ent = v.map((x) => Math.round(x));
    const bas = ent.some((x) => x <= 0);
    const haut = ent.some((x) => x >= 255);
    out.push({ n, L: lab[0], a: lab[1], b: lab[2], c, angle: deg(lab[1], lab[2]), bas, haut, ecrete: bas || haut, rgb: v });
  }
  return out;
}

/** Moyenne circulaire ponderee par la chroma, plus ecart-type — meme convention
 *  que le lecteur de campagne, pour que les nombres soient comparables. */
function resume(pts) {
  if (pts.length === 0) return null;
  let sx = 0, sy = 0;
  for (const p of pts) { sx += p.c * Math.cos(rad(p.angle)); sy += p.c * Math.sin(rad(p.angle)); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(pts.reduce((s, p) => s + ecartAngle(p.angle, moyen) ** 2, 0) / pts.length);
  const cs = pts.map((p) => p.c).sort((x, y) => x - y);
  return {
    k: pts.length, moyen, et,
    cMoy: cs.reduce((s, x) => s + x, 0) / cs.length,
    cMed: cs[Math.floor(cs.length / 2)],
    cMax: cs[cs.length - 1],
  };
}

const SCENES = [
  { nom: "st-h040", teinte: 40, roue: "ombres" },
  { nom: "cg-glob-h040", teinte: 40, roue: "GLOBALE" },
  { nom: "st-h220", teinte: 220, roue: "ombres" },
  { nom: "cg-glob-h220", teinte: 220, roue: "GLOBALE" },
];
const D = {};
for (const s of SCENES) {
  const pts = niveaux(s.nom);
  if (!pts) { console.log("MANQUE : %s", s.nom); process.exit(1); }
  s.tous = pts;
  s.utiles = pts.filter((p) => p.c >= SEUIL);
  s.propres = s.utiles.filter((p) => !p.ecrete);
  D[s.nom] = s;
}

// ── 1 et 2. PROFIL DE CHAQUE SCENE : chroma, ecretage ────────────────────────
console.log("HYPOTHESE 2 — loi par roue, ou artefact d'amplitude ?");
console.log("");
console.log("1+2. PROFIL DES QUATRE SCENES");
console.log("");
console.log("scene         roue      utiles  chroma moy  chroma med  chroma max  ecretes  a 0  a 255");
console.log("".padEnd(96, "-"));
for (const s of SCENES) {
  const r = resume(s.utiles);
  const nBas = s.utiles.filter((p) => p.bas).length;
  const nHaut = s.utiles.filter((p) => p.haut).length;
  const nEcr = s.utiles.filter((p) => p.ecrete).length;
  console.log("%s %s %s %s %s %s %s %s %s",
    s.nom.padEnd(13), s.roue.padEnd(9), String(r.k).padStart(7),
    r.cMoy.toFixed(4).padStart(11), r.cMed.toFixed(4).padStart(11), r.cMax.toFixed(4).padStart(11),
    String(nEcr).padStart(8), String(nBas).padStart(4), String(nHaut).padStart(6));
}
console.log("");
console.log("RAPPORT DE CHROMA globale / ombres, a teinte egale :");
for (const t of [40, 220]) {
  const o = resume(D[`st-h${String(t).padStart(3, "0")}`].utiles);
  const g = resume(D[`cg-glob-h${String(t).padStart(3, "0")}`].utiles);
  console.log("  teinte %s : moyenne x%s, mediane x%s, max x%s",
    String(t).padStart(3), (g.cMoy / o.cMoy).toFixed(2), (g.cMed / o.cMed).toFixed(2), (g.cMax / o.cMax).toFixed(2));
}

// ── 3. RESIDU SUR LES NIVEAUX NON ECRETES ────────────────────────────────────
console.log("");
console.log("3. RESIDU ProPhoto lineaire — tous les niveaux utiles, puis les NON ECRETES seuls");
console.log("");
console.log("scene         roue      tous: k  angle   residu | propres: k  angle   residu   delta");
console.log("".padEnd(96, "-"));
for (const s of SCENES) {
  const ref = angleProPhotoLineaire(s.teinte);
  const a = resume(s.utiles), b = resume(s.propres);
  const rA = ecartAngle(a.moyen, ref), rB = b ? ecartAngle(b.moyen, ref) : NaN;
  console.log("%s %s %s %s %s | %s %s %s %s",
    s.nom.padEnd(13), s.roue.padEnd(9), String(a.k).padStart(7),
    a.moyen.toFixed(1).padStart(7), ((rA >= 0 ? "+" : "") + rA.toFixed(1)).padStart(8),
    String(b ? b.k : 0).padStart(9), (b ? b.moyen.toFixed(1) : "-").padStart(7),
    (b ? (rB >= 0 ? "+" : "") + rB.toFixed(1) : "-").padStart(8),
    (b ? (rB - rA >= 0 ? "+" : "") + (rB - rA).toFixed(1) : "-").padStart(7));
}
console.log("");
for (const t of [40, 220]) {
  const o = D[`st-h${String(t).padStart(3, "0")}`], g = D[`cg-glob-h${String(t).padStart(3, "0")}`];
  const ref = angleProPhotoLineaire(t);
  const dTous = ecartAngle(resume(g.utiles).moyen, ref) - ecartAngle(resume(o.utiles).moyen, ref);
  const dProp = ecartAngle(resume(g.propres).moyen, ref) - ecartAngle(resume(o.propres).moyen, ref);
  console.log("  teinte %s : difference entre roues %s deg (tous) -> %s deg (non ecretes)",
    String(t).padStart(3), dTous.toFixed(1), dProp.toFixed(1));
}

// ── 4. LA COMPARAISON A CHROMA EGALE ─────────────────────────────────────────
// Le test decisif. On decoupe la chroma en bandes et on compare les deux roues
// DANS CHAQUE BANDE. Une loi par roue donne une difference CONSTANTE selon la
// bande ; un artefact d'amplitude donne une difference qui tend vers zero quand
// la chroma baisse.
console.log("");
console.log("4. A CHROMA EGALE — le test decisif");
console.log("");
const LARGEUR = 0.01;
for (const t of [40, 220]) {
  const o = D[`st-h${String(t).padStart(3, "0")}`], g = D[`cg-glob-h${String(t).padStart(3, "0")}`];
  const ref = angleProPhotoLineaire(t);
  console.log("  TEINTE %s  (ProPhoto lineaire = %s deg)", t, ref.toFixed(1));
  console.log("  bande de chroma    ombres: k  angle   residu | globale: k  angle   residu   DIFF");
  console.log("  " + "".padEnd(92, "-"));
  const cMax = Math.max(...o.utiles.map((p) => p.c), ...g.utiles.map((p) => p.c));
  let commun = 0, sDiff = 0, nBandes = 0;
  for (let c0 = 0; c0 < cMax; c0 += LARGEUR) {
    const po = o.utiles.filter((p) => p.c >= c0 && p.c < c0 + LARGEUR);
    const pg = g.utiles.filter((p) => p.c >= c0 && p.c < c0 + LARGEUR);
    if (po.length < 5 || pg.length < 5) continue;
    const ro = resume(po), rg = resume(pg);
    const eo = ecartAngle(ro.moyen, ref), eg = ecartAngle(rg.moyen, ref);
    const diff = eg - eo;
    commun += po.length + pg.length; sDiff += Math.abs(diff); nBandes++;
    console.log("  %s %s %s %s | %s %s %s %s",
      (c0.toFixed(3) + "-" + (c0 + LARGEUR).toFixed(3)).padEnd(17),
      String(ro.k).padStart(10), ro.moyen.toFixed(1).padStart(7),
      ((eo >= 0 ? "+" : "") + eo.toFixed(1)).padStart(8),
      String(rg.k).padStart(11), rg.moyen.toFixed(1).padStart(7),
      ((eg >= 0 ? "+" : "") + eg.toFixed(1)).padStart(8),
      ((diff >= 0 ? "+" : "") + diff.toFixed(1)).padStart(7));
  }
  if (nBandes === 0) {
    console.log("  AUCUNE BANDE COMMUNE : les deux roues n'echantillonnent pas la meme chroma.");
    console.log("  -> la comparaison a chroma egale est impossible par bandes ; voir l'extrapolation.");
  } else {
    console.log("  %d bandes communes, difference moyenne absolue %s deg", nBandes, (sDiff / nBandes).toFixed(2));
  }
  console.log("");
}

// ── 4bis. EXTRAPOLATION A CHROMA NULLE ───────────────────────────────────────
// Si les bandes communes manquent, la droite angle(chroma) de chaque scene,
// prolongee jusqu'a chroma nulle, donne la direction que la roue demanderait
// SANS ecretage. Deux roues qui s'y rejoignent ont la meme loi.
console.log("4bis. EXTRAPOLATION A CHROMA NULLE — angle = alpha + beta * chroma");
console.log("");
console.log("scene         roue      k    alpha (c=0)  beta (/0,1 chroma)  residu de alpha");
console.log("".padEnd(90, "-"));
const inter = {};
for (const s of SCENES) {
  const pts = s.utiles;
  const r = resume(pts);
  const cM = pts.reduce((x, p) => x + p.c, 0) / pts.length;
  let num = 0, den = 0;
  for (const p of pts) { num += (p.c - cM) * ecartAngle(p.angle, r.moyen); den += (p.c - cM) ** 2; }
  const beta = num / den;
  const alpha = r.moyen + (0 - cM) * beta;
  inter[s.nom] = alpha;
  const res = ecartAngle(alpha, angleProPhotoLineaire(s.teinte));
  console.log("%s %s %s %s %s %s",
    s.nom.padEnd(13), s.roue.padEnd(9), String(pts.length).padStart(4),
    alpha.toFixed(1).padStart(12), (beta * 0.1).toFixed(1).padStart(19),
    ((res >= 0 ? "+" : "") + res.toFixed(1)).padStart(17));
}
console.log("");
for (const t of [40, 220]) {
  const a = inter[`st-h${String(t).padStart(3, "0")}`], b = inter[`cg-glob-h${String(t).padStart(3, "0")}`];
  console.log("  teinte %s : ecart des deux intercepts %s deg", String(t).padStart(3), ecartAngle(b, a).toFixed(1));
}

// ── 5. SIMULATION DE L'ECRETAGE — la prediction ──────────────────────────────
// On prend la direction de la roue des OMBRES a chroma nulle comme la direction
// « vraie » de la teinte. On la pousse, au niveau de gris de chaque echantillon
// de la roue GLOBALE, jusqu'a une chroma AVANT ecretage inconnue ; on ecrete et
// on quantifie en 8 bits comme un export ; on cherche la chroma avant ecretage
// qui rend la chroma observee APRES. L'angle qui sort est la prediction.
function exportation(L, c, angleDeg) {
  const lab = [L, c * Math.cos(rad(angleDeg)), c * Math.sin(rad(angleDeg))];
  const lin = oklabToLinearSrgb(lab);
  const huit = lin.map((x) => Math.min(255, Math.max(0, Math.round(linearToSrgb(x) * 255))));
  const relu = linearSrgbToOklab(huit.map((x) => srgbToLinear(x / 255)));
  return { c: Math.hypot(relu[1], relu[2]), angle: deg(relu[1], relu[2]), ecrete: huit.some((x) => x <= 0 || x >= 255) };
}
/** Cherche la chroma AVANT ecretage qui produit `cible` APRES — bissection sur
 *  une fonction croissante puis saturante ; rend null si la cible est hors de
 *  portee (l'ecretage ne peut plus la produire, quelle que soit l'amplitude). */
function chromaAvant(L, cible, angleDeg) {
  let lo = 0, hi = 0.02;
  for (let i = 0; i < 60 && exportation(L, hi, angleDeg).c < cible; i++) hi *= 1.3;
  if (exportation(L, hi, angleDeg).c < cible) return null;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (exportation(L, mid, angleDeg).c < cible) lo = mid; else hi = mid;
  }
  return (lo + hi) / 2;
}

console.log("");
console.log("5. SIMULATION DE L'ECRETAGE — prediction contre observation");
console.log("");
console.log("On pose la direction vraie = l'intercept a chroma nulle de la roue des OMBRES.");
console.log("On la pousse jusqu'a la chroma observee sur chaque scene, on ecrete, on quantifie.");
console.log("");
console.log("scene         direction vraie  angle predit  angle observe  ecart  rotation predite");
console.log("".padEnd(96, "-"));
for (const s of SCENES) {
  const vraie = inter[`st-h${String(s.teinte).padStart(3, "0")}`];
  const pred = [];
  let hors = 0;
  for (const p of s.utiles) {
    const cPre = chromaAvant(p.L, p.c, vraie);
    if (cPre === null) { hors++; continue; }
    const e = exportation(p.L, cPre, vraie);
    pred.push({ c: e.c, angle: e.angle });
  }
  const rp = resume(pred), ro = resume(s.utiles);
  const rot = ecartAngle(rp.moyen, vraie);
  console.log("%s %s %s %s %s %s%s",
    s.nom.padEnd(13), vraie.toFixed(1).padStart(16), rp.moyen.toFixed(1).padStart(13),
    ro.moyen.toFixed(1).padStart(14),
    ecartAngle(rp.moyen, ro.moyen).toFixed(1).padStart(7),
    ((rot >= 0 ? "+" : "") + rot.toFixed(1)).padStart(18),
    hors ? `  (${hors} niveaux hors de portee)` : "");
}
console.log("");
console.log("La rotation PREDITE par le seul ecretage se compare a la difference OBSERVEE :");
for (const t of [40, 220]) {
  const o = D[`st-h${String(t).padStart(3, "0")}`], g = D[`cg-glob-h${String(t).padStart(3, "0")}`];
  const ref = angleProPhotoLineaire(t);
  const obs = ecartAngle(resume(g.utiles).moyen, ref) - ecartAngle(resume(o.utiles).moyen, ref);
  const vraie = inter[`st-h${String(t).padStart(3, "0")}`];
  const sim = (sc) => {
    const pr = [];
    for (const p of sc.utiles) {
      const cPre = chromaAvant(p.L, p.c, vraie);
      if (cPre !== null) pr.push(exportation(p.L, cPre, vraie));
    }
    return ecartAngle(resume(pr).moyen, vraie);
  };
  const predDiff = sim(g) - sim(o);
  console.log("  teinte %s : observee %s deg, predite par l'ecretage %s deg  (reste %s deg inexplique)",
    String(t).padStart(3), obs.toFixed(1), predDiff.toFixed(1), (obs - predDiff).toFixed(1));
}

// ── 6. LE BRUIT DE L'ECRETAGE SUR LA CHROMA ──────────────────────────────────
// Un controle de plus : combien l'ecretage RABOTE-T-IL la chroma ? Si la chroma
// avant ecretage necessaire est a peine superieure a celle observee, l'ecretage
// est faible et ne peut pas porter une rotation de dix degres.
console.log("");
console.log("6. AMPUTATION DE CHROMA PAR L'ECRETAGE (controle du mecanisme)");
console.log("");
console.log("scene         chroma observee  chroma avant ecretage  rapport  niveaux amputes >1%");
console.log("".padEnd(94, "-"));
for (const s of SCENES) {
  const vraie = inter[`st-h${String(s.teinte).padStart(3, "0")}`];
  let sObs = 0, sPre = 0, k = 0, ampute = 0;
  for (const p of s.utiles) {
    const cPre = chromaAvant(p.L, p.c, vraie);
    if (cPre === null) continue;
    sObs += p.c; sPre += cPre; k++;
    if (cPre > p.c * 1.01) ampute++;
  }
  console.log("%s %s %s %s %s",
    s.nom.padEnd(13), (sObs / k).toFixed(4).padStart(16), (sPre / k).toFixed(4).padStart(22),
    (sPre / sObs).toFixed(3).padStart(8), (String(ampute) + " / " + k).padStart(20));
}
console.log("");
console.log("Un rapport proche de 1,000 veut dire que l'ecretage ne mord presque pas :");
console.log("il ne peut alors pas etre la cause d'une difference de dix degres.");

// ── 7. LE SECOND CONFONDANT : LA LUMINANCE ───────────────────────────────────
// L'ecretage est mort (section 3 et 5). Mais la roue des ombres a balance -100
// pose sa chroma sur les pixels SOMBRES, la roue globale la pose PARTOUT : les
// deux moyennes ne tirent donc pas du meme intervalle de L. Si l'angle depend de
// L, deux roues portant la MEME loi rendraient quand meme deux moyennes
// differentes. On regarde donc ou chaque bande de chroma se situe en niveau,
// puis on compare les deux roues NIVEAU PAR NIVEAU — a L identique par
// construction, ce qui retire les deux confondants d'un coup.
console.log("");
console.log("7. LE SECOND CONFONDANT — les deux roues tirent-elles du meme intervalle de L ?");
console.log("");
console.log("scene         niveau moyen (pondere chroma)  L moyen  L min  L max  niveaux utiles");
console.log("".padEnd(94, "-"));
for (const s of SCENES) {
  const p = s.utiles;
  const w = p.reduce((x, q) => x + q.c, 0);
  const nMoy = p.reduce((x, q) => x + q.c * q.n, 0) / w;
  const lMoy = p.reduce((x, q) => x + q.c * q.L, 0) / w;
  console.log("%s %s %s %s %s %s",
    s.nom.padEnd(13), nMoy.toFixed(1).padStart(28), lMoy.toFixed(3).padStart(8),
    Math.min(...p.map((q) => q.L)).toFixed(3).padStart(6),
    Math.max(...p.map((q) => q.L)).toFixed(3).padStart(6),
    (String(p[0].n) + "-" + String(p[p.length - 1].n)).padStart(15));
}

console.log("");
console.log("7bis. NIVEAU PAR NIVEAU — meme L, meme pixel d'entree, les deux roues appariees");
console.log("");
console.log("Seuls les niveaux ou LES DEUX scenes sont utiles ET non ecretees.");
console.log("");
for (const t of [40, 220]) {
  const o = D["st-h" + String(t).padStart(3, "0")], g = D["cg-glob-h" + String(t).padStart(3, "0")];
  const io = new Map(o.propres.map((p) => [p.n, p]));
  const paires = g.propres.filter((p) => io.has(p.n)).map((p) => ({ n: p.n, g: p, o: io.get(p.n) }));
  console.log("  TEINTE %s — %d niveaux apparies", t, paires.length);
  if (paires.length < 10) { console.log("    trop peu de paires."); continue; }
  console.log("  tranche de niveaux   k   L moyen  chroma omb  chroma glob  angle omb  angle glob   DIFF");
  console.log("  " + "".padEnd(94, "-"));
  const bornes = [[0, 51], [51, 102], [102, 153], [153, 204], [204, 256]];
  let sd = 0, sk = 0;
  for (const [a, b] of bornes) {
    const q = paires.filter((p) => p.n >= a && p.n < b);
    if (q.length < 5) continue;
    const ro = resume(q.map((p) => p.o)), rg = resume(q.map((p) => p.g));
    const d = ecartAngle(rg.moyen, ro.moyen);
    sd += Math.abs(d) * q.length; sk += q.length;
    console.log("  %s %s %s %s %s %s %s %s",
      (String(a) + "-" + String(b - 1)).padEnd(20), String(q.length).padStart(3),
      (q.reduce((x, p) => x + p.o.L, 0) / q.length).toFixed(3).padStart(8),
      ro.cMoy.toFixed(4).padStart(11), rg.cMoy.toFixed(4).padStart(12),
      ro.moyen.toFixed(1).padStart(10), rg.moyen.toFixed(1).padStart(11),
      ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(7));
  }
  const tot = ecartAngle(resume(paires.map((p) => p.g)).moyen, resume(paires.map((p) => p.o)).moyen);
  console.log("  ensemble apparie : difference %s deg (moyenne absolue par tranche %s deg)",
    tot.toFixed(1), (sd / sk).toFixed(1));
  console.log("");
}

// ── 8. L'ANGLE DEPEND-IL DE L ? ──────────────────────────────────────────────
// Regression de l'angle sur L, sur les niveaux NON ECRETES seulement. Si la
// pente est forte, la difference entre roues pourrait etre un effet de L ; si
// elle est plate, elle ne peut pas l'etre.
console.log("8. PENTE DE L'ANGLE EN L — sur les niveaux NON ECRETES seuls");
console.log("");
console.log("scene         k    angle a L=0,2  angle a L=0,8  pente/L  extrapole a chroma 0");
console.log("".padEnd(90, "-"));
for (const s of SCENES) {
  const p = s.propres;
  const r = resume(p);
  const lM = p.reduce((x, q) => x + q.L, 0) / p.length;
  let num = 0, den = 0;
  for (const q of p) { num += (q.L - lM) * ecartAngle(q.angle, r.moyen); den += (q.L - lM) ** 2; }
  const pente = num / den;
  const a = (L) => r.moyen + (L - lM) * pente;
  const cM = p.reduce((x, q) => x + q.c, 0) / p.length;
  let nc = 0, dc = 0;
  for (const q of p) { nc += (q.c - cM) * ecartAngle(q.angle, r.moyen); dc += (q.c - cM) ** 2; }
  console.log("%s %s %s %s %s %s",
    s.nom.padEnd(13), String(p.length).padStart(4), a(0.2).toFixed(1).padStart(14),
    a(0.8).toFixed(1).padStart(14), pente.toFixed(1).padStart(8),
    (r.moyen + (0 - cM) * (nc / dc)).toFixed(1).padStart(21));
}

// ── 9. APPARIEMENT SUR (L, CHROMA) — le vrai apples-to-apples ────────────────
// La section 4 egalise la chroma sans egaliser L ; la 7bis egalise L sans
// egaliser la chroma. Les deux laissent un confondant. Si l'angle lu en OKLab
// est une fonction angle(L, chroma) — ce qui est le cas des que l'addition de
// chroma n'est PAS faite en OKLab —, alors deux roues portant la MEME loi
// rendent des moyennes differentes des qu'elles n'echantillonnent pas le meme
// (L, chroma). Le seul test propre apparie sur LES DEUX a la fois.
//
// Il existe un recouvrement : vers les hautes lumieres la roue des ombres
// s'eteint et sa chroma passe SOUS celle de la roue globale (7bis, tranche
// 204-255 : 0,0240 contre 0,0323). Les deux nuages se croisent donc.
console.log("");
console.log("9. APPARIEMENT SUR (L, CHROMA) — le seul test sans confondant");
console.log("");
const TOL_L = 0.04, TOL_C = 0.004;
console.log("Tolerances : |delta L| <= %s, |delta chroma| <= %s", TOL_L, TOL_C);
console.log("");
console.log("teinte  paires  L moyen  chroma moy  angle omb  angle glob   DIFF   ecart-type des diffs");
console.log("".padEnd(96, "-"));
const recap = {};
for (const t of [40, 220]) {
  const o = D["st-h" + String(t).padStart(3, "0")].propres;
  const g = D["cg-glob-h" + String(t).padStart(3, "0")].propres;
  const diffs = [];
  for (const pg of g) {
    for (const po of o) {
      if (Math.abs(pg.L - po.L) > TOL_L) continue;
      if (Math.abs(pg.c - po.c) > TOL_C) continue;
      diffs.push({ d: ecartAngle(pg.angle, po.angle), L: (pg.L + po.L) / 2, c: (pg.c + po.c) / 2 });
    }
  }
  if (diffs.length === 0) { console.log("%s  AUCUNE paire dans ces tolerances", String(t).padStart(6)); continue; }
  const m = diffs.reduce((s, x) => s + x.d, 0) / diffs.length;
  const et = Math.sqrt(diffs.reduce((s, x) => s + (x.d - m) ** 2, 0) / diffs.length);
  recap[t] = { m, k: diffs.length };
  const lM = diffs.reduce((s, x) => s + x.L, 0) / diffs.length;
  const cM = diffs.reduce((s, x) => s + x.c, 0) / diffs.length;
  console.log("%s %s %s %s %s %s %s %s",
    String(t).padStart(6), String(diffs.length).padStart(7), lM.toFixed(3).padStart(8),
    cM.toFixed(4).padStart(11), "-".padStart(10), "-".padStart(11),
    ((m >= 0 ? "+" : "") + m.toFixed(1)).padStart(7), et.toFixed(2).padStart(22));
}
console.log("");
console.log("Meme chose par tranche de L, pour voir si la difference appariee derive :");
for (const t of [40, 220]) {
  const o = D["st-h" + String(t).padStart(3, "0")].propres;
  const g = D["cg-glob-h" + String(t).padStart(3, "0")].propres;
  const diffs = [];
  for (const pg of g) for (const po of o) {
    if (Math.abs(pg.L - po.L) <= TOL_L && Math.abs(pg.c - po.c) <= TOL_C)
      diffs.push({ d: ecartAngle(pg.angle, po.angle), L: (pg.L + po.L) / 2, c: (pg.c + po.c) / 2 });
  }
  if (diffs.length === 0) continue;
  console.log("  TEINTE %s", t);
  for (const [a, b] of [[0, 0.3], [0.3, 0.5], [0.5, 0.7], [0.7, 0.85], [0.85, 1.1]]) {
    const q = diffs.filter((x) => x.L >= a && x.L < b);
    if (q.length < 3) continue;
    const m = q.reduce((s, x) => s + x.d, 0) / q.length;
    console.log("    L %s-%s : %s paires, chroma %s, difference %s deg",
      a.toFixed(2), b.toFixed(2), String(q.length).padStart(4),
      (q.reduce((s, x) => s + x.c, 0) / q.length).toFixed(4),
      ((m >= 0 ? "+" : "") + m.toFixed(1)).padStart(6));
  }
}

// ── 10. LE MODELE angle(L, chroma) EST-IL PARTAGE ? ──────────────────────────
// Dernier controle, croise : on ajuste angle = a0 + a1*L + a2*c sur UNE roue, et
// on s'en sert pour predire l'AUTRE. Si le plan d'une roue predit l'autre au
// niveau du bruit, les deux sont sur la meme surface et la loi est partagee.
function plan(pts) {
  const n = pts.length;
  let sL = 0, sC = 0, sA = 0;
  const ref = resume(pts).moyen;
  for (const p of pts) { sL += p.L; sC += p.c; sA += ecartAngle(p.angle, ref); }
  const mL = sL / n, mC = sC / n, mA = sA / n;
  let sll = 0, scc = 0, slc = 0, sla = 0, sca = 0;
  for (const p of pts) {
    const dl = p.L - mL, dc = p.c - mC, da = ecartAngle(p.angle, ref) - mA;
    sll += dl * dl; scc += dc * dc; slc += dl * dc; sla += dl * da; sca += dc * da;
  }
  const det = sll * scc - slc * slc;
  const a1 = (sca * slc - sla * scc) / -det, a2 = (sla * slc - sca * sll) / -det;
  return { f: (L, c) => ref + mA + a1 * (L - mL) + a2 * (c - mC), a1, a2 };
}
console.log("");
console.log("10. LE PLAN angle(L, chroma) D'UNE ROUE PREDIT-IL L'AUTRE ?");
console.log("");
console.log("teinte  plan ajuste sur  pente/L  pente/chroma  erreur sur sa roue  erreur sur l'AUTRE");
console.log("".padEnd(98, "-"));
for (const t of [40, 220]) {
  const o = D["st-h" + String(t).padStart(3, "0")].propres;
  const g = D["cg-glob-h" + String(t).padStart(3, "0")].propres;
  for (const [nom, src, dst] of [["ombres", o, g], ["GLOBALE", g, o]]) {
    const p = plan(src);
    const err = (pts) => pts.reduce((s, q) => s + Math.abs(ecartAngle(q.angle, p.f(q.L, q.c))), 0) / pts.length;
    console.log("%s %s %s %s %s %s",
      String(t).padStart(6), nom.padStart(16), p.a1.toFixed(1).padStart(8),
      (p.a2 * 0.1).toFixed(1).padStart(13), err(src).toFixed(2).padStart(19), err(dst).toFixed(2).padStart(19));
  }
}
console.log("");
console.log("Le bruit de quantification seul vaut 1,28 a 2,51 deg. Une erreur croisee");
console.log("a ce niveau = une seule surface, donc une seule loi. Tres au-dessus = deux surfaces.");

// ── 11. BALAYAGE DE TOLERANCE — le residu apparie tient-il quand on serre ? ──
// La section 9 laisse 4,3 et 3,9 deg apres appariement. Deux lectures : un vrai
// reste de loi par roue, ou un appariement encore trop lache. On serre. Un reste
// qui DECROIT avec la tolerance est du mesappariement residuel ; un reste qui
// PLAFONNE est reel.
console.log("");
console.log("11. BALAYAGE DE TOLERANCE — le reste apparie decroit-il ou plafonne-t-il ?");
console.log("");
console.log("tol L   tol c    teinte 40: paires  diff | teinte 220: paires  diff");
console.log("".padEnd(80, "-"));
for (const [tl, tc] of [[0.08, 0.008], [0.04, 0.004], [0.02, 0.002], [0.01, 0.001], [0.005, 0.0005]]) {
  const ligne = [tl.toFixed(3).padStart(6), tc.toFixed(4).padStart(8)];
  for (const t of [40, 220]) {
    const o = D["st-h" + String(t).padStart(3, "0")].propres;
    const g = D["cg-glob-h" + String(t).padStart(3, "0")].propres;
    const ds = [];
    for (const pg of g) for (const po of o)
      if (Math.abs(pg.L - po.L) <= tl && Math.abs(pg.c - po.c) <= tc) ds.push(ecartAngle(pg.angle, po.angle));
    ligne.push(String(ds.length).padStart(17));
    ligne.push(ds.length ? ((ds.reduce((s, x) => s + x, 0) / ds.length >= 0 ? "+" : "") +
      (ds.reduce((s, x) => s + x, 0) / ds.length).toFixed(1)).padStart(6) : "     -");
  }
  console.log("%s %s %s %s | %s %s", ...ligne);
}
console.log("");
console.log("CONTROLE DE SIGNE : les deux teintes doivent donner des restes de SIGNE OPPOSE");
console.log("si c'est une rotation par roue (la roue globale tourne dans un sens absolu),");
console.log("et de MEME signe relatif a la direction si c'est une loi. teinte 40 = %s, 220 = %s.",
  recap[40] ? recap[40].m.toFixed(1) : "-", recap[220] ? recap[220].m.toFixed(1) : "-");
