// LA NON-MONOTONIE DES HAUTES LUMIERES EST-ELLE UN POIDS, OU UN PLAFOND ?
//
// LE DEFAUT TEL QU'IL EST ECRIT. Premier des « defauts trouves et NON corriges »
// de docs/ROADMAP.md : « le poids des hautes lumieres du Color Grading est NON
// MONOTONE — il culmine au niveau 205 puis retombe a 0,26 au niveau 248. Aucune
// homographie ne rend ça. » Il est herite du 2026-09-14 et a resiste a deux
// corrections, qui ont traite sa CONSEQUENCE (l'ecrasement) sans sa cause.
//
// LE SOUPÇON. poids-des-quatre-roues.mjs relit ce profil avec la forme identifiee
// par research/18 et retrouve la meme bosse : sommet au niveau 199, puis chute a
// 0,044 au 248 et 0 au 255. Mais le poids y est obtenu en INVERSANT l'operateur
// sur la sortie mesuree — et une sortie ECRETEE au blanc ne s'inverse pas. Un
// poids qui pousse vers le haut ne peut rien faire sur un pixel deja blanc : la
// mesure rend « pas de deplacement », et l'inversion l'attribue au poids.
//
// Le seuil se calcule : l'operateur sature quand `lin*g + b > 1`, soit lin >
// 0,5889 avec les constantes de research/18 — le niveau sRGB 201,7. Le sommet
// mesure est a 199. C'est cette coincidence que ce script eprouve, en trois
// controles qui ne dependent pas les uns des autres.
import { readFileSync } from "node:fs";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const G = 1.690, B = 4.73e-3;

const ramp = JSON.parse(readFileSync(`${M}/cg-hl-lum-p50.json`, "utf8")).rampe;
const temoin = JSON.parse(readFileSync(`${M}/temoin.json`, "utf8")).rampe;

// ── CONTROLE 1 : ou la sortie MESUREE touche-t-elle le blanc ? ───────────────
// Si la bosse est un plafond, la mesure doit coller a 255 au-dela du sommet. Si
// c'est un poids qui retombe, la sortie doit REDESCENDRE vers la diagonale.
let premierBlanc = null;
for (let n = 0; n <= 255; n++) if (ramp[n] >= 254.5 && premierBlanc === null) premierBlanc = n;
console.log("CONTROLE 1 — ce que la sortie mesuree fait en haut de rampe.");
console.log("  premier niveau ou la sortie atteint 254,5 : %s", premierBlanc === null ? "aucun" : premierBlanc);
console.log("");
console.log("  niv   entree   sortie   ecart a la diagonale");
for (const n of [180, 190, 199, 205, 215, 225, 235, 245, 250, 253, 255]) {
  console.log("  %s %s %s %s",
    String(n).padStart(3), String(n).padStart(8),
    ramp[n].toFixed(2).padStart(8), (ramp[n] - n).toFixed(2).padStart(22));
}
console.log("");
console.log("  Un poids qui RETOMBE ramene l'ecart vers zero en douceur.");
console.log("  Un PLAFOND garde l'ecart maximal puis le rabote contre 255.");

// ── CONTROLE 2 : le seuil de saturation, calcule et compare ──────────────────
const linSeuil = (1 - B) / G;
const nSeuil = l2s(linSeuil) * 255;
console.log("");
console.log("CONTROLE 2 — le seuil ou l'operateur sature, calcule sans regarder la mesure.");
console.log("  lin*g + b > 1  =>  lin > %s  =>  niveau sRGB %s", linSeuil.toFixed(4), nSeuil.toFixed(1));

// ── CONTROLE 3 : le poids, relu sur le domaine NON sature seulement ──────────
// Si la bosse etait un plafond, le profil restreint doit etre MONOTONE.
const w = new Array(256).fill(null);
for (let n = 0; n <= 255; n++) {
  const lin = s2l(n / 255);
  const denom = lin * (G - 1) + B;
  if (denom <= 1e-9) continue;
  w[n] = (s2l(ramp[n] / 255) - lin) / denom;
}
function virages(domaine) {
  let sens = 0, v = 0, sommet = -Infinity, ou = 0;
  for (let i = 4; i < domaine.length; i += 4) {
    const a = w[domaine[i - 4]], b2 = w[domaine[i]];
    if (a === null || b2 === null) continue;
    if (b2 > sommet) { sommet = b2; ou = domaine[i]; }
    const d = b2 - a;
    if (Math.abs(d) < 0.004) continue;
    const s = Math.sign(d);
    if (sens !== 0 && s !== sens) v++;
    sens = s;
  }
  return { v, sommet, ou };
}
const tout = [], nonSature = [];
for (let n = 0; n <= 255; n++) {
  if (w[n] === null) continue;
  tout.push(n);
  if (n < nSeuil) nonSature.push(n);
}
const A = virages(tout), C = virages(nonSature);
console.log("");
console.log("CONTROLE 3 — monotonie du profil, sur deux domaines.");
console.log("  domaine                 niveaux   changements de sens   sommet");
console.log("  toute la rampe %s %s   %s au niveau %d",
  String(tout.length).padStart(13), String(A.v).padStart(19), A.sommet.toFixed(3), A.ou);
console.log("  sous le seuil (%s) %s %s   %s au niveau %d",
  nSeuil.toFixed(0), String(nonSature.length).padStart(7), String(C.v).padStart(19), C.sommet.toFixed(3), C.ou);
console.log("");
console.log("  Le temoin, pour memoire : ecart max a la rampe nue %s niveau.",
  Math.max(...temoin.map((v, n) => Math.abs(v - n))).toFixed(3));
