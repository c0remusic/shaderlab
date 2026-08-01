import type { EffectModule } from "./types";
import { HASH_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Motion blur — l'intégration d'un mouvement pendant l'ouverture de
 * l'obturateur, en ligne, en rotation ou en zoom.
 *
 * D'OÙ ÇA VIENT. Cahier de références §6ter : la Blur Gallery de Photoshop
 * range **Path Blur** et **Spin Blur** parmi ses cinq outils, et le cahier note
 * qu'ils « relèvent du motion blur, une autre famille — à cadrer avec lui ».
 * C'est ce cadrage. Le flou radial de zoom vient du même geste physique et
 * n'aurait aucune raison d'être un troisième effet : les trois ne diffèrent que
 * par la TRAJECTOIRE le long de laquelle on intègre.
 *
 * CE QUE CE N'EST PAS : un flou. `lensBlur` intègre sur une SURFACE (l'ouverture
 * du diaphragme) à un instant donné ; celui-ci intègre le long d'une COURBE (la
 * trajectoire du sujet) pendant une durée. C'est pour ça qu'il ne partage pas
 * son noyau : un disque de bokeh n'a rien à faire ici, et une traînée n'a pas de
 * forme de diaphragme.
 *
 * QUATRE CHOSES QUI SÉPARENT ÇA D'UN « filtre Photoshop 2005 » :
 *
 * 1. **Le nombre d'échantillons suit la LONGUEUR de la traînée.** À nombre fixe,
 *    une traînée longue se décompose en copies fantômes espacées — le défaut le
 *    plus reconnaissable d'un motion blur raté, et exactement celui que
 *    `lensBlur` a montré avant correction. Un échantillon par texel, plafonné.
 * 2. **Le départ de l'échantillonnage est TIRÉ PAR PIXEL.** Même à densité
 *    correcte, une grille régulière laisse un moirage le long de la traînée ;
 *    le tirage le remplace par une granulation, qu'on ne voit pas.
 * 3. **L'obturateur est décentrable.** Un moteur physique intègre
 *    symétriquement autour de l'instant courant, ce qui fait déborder le sujet
 *    des DEUX côtés. Une photo veut souvent la traînée derrière le sujet et un
 *    bord net devant — c'est ce que fait un obturateur à rideau (second-curtain
 *    sync), et c'est ce que règle « Décentrage ».
 * 4. **La rotation est circulaire en PIXELS, pas en UV.** Sans correction
 *    d'aspect, un « flou de rotation » sur une photo 3:2 décrirait une ellipse,
 *    et le curseur d'angle mentirait sur toute sa course.
 *
 * COÛT : une collecte en demi-résolution (comme `lensBlur`, et pour la même
 * raison — la sortie reste en définition native, c'est une passe interne), puis
 * une passe finale pleine définition qui reprend le net quand la traînée tombe
 * sous le pixel.
 */

/** Étiquettes de la trajectoire. L'index EST la valeur du paramètre. */
const TRAJECTORIES = ["Directionnel", "Rotation", "Zoom"] as const;
const TRAJ_DIRECTIONAL = 0;

/** Plafond du nombre d'échantillons, qui suit sinon la longueur de la traînée
 *  (environ un par texel). Même arbitrage, et même honnêteté, que `TAPS_MAX` de
 *  `lensBlur` : au-delà de la longueur où ce plafond mord, la densité redescend
 *  et le fantôme réapparaît progressivement. */
const SAMPLES_MAX = 192;

/** Corps partagé par les deux passes : la longueur de traînée d'un pixel, en
 *  UV, selon la trajectoire. Les DEUX passes doivent en lire la même — la
 *  collecte pour savoir combien d'échantillons prendre, la passe finale pour
 *  savoir où reprendre le net. Deux définitions divergentes se verraient comme
 *  une frange au raccord (leçon de `lensBlur`, même remède). */
const TRAIL_WGSL = `
fn motion_trail(uv: vec2<f32>, dims: vec2<f32>) -> vec2<f32> {
  let mode = i32(params[0] + 0.5);
  let amount = params[1];
  let angle = params[2] * 0.017453292519943295;
  let center = vec2<f32>(params[3], params[4]);
  let ar = aspectScale(dims);

  if (mode == ${TRAJ_DIRECTIONAL}) {
    // Longueur en PIXELS pleine définition, convertie en UV par les dimensions
    // réelles : l'angle demandé est l'angle obtenu sur les deux axes.
    return vec2<f32>(cos(angle), sin(angle)) * amount / dims;
  }

  let d = (uv - center) * ar;
  if (mode == 1) {
    // ROTATION : le déplacement est la TANGENTE au cercle, et sa longueur est
    // l'arc parcouru — donc proportionnelle au rayon. C'est ce qui fait qu'un
    // flou de rotation laisse le centre net sans qu'aucun réglage ne le
    // demande. \`amount\` est un angle en degrés.
    let tangent = vec2<f32>(-d.y, d.x);
    return tangent * (amount * 0.017453292519943295) / ar;
  }
  // ZOOM : le déplacement est RADIAL et proportionnel à la distance au centre —
  // même raison, même conséquence sur le centre.
  return d * amount / ar;
}
`;

/** Collecte le long de la trajectoire, en demi-résolution. */
const MOTION_GATHER_WGSL = `
${UV_SPACE_WGSL}${HASH_WGSL}${TRAIL_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let bias = clamp(params[5], -1.0, 1.0);
  let falloff = clamp(params[6], 0.0, 1.0);

  let trail = motion_trail(uv, dims);
  // Longueur en TEXELS de cette cible. Sous un demi-texel, la collecte rendrait
  // la copie du pixel central : autant ne rien faire.
  let lenTexels = length(trail * dims);
  if (lenTexels < 0.5) {
    return color;
  }

  // Un échantillon par texel de traînée, plafonné. À nombre fixe, une traînée
  // longue se décompose en copies fantômes espacées.
  let n = clamp(i32(lenTexels), 4, ${SAMPLES_MAX});
  let nf = f32(n);
  // Départ TIRÉ PAR PIXEL : une grille régulière laisse un moirage le long de
  // la traînée, que le tirage remplace par une granulation.
  let jitter = hash(uv * dims);

  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i = 0; i < n; i = i + 1) {
    // \`t\` court sur [-0.5, 0.5] : l'obturateur est centré sur l'instant
    // courant. \`bias\` le décale — à +1 toute la traînée part vers l'avant et
    // le sujet garde un bord net derrière lui.
    let t = (f32(i) + jitter) / nf - 0.5 + bias * 0.5;
    // Pondération : plate (obturateur franc) à \`falloff\` = 0, en cloche à 1.
    // La cloche n'est pas « plus correcte » — un obturateur mécanique EST
    // franc — mais elle donne la traînée qui s'éteint, qu'on attend d'un
    // filé photographique.
    let w = mix(1.0, 1.0 - abs(t) * 2.0, falloff);
    sum = sum + textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv + trail * t), 0.0) * w;
    wsum = wsum + w;
  }
  return sum / max(wsum, 0.0001);
}
`;

export const motionBlur: EffectModule = {
  id: "motionBlur",
  name: "Motion blur",
  params: [
    { name: "trajectory", label: "Trajectoire", unit: "none", min: 0, max: TRAJECTORIES.length - 1, default: TRAJ_DIRECTIONAL, step: 1, choices: [...TRAJECTORIES], hint: "Directionnel : un filé en ligne droite. Rotation : le sujet tourne autour d'un point. Zoom : l'objectif zoome pendant la pose. Les deux dernières laissent le centre net par construction." },
    { name: "amount", label: "Amplitude", unit: "none", min: 0, max: 120, default: 30, step: 0.5, hint: "Longueur du mouvement — en pixels pour un filé directionnel, en degrés pour une rotation, en fraction de la distance au centre pour un zoom" },
    { name: "angle", label: "Direction", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "Axe du filé. Sans objet en Rotation et en Zoom, dont la direction vient du centre." },
    { name: "centerX", label: "Centre X", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Point autour duquel tourne ou depuis lequel part le mouvement. Sans objet en Directionnel." },
    { name: "centerY", label: "Centre Y", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Voir Centre X." },
    { name: "bias", label: "Décentrage de l'obturateur", unit: "percent", min: -1, max: 1, default: 0, step: 0.01, hint: "0 = la traînée déborde des deux côtés du sujet, comme une intégration symétrique. ±1 = elle part d'un seul côté et le sujet garde un bord net de l'autre, comme un obturateur à rideau" },
    { name: "falloff", label: "Extinction", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "0 = obturateur franc, toute la traînée à densité égale. 1 = elle s'éteint vers ses extrémités, le filé photographique" },
  ],
  passes: [{ scale: 0.5, wgsl: MOTION_GATHER_WGSL }],
  wgsl: `
${UV_SPACE_WGSL}${TRAIL_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let trail = motion_trail(uv, dims);
  let lenPx = length(trail * dims);
  let blurred = textureSample(prevPass, srcSampler, uv);

  // Reprise du NET sous le pixel. La collecte tourne en demi-résolution : là où
  // la traînée est plus courte qu'un pixel, son résultat est quand même passé
  // par un aller-retour de résolution, donc légèrement mou. C'est visible au
  // CENTRE d'une rotation ou d'un zoom, précisément l'endroit que ces deux
  // trajectoires sont censées laisser intact — un flou de rotation qui ramollit
  // son propre centre a raté ce qui le distingue d'un flou uniforme.
  //
  // Le seuil bas est le même que le court-circuit de la collecte (0.5 texel de
  // demi-résolution = 1 px pleine définition) : les deux chemins y coïncident,
  // donc le raccord est invisible par construction plutôt que par réglage.
  let sharpness = smoothstep(1.0, 2.0, lenPx);
  return vec4<f32>(mix(color.rgb, blurred.rgb, sharpness), color.a);
}
`,
};
