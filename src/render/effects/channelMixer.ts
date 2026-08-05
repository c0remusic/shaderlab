import type { EffectModule, EffectSection } from "./types";
import {
  TRANSFER_SPACE_SRGB,
  TRANSFER_SPACE_WGSL,
  TRANSFER_SPACE_LINEAR,
  transferSpaceParam,
} from "./blendSpace";
import { linearToSrgb, srgbToLinear } from "./srgbTransfer";
import { HSL_TO_RGB_WGSL, hsl2rgb } from "./hsl";
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
 * 4. **ENCRES PAR CANAL (2026-08-02, cahier §6quinquies).** La fiche Figma dit
 *    de leur channel mixer qu'il « recolors each channel with your own selected
 *    color ». Le cahier en concluait deux outils sous un même nom : le leur
 *    assigne une couleur par canal, le nôtre est une matrice numérique.
 *
 *    C'EST LA MÊME ALGÈBRE, ET LE VOIR CHANGE CE QU'IL FAUT ÉCRIRE. Assigner
 *    une couleur `C` au canal rouge, c'est poser `C` en COLONNE 0 de la
 *    matrice ; nos neuf curseurs en sont les LIGNES. Leur outil est donc déjà
 *    atteignable ici — mais en réglant, pour une seule encre, trois curseurs
 *    répartis dans trois groupes différents. Ce qui manquait n'était pas une
 *    capacité, c'était une prise.
 *
 *    D'où le choix de forme : les encres ne REMPLACENT pas la matrice, elles se
 *    COMPOSENT avec elle (elles s'appliquent à sa sortie). On peut donc séparer
 *    les canaux au filtre optique PUIS leur assigner une couleur — ce que la
 *    fiche de référence, elle, ne permet pas.
 *
 *    La normalisation d'exposition est branchée sur le MÊME `preserveLuma` que
 *    les lignes, et pour la même raison : sans elle, choisir une encre sombre
 *    est aussi un changement d'exposition, et le réglage devient impilotable.
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
  const inked = applyInks(blended, p, preserve, space);
  const decoded = space === TRANSFER_SPACE_SRGB ? (inked.map(srgbToLinear) as [number, number, number]) : inked;
  return [Math.max(0, decoded[0]), Math.max(0, decoded[1]), Math.max(0, decoded[2])];
}

/** Poids de luminance BT.709, les mêmes que partout ailleurs dans `effects/`. */
const LUMA = [0.2126, 0.7152, 0.0722] as const;

/**
 * Les encres, en COLONNES de matrice — voir le point 4 de l'en-tête. `v` et le
 * résultat vivent dans l'espace de transfert courant, comme la matrice qui
 * précède ; la couleur du picker est donc décodée puis ré-encodée pour y
 * arriver, exactement comme `to_transfer_space` le fait côté WGSL.
 */
function applyInks(
  v: readonly [number, number, number],
  p: readonly number[],
  preserve: number,
  space: number,
): [number, number, number] {
  const colorize = Math.min(1, Math.max(0, p[21] ?? 0));
  const ink = (base: number): [number, number, number] => {
    const lin = hsl2rgb((p[base] ?? 0) / 360, p[base + 1] ?? 0, p[base + 2] ?? 0).map(srgbToLinear) as [number, number, number];
    return space === TRANSFER_SPACE_SRGB ? (lin.map(linearToSrgb) as [number, number, number]) : lin;
  };
  const cr = ink(12), cg = ink(15), cb = ink(18);
  const raw: [number, number, number] = [
    v[0] * cr[0] + v[1] * cg[0] + v[2] * cb[0],
    v[0] * cr[1] + v[1] * cg[1] + v[2] * cb[1],
    v[0] * cr[2] + v[1] * cg[2] + v[2] * cb[2],
  ];
  // Exposition : un blanc neutre (1,1,1) entre par les trois colonnes à la
  // fois, donc il sort en `cr + cg + cb`. Le facteur ramène la luminance de
  // cette somme à 1 — mêmes poids et même curseur que la normalisation des
  // lignes. Garde au dénominateur : trois encres noires n'ont pas d'exposition
  // à préserver, et diviser par zéro rendrait l'image blanche sans le dire.
  const white = [cr[0] + cg[0] + cb[0], cr[1] + cg[1] + cb[1], cr[2] + cg[2] + cb[2]];
  const lum = LUMA[0] * white[0] + LUMA[1] * white[1] + LUMA[2] * white[2];
  const k = 1 + (1 / Math.max(lum, 0.001) - 1) * preserve;
  return [
    v[0] + (raw[0] * k - v[0]) * colorize,
    v[1] + (raw[1] * k - v[1]) * colorize,
    v[2] + (raw[2] * k - v[2]) * colorize,
  ];
}

