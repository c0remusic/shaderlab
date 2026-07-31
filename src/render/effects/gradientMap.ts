import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Gradient map — remplace la couleur de chaque pixel par celle qu'un dégradé
 * porte à sa luminosité.
 *
 * CE QUI LE DISTINGUE DE `duotone`, qui prend les mêmes trois couleurs. La
 * question est légitime et la réponse n'est pas cosmétique — ce sont deux
 * outils pour deux gestes :
 * - `duotone` ÉCRASE la matière. Son curseur « contraste » durcit les bascules
 *   jusqu'aux aplats ; le résultat est graphique, sérigraphié, et le modelé de
 *   la photo disparaît. C'est voulu.
 * - `gradientMap` GARDE la photo. Ses trois arrêts sont POSITIONNABLES (point
 *   noir, point blanc, position du ton moyen : là où duotone n'a qu'un pivot),
 *   et « Conserver le modelé » réinjecte la luminosité d'origine sous la teinte
 *   du dégradé. On tire une image vers une gamme colorée sans la transformer en
 *   affiche.
 *
 * LA VERSION NAÏVE, et pourquoi elle rend « filtre Photoshop 2005 » : prendre
 * la luminance, la mettre telle quelle dans un `mix` entre deux couleurs.
 * Quatre pannes, toutes visibles à l'œil, toutes corrigées ici :
 *
 * 1. **Cartographier sur la luminance LINÉAIRE bourre tout le dégradé dans les
 *    hautes lumières.** Un gris perçu comme « milieu » vaut ~0.21 en linéaire,
 *    pas 0.5 : les quatre cinquièmes de l'image tombent donc dans le premier
 *    cinquième de la rampe, et l'arrêt de ton moyen n'a d'effet que sur les
 *    ciels. C'est la même panne, et le même correctif, que le seuil d'`outlines`
 *    et les bascules de `duotone` : on POSITIONNE sur l'axe PERCEPTUEL
 *    (`linear_to_srgb(luma)`) sans toucher à aucune valeur de couleur.
 *
 * 2. **Interpoler deux couleurs saturées en lumière LINÉAIRE creuse le
 *    milieu.** Entre un bleu profond et un orange vif, la moyenne linéaire est
 *    dominée par le plus lumineux des deux et le milieu de rampe sort en gris
 *    boueux — le défaut le plus reconnaissable d'un gradient map raté. Le
 *    mélange se fait donc dans l'espace PERCEPTUEL (celui du sélecteur, celui
 *    où les arrêts sont écrits), et la couleur obtenue n'est décodée vers le
 *    linéaire qu'UNE fois, à la fin. C'est le choix inverse de `duotone`, qui
 *    décode ses trois arrêts d'abord — cohérent avec son but, qui est de casser
 *    la continuité, pas de la préserver.
 *
 * 3. **Une rampe linéaire par morceaux laisse une ARÊTE à l'arrêt du milieu.**
 *    La couleur est continue mais sa dérivée saute, et sur un dégradé lisse —
 *    un ciel, un mur — l'œil voit une bande nette pile à la position du ton
 *    moyen (bande de Mach). Chaque segment passe donc par un `smoothstep`, dont
 *    la dérivée s'annule aux deux bouts : les deux segments se raccordent sans
 *    arête.
 *
 * 4. **Un gradient map pur efface le modelé.** Deux pixels de même luminosité
 *    reçoivent la même couleur, quelle que soit la texture : une peau devient un
 *    aplat. « Conserver le modelé » remet la luminance d'origine sous la
 *    chromaticité du dégradé, en bornant le facteur de remise à l'échelle —
 *    sans borne, un arrêt très sombre sous une haute lumière produit une
 *    division par presque zéro et un pixel blanc isolé, cramé, au milieu d'une
 *    zone propre.
 *
 * COÛT : aucun tap supplémentaire (le pixel courant suffit), une seule passe.
 *
 * Pas de curseur « mélange avec l'original » : le calque porte déjà son
 * `opacity`, son `blendMode` et son masque.
 */
