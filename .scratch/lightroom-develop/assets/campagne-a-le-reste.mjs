// LES SEPT MESURES DE LA CAMPAGNE A QUI NE SONT PAS DES TEINTES.
//
// research/22 n'a lu que les onze teintes et les deux controles de roue. La
// campagne en portait VINGT ET UNE. Sept restent, et chacune repond a une question
// que le ticket 06 declare ouverte :
//
//   st-ombres-sat20 / sat100   la loi d'AMPLITUDE. `chromaK` est calibre a une
//                              seule saturation (60) ; rien ne dit que la chroma
//                              soit proportionnelle a la saturation.
//   cg-fusion-25 / 75          les doses intermediaires de FUSION, absentes : la
//                              table n'avait que 0, 50 et 100, donc la forme de
//                              `blendDepth` entre les deux etait indeterminee.
//   st-balance-m50 / p50       idem pour la BALANCE, qui n'avait que 0 et +-100.
//   temperature-m50            la dose qui manquait au milieu du retournement de
//                              la branche froide de la balance des blancs.
//
// METRIQUE. Pour chaque scene, l'ecart du twin a la mesure en NIVEAUX sRGB sur les
// trois canaux — la meme que verifier-grading.mjs, celle qui decide. Et pour les
// deux saturations, la loi d'amplitude est lue directement : chroma mesuree contre
// chroma attendue si elle etait proportionnelle.
import { readFileSync, existsSync } from "node:fs";
import { colorGradingSpec } from "../../../src/render/effects/colorGrading.ts";
import { linearSrgbToOklab } from "../../../src/render/effects/oklab.ts";
import { COLOR_GRADING as CG } from "../../../src/render/effects/colorGradingTable.ts";

const M = ".scratch/lightroom-develop/research/mesures";
const s2l = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
const l2s = (l) => { const x = Math.max(0, Math.min(1, l)); return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055; };
const niv = (v) => l2s(v) * 255;

const charge = (nom) => {
  const f = `${M}/${nom}.json`;
  return existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : null;
};
/** Ordre du uniform : ombres h/s/l, moyens, hautes, globale, fusion, balance. */
const p = (o = {}) => {
  const d = { shHue: 0, shSat: 0, shLum: 0, mHue: 0, mSat: 0, mLum: 0, hHue: 0, hSat: 0,
    hLum: 0, gHue: 0, gSat: 0, gLum: 0, blending: 50, balance: 0, ...o };
  return [d.shHue, d.shSat, d.shLum, d.mHue, d.mSat, d.mLum, d.hHue, d.hSat, d.hLum,
    d.gHue, d.gSat, d.gLum, d.blending, d.balance];
};
const duo = { shHue: 220, shSat: 60, hHue: 40, hSat: 60 };

// ⚠️ LES SCENES DE TEINTE DE CETTE CAMPAGNE PORTENT Balance -100, celles de
// saturation aussi. Reconstruire leurs reglages de tete serait le defaut que ce
// dossier traite en premier : ils sont recopies de listes-de-mesures.md.
const SCENES = [
  ["st-ombres-sat20", p({ shHue: 220, shSat: 20, balance: -100 }), "amplitude"],
  ["st-ombres-sat100", p({ shHue: 220, shSat: 100, balance: -100 }), "amplitude"],
  ["st-h220", p({ shHue: 220, shSat: 60, balance: -100 }), "amplitude"],
  ["cg-fusion-25", p({ ...duo, blending: 25 }), "fusion"],
  ["cg-fusion-75", p({ ...duo, blending: 75 }), "fusion"],
  ["st-balance-m50", p({ ...duo, balance: -50 }), "balance"],
  ["st-balance-p50", p({ ...duo, balance: 50 }), "balance"],
  ["temperature-m50", null, "temperature"],
];

console.log("ECART DU TWIN AUX SEPT MESURES NEUVES, en niveaux sRGB (3 canaux)");
console.log("");
console.log("scene              famille       moyenne    pire   niveau du pire");
console.log("".padEnd(70, "-"));
for (const [nom, params, famille] of SCENES) {
  const d = charge(nom);
  if (!d) { console.log("%s  MANQUANTE", nom.padEnd(18)); continue; }
  if (params === null) {
    console.log("%s %s   (hors module colorGrading — balance des blancs)", nom.padEnd(18), famille.padEnd(13));
    continue;
  }
  const lr = d.rampe_rgb;
  let somme = 0, pire = 0, ouPire = 0;
  for (let i = 0; i < 256; i++) {
    const lin = s2l(i / 255);
    const out = colorGradingSpec([lin, lin, lin], params);
    for (let c = 0; c < 3; c++) {
      const e = Math.abs(niv(out[c]) - lr[i][c]);
      somme += e;
      if (e > pire) { pire = e; ouPire = i; }
    }
  }
  console.log("%s %s %s %s %s",
    nom.padEnd(18), famille.padEnd(13),
    (somme / (256 * 3)).toFixed(2).padStart(8), pire.toFixed(1).padStart(7),
    String(ouPire).padStart(16));
}