const RANGE = { min: -1, max: 2, step: 0.01 } as const;

/**
 * UNE SECTION PAR CANAL DE SORTIE : la ligne qui le fabrique, puis l'encre dans
 * laquelle il s'imprime.
 *
 * D'OÙ ÇA VIENT. La liste plate posait les neuf coefficients en haut et les
 * trois pastilles dix rangs plus bas, séparées d'eux par les réglages communs.
 * Régler « le rouge » demandait donc de faire l'aller-retour entre deux endroits
 * du panneau — alors que c'est la MÊME algèbre : la ligne dit d'où le canal
 * vient, l'encre dit en quoi il repart (point 4 de l'en-tête). Ce point-là
 * concluait déjà que ce qui manquait n'était pas une capacité mais une PRISE ;
 * la section est cette prise.
 *
 * ⚠️ LES TROIS RÔLES D'UNE ENCRE RESTENT DANS LA MÊME SECTION. `groupEffectParams`
 * n'émet qu'UN item par `colorGroup.key`, à l'index de son premier rôle : citer
 * la teinte ici et la saturation ailleurs découperait un bloc que le panneau ne
 * sait rendre qu'entier. C'est l'invariant « une section déplace des blocs
 * entiers, elle ne les traverse pas ».
 *
 * ⚠️ LES QUATRE RÉGLAGES COMMUNS RESTENT HORS SECTION, à leur place dans
 * `params[]`. `preserveLuma` normalise les trois lignes, `monochrome` les fait
 * toutes sortir de la seule ligne rouge, `transferSpace` choisit la courbe de
 * toute la matrice et `colorize` dose les trois encres ensemble : aucun n'est le
 * réglage d'UN canal, et le ranger sous l'un d'eux le dirait faux. Leur inventer
 * une section « Commun » ne clarifierait rien non plus — un titre pour dire
 * « tout le reste ». Le design le prévoit : un paramètre qu'aucune section ne
 * cite reste rendu à sa place.
 *
 * Gabarit `liste` et non `grille` : « Rouge ← Vert » n'est pas un libellé court,
 * et l'encre est une pastille repliable, pas un curseur. Deux colonnes étroites
 * tronqueraient les uns et déformeraient l'autre.
 */
