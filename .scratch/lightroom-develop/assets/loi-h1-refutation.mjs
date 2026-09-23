// REFUTATION DE H1 — LE "TEST DECISIF" EST-IL DECISIF ?
//
// CE QUI EST EN CAUSE. `loi-h1-gamut.mjs` tranche par ABLATION : il retire les
// niveaux ecretes, relit le residu, et conclut « ECRETAGE » si le residu tombe,
// « LA LOI » s'il ne bouge pas. Il rend 220 = INCHANGE (donc la loi) et
// 140/150 = EFFONDRE (donc l'ecretage).
//
// DEUX SOUPCONS, ET ILS TIRENT DANS DES SENS OPPOSES.
//
//  A. PUISSANCE. L'estimateur est une moyenne circulaire PONDEREE PAR LA CHROMA.
//     Les niveaux ecretes sont les niveaux BAS, et les niveaux bas portent la
//     chroma la plus FAIBLE (0,025 a n=8 contre 0,079 a n=128 sur 220). Le test
//     retire donc exactement ce que son estimateur pondere le moins. Si le bloc
//     retire ne porte que quelques pour cent du poids, « inchange » ne prouve
//     rien : l'ablation ne POUVAIT pas bouger, quelle que soit la verite.
//     On chiffre le LEVIER — de combien de degres l'ablation pouvait-elle
//     deplacer la moyenne AU MAXIMUM.
//
//  B. CONFUSION. Retirer les niveaux bas ne retire pas « l'ecretage », ca
//     DEPLACE LA FENETRE DE NIVEAUX. Or l'angle DERIVE avec le niveau (colonne
//     `derive` du script : +9,9 deg/100 niveaux sur 140). Un deplacement de
//     fenetre suffit donc a faire bouger le residu SANS aucun ecretage. On
//     predit le changement par derive x deplacement, et on compare a l'observe.
//
// TROIS CONTROLES QUI MANQUENT AU SCRIPT D'ORIGINE.
//  1. PLACEBO — la meme coupe de fenetre appliquee a des teintes NON ecretees.
//  2. BALAYAGE DE FENETRE — le residu en fonction du niveau de coupe. Si c'est
//     une courbe lisse, la coupe « ecretage » n'est qu'un point comme un autre.
//  3. CONTROLE SYNTHETIQUE DE L'ABLATION ELLE-MEME. Le controle existant
//     (`loi-de-teinte-controle.mjs`) valide l'estimateur d'ANGLE et dit en toutes
//     lettres : « Ce qui n'est PAS simule : l'ecretage de gamut [...] et une
//     eventuelle derive de l'angle avec le niveau ». C'est-a-dire les DEUX
//     ingredients du test H1. L'ablation n'a donc jamais ete eprouvee sur une
//     reponse connue. On le fait ici : loi EXACTE + derive, sans le moindre
//     ecretage — l'ablation doit rendre « rien ». Si elle crie « ECRETAGE »,
//     son verdict sur 140/150 est un artefact.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab, oklabToLinearSrgb } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear, linearToSrgb } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;
const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];

const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const roue = (h) => hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
const angleProPhotoLineaire = (h) => deg(...linearSrgbToOklab(ap(XS, ap(PP, roue(h)))).slice(1));

function rampeDe(rgb) {
  return rgb.map(([R, G, B], n) => {
    const lab = linearSrgbToOklab([s2l(R / 255), s2l(G / 255), s2l(B / 255)]);
    return { n, R, G, B, bas: Math.min(R, G, B), haut: Math.max(R, G, B),
             angle: deg(lab[1], lab[2]), chroma: Math.hypot(lab[1], lab[2]) };
  });
}
function rampe(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  return rampeDe(JSON.parse(readFileSync(f, "utf8")).rampe_rgb);
}

/** Exactement l'estimateur de loi-h1-gamut.mjs, plus le NIVEAU MOYEN PONDERE et
 *  le POIDS TOTAL — les deux quantites qui manquaient pour juger sa puissance. */
function agrege(niveaux) {
  const lus = niveaux.filter((x) => x.chroma >= SEUIL);
  if (lus.length < 3) return { n: lus.length, insuffisant: true };
  let sx = 0, sy = 0, sw = 0, swn = 0;
  for (const x of lus) {
    sx += x.chroma * Math.cos(rad(x.angle)); sy += x.chroma * Math.sin(rad(x.angle));
    sw += x.chroma; swn += x.chroma * x.n;
  }
  const moyen = deg(sx, sy);
  let num = 0, den = 0;
  const nMoy = lus.reduce((s, x) => s + x.n, 0) / lus.length;
  for (const x of lus) { num += (x.n - nMoy) * ecartAngle(x.angle, moyen); den += (x.n - nMoy) ** 2; }
  return { n: lus.length, moyen, poids: sw, niveauPondere: swn / sw,
           pente: den > 0 ? (num / den) * 100 : 0, premier: lus[0].n, dernier: lus[lus.length - 1].n };
}
const propre = (x, marge) => x.bas >= marge && x.haut <= 255 - marge;

