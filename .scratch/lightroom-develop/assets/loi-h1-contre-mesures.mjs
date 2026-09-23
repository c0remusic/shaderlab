// CONTRE-MESURES — ce que l'ablation pouvait dire, et ce qu'elle a laisse dehors.
//
// TROIS PIECES.
//  G. L'ANGLE DU BLOC RETIRE. L'ablation ne rend qu'un scalaire (« ca a bouge »
//     ou « ca n'a pas bouge »). La quantite qu'on voulait vraiment est directe et
//     n'a jamais ete imprimee : l'angle MOYEN des niveaux ecretes, compare a
//     celui des niveaux propres. Si les deux coincident, l'ecretage n'a tourne
//     personne — et on le sait sans dependre du levier de la ponderation.
//  H. CONTROLE APPARIE DERIVE / PAS DERIVE. Deux mondes synthetiques a ECRETAGE
//     IDENTIQUE, ne differant QUE par la derive. La difference de verdict entre
//     les deux est imputable a la derive seule. C'est le controle qui separe les
//     deux causes, la ou S1/S3 les melangeaient.
//  I. L'AXE QUE PERSONNE N'A UTILISE — L'AMPLITUDE. Le modele veut dir() UNITAIRE,
//     donc la chroma ajoutee IDENTIQUE d'une teinte a l'autre. Mesuree, elle va de
//     75,9 % a 134,8 % de la mediane. Ce n'est pas du bruit, et ce n'est pas une
//     question separee : chaque famille candidate PREDIT une norme par teinte
//     (la longueur du vecteur ab de sa couleur de roue). C'est donc un
//     discriminant gratuit, independant de l'angle, jamais releve.
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
const labSrgbHsl = (h) => { const c = roue(h); return linearSrgbToOklab(c.map(srgbToLinear)).slice(1); };
const labProPhotoLin = (h) => linearSrgbToOklab(ap(XS, ap(PP, roue(h)))).slice(1);
const labProPhotoGamma = (h) => linearSrgbToOklab(ap(XS, ap(PP, roue(h).map((c) => Math.pow(c, 1.8))))).slice(1);
const angleProPhotoLineaire = (h) => deg(...labProPhotoLin(h));
const ZERO = deg(...labSrgbHsl(0));

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
function agrege(niveaux) {
  const lus = niveaux.filter((x) => x.chroma >= SEUIL);
  if (lus.length < 3) return { n: lus.length, insuffisant: true };
  let sx = 0, sy = 0, sw = 0;
  for (const x of lus) { sx += x.chroma * Math.cos(rad(x.angle)); sy += x.chroma * Math.sin(rad(x.angle)); sw += x.chroma; }
  return { n: lus.length, moyen: deg(sx, sy), poids: sw };
}
const propre = (x, m) => x.bas >= m && x.haut <= 255 - m;

const DATA = new Map();
for (const t of TEINTES) { const r = rampe(`st-h${String(t).padStart(3, "0")}`); if (r) DATA.set(t, r); }
const VUS = [...DATA.keys()];

// ── G. L'ANGLE DU BLOC RETIRE ───────────────────────────────────────────────
console.log("G. LES NIVEAUX ECRETES SONT-ILS TOURNES ? (la mesure directe)");
console.log("L'ablation demandait « la moyenne bouge-t-elle ? », ce qui depend du POIDS");
console.log("du bloc. La question sans detour est « le bloc est-il a un autre angle ? ».");
console.log("");
console.log("teinte   niv ecretes   angle bloc ecrete   angle bloc propre   ECART   lecture");
console.log("".padEnd(96, "-"));
for (const t of VUS) {
  const r = DATA.get(t);
  const sale = agrege(r.filter((x) => !propre(x, 1)));
  const net = agrege(r.filter((x) => propre(x, 1)));
  if (sale.insuffisant || net.insuffisant) {
    console.log("%s %s   pas assez de niveaux d'un cote (%s / %s)", String(t).padStart(6),
      String(sale.insuffisant ? sale.n : "-").padStart(13), String(sale.n), String(net.n));
    continue;
  }
  const d = ecartAngle(sale.moyen, net.moyen);
  console.log("%s %s %s %s %s   %s", String(t).padStart(6), String(sale.n).padStart(13),
    sale.moyen.toFixed(1).padStart(19), net.moyen.toFixed(1).padStart(19),
    ((d >= 0 ? "+" : "") + d.toFixed(1)).padStart(7),
    Math.abs(d) < 3 ? "bloc NON tourne" : "bloc tourne — l'ecretage agit ici");
}

