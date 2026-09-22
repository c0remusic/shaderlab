// LES QUATRE PROFILS DE POIDS, tires des mesures DEJA au disque.
//
// L'IDEE, et elle ne coute aucune mesure neuve. research/18 a identifie la forme
// sur la roue des ombres : `lin_sortie = lin*(1 + w*(g-1)) + w*b`. Deux
// constantes, un poids. Si les constantes ne dependent PAS de la plage — ce que
// colorGradingTable.ts affirme en toutes lettres, « Lightroom applique UN seul
// modele de melange, donc l'amplitude d'une roue ne depend pas de la plage » —
// alors l'equation s'inverse a chaque niveau :
//
//     w(n) = (lin_sortie - lin) / (lin*(g-1) + b)
//
// et les rampes +50 des roues MEDIANS, HAUTES et GLOBALE rendent leurs profils
// sans qu'on mesure quoi que ce soit de neuf.
//
// ⚠️ C'EST UNE HYPOTHESE, ET ELLE SE FALSIFIE ELLE-MEME. Un poids de plage vit
// dans [0, 1] et est lisse. Si le w extrait sort de l'intervalle ou part en
// dents de scie, l'hypothese « memes constantes pour les quatre roues » est
// fausse, et la campagne F reste necessaire. Les deux issues renseignent — c'est
// pour ça que ce controle vaut d'etre fait avant d'attendre Lightroom.
//
// CE QU'ON CHERCHE EN PRIORITE. Le premier des « defauts trouves et NON
// corriges » du ROADMAP : « le poids des hautes lumieres est NON MONOTONE — il
// culmine au niveau 205 puis retombe a 0,26 au niveau 248 ». Ce constat porte sur
// le poids IMPLICITE tire des mesures avec l'ancien modele. Avec la forme
// identifiee, le meme profil se relit — et dira si la non-monotonie etait une
// propriete de Lightroom ou un artefact du modele qui la lisait.
import { readFileSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const Lde = (lin) => Math.cbrt(Math.max(0, lin));

// Les constantes de research/18, ajustees sur le BAS de la rampe des ombres —
// le domaine que l'oeil regarde, et celui sur lequel tout s'est joue.
const G = 1.690, B = 4.73e-3;

const INDEX_LUM = { ombres: 2, moyens: 5, hautes: 8, global: 11 };
const RAMPES = {
  ombres: "cg-ombres-lum-p50",
  moyens: "cg-moyens-lum-p50",
  hautes: "cg-hl-lum-p50",
  global: "grading-global-lum-p50",
};

/** NOTRE poids, recupere du code en service en inversant `appliqueLum`. */
function notrePoids(roue, n) {
  const lin = s2l(n / 255);
  const L = Lde(lin);
  const p = new Array(14).fill(0); p[12] = 50; p[INDEX_LUM[roue]] = 50;
  const Lout = Lde(Math.max(0, colorGradingSpec([lin, lin, lin], p)[0]));
  if (Math.abs(Lout - L) < 1e-12) return 0;
  const h = Lout > L ? 1 - L : L;
  if (h <= 1e-6) return null;
  const d = Math.abs(Lout - L) / h;
  if (d >= 1) return null;
  return (-h * Math.log(1 - d)) / (0.5 * CG.lumK);
}

console.log("Constantes de research/18 : g = %s, b = %s (ajustees sur le BAS des ombres).", G, B.toExponential(2));
console.log("Hypothese testee : elles valent pour les QUATRE roues.");
console.log("");
console.log("roue      dans [0,1]   hors bornes   pire hors-borne   dents de scie   monotone ?");
console.log("".padEnd(92, "-"));

const profils = {};
for (const [roue, nom] of Object.entries(RAMPES)) {
  const ramp = JSON.parse(readFileSync(`${M}/${nom}.json`, "utf8")).rampe;
  const w = new Array(256).fill(null);
  for (let n = 0; n <= 255; n++) {
    const lin = s2l(n / 255);
    const denom = lin * (G - 1) + B;
    if (denom <= 1e-9) continue;
    w[n] = (s2l(ramp[n] / 255) - lin) / denom;
  }
  profils[roue] = w;

  const defs = w.map((v, n) => [n, v]).filter(([, v]) => v !== null);
  const dedans = defs.filter(([, v]) => v >= -0.02 && v <= 1.02).length;
  const dehors = defs.length - dedans;
  const pire = Math.max(...defs.map(([, v]) => Math.max(v - 1, -v, 0)));
  // Dents de scie : changements de sens de la derivee, lisses sur 4 niveaux.
  let sens = 0, virages = 0;
  for (let i = 4; i < defs.length; i += 4) {
    const d = defs[i][1] - defs[i - 4][1];
    if (Math.abs(d) < 0.004) continue;
    const s = Math.sign(d);
    if (sens !== 0 && s !== sens) virages++;
    sens = s;
  }
  console.log("%s %s %s %s %s %s",
    roue.padEnd(9),
    String(dedans).padStart(12),
    String(dehors).padStart(13),
    pire.toFixed(3).padStart(17),
    String(virages).padStart(15),
    (virages <= 1 ? "oui" : "NON").padStart(12));
}

console.log("");
console.log("PROFILS, extrait contre en service :");
console.log("  niv " + Object.keys(RAMPES).flatMap((r) => [r.slice(0, 6) + "+", "svc"]).map((s) => s.padStart(9)).join(""));
for (const n of [8, 32, 64, 96, 128, 160, 190, 205, 220, 235, 248, 255]) {
  const cells = Object.keys(RAMPES).flatMap((roue) => {
    const a = profils[roue][n], b = notrePoids(roue, n);
    return [(a === null ? "—" : a.toFixed(3)).padStart(9), (b === null ? "—" : b.toFixed(3)).padStart(9)];
  });
  console.log("  %s%s", String(n).padStart(3), cells.join(""));
}

console.log("");
console.log("LE POINT EN LITIGE — le poids des HAUTES LUMIERES culmine-t-il puis retombe-t-il ?");
const wh = profils["hautes"];
let sommet = -Infinity, ouSommet = 0;
for (let n = 0; n <= 255; n++) if (wh[n] !== null && wh[n] > sommet) { sommet = wh[n]; ouSommet = n; }
console.log("   extrait   : sommet %s au niveau %d, puis %s au niveau 248, %s au 255",
  sommet.toFixed(3), ouSommet,
  wh[248] === null ? "—" : wh[248].toFixed(3),
  wh[255] === null ? "—" : wh[255].toFixed(3));
let sommetN = -Infinity, ouN = 0;
for (let n = 0; n <= 255; n++) { const v = notrePoids("hautes", n); if (v !== null && v > sommetN) { sommetN = v; ouN = n; } }
console.log("   en service: sommet %s au niveau %d, puis %s au niveau 248, %s au 255",
  sommetN.toFixed(3), ouN,
  (notrePoids("hautes", 248) ?? NaN).toFixed(3),
  (notrePoids("hautes", 255) ?? NaN).toFixed(3));