const DATA = new Map();
for (const t of TEINTES) { const r = rampe(`st-h${String(t).padStart(3, "0")}`); if (r) DATA.set(t, r); }
const VUS = [...DATA.keys()];

console.log("REFUTATION DE H1 — LE TEST PAR ABLATION EST-IL DECISIF ?");
console.log("");

// ── A. LE LEVIER DE L'ABLATION ──────────────────────────────────────────────
// Le vecteur moyen est une somme ponderee. Retirer un bloc qui porte une
// fraction w du poids, situe a un ecart angulaire d de la moyenne, deplace la
// moyenne de atan2(-w sin d, 1 - w + w cos d). Le DEPLACEMENT MAXIMAL possible
// s'obtient a d = +/-90 deg et vaut atan(w / (1-w)) : c'est le plafond de ce que
// l'ablation pouvait montrer, quelle que soit la verite sur l'ecretage.
console.log("A. PUISSANCE DU TEST — DE COMBIEN L'ABLATION POUVAIT-ELLE BOUGER ?");
console.log("Les niveaux retires sont les niveaux BAS, et l'estimateur pondere par la");
console.log("chroma, qui y est la plus faible. w = part du poids total portee par le");
console.log("bloc retire. Plafond = deplacement maximal de la moyenne, toutes verites");
console.log("confondues. Un plafond sous l'anomalie a expliquer rend le test AVEUGLE.");
console.log("");
console.log("teinte  niv retires  w (%% du poids)   plafond du deplacement   anomalie a expliquer   test");
console.log("".padEnd(104, "-"));
const leviers = new Map();
for (const t of VUS) {
  const r = DATA.get(t);
  const tous = agrege(r), garde = agrege(r.filter((x) => propre(x, 1)));
  if (tous.insuffisant || garde.insuffisant) { console.log("%s   insuffisant", String(t).padStart(6)); continue; }
  const w = (tous.poids - garde.poids) / tous.poids;
  const plafond = (Math.atan(w / Math.max(1e-9, 1 - w)) * 180) / Math.PI;
  const anomalie = Math.abs(ecartAngle(tous.moyen, angleProPhotoLineaire(t)));
  leviers.set(t, { w, plafond, anomalie });
  console.log("%s %s %s %s %s   %s",
    String(t).padStart(6), String(tous.n - garde.n).padStart(12), (w * 100).toFixed(1).padStart(15),
    plafond.toFixed(1).padStart(24), anomalie.toFixed(1).padStart(22),
    plafond >= anomalie ? "peut trancher" : "AVEUGLE (plafond < anomalie)");
}
console.log("");
{
  const l = leviers.get(220);
  if (l) console.log("  -> Sur 220 : le bloc retire porte %s %% du poids. Meme s'il avait ete\n     distordu de 90 degres, la moyenne n'aurait bouge que de %s deg — contre\n     %s deg a expliquer. « Inchange » etait le seul resultat POSSIBLE.",
    (l.w * 100).toFixed(1), l.plafond.toFixed(1), l.anomalie.toFixed(1));
}

// ── B. LA CONFUSION DERIVE x FENETRE ────────────────────────────────────────
console.log("");
console.log("B. LE CHANGEMENT S'EXPLIQUE-T-IL SANS AUCUN ECRETAGE ?");
console.log("Retirer les niveaux bas DEPLACE la fenetre. L'angle derivant avec le niveau,");
console.log("ce seul deplacement predit un changement de residu. Predit = derive x");
console.log("deplacement du niveau moyen pondere. Rien d'autre n'est suppose.");
console.log("");
console.log("teinte  niveau moyen  ->  apres    deplacement   derive/100   PREDIT   OBSERVE   reste");
console.log("".padEnd(96, "-"));
let sReste = 0, nReste = 0;
for (const t of VUS) {
  const r = DATA.get(t);
  const a = agrege(r), b = agrege(r.filter((x) => propre(x, 1)));
  if (a.insuffisant || b.insuffisant) continue;
  const dep = b.niveauPondere - a.niveauPondere;
  const predit = (a.pente / 100) * dep;
  const observe = ecartAngle(b.moyen, a.moyen);
  const reste = observe - predit;
  sReste += Math.abs(reste); nReste++;
  console.log("%s %s %s %s %s %s %s %s",
    String(t).padStart(6), a.niveauPondere.toFixed(1).padStart(12), b.niveauPondere.toFixed(1).padStart(9),
    dep.toFixed(1).padStart(13), a.pente.toFixed(2).padStart(12),
    ((predit >= 0 ? "+" : "") + predit.toFixed(1)).padStart(8),
    ((observe >= 0 ? "+" : "") + observe.toFixed(1)).padStart(9),
    ((reste >= 0 ? "+" : "") + reste.toFixed(1)).padStart(7));
}
console.log("");
console.log("  reste moyen absolu apres retrait de la derive : %s deg sur %d teintes.", (sReste / nReste).toFixed(2), nReste);
console.log("  (le « reste » est ce que l'ecretage aurait a expliquer EN PLUS de la derive)");