export const gradientMap: EffectModule = {
  id: "gradientMap",
  name: "Gradient map",
  params: [
    { name: "shadowHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 235, step: 1, colorGroup: { key: "shadow", role: "hue", label: "Arrêt sombre" } },
    { name: "shadowSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "shadow", role: "saturation", label: "Arrêt sombre" } },
    { name: "shadowLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.14, step: 0.01, colorGroup: { key: "shadow", role: "lightness", label: "Arrêt sombre" } },
    { name: "midHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 320, step: 1, colorGroup: { key: "mid", role: "hue", label: "Arrêt moyen" } },
    { name: "midSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.42, step: 0.01, colorGroup: { key: "mid", role: "saturation", label: "Arrêt moyen" } },
    { name: "midLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "mid", role: "lightness", label: "Arrêt moyen" } },
    { name: "highHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 45, step: 1, colorGroup: { key: "high", role: "hue", label: "Arrêt clair" } },
    { name: "highSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "high", role: "saturation", label: "Arrêt clair" } },
    { name: "highLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.88, step: 0.01, colorGroup: { key: "high", role: "lightness", label: "Arrêt clair" } },
    { name: "midPosition", label: "Position du ton moyen", unit: "percent", min: 0.05, max: 0.95, default: 0.5, step: 0.01, hint: "Où l'arrêt moyen tombe sur l'axe de luminosité perceptuelle — bas = la gamme claire occupe presque toute l'image" },
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0, step: 0.01, hint: "Ton d'entrée qui reçoit l'arrêt sombre — le monter écrase les ombres sur cette couleur" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, hint: "Ton d'entrée qui reçoit l'arrêt clair — le descendre écrase les hautes lumières sur cette couleur" },
    { name: "preserveShading", label: "Conserver le modelé", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Réinjecte la luminosité d'origine sous la teinte du dégradé — 0 = aplats par niveau, 1 = la photo garde tout son relief" },
  ],
  wgsl: `
${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
const GRADIENT_MAP_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Les trois arrêts restent en sRGB (valeurs PERCEPTUELLES, exactement ce
  // qu'affichent les pastilles) : c'est dans cet espace qu'on les mélange, et
  // le décodage vers le linéaire n'a lieu qu'une fois, sur la couleur finale.
  let shadowStop = hsl2rgb(params[0] / 360.0, params[1], params[2]);
  let midStop = hsl2rgb(params[3] / 360.0, params[4], params[5]);
  let highStop = hsl2rgb(params[6] / 360.0, params[7], params[8]);
  let midPosition = clamp(params[9], 0.05, 0.95);
  let blackPoint = params[10];
  // Un point blanc sous le point noir inverserait la rampe en silence, avec un
  // dénominateur négatif : borné juste au-dessus, l'inversion se fait au
  // sélecteur de couleurs (en échangeant les arrêts), là où elle se voit.
  let whitePoint = max(params[11], blackPoint + 0.001);
  let preserveShading = clamp(params[12], 0.0, 1.0);

  // \`color\` est LINÉAIRE (format de texture -srgb). La luminance l'est donc
  // aussi, et c'est bien ce qu'il faut pour le modelé plus bas — mais pas pour
  // POSITIONNER sur la rampe, d'où la conversion perceptuelle qui suit.
  let luma = dot(color.rgb, GRADIENT_MAP_LUMA);
  let tone = linear_to_srgb(luma);
  let x = clamp((tone - blackPoint) / (whitePoint - blackPoint), 0.0, 1.0);

  // Deux segments, chacun lissé aux deux bouts : la dérivée s'annule de part et
  // d'autre de l'arrêt moyen, donc les segments se raccordent sans arête. Les
  // deux branches sont calculées puis SÉLECTIONNÉES plutôt que branchées : sur
  // GPU les deux chemins d'un \`if\` divergent s'exécutent de toute façon, et
  // \`select\` le dit au lieu de le cacher.
  let lowK = smoothstep(0.0, 1.0, x / midPosition);
  let highK = smoothstep(0.0, 1.0, (x - midPosition) / (1.0 - midPosition));
  let rampSrgb = select(
    mix(shadowStop, midStop, lowK),
    mix(midStop, highStop, highK),
    x >= midPosition
  );

  let mapped = srgb_to_linear3(rampSrgb);

  // MODELÉ. On remet la luminance d'origine en remettant à l'échelle la couleur
  // cartographiée — ce qui conserve sa chromaticité. Le facteur est borné à 4 :
  // sans borne, un arrêt presque noir sous une haute lumière donne une division
  // par presque zéro, et le pixel part en blanc cramé isolé au milieu d'une
  // zone propre.
  let mappedLuma = dot(mapped, GRADIENT_MAP_LUMA);
  let relit = mapped * clamp(luma / max(mappedLuma, 0.0001), 0.0, 4.0);
  let out = mix(mapped, relit, preserveShading);

  return vec4<f32>(out, color.a);
}
`,
};
