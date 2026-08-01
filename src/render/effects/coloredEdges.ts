import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INPUT_DRIVER_WGSL, inputSourceParam } from "./inputMode";
import { EDGE_GRADIENT_WGSL, EDGE_SPACING_WGSL, SCHARR_NORM } from "./edgeGradient";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Colored edges — les contours, colorés par leur ORIENTATION.
 *
 * D'OÙ ÇA VIENT. Demandé par Antoine le 2026-08-01 ; `Colored edges` figure au
 * catalogue Figma des shaders (Ellie Lin), et sa fiche n'a pas pu être lue — la
 * page ne publie que ses quatre vedettes. Conçu donc d'après la référence de
 * détection de contours, écart avec Figma assumé et écrit ici.
 *
 * CE QUI LE SÉPARE D'`outlines`, et pourquoi ce n'est pas un doublon. La
 * question est légitime : les deux tracent des bords, et depuis ce commit ils
 * partagent le MÊME détecteur (`edgeGradient.ts`). Ce qu'ils font de la mesure
 * n'a rien à voir :
 *
 * - `outlines` jette la DIRECTION du gradient et n'en garde que la magnitude.
 *   Son trait est d'une seule encre, choisie au sélecteur. Le résultat est un
 *   dessin — silhouette, dessin au trait sur fond délavé.
 * - `coloredEdges` garde la direction et en fait une TEINTE. Deux bords d'une
 *   même forme, orientés différemment, sortent de deux couleurs différentes ;
 *   un contour fermé parcourt le cercle chromatique. Le résultat n'est pas un
 *   dessin mais une lecture de la géométrie, celle qu'on reconnaît sur une
 *   carte de normales.
 *
 * Aucun réglage d'`outlines` ne produit ça, et aucun empilement non plus : la
 * direction du gradient n'existe nulle part ailleurs dans le pipeline.
 *
 * TROIS CHOSES QUI ÉVITENT LE RENDU CHEAP :
 *
 * 1. **La direction tient compte des contours ISOLUMINANTS.** Un gradient de
 *    luminance seul est aveugle à une fleur rouge sur des feuilles vertes : sa
 *    direction y serait du bruit, donc la teinte y scintillerait pixel à pixel.
 *    Le vecteur d'orientation somme donc le gradient de ton et celui de
 *    chromaticité, avec le même poids que celui qui règle déjà la magnitude.
 * 2. **La teinte est CYCLIQUE, comme l'angle qu'elle représente.** Un angle
 *    fait le tour ; une rampe de teinte qui ne boucle pas poserait une couture
 *    visible sur les bords orientés à 180°, là où le rouge redeviendrait
 *    brutalement du violet. `fract` sur un tour de roue supprime la couture par
 *    construction.
 * 3. **Le trait reste antialiasé par le plancher `fwidth`**, exactement comme
 *    `outlines` : la largeur de la bascule ne descend jamais sous la variation
 *    de la magnitude d'un pixel écran à l'autre. Un contour coloré crénelé
 *    serait deux fois plus visible qu'un contour noir, puisque l'escalier y
 *    change aussi de teinte.
 *
 * COÛT : 8 taps (ceux du module partagé), une seule passe.
 */