// ── C. PLACEBO — LA MEME COUPE SUR DES TEINTES NON ECRETEES ─────────────────
console.log("");
console.log("C. PLACEBO — LA MEME COUPE DE FENETRE, SANS AUCUN ECRETAGE");
console.log("On coupe a n < 169 (la coupe que l'ecretage impose a 140) sur les teintes");
console.log("qui n'ont AUCUN niveau ecrete la. Si leur residu bouge autant, la coupe ne");
console.log("mesure pas l'ecretage, elle mesure la fenetre.");
console.log("");
console.log("teinte  ecretes sous n=169   residu complet   residu apres coupe   variation");
console.log("".padEnd(88, "-"));
for (const t of VUS) {
  const r = DATA.get(t), pp = angleProPhotoLineaire(t);
  const ecretesSous = r.filter((x) => x.n < 169 && x.bas < 1).length;
  const a = agrege(r), b = agrege(r.filter((x) => x.n >= 169 && propre(x, 1)));
  if (a.insuffisant) continue;
  const rA = ecartAngle(a.moyen, pp);
  const rB = b.insuffisant ? null : ecartAngle(b.moyen, pp);
  console.log("%s %s %s %s %s",
    String(t).padStart(6), String(ecretesSous).padStart(18),
    ((rA >= 0 ? "+" : "") + rA.toFixed(1)).padStart(16),
    (rB === null ? `n=${b.n}` : (rB >= 0 ? "+" : "") + rB.toFixed(1)).padStart(20),
    (rB === null ? "--" : (Math.abs(rB) - Math.abs(rA) >= 0 ? "+" : "") + (Math.abs(rB) - Math.abs(rA)).toFixed(1)).padStart(11));
}

// ── D. BALAYAGE DE FENETRE — la coupe « ecretage » est-elle un point special ?
console.log("");
console.log("D. RESIDU EN FONCTION DU NIVEAU DE COUPE BASSE (marge 1,0 en plus)");
console.log("Si le residu est une COURBE LISSE du niveau de coupe, la coupe imposee par");
console.log("l'ecretage n'a rien de particulier : c'est un point sur une pente.");
console.log("");
const COUPES = [0, 32, 64, 96, 128, 160, 192];
console.log("teinte " + COUPES.map((c) => ("n>=" + c).padStart(9)).join("") + "    coupe imposee par l'ecretage");
console.log("".padEnd(104, "-"));
for (const t of VUS) {
  const r = DATA.get(t), pp = angleProPhotoLineaire(t);
  const cells = COUPES.map((c) => {
    const g = agrege(r.filter((x) => x.n >= c && propre(x, 1)));
    if (g.insuffisant) return ("n=" + g.n).padStart(9);
    const e = ecartAngle(g.moyen, pp);
    return ((e >= 0 ? "+" : "") + e.toFixed(1)).padStart(9);
  });
  const dernierEcrete = r.filter((x) => x.bas < 1).map((x) => x.n).pop();
  console.log("%s%s %s", String(t).padStart(6), cells.join(""),
    ("n >= " + ((dernierEcrete ?? -1) + 1)).padStart(30));
}

