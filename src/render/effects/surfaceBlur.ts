import type { EffectModule } from "./types";
import { HASH_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";
import { LINEAR_TO_SRGB_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

/**
 * Surface blur — lisse les APLATS sans traverser les contours.
 *
 * D'OÙ ÇA VIENT. Demandé par Antoine le 2026-08-01 avec la famille des flous de
 * Photoshop. C'est le seul de cette famille qui ne soit pas un flou optique :
 * Surface Blur et Smart Blur ne simulent aucun objectif, ils réparent — grain
 * de capteur dans un ciel, bruit de peau, aplats sales d'un scan — en
 * n'agissant QUE là où il n'y a rien à préserver.
 *
 * POURQUOI CE N'EST PAS LE GAUSSIEN QUE §6ter REFUSE. La référence dit qu'un
 * gaussien « lave l'image » : il moyenne sans distinction, donc il efface les
 * contours en même temps que le bruit. Un filtre bilatéral pèse chaque voisin
 * par sa DISTANCE **et** par son ÉCART DE VALEUR : un voisin de l'autre côté
 * d'un contour a beau être proche, son écart le disqualifie. Le contour survit
 * intact pendant que l'aplat se lisse. Ce n'est pas le même outil, et c'est
 * pour ça que celui-là entre au registre quand le gaussien reste dehors.
 *
 * TROIS CHOSES QUI ÉVITENT LE RENDU CHEAP :
 *
 * 1. **Le seuil d'écart est PERCEPTUEL.** En lumière linéaire, un même écart de
 *    valeur ne veut pas dire la même chose dans une ombre et dans une haute
 *    lumière : le filtre lisserait les ombres jusqu'à l'aplat et n'oserait
 *    rien dans les ciels. C'est la même panne, et le même correctif, que le
 *    seuil d'`outlines` et le bright-pass du `glow`.
 * 2. **L'écart se mesure sur la LUMINANCE, la couleur suit.** Peser chaque
 *    canal séparément fait dériver la teinte des pixels de bord — le voisin est
 *    accepté en rouge et refusé en bleu, donc le mélange n'a plus de sens
 *    colorimétrique. Un seul poids par voisin, appliqué au triplet entier.
 * 3. **Le nombre de taps suit l'AIRE**, et la spirale est tournée par pixel.
 *    Sans ça, un rayon large donne une nuée granuleuse — la leçon que
 *    `lensBlur` a payée dans cette même session.
 *
 * LA RAIDEUR DU SEUIL EST UN VRAI RÉGLAGE, pas un détail d'implémentation. À
 * raideur maximale, le voisin est pris ou jeté franchement : les zones se
 * séparent en plages, et on obtient le rendu « peinture » de Smart Blur. À
 * raideur minimale, la bascule est une gaussienne et le lissage reste
 * photographique. Les deux sont légitimes, aucun n'est le bon par défaut —
 * d'où un curseur plutôt qu'une constante choisie en silence.
 *
 * COÛT : une collecte en demi-résolution, comme `lensBlur` et `motionBlur`, et
 * pour la même raison — passe interne, sortie en définition native.
 */

/** Plafond du nombre de taps. Même arbitrage assumé que `lensBlur` : au-delà du
 *  rayon où il mord, la couverture redescend et la granulation revient. */
const TAPS_MAX = 192;

const SURFACE_GATHER_WGSL = `
${UV_SPACE_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${HASH_WGSL}
const SURFACE_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const GOLDEN_ANGLE = 2.399963229728653;
const TAU = 6.283185307179586;

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  // Rayon en TEXELS de cette cible : la passe tourne à 1/2, donc un pixel
  // pleine définition vaut un demi-texel ici. Le facteur ne « tombe pas tout
  // seul » — c'est l'erreur qu'a faite la première version de \`lensBlur\`, et
  // elle floutait au double du rayon réglé.
  let rt = max(params[0], 0.0) * 0.5;
  // Seuil PERCEPTUEL : c'est une valeur de curseur, comparée à un écart de
  // luminance qu'on lit lui aussi sur l'axe perceptuel. Les deux bouts de la
  // comparaison vivent donc dans le même espace.
  let sigma = max(params[1], 0.002);
  // Raideur de la bascule : 2 = gaussienne (lissage photographique), 8 = presque
  // un tout-ou-rien (plages séparées, rendu « peinture »).
  let stiffness = mix(8.0, 2.0, clamp(params[2], 0.0, 1.0));

  if (rt < 0.35) {
    return color;
  }

  let centerLuma = linear_to_srgb(dot(color.rgb, SURFACE_LUMA));
  let jitter = hash(uv * dims) * TAU;
  let step = rt / dims;
  let taps = clamp(i32(3.141592653589793 * rt * rt / 3.0), 24, ${TAPS_MAX});
  let tapsF = f32(taps);

  // Le pixel central compte, avec un poids de 1 : sans lui, un pixel isolé dont
  // TOUS les voisins sont hors seuil (un point de poussière, un pixel chaud)
  // n'aurait aucun poids valide et sortirait de la division par un plancher —
  // c'est-à-dire noir. Il doit rester lui-même, pas disparaître.
  var sum = color * 1.0;
  var wsum = 1.0;
  for (var i = 0; i < taps; i = i + 1) {
    let fi = f32(i);
    // sqrt(t) : densité constante sur l'AIRE du disque. Sans la racine, les
    // taps s'entassent au centre et le voisinage lointain est sous-échantillonné.
    let t = (fi + 0.5) / tapsF;
    let r = sqrt(t);
    let theta = fi * GOLDEN_ANGLE + jitter;
    let off = vec2<f32>(cos(theta), sin(theta)) * r * step;
    let c = textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv + off), 0.0);

    // POIDS SPATIAL : gaussienne sur le rayon normalisé. Un poids plat ferait
    // du filtre une moyenne de boîte, dont le noyau carré se lit en croix sur
    // les aplats.
    let ws = exp(-2.0 * r * r);
    // POIDS DE VALEUR — c'est lui qui fait tout. Un voisin de l'autre côté d'un
    // contour a beau être proche, son écart le disqualifie. Mesuré sur la
    // LUMINANCE et appliqué au triplet entier : peser chaque canal séparément
    // ferait dériver la teinte des pixels de bord.
    let dl = abs(linear_to_srgb(dot(c.rgb, SURFACE_LUMA)) - centerLuma);
    let wr = exp(-pow(dl / sigma, stiffness));

    let w = ws * wr;
    sum = sum + c * w;
    wsum = wsum + w;
  }
  return sum / wsum;
}
`;

export const surfaceBlur: EffectModule = {
  id: "surfaceBlur",
  name: "Surface blur",
  params: [
    { name: "radius", label: "Rayon", unit: "pixels", min: 0, max: 80, default: 16, step: 0.5, hint: "Jusqu'où le lissage va chercher ses voisins, en pixels pleine définition" },
    { name: "threshold", label: "Seuil d'écart", unit: "percent", min: 0.002, max: 0.5, default: 0.06, step: 0.002, hint: "Écart de ton, en valeurs perceptuelles, au-delà duquel un voisin est refusé. C'est ce qui fait survivre les contours : bas = seuls les aplats se lissent, haut = le filtre redevient un flou ordinaire" },
    { name: "stiffness", label: "Raideur du seuil", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "0 = bascule franche, les zones se séparent en plages (rendu peinture) ; 1 = bascule gaussienne, lissage photographique" },
  ],
  passes: [{ scale: 0.5, wgsl: SURFACE_GATHER_WGSL }],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let radiusPx = max(params[0], 0.0);
  let blurred = textureSample(prevPass, srcSampler, uv);
  // Reprise du NET sous le pixel, même contrat que \`lensBlur\` et
  // \`motionBlur\` : la collecte tourne en demi-résolution, donc un rayon nul y
  // rendrait quand même une image passée par un aller-retour de résolution. Un
  // filtre dont la promesse est de PRÉSERVER ne peut pas se permettre de
  // ramollir ce qu'il ne touche pas.
  let sharpness = smoothstep(0.7, 2.0, radiusPx);
  return vec4<f32>(mix(color.rgb, blurred.rgb, sharpness), color.a);
}
`,
};
