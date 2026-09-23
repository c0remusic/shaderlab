// LE DETAIL QUE LE CLASSEMENT CACHE — residu par teinte, et controle de roue serre.
//
// CE QUE LE CLASSEMENT A DIT. Sur les onze teintes de la campagne A, ProPhoto
// LINEAIRE rend 5,00 degres d'ecart moyen contre 13,42 au modele en service, a
// zero parametre. Deux choses restent a regarder avant d'en faire quoi que ce soit :
//
//  1. 5,00 EST ENCORE LOIN DU BRUIT. Le controle synthetique
//     (loi-de-teinte-controle.mjs) a montre que la quantification 8 bits laisse
//     1,28 a 2,51 degres de residu meme quand la loi est EXACTE. Un residu de 5,00
//     porte donc de la structure : ProPhoto lineaire est la meilleure des cinq,
//     pas la reponse. Le residu PAR TEINTE dit ou elle manque.
//
//  2. LE CONTROLE DE ROUE A ECHOUE (14,53 et 9,96 degres d'ecart entre la roue des
//     ombres et la roue globale) et ce serait un resultat lourd — il refuterait le
//     postulat « un seul modele de melange » sur lequel toute la serie repose. Un
//     resultat lourd se verifie : on imprime l'ecart-type des deux mesures
//     globales, leur nombre de niveaux, et on regarde si l'ecretage de gamut peut
//     expliquer la difference.
import { readFileSync, existsSync } from "node:fs";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { hsl2rgb } from "../../../src/render/effects/hsl.ts";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const deg = (a, b) => (Math.atan2(b, a) * 180) / Math.PI;
const ecartAngle = (a, b) => { let d = a - b; while (d > 180) d -= 360; while (d < -180) d += 360; return d; };
const SEUIL = 0.02;

function angleSrgbHsl(h) {
  const [r, g, b] = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  const lab = linearSrgbToOklab([srgbToLinear(r), srgbToLinear(g), srgbToLinear(b)]);
  return deg(lab[1], lab[2]);
}
const PP = [[0.7976749, 0.1351917, 0.0313534], [0.2880402, 0.7118741, 0.0000857], [0, 0, 0.82521]];
const XS = [[3.1338561, -1.6168667, -0.4906146], [-0.9787684, 1.9161415, 0.033454], [0.0719453, -0.2289914, 1.4052427]];
const ap = (m, v) => m.map((r) => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]);
function angleProPhotoLineaire(h) {
  const rgb = hsl2rgb(((h % 360) + 360) % 360 / 360, 1, 0.5);
  return deg(...linearSrgbToOklab(ap(XS, ap(PP, rgb))).slice(1));
}

function mesure(nom) {
  const f = `${M}/${nom}.json`;
  if (!existsSync(f)) return null;
  const rgb = JSON.parse(readFileSync(f, "utf8")).rampe_rgb;
  const lus = [];
  for (let n = 0; n <= 255; n++) {
    const lab = linearSrgbToOklab([s2l(rgb[n][0] / 255), s2l(rgb[n][1] / 255), s2l(rgb[n][2] / 255)]);
    const c = Math.hypot(lab[1], lab[2]);
    if (c >= SEUIL) lus.push([n, deg(lab[1], lab[2]), c]);
  }
  if (lus.length < 20) return { niveaux: lus.length, insuffisant: true };
  let sx = 0, sy = 0;
  for (const [, a, c] of lus) { sx += c * Math.cos(a * Math.PI / 180); sy += c * Math.sin(a * Math.PI / 180); }
  const moyen = deg(sx, sy);
  const et = Math.sqrt(lus.reduce((s, [, a]) => s + ecartAngle(a, moyen) ** 2, 0) / lus.length);
  // L'angle DERIVE-t-il avec le niveau ? Pente d'une regression simple, en
  // degres par centaine de niveaux — un ecart-type eleve peut venir du bruit
  // comme d'une derive, et les deux ne se corrigent pas pareil.
  const nMoy = lus.reduce((s, [n]) => s + n, 0) / lus.length;
  let num = 0, den = 0;
  for (const [n, a] of lus) { num += (n - nMoy) * ecartAngle(a, moyen); den += (n - nMoy) ** 2; }
  return { niveaux: lus.length, moyen, ecartType: et, pente: (num / den) * 100, premier: lus[0][0], dernier: lus[lus.length - 1][0] };
}

const TEINTES = [0, 40, 60, 90, 140, 150, 180, 220, 270, 300, 330];
console.log("RESIDU PAR TEINTE — ProPhoto lineaire contre le modele en service");
console.log("");
console.log("teinte  mesure   ProPhoto lin.  residu   en service  residu   ecart-type  derive/100niv");
console.log("".padEnd(94, "-"));
let sPP = 0, sSvc = 0, n = 0;
for (const t of TEINTES) {
  const m = mesure(`st-h${String(t).padStart(3, "0")}`);
  if (!m || m.insuffisant) continue;
  const pp = angleProPhotoLineaire(t), svc = angleSrgbHsl(t);
  const rPP = ecartAngle(m.moyen, pp), rSvc = ecartAngle(m.moyen, svc);
  sPP += Math.abs(rPP); sSvc += Math.abs(rSvc); n++;
  console.log("%s %s %s %s %s %s %s %s",
    String(t).padStart(6), m.moyen.toFixed(1).padStart(8), pp.toFixed(1).padStart(14),
    ((rPP >= 0 ? "+" : "") + rPP.toFixed(1)).padStart(8), svc.toFixed(1).padStart(12),
    ((rSvc >= 0 ? "+" : "") + rSvc.toFixed(1)).padStart(8),
    m.ecartType.toFixed(2).padStart(12), m.pente.toFixed(2).padStart(14));
}
console.log("");
console.log("moyennes : ProPhoto lineaire %s, en service %s", (sPP / n).toFixed(2), (sSvc / n).toFixed(2));
console.log("⚠️ Le bruit de quantification seul vaut 1,28 a 2,51 deg (controle synthetique).");
console.log("   Un residu tres au-dessus porte de la structure : la famille n'est pas exacte.");

// ── LE CONTROLE DE ROUE, SERRE ──────────────────────────────────────────────
console.log("");
console.log("CONTROLE DE ROUE — un resultat lourd se verifie avant d'etre cru.");
console.log("");
console.log("scene            niveaux  angle    ecart-type  derive/100niv  residu ProPhoto lin.");
console.log("".padEnd(90, "-"));
for (const [nom, t] of [["st-h040", 40], ["cg-glob-h040", 40], ["st-h220", 220], ["cg-glob-h220", 220]]) {
  const m = mesure(nom);
  if (!m || m.insuffisant) { console.log("%s  manquante ou insuffisante", nom.padEnd(16)); continue; }
  const r = ecartAngle(m.moyen, angleProPhotoLineaire(t));
  console.log("%s %s %s %s %s %s",
    nom.padEnd(16), String(m.niveaux).padStart(8), m.moyen.toFixed(1).padStart(8),
    m.ecartType.toFixed(2).padStart(11), m.pente.toFixed(2).padStart(14),
    ((r >= 0 ? "+" : "") + r.toFixed(1)).padStart(20));
}
console.log("");
console.log("Si les deux roues d'une meme teinte tombent au meme residu ProPhoto, le");
console.log("postulat « une seule loi » tient et c'etait le modele en service qui les");
console.log("separait. Si elles divergent encore, la loi est PAR ROUE.");
