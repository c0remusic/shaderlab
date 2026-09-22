// COMBIEN DE NIVEAUX CHAQUE FORME DE MESURE DE TEINTE REND-ELLE LISIBLES ?
//
// LE CONSTAT QUI DECLENCHE. research/21 a mesure l'angle de teinte sur cinq
// scenes, et le nombre de niveaux exploitables varie du simple au double :
// `st-ombres-bleu` (roue des ombres seule) en rend 107, `st-balance-m100` (meme
// teinte, mais Balance a -100) en rend 197. La raison est mecanique — le poids
// des ombres s'eteint en haut de rampe, donc la chroma tombe sous le seuil de
// lecture et l'angle y devient du bruit de quantification.
//
// CE QUE ÇA VEUT DIRE POUR LA CAMPAGNE A. Elle est ecrite avec huit lignes
// `SplitToningShadowHue=X;SplitToningShadowSaturation=60`, donc la forme a 107
// niveaux. Ajouter `SplitToningBalance=-100` a chaque ligne pousse tout du cote
// des ombres : meme nombre de mesures, meme duree de course, presque le double de
// niveaux exploitables. ⚠️ Et contrairement a `st-balance-m100`, il n'y a ici
// AUCUNE contamination — la roue des hautes lumieres reste a saturation 0, alors
// que le duo l'activait (c'est ce qui faisait diverger de 4,5 degres les deux
// mesures du bleu).
//
// Ce script chiffre les trois formes sur le TWIN, avant de reecrire quoi que ce
// soit. Le twin n'est pas Lightroom, mais le poids de plage est ce qui decide de
// la couverture, et c'est justement ce que le twin modelise.
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";

const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
// Meme seuil que research/21 : sous cette chroma, l'angle est du bruit.
const SEUIL = 0.02;

/** [shHue, shSat, shLum, mHue, mSat, mLum, hHue, hSat, hLum, gHue, gSat, gLum, fusion, balance] */
const FORMES = [
  ["ombres seules (campagne A telle qu'ecrite)", (h) => [h, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, 0]],
  ["ombres + Balance -100", (h) => [h, 60, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 50, -100]],
  ["roue GLOBALE", (h) => [0, 0, 0, 0, 0, 0, 0, 0, 0, h, 60, 0, 50, 0]],
  ["medians seuls", (h) => [0, 0, 0, h, 60, 0, 0, 0, 0, 0, 0, 0, 50, 0]],
];

const TEINTES = [0, 40, 60, 90, 140, 180, 220, 270, 300, 330];

console.log("Niveaux dont la chroma depasse %s — ceux ou un angle se lit.", SEUIL);
console.log("");
console.log("forme                                        " + TEINTES.map((t) => String(t).padStart(5)).join("") + "   mediane");
console.log("".padEnd(112, "-"));

for (const [nom, params] of FORMES) {
  const comptes = TEINTES.map((h) => {
    let n = 0;
    for (let i = 0; i <= 255; i++) {
      const lin = s2l(i / 255);
      const lab = linearSrgbToOklab(colorGradingSpec([lin, lin, lin], params(h)));
      if (Math.hypot(lab[1], lab[2]) >= SEUIL) n++;
    }
    return n;
  });
  const tries = comptes.slice().sort((a, b) => a - b);
  const med = tries[Math.floor(tries.length / 2)];
  console.log("%s%s %s",
    nom.padEnd(44),
    comptes.map((c) => String(c).padStart(5)).join(""),
    String(med).padStart(9));
}

console.log("");
console.log("⚠️ Le twin n'est pas Lightroom. Ce qu'il modelise ici est le POIDS DE PLAGE,");
console.log("   qui est ce qui decide de la couverture — donc le classement des formes");
console.log("   tient meme si les valeurs exactes bougent. Controle disponible : la forme");
console.log("   « ombres + Balance -100 » est celle de st-balance-m100, ou Lightroom rend");
console.log("   197 niveaux lisibles contre 107 pour st-ombres-bleu.");
