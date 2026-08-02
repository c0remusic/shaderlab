import type { EffectModule } from "./types";
import { BAYER4_WGSL, BAYER8_WGSL } from "./bayer";
import { HSL_TO_RGB_WGSL } from "./hsl";
import {
  LINEAR_TO_SRGB_WGSL,
  LINEAR_TO_SRGB_VEC3_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Dither — la quantification ASSUMÉE : peu de niveaux, et un motif qui rend
 * lisible ce qui tombe entre deux. C'est le rendu riso, le 1 bit, le journal.
 *
 * D'OÙ ÇA VIENT. Cahier de références, §6quinquies : `Dither` figure parmi les
 * effets Figma sans équivalent ici, avec sa surface — Style (Bayer / Blue Noise
 * / Threshold), Size, Levels, Mono. Demandé par Antoine le 2026-08-03 dans la
 * suite d'`echoOutlines`, « dans le genre, la même DA ».
 *
 * CE N'EST PAS LE TRAMAGE DE `posterize`, et il vaut mieux écrire pourquoi que
 * de laisser croire à un doublon. Le sien est un correctif : un décalage d'au
 * plus un demi-palier, en Bayer 4x4, sur les trois canaux, POUR CACHER la
 * frontière entre deux aplats. Il est au service de la quantification, il ne se
 * voit pas. Ici le motif EST le sujet — sa taille se règle, il descend à deux
 * niveaux, et il peut réduire l'image à deux encres. Aucun réglage de
 * `posterize` n'atteint ça : son tramage n'a ni taille, ni style, ni mono.
 *
 * ─── TROIS STYLES, ET CE QUI LES SÉPARE VRAIMENT ────────────────────────────
 *
 * - **Bayer** (ordonné). Un seuil par position dans une matrice, donc un motif
 *   RÉGULIER et parfaitement stable. C'est le rendu « ordinateur 8 bits » : on
 *   voit la grille, et c'est ce qu'on vient chercher. Matrice 8x8 et non 4x4 :
 *   à deux niveaux, les seize seuils d'une 4x4 sont toute l'information
 *   disponible et la trame se lit en blocs. Voir `bayer.ts`.
 * - **Bruit bleu**. Un seuil pseudo-aléatoire dont le spectre est pauvre en
 *   basses fréquences : le motif ne fait pas de paquets, donc l'œil ne voit plus
 *   de grille mais un grain fin. C'est le rendu « impression », plus organique.
 *   ⚠️ CE QUI EST IMPLÉMENTÉ EST UNE APPROXIMATION, et c'est écrit ici plutôt
 *   que sous-entendu : le vrai bruit bleu se précalcule (recuit simulé sur une
 *   texture), ce qui demanderait une texture de plus dans un pipeline qui n'en
 *   a pas prévu. On utilise l'`interleaved gradient noise` de Jimenez — la même
 *   source que le bloom de ce dépôt cite déjà — dont le spectre est proche du
 *   bruit bleu pour un coût de trois multiplications. La différence se voit sur
 *   un dégradé très lent, pas sur une photo.
 * - **Seuil**. Aucun motif : la quantification nue. Il n'est pas là pour être
 *   beau mais pour être le TÉMOIN — c'est en basculant dessus qu'on voit ce que
 *   les deux autres font réellement, et c'est le rendu « photocopie » quand les
 *   niveaux tombent à deux.
 *
 * ─── DEUX CHOSES QUI ÉVITENT LE RENDU CHEAP ─────────────────────────────────
 *
 * 1. **La comparaison se fait sur l'axe PERCEPTUEL.** Quantifier une valeur
 *    linéaire répartirait presque tous les niveaux dans les hautes lumières —
 *    une image dont les ombres seraient un aplat noir et les clairs un dégradé
 *    fin. C'est la même panne, et le même correctif, que le seuil d'`outlines`
 *    et les bascules de `duotone` : on POSITIONNE une réponse sur l'axe
 *    perceptuel, on ne convertit aucune couleur.
 * 2. **La taille du motif est en pixels de l'IMAGE, et elle monte jusqu'à 32.**
 *    Une trame de 2 px source sur une photo de 26 Mpx affichée à 30 % fait
 *    0,6 px à l'écran : elle ne peut que se moyenner en bouillie. La leçon a
 *    déjà été payée sur `posterize` (journal du 2026-08-02) — un phénomène
 *    exprimé en pixels source se juge à l'échelle d'affichage.
 *
 * COÛT : aucun tap supplémentaire, une seule passe.
 */

const STYLES = ["Bayer", "Bruit bleu", "Seuil"] as const;
const STYLE_BAYER = 0;
const STYLE_BLUE = 1;

export const dither: EffectModule = {
  id: "dither",
  name: "Dither",
  params: [
    { name: "style", label: "Style", unit: "none", min: 0, max: STYLES.length - 1, default: STYLE_BAYER, step: 1, choices: [...STYLES], hint: "Bayer : matrice ordonnée, on voit la grille (rendu 8 bits). Bruit bleu : grain fin sans grille (rendu impression). Seuil : aucun motif, la quantification nue — le témoin qui montre ce que font les deux autres" },
    { name: "size", label: "Taille du motif", unit: "pixels", min: 1, max: 32, default: 4, step: 1, hint: "Côté d'une cellule de trame, en pixels de l'image. Sur une grande photo affichée en réduction, une trame de 1 ou 2 px se moyenne en bouillie : c'est ici qu'on la remonte" },
    { name: "levels", label: "Niveaux", unit: "none", min: 2, max: 8, default: 3, step: 1, hint: "Nombre de valeurs conservées. 2 = un bit, le rendu photocopie ; au-delà de 6 le tramage cesse de se voir" },
    { name: "mono", label: "Deux encres", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, hint: "0 = chaque canal est tramé séparément (rendu couleur rétro). 1 = l'image se réduit à l'encre et au papier ci-dessous, comme une risographie" },
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0.05, step: 0.01, hint: "Ton d'entrée qui reçoit le niveau le plus sombre — le monter écrase les ombres" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 0.95, step: 0.01, hint: "Ton d'entrée qui reçoit le niveau le plus clair — le descendre brûle les hautes lumières" },
    { name: "inkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 220, step: 1, colorGroup: { key: "encre", role: "hue", label: "Encre" } },
    { name: "inkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "encre", role: "saturation", label: "Encre" } },
    { name: "inkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.13, step: 0.01, colorGroup: { key: "encre", role: "lightness", label: "Encre" } },
    { name: "paperHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 40, step: 1, colorGroup: { key: "papier", role: "hue", label: "Papier" } },
    { name: "paperSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.18, step: 0.01, colorGroup: { key: "papier", role: "saturation", label: "Papier" } },
    { name: "paperLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.94, step: 0.01, colorGroup: { key: "papier", role: "lightness", label: "Papier" } },
  ],
  wgsl: `
${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${HSL_TO_RGB_WGSL}${BAYER4_WGSL}${BAYER8_WGSL}
const DITHER_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

/** Interleaved gradient noise (Jimenez, SIGGRAPH 2014) — approximation de bruit
 *  bleu à trois multiplications. Rendue dans [-0.5, 0.5), comme les seuils de
 *  Bayer, pour que les trois styles soient interchangeables sans facteur. */
fn ditherBlue(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)) - 0.5;
}

/** Seuil du pixel selon le style. Le \`if\` est sûr : le style vient d'un
 *  UNIFORME, donc le branchement est uniforme sur toute la passe — même
 *  raisonnement que \`input_driver\`. */
fn ditherThreshold(cell: vec2<f32>, style: f32) -> f32 {
  let s = i32(style + 0.5);
  if (s == ${STYLE_BAYER}) {
    return bayerThreshold8(vec2<u32>(vec2<i32>(floor(cell)) & vec2<i32>(7)));
  }
  if (s == ${STYLE_BLUE}) {
    return ditherBlue(floor(cell));
  }
  // Seuil nu : aucun motif. Le témoin.
  return 0.0;
}

/** Quantification d'un canal, seuil déjà choisi. \`v\` et le résultat sont sur
 *  l'axe PERCEPTUEL — voir le point 1 de l'en-tête. */
fn ditherQuantize(v: f32, levels: f32, seuil: f32) -> f32 {
  let pas = 1.0 / max(levels - 1.0, 1.0);
  return clamp(floor(v / pas + 0.5 + seuil) * pas, 0.0, 1.0);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let style = params[0];
  let size = max(params[1], 1.0);
  let levels = max(params[2], 2.0);
  let mono = clamp(params[3], 0.0, 1.0);
  let blackPoint = clamp(params[4], 0.0, 0.95);
  // Un point blanc sous le point noir inverserait la réponse en silence, avec
  // un dénominateur négatif. Borné juste au-dessus — l'inversion se fait en
  // échangeant les deux curseurs, là où elle se voit.
  let whitePoint = max(params[5], blackPoint + 0.001);

  // Cellule de trame, en pixels de l'IMAGE et non en UV : une trame doit avoir
  // la même finesse sur les deux axes, ce qu'un pas en UV ne donne pas dès que
  // la photo n'est pas carrée.
  let px = uv * vec2<f32>(textureDimensions(srcTexture));
  let cell = px / size;
  let seuil = ditherThreshold(cell, style);

  // \`color.rgb\` est LINÉAIRE (format de texture -srgb). On passe sur l'axe
  // perceptuel pour quantifier, et on redescend : aucun gamma ne s'échappe, le
  // couple encode/décode encadre la seule quantification (même contrat que le
  // \`transferSpace\` de channelMixer).
  let src = linear_to_srgb3(color.rgb);
  let etendue = whitePoint - blackPoint;

  // VOIE COULEUR : chaque canal tramé séparément, ce qui donne les teintes
  // croisées du rendu rétro — un pixel peut sortir cyan ou magenta sans que
  // l'image ait jamais eu ces couleurs.
  let etale = clamp((src - vec3<f32>(blackPoint)) / etendue, vec3<f32>(0.0), vec3<f32>(1.0));
  let couleur = vec3<f32>(
    ditherQuantize(etale.r, levels, seuil),
    ditherQuantize(etale.g, levels, seuil),
    ditherQuantize(etale.b, levels, seuil)
  );

  // VOIE DEUX ENCRES : on trame la LUMINANCE, et le niveau obtenu choisit où
  // l'on se trouve entre le papier et l'encre. Le mélange se fait en LINÉAIRE
  // (les deux couleurs sont décodées d'abord), comme partout ailleurs ici.
  let tone = clamp((linear_to_srgb(dot(color.rgb, DITHER_LUMA)) - blackPoint) / etendue, 0.0, 1.0);
  let niveau = ditherQuantize(tone, levels, seuil);
  let encre = srgb_to_linear3(hsl2rgb(params[6] / 360.0, params[7], params[8]));
  let papier = srgb_to_linear3(hsl2rgb(params[9] / 360.0, params[10], params[11]));
  let deuxEncres = mix(encre, papier, niveau);

  return vec4<f32>(mix(srgb_to_linear3(couleur), deuxEncres, mono), color.a);
}
`,
};