const outputSections: EffectSection[] = [
  {
    id: "sortie-rouge",
    label: "Sortie rouge",
    params: ["redFromRed", "redFromGreen", "redFromBlue", "redInkHue", "redInkSaturation", "redInkLightness"],
    layout: "liste",
  },
  {
    id: "sortie-verte",
    label: "Sortie verte",
    params: ["greenFromRed", "greenFromGreen", "greenFromBlue", "greenInkHue", "greenInkSaturation", "greenInkLightness"],
    layout: "liste",
  },
  {
    id: "sortie-bleue",
    label: "Sortie bleue",
    params: ["blueFromRed", "blueFromGreen", "blueFromBlue", "blueInkHue", "blueInkSaturation", "blueInkLightness"],
    layout: "liste",
  },
];

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
    // ENCRES — indices 12 à 21, ajoutés À LA FIN. Les paramètres sont persistés
    // par NOM dans les presets, mais lus par INDEX par le shader : insérer au
    // milieu décalerait les neuf coefficients de la matrice d'un cran.
    //
    // Les trois défauts sont un vrai grade de fausse couleur (orange / vert /
    // turquoise), pas les primaires : posées sur les primaires, elles seraient
    // l'identité, et le curseur Recoloration serait MORT sur toute sa course
    // tant qu'on n'aurait pas touché aux teintes.
    { name: "redInkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 25, step: 1, colorGroup: { key: "encreRouge", role: "hue", label: "Encre du rouge" } },
    { name: "redInkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.85, step: 0.01, colorGroup: { key: "encreRouge", role: "saturation", label: "Encre du rouge" } },
    { name: "redInkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "encreRouge", role: "lightness", label: "Encre du rouge" } },
    { name: "greenInkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 105, step: 1, colorGroup: { key: "encreVerte", role: "hue", label: "Encre du vert" } },
    { name: "greenInkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "encreVerte", role: "saturation", label: "Encre du vert" } },
    { name: "greenInkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "encreVerte", role: "lightness", label: "Encre du vert" } },
    { name: "blueInkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 195, step: 1, colorGroup: { key: "encreBleue", role: "hue", label: "Encre du bleu" } },
    { name: "blueInkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.85, step: 0.01, colorGroup: { key: "encreBleue", role: "saturation", label: "Encre du bleu" } },
    { name: "blueInkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "encreBleue", role: "lightness", label: "Encre du bleu" } },
    // Défaut 0 : les encres sont un AJOUT. À 0, ce que rend l'effet est identique
    // AU BIT à ce qu'il rendait avant elles — la référence de rendu
    // `effet-channel-mixer` a été posée la veille du changement pour le prouver,
    // et non après.
    {
      name: "colorize",
      label: "Recoloration",
      unit: "percent",
      min: 0,
      max: 1,
      default: 0,
      step: 0.01,
      hint: "Remplace chaque canal de sortie par son encre — c'est le channel mixer « fausse couleur » de la référence. S'applique APRÈS la matrice : on peut séparer les canaux au filtre optique, puis les colorer",
    },
  ],
  sections: outputSections,
  wgsl: `
${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${TRANSFER_SPACE_WGSL}${HSL_TO_RGB_WGSL}
fn mixRow(row: vec3<f32>, preserve: f32) -> vec3<f32> {
  let sum = row.x + row.y + row.z;
  // Garde : somme nulle/négative -> aucune normalisation ne garde le signe.
  // On laisse la ligne brute plutôt que d'inverser l'image en silence.
  let safe = select(row, row / max(sum, 0.001), sum > 0.001);
  return mix(row, safe, preserve);
}

const CM_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

// Une encre, amenée du picker jusqu'à l'espace de travail de la matrice. La
// pastille montre du sRGB ; \`srgb_to_linear3\` la décode, \`to_transfer_space\`
// la remet dans l'espace courant — aller-retour fermé, identité en Linéaire.
fn cmInk(h: f32, s: f32, l: f32, space: f32) -> vec3<f32> {
  return to_transfer_space(srgb_to_linear3(hsl2rgb(h / 360.0, s, l)), space);
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
  let v = mix(mixed, gray, mono);

  // ENCRES, en COLONNES (voir le point 4 de l'en-tête) : la sortie rouge de la
  // matrice porte l'encre du rouge, et ainsi de suite. À \`colorize\` = 0 ce
  // bloc rend \`v\` inchangé, donc l'effet est identique au bit à ce qu'il
  // rendait avant lui.
  let cr = cmInk(params[12], params[13], params[14], space);
  let cg = cmInk(params[15], params[16], params[17], space);
  let cb = cmInk(params[18], params[19], params[20], space);
  let raw = v.r * cr + v.g * cg + v.b * cb;
  // Exposition : un blanc neutre entre par les trois colonnes à la fois, donc
  // il sort en \`cr + cg + cb\`. Le facteur ramène la luminance de cette somme à
  // 1 — mêmes poids et MÊME curseur que la normalisation des lignes. Garde au
  // dénominateur : trois encres noires n'ont pas d'exposition à préserver.
  let white = cr + cg + cb;
  let k = mix(1.0, 1.0 / max(dot(white, CM_LUMA), 0.001), preserve);
  let inked = mix(v, raw * k, clamp(params[21], 0.0, 1.0));

  // Plancher à 0 : une lumière négative n'existe pas, et un canal négatif
  // fausserait ensuite le mode de fusion du calque (qui, lui, n'écrête pas).
  // Pas de plafond : l'écrêtage des hautes lumières appartient à la cible, pas
  // à cet effet — l'aplatir ici tuerait la marge des calques du dessus.
  return vec4<f32>(max(from_transfer_space(inked, space), vec3<f32>(0.0)), color.a);
}
`,
};