// ── H. CONTROLE APPARIE — MEME ECRETAGE, DERIVE OU PAS ──────────────────────
// On fabrique la MEME rampe deux fois : meme loi de chroma, donc EXACTEMENT le
// meme ecretage, et on n'ajoute la derive que dans un des deux mondes. Tout ce
// qui differe entre les deux verdicts est imputable a la derive, et a rien
// d'autre. C'est le controle que le script d'origine n'a pas fait.
console.log("");
console.log("H. CONTROLE APPARIE — MEME ECRETAGE, LA DERIVE POUR SEULE DIFFERENCE");
console.log("Meme amplitude de chroma des deux cotes, donc le MEME nombre de niveaux");
console.log("ecretes. Seule la derive change. La difference de verdict lui revient.");
console.log("");
const amplitude = (n, k) => k * Math.exp(-Math.pow(n / 255, 2.2) * 2.6);
function fabrique(teinte, derive, k) {
  const rgb = [];
  for (let n = 0; n <= 255; n++) {
    const L = Math.cbrt(s2l(n / 255));
    const a = rad(angleProPhotoLineaire(teinte) + (derive * (n - 128)) / 100);
    const c = amplitude(n, k);
    const lin = oklabToLinearSrgb([L, c * Math.cos(a), c * Math.sin(a)]);
    rgb.push(lin.map((v) => Math.round(linearToSrgb(Math.max(0, Math.min(1, v))) * 255)));
  }
  return rampeDe(rgb);
}
console.log("teinte  k      derive   niv ecretes   residu tous   non ecretes   variation   verdict");
console.log("".padEnd(100, "-"));
for (const t of [140, 220]) {
  for (const k of [0.13, 0.085]) {
    for (const derive of [0, 9.9]) {
      const r = fabrique(t, derive, k), pp = angleProPhotoLineaire(t);
      const a = agrege(r), b = agrege(r.filter((x) => propre(x, 1)));
      const ecretes = r.filter((x) => x.bas < 1).length;
      const rA = a.insuffisant ? null : ecartAngle(a.moyen, pp);
      const rB = b.insuffisant ? null : ecartAngle(b.moyen, pp);
      const dep = rA === null ? null : Math.abs(rA), arr = rB === null ? null : Math.abs(rB);
      let v = "NON CONCLUANT";
      if (!b.insuffisant) {
        if (arr < 3 && dep >= 9) v = "ECRETAGE";
        else if (arr < dep * 0.5) v = "ECRETAGE EN PARTIE";
        else if (Math.abs(arr - dep) < 2) v = "LA LOI";
        else v = "MIXTE";
      }
      console.log("%s %s %s %s %s %s %s   %s", String(t).padStart(6), String(k).padStart(6),
        String(derive).padStart(9), String(ecretes).padStart(12),
        (rA === null ? "--" : (rA >= 0 ? "+" : "") + rA.toFixed(1)).padStart(13),
        (rB === null ? "--" : (rB >= 0 ? "+" : "") + rB.toFixed(1)).padStart(13),
        (dep !== null && arr !== null ? ((arr - dep >= 0 ? "+" : "") + (arr - dep).toFixed(1)) : "--").padStart(11), v);
    }
  }
}
console.log("");
console.log("Lire par PAIRES : meme teinte, meme k, donc meme ecretage. Si la ligne a");
console.log("derive 0 rend « LA LOI » et celle a derive 9,9 rend « ECRETAGE », le verdict");
console.log("de l'ablation est produit par la derive.");