// ── LA LOI D'AMPLITUDE ──────────────────────────────────────────────────────
// C'est la question que research/22 a laissee ouverte en toutes lettres : la
// chroma ajoutee varie d'un facteur 1,77 selon la teinte alors qu'une direction
// unitaire imposerait l'egalite. Ces deux mesures disent si elle est au moins
// PROPORTIONNELLE a la saturation, ce que le modele suppose.
console.log("");
console.log("LOI D'AMPLITUDE — chroma ajoutee contre saturation, teinte 220");
console.log("");
const chromaDe = (nom) => {
  const d = charge(nom);
  if (!d) return null;
  const out = [];
  for (let i = 0; i <= 255; i++) {
    const lab = linearSrgbToOklab([s2l(d.rampe_rgb[i][0] / 255), s2l(d.rampe_rgb[i][1] / 255), s2l(d.rampe_rgb[i][2] / 255)]);
    out.push(Math.hypot(lab[1], lab[2]));
  }
  return out;
};
const c20 = chromaDe("st-ombres-sat20"), c60 = chromaDe("st-h220"), c100 = chromaDe("st-ombres-sat100");
if (c20 && c60 && c100) {
  console.log("  niv   sat20    sat60   sat100  |  20/60  100/60  |  attendu si proportionnel");
  console.log("".padEnd(82, "-"));
  for (const n of [8, 24, 48, 64, 96, 128, 160, 190]) {
    console.log("  %s %s %s %s  | %s %s  |  %s et %s",
      String(n).padStart(3),
      c20[n].toFixed(4).padStart(8), c60[n].toFixed(4).padStart(8), c100[n].toFixed(4).padStart(8),
      (c20[n] / c60[n]).toFixed(3).padStart(6), (c100[n] / c60[n]).toFixed(3).padStart(6),
      (20 / 60).toFixed(3), (100 / 60).toFixed(3));
  }
  // Moyennes ponderees par la chroma de reference — un rapport lu la ou il y a du
  // signal, pas la ou les deux termes frolent zero.
  let s20 = 0, s100 = 0, poids = 0;
  for (let n = 0; n <= 255; n++) {
    if (c60[n] < 0.02) continue;
    s20 += c60[n] * (c20[n] / c60[n]); s100 += c60[n] * (c100[n] / c60[n]); poids += c60[n];
  }
  console.log("");
  console.log("  rapport moyen (pondere) : sat20/sat60 = %s (attendu 0,333), sat100/sat60 = %s (attendu 1,667)",
    (s20 / poids).toFixed(3), (s100 / poids).toFixed(3));
  console.log("  chromaK en service : %s", CG.chromaK.toFixed(3));
}

// ── FUSION ET BALANCE : les doses qui manquaient ────────────────────────────
console.log("");
console.log("FUSION ET BALANCE — ce que les doses intermediaires ajoutent");
console.log("");
console.log("Chroma mesuree au niveau 160 (le repere de la table pour blendDepth) :");
for (const [nom, dose] of [["cg-fusion-0", 0], ["cg-fusion-25", 25], ["cg-fusion-100", 100], ["cg-fusion-75", 75]]) {
  const c = chromaDe(nom);
  console.log("  %s : %s", (nom + " (dose " + dose + ")").padEnd(28), c ? c[160].toFixed(4) : "manquante");
}
console.log("");
console.log("Croisement des deux teintes du duo (niveau ou la chroma est minimale) :");
for (const nom of ["st-balance-m100", "st-balance-m50", "st-duo", "st-balance-p50", "st-balance-p100"]) {
  const c = chromaDe(nom);
  if (!c) { console.log("  %s : manquante", nom.padEnd(20)); continue; }
  let min = Infinity, ou = 0;
  for (let n = 4; n <= 250; n++) if (c[n] < min) { min = c[n]; ou = n; }
  console.log("  %s : niveau %s (chroma %s)", nom.padEnd(20), String(ou).padStart(3), min.toFixed(4));
}