// ── E. LE CONTROLE QUI MANQUE — L'ABLATION SUR UNE REPONSE CONNUE ───────────
// Trois mondes synthetiques, tous sous la loi D EXACTE (residu vrai = 0 a la
// base de la fenetre) :
//   S1 — derive seule, AUCUN ecretage. L'ablation doit rendre « rien ».
//   S2 — ecretage seul, AUCUNE derive. L'ablation doit rendre « ecretage ».
//   S3 — ni l'un ni l'autre. Plancher de bruit de quantification.
console.log("");
console.log("E. CONTROLE ABSENT DU SCRIPT D'ORIGINE — L'ABLATION SUR UNE REPONSE CONNUE");
console.log("Trois mondes fabriques sous la loi D EXACTE. La verite est connue par");
console.log("construction ; on regarde ce que l'ablation en dit.");
console.log("");
const amplitude = (n) => 0.085 * Math.exp(-Math.pow(n / 255, 2.2) * 2.6);
function fabrique(teinte, { derive = 0, biaisEcretage = 0 }) {
  const rgb = [];
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const L = Math.cbrt(lin);
    // La derive fait TOURNER l'angle avec le niveau, autour du niveau 128 pour
    // que la loi reste exacte au milieu de la fenetre.
    const a = rad(angleProPhotoLineaire(teinte) + (derive * (n - 128)) / 100);
    const c = amplitude(n);
    let lab = [L, c * Math.cos(a), c * Math.sin(a)];
    // biaisEcretage : on POUSSE la chroma jusqu'a sortir du gamut en bas de
    // rampe, ce qui produit un VRAI ecretage de canal a l'encodage.
    if (biaisEcretage > 0) lab = [L, lab[1] * (1 + biaisEcretage), lab[2] * (1 + biaisEcretage)];
    const lin3 = oklabToLinearSrgb(lab);
    rgb.push(lin3.map((v) => Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));
  }
  return rampeDe(rgb);
}
const MONDES = [
  ["S1 derive +10/100, zero ecretage", { derive: 10, biaisEcretage: 0 }],
  ["S2 ecretage fort, zero derive", { derive: 0, biaisEcretage: 3.2 }],
  ["S3 ni derive ni ecretage", { derive: 0, biaisEcretage: 0 }],
];
console.log("monde                              teinte  ecretes  residu tous  non ecretes  variation  verdict rendu");
console.log("".padEnd(112, "-"));
for (const [nom, opt] of MONDES) {
  for (const t of [140, 220]) {
    const r = fabrique(t, opt), pp = angleProPhotoLineaire(t);
    const a = agrege(r), b = agrege(r.filter((x) => propre(x, 1)));
    const ecretes = r.filter((x) => x.bas < 1).length;
    const rA = a.insuffisant ? null : ecartAngle(a.moyen, pp);
    const rB = b.insuffisant ? null : ecartAngle(b.moyen, pp);
    // La grille de verdict de loi-h1-gamut.mjs, recopiee a l'identique.
    let v;
    const dep = rA === null ? null : Math.abs(rA), arr = rB === null ? null : Math.abs(rB);
    if (b.insuffisant) v = "NON CONCLUANT";
    else if (arr < 3 && dep >= 9) v = "ECRETAGE";
    else if (arr < dep * 0.5) v = "ECRETAGE EN PARTIE";
    else if (Math.abs(arr - dep) < 2) v = "LA LOI";
    else v = "MIXTE";
    console.log("%s %s %s %s %s %s  %s", nom.padEnd(34), String(t).padStart(6),
      String(ecretes).padStart(8),
      (rA === null ? "--" : (rA >= 0 ? "+" : "") + rA.toFixed(1)).padStart(12),
      (rB === null ? "--" : (rB >= 0 ? "+" : "") + rB.toFixed(1)).padStart(12),
      (dep !== null && arr !== null ? ((arr - dep >= 0 ? "+" : "") + (arr - dep).toFixed(1)) : "--").padStart(10), v);
  }
}
console.log("");
console.log("LECTURE. S1 n'a AUCUN pixel ecrete par construction. Si l'ablation y rend");
console.log("autre chose que « LA LOI », alors le verdict « ECRETAGE EN PARTIE » rendu sur");
console.log("140 et 150 est produit par la DERIVE, pas par l'ecretage.");

// ── F. CE QUE LA DERIVE FAIT AU CHIFFRE MEME DE « RESIDU » ──────────────────
console.log("");
console.log("F. Y A-T-IL SEULEMENT UN ANGLE PAR TEINTE ?");
console.log("Le classement suppose qu'une teinte a UN angle. Avec une derive, l'angle");
console.log("BALAYE un arc sur la fenetre lisible, et « le » residu n'est qu'un point");
console.log("choisi dans cet arc par la ponderation.");
console.log("");
console.log("teinte  fenetre lisible   derive/100   ARC BALAYE   residu (arbitraire dans l'arc ?)");
console.log("".padEnd(92, "-"));
for (const t of VUS) {
  const r = DATA.get(t), a = agrege(r);
  if (a.insuffisant) continue;
  const arc = Math.abs((a.pente / 100) * (a.dernier - a.premier));
  const res = ecartAngle(a.moyen, angleProPhotoLineaire(t));
  console.log("%s %s %s %s %s   %s", String(t).padStart(6),
    (a.premier + "-" + a.dernier).padStart(16), a.pente.toFixed(2).padStart(12),
    arc.toFixed(1).padStart(12), ((res >= 0 ? "+" : "") + res.toFixed(1)).padStart(9),
    arc > 2 * Math.abs(res) && arc > 6 ? "OUI — l'arc depasse le residu" : "");
}
