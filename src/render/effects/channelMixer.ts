import type { EffectModule } from "./types";
import {
  TRANSFER_SPACE_SRGB,
  TRANSFER_SPACE_WGSL,
  TRANSFER_SPACE_LINEAR,
  transferSpaceParam,
} from "./blendSpace";
import { linearToSrgb, srgbToLinear } from "./srgbTransfer";
import {
  LINEAR_TO_SRGB_VEC3_WGSL,
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Channel mixer — matrice 3x3 de recombinaison des canaux, plus normalisation
 * de luminosité et bascule monochrome.
 *
 * CE QUE C'EST, physiquement : un channel mixer est le modèle exact d'un FILTRE
 * COLORÉ posé devant l'objectif (chaque canal de sortie est une combinaison
 * linéaire des sensibilités d'entrée). C'est l'outil qui fait la conversion
 * noir & blanc « filtre rouge » (ciel plombé, peaux claires) et les grades de
 * séparation couleur qu'aucune commande de saturation ne sait produire, parce
 * qu'elle agit sur l'axe teinte/saturation et jamais sur la RECOMBINAISON.
 *
 * TROIS ÉCARTS AVEC LA VERSION NAÏVE (3x3 sliders bruts) :
 *
 * 1. **Le mélange se fait en LUMIÈRE LINÉAIRE par défaut.** C'est le modèle
 *    correct : un filtre optique est une opération linéaire sur le spectre. Le
 *    channel mixer de Photoshop, lui, travaille sur des valeurs encodées
 *    gamma — d'où les croisements de tons moyens boueux et les virages de
 *    teinte parasites quand un coefficient est négatif.
 *
 *    AMENDEMENT DU 2026-08-01 (cahier de références §6bis) : Figma expose ce
 *    choix, et l'appelle « vif » là où ce fichier écrivait « boueux ». Les deux
 *    lectures sont vraies et ne parlent pas de la même chose — la matrice
 *    appliquée sur des valeurs encodées SÉPARE davantage aux croisements, ce
 *    qui est un défaut de modèle et un effet de look. Le choix est donc exposé
 *    (`transferSpace`) plutôt qu'imposé dans un sens ou dans l'autre, et il
 *    reste sur `Linéaire` par défaut : aucun rendu déjà produit ne bouge.
 *
 *    Ce n'est PAS le double gamma que le projet interdit : l'encodage et le
 *    décodage encadrent la seule matrice, dans la même expression, et ce qui
 *    sort est linéaire comme ce qui est entré (voir la seconde exception en
 *    tête de `srgbTransfer`). Aucun gamma ne s'échappe vers la suite de la
 *    chaîne.
 *
 * 2. **Normalisation de ligne (`preserveLuma`).** Sans elle, tout déplacement
 *    d'un curseur est AUSSI un déplacement d'exposition : on cherche une
 *    séparation de couleur, on obtient une image plus claire, on compense au
 *    curseur suivant, et le réglage devient impilotable. La normalisation
 *    divise chaque ligne par sa somme, ce qui garantit qu'un gris neutre reste
 *    exactement le même gris — la ligne ne fait plus que RÉPARTIR.
 *
 * 3. **Coefficients négatifs autorisés (jusqu'à -1).** Un mixer borné à [0,1]
 *    ne sait pas SOUSTRAIRE, donc il ne sait pas faire le geste central du
 *    filtre coloré (« retirer le bleu du rouge » = assombrir le ciel). C'est la
 *    moitié de l'outil qui manquerait.
 *
 * DÉFAUTS : identité (1,0,0 / 0,1,0 / 0,0,1) serait la neutralité honnête, mais
 * poser le calque ne montrerait alors RIEN — l'erreur exacte que les six effets
 * existants ont dû payer (leurs défauts étaient en bas de leur propre course).
 * Le défaut est donc un grade réel, sobre : séparation rouge/bleu (ciels plus
 * denses, peaux plus chaudes), avec les trois lignes de somme 1.0 — donc
 * strictement neutre en luminosité, jamais une fausse « amélioration » par
 * remontée d'exposition.
 */

/** Spécification pure du shader (twin TS, même rôle que `uvSpace`/`bayer`) :
 *  `p` est le tableau de paramètres dans l'ORDRE du uniform, `rgb` une couleur
 *  LINÉAIRE (ce que rend `textureSample`), le résultat aussi.
 *  Toute modification de la formule doit être faite des DEUX côtés. */
export function channelMixSpec(
  rgb: readonly [number, number, number],
  p: readonly number[],
): [number, number, number] {
  const preserve = Math.min(1, Math.max(0, p[9]));
  const mono = Math.min(1, Math.max(0, p[10]));
  const space = Math.round(p[11] ?? TRANSFER_SPACE_LINEAR);
  const row = (a: number, b: number, c: number): [number, number, number] => {
    const sum = a + b + c;
    // Une ligne de somme nulle ou négative n'a pas de normalisation qui ait un
    // sens (elle inverserait le signe de tous ses coefficients) : on la laisse
    // telle quelle plutôt que de produire une image négative en silence.
    if (!(sum > 0.001)) return [a, b, c];
    return [
      a + (a / sum - a) * preserve,
      b + (b / sum - b) * preserve,
      c + (c / sum - c) * preserve,
    ];
  };
  // Aller-retour FERMÉ autour de la seule matrice : encoder, recombiner,
  // décoder. En espace linéaire (défaut) les deux conversions sont l'identité,
  // donc le résultat est celui d'avant ce paramètre, au bit près.
  const src = space === TRANSFER_SPACE_SRGB ? (rgb.map(linearToSrgb) as [number, number, number]) : rgb;
  const dot3 = (r: readonly [number, number, number]) =>
    r[0] * src[0] + r[1] * src[1] + r[2] * src[2];
  const rowR = row(p[0], p[1], p[2]);
  const mixed: [number, number, number] = [dot3(rowR), dot3(row(p[3], p[4], p[5])), dot3(row(p[6], p[7], p[8]))];
  const gray = dot3(rowR);
  const blended: [number, number, number] = [
    mixed[0] + (gray - mixed[0]) * mono,
    mixed[1] + (gray - mixed[1]) * mono,
    mixed[2] + (gray - mixed[2]) * mono,
  ];
  const decoded = space === TRANSFER_SPACE_SRGB ? (blended.map(srgbToLinear) as [number, number, number]) : blended;
  return [Math.max(0, decoded[0]), Math.max(0, decoded[1]), Math.max(0, decoded[2])];
}

const RANGE = { min: -1, max: 2, step: 0.01 } as const;

export const channelMixer: EffectModule = {
  id: "channelMixer",
  name: "Channel mixer",
  params: [
    // Défaut : R = 1.15R - 0.15B. Somme 1.0 -> un gris reste le même gris.
    { name: "redFromRed", label: "Rouge ← Rouge", unit: "none", ...RANGE, default: 1.15 },
    { name: "redFromGreen", label: "Rouge ← Vert", unit: "none", ...RANGE, default: 0 },
    { name: "redFromBlue", label: "Rouge ← Bleu", unit: "none", ...RANGE, default: -0.15, hint: "Négatif = le bleu SOUSTRAIT du rouge (c'est le geste du filtre rouge : ciel plombé)" },
    { name: "greenFromRed", label: "Vert ← Rouge", unit: "none", ...RANGE, default: -0.08 },
    { name: "greenFromGreen", label: "Vert ← Vert", unit: "none", ...RANGE, default: 1.16 },
    { name: "greenFromBlue", label: "Vert ← Bleu", unit: "none", ...RANGE, default: -0.08 },
    { name: "blueFromRed", label: "Bleu ← Rouge", unit: "none", ...RANGE, default: 0 },
    { name: "blueFromGreen", label: "Bleu ← Vert", unit: "none", ...RANGE, default: -0.18 },
    { name: "blueFromBlue", label: "Bleu ← Bleu", unit: "none", ...RANGE, default: 1.18 },
    {
      name: "preserveLuma",
      label: "Préserver la luminosité",
      unit: "percent",
      min: 0,
      max: 1,
      default: 1,
      step: 0.01,
      hint: "Normalise chaque ligne à somme 1 — un gris neutre reste le même gris, le curseur ne déplace plus l'exposition",
    },
    {
      name: "monochrome",
      label: "Monochrome",
      unit: "percent",
      min: 0,
      max: 1,
      default: 0,
      step: 0.01,
      hint: "Fait sortir les trois canaux de la SEULE ligne Rouge — c'est la conversion noir & blanc au filtre coloré",
    },
    transferSpaceParam({
      hint: "Sur quelle courbe la matrice recombine — Linéaire = modèle du filtre optique (croisements doux, défaut du projet) ; sRGB = celle de Photoshop et Figma, qui sépare davantage aux croisements",
    }),
  ],
  wgsl: `
${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${TRANSFER_SPACE_WGSL}
fn mixRow(row: vec3<f32>, preserve: f32) -> vec3<f32> {
  let sum = row.x + row.y + row.z;
  // Garde : somme nulle/négative -> aucune normalisation ne garde le signe.
  // On laisse la ligne brute plutôt que d'inverser l'image en silence.
  let safe = select(row, row / max(sum, 0.001), sum > 0.001);
  return mix(row, safe, preserve);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let preserve = clamp(params[9], 0.0, 1.0);
  let mono = clamp(params[10], 0.0, 1.0);
  let space = params[11];
  let rowR = mixRow(vec3<f32>(params[0], params[1], params[2]), preserve);
  let rowG = mixRow(vec3<f32>(params[3], params[4], params[5]), preserve);
  let rowB = mixRow(vec3<f32>(params[6], params[7], params[8]), preserve);
  // color.rgb est DÉJÀ linéaire (format de texture -srgb). \`to_transfer_space\`
  // est l'IDENTITÉ sur le défaut (Linéaire) : la recombinaison se fait alors en
  // lumière, comme un filtre optique, exactement comme avant ce paramètre. En
  // sRGB, l'encodage et le décodage encadrent la SEULE matrice — aller-retour
  // fermé, rien d'encodé ne quitte cette fonction.
  let src = to_transfer_space(color.rgb, space);
  let mixed = vec3<f32>(dot(rowR, src), dot(rowG, src), dot(rowB, src));
  // Monochrome : les trois sorties viennent de la MÊME ligne (la rouge), ce qui
  // est la définition du noir & blanc au filtre coloré. Interpolé plutôt que
  // binaire — un curseur donne aussi les désaturations partielles, qu'une case
  // à cocher rendrait inatteignables.
  let gray = vec3<f32>(dot(rowR, src));
  // Plancher à 0 : une lumière négative n'existe pas, et un canal négatif
  // fausserait ensuite le mode de fusion du calque (qui, lui, n'écrête pas).
  // Pas de plafond : l'écrêtage des hautes lumières appartient à la cible, pas
  // à cet effet — l'aplatir ici tuerait la marge des calques du dessus.
  return vec4<f32>(max(from_transfer_space(mix(mixed, gray, mono), space), vec3<f32>(0.0)), color.a);
}
`,
};
