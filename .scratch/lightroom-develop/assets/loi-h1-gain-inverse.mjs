// LE « 0,6 DEG » DE REPRODUCTIBILITE EST-IL UN DEGRE ?
//
// La contre-epreuve 3 du script d'origine imprime QUATRE colonnes pour la meme
// teinte 220 sur deux roues :
//     st-h220        angle -132,9   residu +21,3   teinte impliquee 246,1
//     cg-glob-h220   angle -122,9   residu +31,3   teinte impliquee 246,7
// L'angle et le residu different de DIX degres. La teinte impliquee, de 0,6.
// C'est cette derniere qui a ete retenue comme preuve de reproductibilite.
//
// Les deux colonnes ne sont pas dans la meme unite. La teinte impliquee est
// l'ANTECEDENT de l'angle par la loi ProPhoto lineaire ; si cette loi a un GAIN
// LOCAL eleve pres de 246 — beaucoup de degres d'angle pour un degre de
// curseur — alors son inverse ECRASE les desaccords, et « 0,6 » ne mesure plus
// un accord mais une compression d'echelle.
//
// On mesure donc le gain local de la loi, teinte par teinte, et on convertit le
// desaccord dans les deux sens.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const rad = (d) => (d * Math.PI) / 180;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
const roue = (h) => hsl2rgb((((h % 360) + 360) % 360) / 360, 1, 0.5);
const A = (h) => deg(...linearSrgbToOklab(ap(XS, ap(PP, roue(h)))).slice(1));

console.log("GAIN LOCAL DE LA LOI ProPhoto LINEAIRE — combien de degres d'ANGLE OKLab");
console.log("par degre de CURSEUR ? (derivee centree, pas de 0,25 deg)");
console.log("");
console.log("teinte curseur   dA/dh   1 deg de curseur vaut   1 deg d'angle vaut");
console.log("".padEnd(76, "-"));
for (const h of [0, 40, 60, 90, 140, 150, 180, 200, 220, 240, 246, 250, 260, 270, 300, 330]) {
  const g = ecartAngle(A(h + 0.25), A(h - 0.25)) / 0.5;
  console.log("%s %s %s %s", String(h).padStart(14), g.toFixed(2).padStart(7),
    (g.toFixed(2) + " deg d'angle").padStart(24), ((1 / g).toFixed(3) + " deg de curseur").padStart(22));
}

console.log("");
console.log("LE DESACCORD ENTRE LES DEUX ROUES, DANS LES DEUX UNITES");
console.log("");
function rampe(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  return JSON.parse(readFileSync(f, "utf8")).rampe_rgb.map(([R, G, B], n) => {
    const lab = linearSrgbToOklab([s2l(R / 255), s2l(G / 255), s2l(B / 255)]);
    return { n, bas: Math.min(R, G, B), haut: Math.max(R, G, B),
             angle: deg(lab[1], lab[2]), chroma: Math.hypot(lab[1], lab[2]) };
  });
}
function agrege(niveaux) {
  const lus = niveaux.filter((x) => x.chroma >= SEUIL);
  if (lus.length < 3) return { n: lus.length, insuffisant: true };
  let sx = 0, sy = 0, sw = 0, swn = 0;
  for (const x of lus) {
    sx += x.chroma * Math.cos(rad(x.angle)); sy += x.chroma * Math.sin(rad(x.angle));
    sw += x.chroma; swn += x.chroma * x.n;
  }
  const moyen = deg(sx, sy);
  const nMoy = lus.reduce((s, x) => s + x.n, 0) / lus.length;
  let num = 0, den = 0;
  for (const x of lus) { num += (x.n - nMoy) * ecartAngle(x.angle, moyen); den += (x.n - nMoy) ** 2; }
  return { n: lus.length, moyen, niveauPondere: swn / sw, pente: den > 0 ? (num / den) * 100 : 0,
           premier: lus[0].n, dernier: lus[lus.length - 1].n };
}
function inverse(vise) {
  let best = 0, bestE = Infinity;
  for (let h = 0; h < 360; h += 0.05) { const e = Math.abs(ecartAngle(vise, A(h))); if (e < bestE) { bestE = e; best = h; } }
  return best;
}
const propre = (x, m) => x.bas >= m && x.haut <= 255 - m;

console.log("scene            niv  niveau pond.  derive/100   angle mesure   residu   teinte impliquee");
console.log("".padEnd(100, "-"));
const vus = {};
for (const [nom, t] of [["st-h040", 40], ["cg-glob-h040", 40], ["st-h220", 220], ["cg-glob-h220", 220],
                        ["cg-fusion-25", 220], ["cg-fusion-75", 220]]) {
  const r = rampe(nom);
  if (!r) { console.log("%s   ABSENTE", nom.padEnd(16)); continue; }
  const g = agrege(r.filter((x) => propre(x, 2)));
  if (g.insuffisant) { console.log("%s   %d niveaux", nom.padEnd(16), g.n); continue; }
  vus[nom] = { g, t, imp: inverse(g.moyen) };
  console.log("%s %s %s %s %s %s %s", nom.padEnd(16), String(g.n).padStart(4),
    g.niveauPondere.toFixed(1).padStart(13), g.pente.toFixed(2).padStart(11),
    g.moyen.toFixed(1).padStart(14),
    ((ecartAngle(g.moyen, A(t)) >= 0 ? "+" : "") + ecartAngle(g.moyen, A(t)).toFixed(1)).padStart(8),
    vus[nom].imp.toFixed(1).padStart(18));
}
console.log("");
for (const [a, b] of [["st-h040", "cg-glob-h040"], ["st-h220", "cg-glob-h220"]]) {
  if (!vus[a] || !vus[b]) continue;
  const dAngle = ecartAngle(vus[a].g.moyen, vus[b].g.moyen);
  const dImp = ecartAngle(vus[a].imp, vus[b].imp);
  const gain = ecartAngle(A(vus[a].imp + 0.25), A(vus[a].imp - 0.25)) / 0.5;
  console.log("%s contre %s", a, b);
  console.log("   desaccord en ANGLE OKLab (l'unite du residu) : %s deg", Math.abs(dAngle).toFixed(1));
  console.log("   desaccord en TEINTE IMPLIQUEE (unite curseur) : %s deg", Math.abs(dImp).toFixed(1));
  console.log("   gain local de la loi ici : %s deg d'angle par degre de curseur.", gain.toFixed(1));
  console.log("   -> l'inverse COMPRIME le desaccord d'un facteur %s.", (Math.abs(dAngle) / Math.max(1e-6, Math.abs(dImp))).toFixed(0));
  console.log("");
}
console.log("Le residu que la campagne cherche a expliquer est en ANGLE OKLab. Un accord");
console.log("annonce en TEINTE IMPLIQUEE la ou le gain local vaut 17 n'est pas un accord");
console.log("a 0,6 deg : c'est un desaccord de 10 deg divise par le gain.");
