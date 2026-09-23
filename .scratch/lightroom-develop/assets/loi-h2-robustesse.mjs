// ROBUSTESSE DE L'INTERPOLATION — l'estimateur a chroma egale depend-il du
// bracket choisi, ou de la forme supposee de angle(chroma) ?
//
// Trois variantes sur les MEMES niveaux :
//   A. lineaire entre les deux saturations qui ENCADRENT la chroma cible ;
//   B. lineaire entre sat20 et sat100 (bracket le plus large) ;
//   C. parabole par les trois points (20, 60, 100).
// Si les trois donnent le meme nombre, la correction ne tient pas a la forme.
import { readFileSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = process.env.MESURES ?? ".scratch/lightroom-develop/research/mesures";
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ec = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const niv = (nom) => JSON.parse(readFileSync(M + "/" + nom + ".json", "utf8")).rampe_rgb.map((v, i) => {
  const lab = linearSrgbToOklab(v.map((x) => srgbToLinear(x / 255)));
  const e = v.map((x) => Math.round(x));
  return { n: i, L: lab[0], c: Math.hypot(lab[1], lab[2]), angle: deg(lab[1], lab[2]), ecrete: e.some((x) => x <= 0 || x >= 255) };
});
const S = { 20: niv("st-ombres-sat20"), 60: niv("st-h220"), 100: niv("st-ombres-sat100") };
const G = niv("cg-glob-h220");
const SEUIL = 0.012;

const pts = (n) => [20, 60, 100].map((s) => S[s][n]).filter((p) => !p.ecrete && p.c >= SEUIL).sort((a, b) => a.c - b.c);
const lin = (p, q, cible) => p.angle + ((cible - p.c) / (q.c - p.c)) * ec(q.angle, p.angle);
function quad(ps, cible, ref) {
  const [x0, x1, x2] = ps.map((p) => p.c);
  const [y0, y1, y2] = ps.map((p) => ec(p.angle, ref));
  const l0 = ((cible - x1) * (cible - x2)) / ((x0 - x1) * (x0 - x2));
  const l1 = ((cible - x0) * (cible - x2)) / ((x1 - x0) * (x1 - x2));
  const l2 = ((cible - x0) * (cible - x1)) / ((x2 - x0) * (x2 - x1));
  return ref + l0 * y0 + l1 * y1 + l2 * y2;
}

console.log("ROBUSTESSE — la difference entre roues a (L, chroma) egaux, selon la forme supposee");
console.log("");
console.log("tranche n    k   A: bracket encadrant   B: sat20-sat100   C: parabole 3 pts   etendue");
console.log("".padEnd(98, "-"));
let SA = 0, SB = 0, SC = 0, SK = 0;
for (const [a, b] of [[0, 51], [51, 102], [102, 153], [153, 204], [204, 256]]) {
  const rs = [];
  for (let n = a; n < b; n++) {
    const g = G[n];
    if (g.ecrete || g.c < SEUIL) continue;
    const ps = pts(n);
    if (ps.length < 2) continue;
    let A = null;
    for (let i = 0; i + 1 < ps.length; i++) if (g.c >= ps[i].c && g.c <= ps[i + 1].c) A = lin(ps[i], ps[i + 1], g.c);
    if (A === null) continue;
    const dernier = ps[ps.length - 1];
    const B = (g.c >= ps[0].c && g.c <= dernier.c) ? lin(ps[0], dernier, g.c) : null;
    const C = ps.length === 3 ? quad(ps, g.c, ps[1].angle) : null;
    rs.push({ A: ec(g.angle, A), B: B === null ? null : ec(g.angle, B), C: C === null ? null : ec(g.angle, C) });
  }
  if (rs.length < 3) { console.log("%s  %s   (insuffisant)", (a + "-" + (b - 1)).padEnd(12), String(rs.length).padStart(3)); continue; }
  const m = (k) => { const v = rs.map((r) => r[k]).filter((x) => x !== null); return v.length ? v.reduce((s, x) => s + x, 0) / v.length : NaN; };
  const mA = m("A"), mB = m("B"), mC = m("C");
  SA += mA * rs.length; SB += mB * rs.length; SC += mC * rs.length; SK += rs.length;
  const fin = [mA, mB, mC].filter((x) => !Number.isNaN(x));
  console.log("%s  %s %s %s %s %s",
    (a + "-" + (b - 1)).padEnd(12), String(rs.length).padStart(3),
    mA.toFixed(1).padStart(21), mB.toFixed(1).padStart(18), mC.toFixed(1).padStart(20),
    (Math.max(...fin) - Math.min(...fin)).toFixed(1).padStart(9));
}
console.log("");
console.log("ENSEMBLE %d niveaux : A %s   B %s   C %s deg", SK, (SA / SK).toFixed(1), (SB / SK).toFixed(1), (SC / SK).toFixed(1));

let sb = 0, k = 0;
for (let n = 0; n <= 255; n++) {
  const g = G[n], o = S[60][n];
  if (g.ecrete || o.ecrete || g.c < SEUIL || o.c < SEUIL) continue;
  sb += ec(g.angle, o.angle); k++;
}
console.log("");
console.log("Brut, sans aucune correction de chroma, memes niveaux : %d niveaux, %s deg", k, (sb / k).toFixed(1));
console.log("");
console.log("SON chiffre, obtenu par appariement fortuit dans la seule queue : +3,9 deg,");
console.log("et la part qu'il attribue a l'echantillonnage : 61 %%.");
