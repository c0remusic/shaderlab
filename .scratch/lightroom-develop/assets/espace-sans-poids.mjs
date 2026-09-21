// QUEL ESPACE, SANS SUPPOSER AUCUN POIDS DE PLAGE.
//
// LE DEFAUT QUE CE SCRIPT EVITE. Les trois comparaisons precedentes
// (comparer-lum-modeles, ajuster-lum-roues, courbe-lum-ombres) posent toutes le
// poids de plage recupere du code en service, puis ajustent une amplitude par
// dessus. C'est legitime pour mesurer l'amplitude du modele EN SERVICE — le poids
// recupere est exactement sa fonction de plage. Ça ne l'est pas pour departager
// deux FORMES : la table de calibration dit elle-meme de `rangeContrast` que
// « CE N'EST DONC PAS LA FORME DU BINAIRE, c'est une forme qui reproduit sa
// mesure ». Une forme testee a travers le poids d'une autre teste les deux a la
// fois, et le verdict de courbe-lum-ombres (la courbe perd malgre DEUX
// parametres) peut venir de l'une comme de l'autre.
//
// LE TEST QUI S'EN PASSE. La roue des ombres a ete mesuree aux DEUX signes. Quelle
// que soit la fonction de plage w(n) — inconnue, quelconque — tout operateur de la
// forme « quantite Q decalee de dose*k*w(n) » verifie, a chaque niveau :
//
//        Q(n, +50) - Q(n)        +k*w(n)
//        -----------------   =   -------   =   CONSTANTE, independante de n
//        Q(n, -50) - Q(n)        -k*w(n)
//
// w(n) SE SIMPLIFIE. Le rapport est donc constant si et seulement si Q est la
// bonne quantite. On calcule ce rapport pour cinq candidats et on lit lequel est
// plat : c'est une mesure de FORME qui ne doit rien a une amplitude ajustee, et
// aucun modele n'y a d'avantage pour avoir plus de parametres.
//
// ⚠️ Ce test ne separe PAS un decalage d'une pente DANS un meme espace (les deux
// donnent un rapport constant). Il separe les ESPACES, et c'est la question
// ouverte. Le partage decalage/pente se lit ensuite sur le profil.
import { readFileSync } from "node:fs";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

const plus = JSON.parse(readFileSync(`${M}/cg-ombres-lum-p50.json`, "utf8")).rampe;
const moins = JSON.parse(readFileSync(`${M}/cg-ombres-lum-m50.json`, "utf8")).rampe;

// Cinq quantites candidates, fonction du niveau sRGB 0..255.
const CANDIDATS = [
  ["L (OKLab) — en service", (n) => Lde(s2l(n / 255))],
  ["lumiere lineaire", (n) => s2l(n / 255)],
  ["niveau sRGB", (n) => n / 255],
  ["log de la lumiere", (n) => Math.log(s2l(n / 255) + 1e-4)],
  ["racine carree du lineaire", (n) => Math.sqrt(s2l(n / 255))],
];

// On ne lit le rapport que la ou les DEUX signes bougent d'au moins un niveau :
// ailleurs on diviserait du bruit de quantification par du bruit de
// quantification. La borne est sur la MESURE, pas sur un modele.
const utiles = [];
for (let n = 1; n <= 254; n++) {
  if (Math.abs(plus[n] - n) >= 1 && Math.abs(moins[n] - n) >= 1) utiles.push(n);
}
console.log("niveaux ou les deux signes bougent d'au moins 1 : %d (de %d a %d)",
  utiles.length, utiles[0], utiles[utiles.length - 1]);
console.log("");
console.log("quantite Q                        rapport moyen   ecart-type   dispersion");
console.log("".padEnd(76, "-"));

const resultats = [];
for (const [nom, Q] of CANDIDATS) {
  const rapports = utiles.map((n) => {
    const q = Q(n);
    return (Q(plus[n]) - q) / (Q(moins[n]) - q);
  }).filter(Number.isFinite);
  const moy = rapports.reduce((a, b) => a + b, 0) / rapports.length;
  const ec = Math.sqrt(rapports.reduce((a, b) => a + (b - moy) ** 2, 0) / rapports.length);
  resultats.push([nom, moy, ec, Math.abs(ec / moy)]);
  console.log("%s %s %s %s",
    nom.padEnd(33),
    moy.toFixed(4).padStart(13),
    ec.toFixed(4).padStart(12),
    (Math.abs(ec / moy) * 100).toFixed(1).padStart(10) + " %");
}
console.log("");
const gagnant = resultats.slice().sort((a, b) => a[3] - b[3])[0];
console.log("Le plus PLAT : %s (dispersion %s %%).", gagnant[0], (gagnant[3] * 100).toFixed(1));
console.log("Un operateur symetrique aurait en plus un rapport proche de -1.");
console.log("");

// Le profil du rapport, pour voir COMMENT il derive quand il derive.
console.log("profil du rapport, par niveau :");
console.log("  niv " + CANDIDATS.map(([n]) => n.slice(0, 11).padStart(12)).join(""));
for (const n of utiles.filter((v) => [2, 4, 8, 16, 32, 48, 64, 96, 128, 160, 200].includes(v))) {
  const cells = CANDIDATS.map(([, Q]) => {
    const q = Q(n);
    const r = (Q(plus[n]) - q) / (Q(moins[n]) - q);
    return (Number.isFinite(r) ? r.toFixed(3) : "—").padStart(12);
  });
  console.log("  %s%s", String(n).padStart(3), cells.join(""));
}