// ── I. L'AMPLITUDE — UN DISCRIMINANT GRATUIT, JAMAIS RELEVE ─────────────────
// Le modele en service dit : da,db += dir(teinte) * (sat/100) * chromaK * poids(L),
// avec dir UNITAIRE. La chroma de sortie ne devrait donc PAS dependre de la teinte.
// Mesuree, elle varie de 75,9 % a 134,8 %. Chaque famille candidate predit cette
// variation : si la teinte du selecteur est portee par une couleur de roue dans
// un espace donne, la NORME du vecteur ab de cette couleur varie avec la teinte
// exactement comme son angle. On confronte les deux.
console.log("");
console.log("I. L'AMPLITUDE DE LA CHROMA — L'AXE QUE L'INSTRUMENT NE REGARDE PAS");
console.log("Le modele veut dir() UNITAIRE, donc une chroma EGALE pour toutes les teintes.");
console.log("Elle ne l'est pas. Chaque famille predit sa propre variation ; on compare.");
console.log("");
const NIVEAUX = [8, 16, 24, 32, 48, 64, 96, 128];
const mesure = new Map();
for (const t of VUS) mesure.set(t, NIVEAUX.map((n) => DATA.get(t)[n].chroma));
const medianeParNiveau = NIVEAUX.map((_, i) => {
  const v = VUS.map((t) => mesure.get(t)[i]).sort((a, b) => a - b);
  return v[Math.floor(v.length / 2)];
});
const relMesuree = new Map();
for (const t of VUS) relMesuree.set(t, mesure.get(t).map((c, i) => c / medianeParNiveau[i]).reduce((s, x) => s + x, 0) / NIVEAUX.length);

const FAMILLES = [
  ["A. HSL sur sRGB (en service)", labSrgbHsl],
  ["B. angle direct OKLCh", (h) => [Math.cos(rad(ZERO + h)), Math.sin(rad(ZERO + h))]],
  ["C. ProPhoto RGB gamma 1,8", labProPhotoGamma],
  ["D. ProPhoto RGB lineaire", labProPhotoLin],
];
console.log("teinte   chroma mesuree" + FAMILLES.map(([n]) => n.slice(0, 2).padStart(12)).join("") + "   (en %% de la mediane)");
console.log("".padEnd(88, "-"));
const predites = new Map();
for (const [nom, f] of FAMILLES) {
  const normes = VUS.map((t) => Math.hypot(...f(t)));
  const med = [...normes].sort((a, b) => a - b)[Math.floor(normes.length / 2)];
  predites.set(nom, new Map(VUS.map((t, i) => [t, normes[i] / med])));
}
for (const t of VUS) {
  console.log("%s %s%s", String(t).padStart(6), (relMesuree.get(t) * 100).toFixed(1).padStart(15),
    FAMILLES.map(([nom]) => (predites.get(nom).get(t) * 100).toFixed(1).padStart(12)).join(""));
}
console.log("");
console.log("famille                              ecart moyen sur l'AMPLITUDE (points de %%)");
console.log("".padEnd(80, "-"));
const clA = FAMILLES.map(([nom]) => {
  const e = VUS.map((t) => Math.abs(predites.get(nom).get(t) - relMesuree.get(t)) * 100);
  return { nom, moy: e.reduce((s, x) => s + x, 0) / e.length };
}).sort((a, b) => a.moy - b.moy);
for (const c of clA) console.log("%s %s", c.nom.padEnd(36), c.moy.toFixed(1).padStart(10));
console.log("");
console.log("Reference : une dir() vraiment UNITAIRE predirait 100,0 %% partout.");
{
  const e = VUS.map((t) => Math.abs(1 - relMesuree.get(t)) * 100);
  console.log("  modele « dir unitaire »              %s", (e.reduce((s, x) => s + x, 0) / e.length).toFixed(1).padStart(10));
  const min = Math.min(...VUS.map((t) => relMesuree.get(t))), max = Math.max(...VUS.map((t) => relMesuree.get(t)));
  console.log("  etendue mesuree : %s %% a %s %% — rapport %s entre la teinte la plus",
    (min * 100).toFixed(1), (max * 100).toFixed(1), (max / min).toFixed(2));
  console.log("  chromatique et la moins. Ce n'est pas une question separee de l'angle :");
  console.log("  c'est la MEME loi vue sur son autre composante.");
}
