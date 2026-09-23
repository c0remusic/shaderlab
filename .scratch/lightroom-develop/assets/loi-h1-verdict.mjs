// LE TABLEAU QUI TRANCHE — l'ecretage tourne-t-il quoi que ce soit, UNE FOIS LA
// DERIVE DEFALQUEE ?
//
// Piece G a montre que le bloc ecrete de 140 est tourne de -9,8 deg par rapport
// au bloc propre, et celui de 220 de +0,2 deg. Le script d'origine lirait la
// premiere ligne comme « l'ecretage agit sur 140 ». Mais les deux blocs ne sont
// pas au meme NIVEAU — le bloc ecrete est en bas de rampe, le bloc propre en
// haut — et l'angle DERIVE avec le niveau. Une partie de l'ecart entre les deux
// blocs est donc due a leur seule separation, sans qu'aucun pixel n'ait ete
// ecrete.
//
// On defalque : ecart attendu = derive x separation des niveaux. Ce qui RESTE
// est la seule part imputable a l'ecretage. On la compare au plancher de bruit
// declare par le controle synthetique (1,28 a 2,51 deg).
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

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
  return { n: lus.length, moyen: deg(sx, sy), niveauPondere: swn / sw };
}
/** Derive estimee SUR LE BLOC PROPRE UNIQUEMENT — sinon on estimerait la pente
 *  sur les niveaux dont on cherche justement a savoir s'ils sont fausses. */
function pente(niveaux) {
  const lus = niveaux.filter((x) => x.chroma >= SEUIL);
  if (lus.length < 5) return null;
  const m = agrege(lus);
  const nMoy = lus.reduce((s, x) => s + x.n, 0) / lus.length;
  let num = 0, den = 0;
  for (const x of lus) { num += (x.n - nMoy) * ecartAngle(x.angle, m.moyen); den += (x.n - nMoy) ** 2; }
  return den > 0 ? (num / den) * 100 : null;
}
const propre = (x, m) => x.bas >= m && x.haut <= 255 - m;

console.log("VERDICT — L'ECRETAGE TOURNE-T-IL, UNE FOIS LA DERIVE DEFALQUEE ?");
console.log("");
console.log("La derive est estimee sur le BLOC PROPRE seul, puis extrapolee jusqu'au");
console.log("niveau du bloc ecrete. « Reste » = ce que l'ecretage aurait a expliquer.");
console.log("Plancher de bruit declare par le controle synthetique : 1,28 a 2,51 deg.");
console.log("");
console.log("teinte  niv ecr.  niveau ecr.  niveau propre  ecart observe  derive/100  ATTENDU  RESTE  verdict");
console.log("".padEnd(112, "-"));
let sReste = 0, nReste = 0;
for (const t of TEINTES) {
  const r = rampe(`st-h${String(t).padStart(3, "0")}`);
  if (!r) continue;
  const sale = agrege(r.filter((x) => !propre(x, 1)));
  const net = r.filter((x) => propre(x, 1));
  const aNet = agrege(net);
  if (sale.insuffisant || aNet.insuffisant) {
    console.log("%s %s   bloc ecrete trop petit (%d niveaux lisibles) — rien a conclure",
      String(t).padStart(6), String(sale.n).padStart(9), sale.n);
    continue;
  }
  const p = pente(net);
  if (p === null) { console.log("%s   pente non estimable", String(t).padStart(6)); continue; }
  const sep = sale.niveauPondere - aNet.niveauPondere;
  const attendu = (p / 100) * sep;
  const observe = ecartAngle(sale.moyen, aNet.moyen);
  const reste = observe - attendu;
  sReste += Math.abs(reste); nReste++;
  console.log("%s %s %s %s %s %s %s %s   %s",
    String(t).padStart(6), String(sale.n).padStart(9),
    sale.niveauPondere.toFixed(1).padStart(12), aNet.niveauPondere.toFixed(1).padStart(14),
    ((observe >= 0 ? "+" : "") + observe.toFixed(1)).padStart(14), p.toFixed(2).padStart(11),
    ((attendu >= 0 ? "+" : "") + attendu.toFixed(1)).padStart(8),
    ((reste >= 0 ? "+" : "") + reste.toFixed(1)).padStart(6),
    Math.abs(reste) < 2.51 ? "sous le plancher de bruit" : "au-dessus du bruit");
}
console.log("");
console.log("reste moyen absolu : %s deg sur %d teintes mesurables.", (sReste / nReste).toFixed(2), nReste);

// ── REPRODUCTION INDEPENDANTE DU +21 SUR 220 ────────────────────────────────
console.log("");
console.log("CONTROLE — LE +21 DE 220 SUR LES DEUX ROUES, ET SUR LES SEULS NIVEAUX PROPRES");
console.log("");
console.log("scene            niv propres   angle mesure   residu PPlin   chroma moy.");
console.log("".padEnd(80, "-"));
for (const [nom, t] of [["st-h220", 220], ["cg-glob-h220", 220], ["st-h180", 180], ["cg-glob-h040", 40], ["st-h040", 40]]) {
  const r = rampe(nom);
  if (!r) { console.log("%s   ABSENTE", nom.padEnd(16)); continue; }
  const propres = r.filter((x) => propre(x, 1) && x.chroma >= SEUIL);
  const g = agrege(propres);
  if (g.insuffisant) { console.log("%s   %d niveaux", nom.padEnd(16), g.n); continue; }
  const res = ecartAngle(g.moyen, angleProPhotoLineaire(t));
  console.log("%s %s %s %s %s", nom.padEnd(16), String(g.n).padStart(12),
    g.moyen.toFixed(1).padStart(14), ((res >= 0 ? "+" : "") + res.toFixed(1)).padStart(14),
    (propres.reduce((s, x) => s + x.chroma, 0) / propres.length).toFixed(4).padStart(13));
}