export const coloredEdges: EffectModule = {
  id: "coloredEdges",
  name: "Colored edges",
  params: [
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 12, default: 2, step: 0.1, hint: "Écartement des taps — épaissit le trait et, du même geste, empêche le grain d'être dessiné" },
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 0.6, default: 0.07, step: 0.005, hint: "Contraste minimal (en tons perceptuels, sur l'épaisseur du trait) pour qu'un contour soit tracé" },
    { name: "softness", label: "Fondu du trait", unit: "percent", min: 0, max: 1, default: 0.3, step: 0.01, hint: "0 = trait franc (toujours antialiasé), 1 = trait fondu qui s'éteint progressivement sur les contours faibles" },
    { name: "chroma", label: "Sensibilité couleur", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Fait lever les contours entre deux couleurs de MÊME luminosité, et empêche leur teinte de scintiller faute d'orientation lisible. Sans objet en entrée Alpha" },
    { name: "hueOffset", label: "Rotation des teintes", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "Fait tourner la roue chromatique : choisit quelle couleur reçoit un bord horizontal" },
    { name: "hueSpread", label: "Étendue des teintes", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, hint: "Part du cercle chromatique parcourue par un tour complet d'orientation. 1 = toutes les teintes ; bas = une gamme resserrée autour de la rotation" },
    { name: "saturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.85, step: 0.01, hint: "Vivacité des contours colorés" },
    { name: "lightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, hint: "Clarté des contours colorés" },
    { name: "wash", label: "Délavé du fond", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "Éclaircit la photo sous les contours — 0 = contours sur la photo intacte, 1 = contours seuls sur blanc" },
    inputSourceParam(),
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INPUT_DRIVER_WGSL}${EDGE_GRADIENT_WGSL}${EDGE_SPACING_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[1];
  let softness = clamp(params[2], 0.0, 1.0);
  let chroma = clamp(params[3], 0.0, 1.0);
  let hueOffset = params[4] / 360.0;
  let hueSpread = clamp(params[5], 0.05, 1.0);
  let saturation = clamp(params[6], 0.0, 1.0);
  let lightness = clamp(params[7], 0.0, 1.0);
  let wash = clamp(params[8], 0.0, 1.0);
  let source = params[9];

  // Détecteur PARTAGÉ avec \`outlines\` (effects/edgeGradient.ts) : mêmes huit
  // taps, mêmes poids de Scharr, même écartement isotrope. Ce qui diffère
  // commence en dessous.
  let g = edge_scharr(uv, edge_spacing(params[0]), source);
  let gx = g.gx;
  let gy = g.gy;

  // MAGNITUDE — identique à celle d'\`outlines\`, et pour les mêmes raisons :
  // \`max\` et non somme (un contour de luminance net ne doit pas s'épaissir
  // parce qu'il est accessoirement coloré), facteur 3 pour ramener l'échelle de
  // la chromaticité sur celle du ton.
  let toneMag = sqrt(gx.x * gx.x + gy.x * gy.x) / ${SCHARR_NORM}.0;
  let chromaMag = sqrt(gx.y * gx.y + gy.y * gy.y + gx.z * gx.z + gy.z * gy.z) / ${SCHARR_NORM}.0;
  let mag = max(toneMag, chroma * 3.0 * chromaMag);

  // ORIENTATION — c'est ici que cet effet se sépare d'\`outlines\`, qui jette
  // cette information. Le vecteur somme le gradient de TON et celui de
  // CHROMATICITÉ : sur un contour isoluminant, le premier est nul et sa
  // direction serait du bruit, donc la teinte scintillerait pixel à pixel. Le
  // poids est le même que celui qui règle la magnitude — un seul curseur pour
  // une seule notion.
  let gTone = vec2<f32>(gx.x, gy.x);
  let gChroma = vec2<f32>(gx.y + gx.z, gy.y + gy.z);
  let dirVec = gTone + chroma * 3.0 * gChroma;
  // atan2 rend -PI..PI ; ramené en TOURS, comme la teinte. \`fract\` referme le
  // cercle : sans lui, les bords orientés à 180° porteraient une couture, là où
  // la rampe de teinte sauterait d'un bout à l'autre de la roue.
  let turns = atan2(dirVec.y, dirVec.x) / 6.283185307179586;
  let hue = fract(hueOffset + turns * hueSpread);

  // Plancher fwidth : la largeur de la bascule ne descend jamais sous la
  // variation de \`mag\` d'un pixel écran à l'autre. Un contour COLORÉ crénelé
  // serait deux fois plus visible qu'un contour noir — l'escalier y changerait
  // aussi de teinte.
  let band = max(max(softness * 0.5, fwidth(mag)), 0.0005);
  let line = smoothstep(threshold, threshold + band, mag);

  // La couleur est construite en HSL (donc en valeurs PERCEPTUELLES, comme un
  // sélecteur), puis décodée vers le linéaire avant tout mélange — même contrat
  // que l'encre d'\`outlines\` et les arrêts de \`duotone\`.
  let edgeColor = srgb_to_linear3(hsl2rgb(hue, saturation, lightness));
  let paper = mix(color.rgb, vec3<f32>(1.0), wash);
  return vec4<f32>(mix(paper, edgeColor, line), color.a);
}
`,
};
