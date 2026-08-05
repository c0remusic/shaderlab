import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INK_TEXTURE_WGSL, inkTextureParams } from "./inkTexture";
import {
  LINEAR_TO_SRGB_VEC3_WGSL,
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Amplitude de la bavure d'encre, en FRACTION DU PAS DE TRAME par unité
 * d'irrégularité prélevée.
 *
 * ⚠️ Constante CALIBRÉE, pas arbitraire, et sa raison d'être est un ordre de
 * grandeur : `ink_irregularite` rend un HAUT DE BANDE (centre moins quatre
 * voisins), dont l'amplitude typique sur les scans mesurés le 2026-08-05 est de
 * l'ordre de 0,02 en luminance normalisée — deux ordres de grandeur sous ce
 * qu'il faut pour qu'un bord de point bouge visiblement. Sans gain, le curseur
 * « Bavure d'encre » aurait une course entièrement morte, c'est-à-dire l'échec
 * silencieux que ce dépôt proscrit (D11, `sliceShift`).
 *
 * À 8, une irrégularité de 0,02 déplace le bord de ~16 % du pas de trame à
 * force 1 : visible sans détruire la trame. À re-mesurer si la famille de scans
 * change de nature.
 */
const INK_EDGE_GAIN = 8;

/**
 * Halftone — la trame d'imprimerie : l'image reconstituée par des points dont
 * la TAILLE porte la densité d'encre.
 *
 * D'OÙ ÇA VIENT. Cahier de références §7, qui le classe comme justifié
 * (« complète posterize sur la même référence d'impression ») ; surface de
 * contrôle lue le 2026-08-01 sur la fiche Figma du shader `Halftone`.
 *
 * CE QUI SÉPARE UNE VRAIE TRAME D'UNE GRILLE DE POINTS — trois choses, et la
 * première est celle que tout le monde rate :
 *
 * 1. **LES QUATRE ENCRES N'ONT PAS LE MÊME ANGLE D'ÉCRAN.** C, M, J, N sont
 *    tramés à 15°, 75°, 0° et 45°. Ces écarts ne sont pas décoratifs : deux
 *    trames superposées au MÊME angle produisent un moiré grossier, tandis que
 *    ces angles-là font apparaître la ROSETTE — la petite fleur de points qui
 *    est la signature de l'offset. Un halftone qui trame tout à 45° ne rend pas
 *    un imprimé, il rend une grille.
 *
 * 2. **LE POINT PORTE SA DENSITÉ PAR SON AIRE, PAS PAR SON RAYON.** Un rayon
 *    proportionnel à l'encre donne des demi-tons deux fois trop clairs : l'œil
 *    intègre la SURFACE couverte, qui va comme le carré du rayon. D'où le
 *    `sqrt` — c'est la correction que la version naïve oublie, et elle se voit
 *    sur toute la gamme, pas dans un coin.
 *
 * 3. **L'ENCRE EST SOUSTRACTIVE.** Le papier est blanc et chaque encre RETIRE
 *    une bande du spectre : le cyan absorbe le rouge, le magenta le vert, le
 *    jaune le bleu. On MULTIPLIE des transmittances, on n'additionne pas des
 *    lumières. Additionner donnerait des superpositions plus CLAIRES que leurs
 *    composants, ce qu'aucune encre ne fait.
 *
 * UN PIÈGE MOINS VISIBLE : la densité d'un point se lit au CENTRE DE SA CELLULE,
 * pas sous le pixel courant. Échantillonner sous le pixel ferait varier le
 * diamètre à l'intérieur d'un même point, qui cesserait d'être un disque pour
 * devenir une tache floue épousant l'image — c'est-à-dire l'image elle-même,
 * légèrement piquée. Chaque encre a sa grille, donc son propre centre de
 * cellule, donc son propre tap : quatre lectures.
 *
 * RETRAIT DE SOUS-COULEUR (UCR). Le noir est EXTRAIT du minimum des trois
 * encres au lieu d'être imprimé par-dessus elles. Sans ça, un noir profond
 * demanderait 300 % d'encre, les trois trames se superposeraient en un magma
 * boueux, et la rosette disparaîtrait là où elle est la plus visible.
 *
 * `Fondu du point` remplace la bascule Point/Dégradé de la référence par un
 * curseur continu, sur le précédent du `monochrome` de `channelMixer` : les
 * états intermédiaires modélisent quelque chose (une trame plus ou moins
 * mordante), donc ils doivent être atteignables.
 *
 * COÛT : 4 taps, une seule passe.
 */

/** Modes de couleur. L'index EST la valeur du paramètre. */
const COLOR_MODES = ["CMJN", "RVB", "Noir sur blanc", "Blanc sur noir"] as const;
const MODE_CMYK = 0;

/** Angles d'écran de l'offset, en degrés, dans l'ordre C, M, J, N.
 *
 *  Ce sont les angles de l'imprimerie, pas un choix esthétique : 30° séparent
 *  les trois encres chromatiques, et le jaune — le moins visible — prend le 0°
 *  où le moiré serait le plus voyant. Les changer casse la rosette. */
const SCREEN_ANGLES = [15, 75, 0, 45] as const;

export const halftone: EffectModule = {
  id: "halftone",
  name: "Halftone",
  // ENCRE RÉELLE : le scan arrive par le binding 7, désigné par son RANG dans
  // le catalogue. Cette déclaration est ce qui rend `libraryTexture` disponible
  // au WGSL — et elle interdit les passes internes (`validateEffect`), ce qui
  // est sans conséquence ici : `halftone` est mono-passe.
  libraryTexture: { indexParam: "encreRang" },
  params: [
    { name: "dotSize", label: "Pas de trame", unit: "pixels", min: 2, max: 64, default: 8, step: 0.5, hint: "Distance entre deux points, en pixels — c'est la linéature. Grand = points gros et comptables, petit = trame fine" },
    { name: "dotScale", label: "Grosseur du point", unit: "percent", min: 0.2, max: 1.6, default: 1.05, step: 0.01, hint: "Jusqu'où un point peut grossir dans sa cellule. Au-delà de 1 les points se touchent dans les ombres et l'aplat se ferme — ce que fait un vrai engraissement de point" },
    { name: "colorMode", label: "Mode de couleur", unit: "none", min: 0, max: COLOR_MODES.length - 1, default: MODE_CMYK, step: 1, choices: [...COLOR_MODES], hint: "CMJN : quatre encres aux angles d'écran de l'offset, avec la rosette. RVB : trois trames additives, rendu écran. Noir sur blanc et Blanc sur noir : une seule encre" },
    { name: "rotation", label: "Rotation de la trame", unit: "degrees", min: 0, max: 90, default: 0, step: 1, hint: "Fait pivoter les quatre écrans ENSEMBLE, en conservant leurs écarts — donc la rosette survit" },
    { name: "centerX", label: "Centre X", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Point d'où la grille s'aligne" },
    { name: "centerY", label: "Centre Y", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Voir Centre X." },
    { name: "softness", label: "Fondu du point", unit: "percent", min: 0, max: 1, default: 0.12, step: 0.01, hint: "0 = points francs (toujours antialiasés), 1 = points fondus qui se dissolvent dans le papier" },
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0, step: 0.01, hint: "Ton d'entrée qui reçoit l'encre maximale — le monter ferme les ombres" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, hint: "Ton d'entrée à partir duquel le papier reste nu" },
    // ── ENCRE RÉELLE (transversal, `inkTexture.ts`), ajoutée À LA FIN le
    // 2026-08-05 : l'index d'un paramètre est persisté dans les presets.
    // `encreForce` vaut 0 par défaut, donc le rendu de cet effet est inchangé
    // au bit près tant qu'on n'y touche pas — ce que le verrou de pixels prouve.
    ...inkTextureParams(),
  ],
  wgsl: `
${UV_SPACE_WGSL}${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INK_TEXTURE_WGSL}
const HALFTONE_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

// Densités des quatre encres sous un point donné, dans l'ordre C, M, J, N.
//
// Les valeurs d'encre se lisent sur l'axe PERCEPTUEL : une presse dose ses
// encres d'après un ton, pas d'après une énergie lumineuse. Sur l'axe linéaire,
// les trois quarts de l'image tomberaient dans le premier quart de la gamme
// d'encre — la même panne, et le même correctif, que le seuil d'outlines.
fn halftone_inks(uv: vec2<f32>, blackPoint: f32, whitePoint: f32) -> vec4<f32> {
  let lin = textureSample(srcTexture, srcSampler, mirrorUv(uv)).rgb;
  let tone = linear_to_srgb3(lin);
  // Étalement entre point noir et point blanc, avant toute conversion d'encre.
  let span = max(whitePoint - blackPoint, 0.001);
  let t = clamp((tone - vec3<f32>(blackPoint)) / span, vec3<f32>(0.0), vec3<f32>(1.0));
  let cmy = vec3<f32>(1.0) - t;
  // RETRAIT DE SOUS-COULEUR : le noir sort du minimum des trois, et les trois
  // s'en trouvent allégées d'autant. Sans ça un noir profond demanderait 300 %
  // d'encre et les trames se superposeraient en magma.
  let k = min(cmy.x, min(cmy.y, cmy.z));
  let reste = max(1.0 - k, 0.0001);
  return vec4<f32>((cmy - vec3<f32>(k)) / reste, k);
}

// Couverture du point d'une encre, dans sa propre grille tournée.
//
// \`ink\` est relu AU CENTRE DE LA CELLULE et non sous le pixel : c'est ce qui
// fait un disque plutôt qu'une tache épousant l'image. \`aa\` est analytique —
// un pixel vaut toujours un pixel, la grille n'est qu'une rotation.
fn halftone_dot(
  px: vec2<f32>, centerPx: vec2<f32>, angle: f32, size: f32,
  scale: f32, softness: f32, canal: i32, blackPoint: f32, whitePoint: f32,
  dims: vec2<f32>, encreForce: f32, encreEchelle: f32
) -> f32 {
  let c = cos(angle);
  let s = sin(angle);
  let rel = px - centerPx;
  // Passage dans le repère de l'écran de cette encre.
  let g = vec2<f32>(rel.x * c - rel.y * s, rel.x * s + rel.y * c);
  let cell = floor(g / size) + vec2<f32>(0.5);
  let centre = cell * size;
  // Retour au repère image pour aller lire la densité au centre de la cellule.
  let back = vec2<f32>(centre.x * c + centre.y * s, -centre.x * s + centre.y * c) + centerPx;
  let inks = halftone_inks(back / dims, blackPoint, whitePoint);
  var ink = inks.w;
  if (canal == 0) { ink = inks.x; }
  if (canal == 1) { ink = inks.y; }
  if (canal == 2) { ink = inks.z; }

  // AIRE et non rayon : l'œil intègre la surface couverte, qui va comme le
  // carré du rayon. Sans ce sqrt, les demi-tons sortent deux fois trop clairs.
  let rayonNet = size * 0.5 * scale * sqrt(clamp(ink, 0.0, 1.0));
  // BAVURE D'ENCRE : le rayon du point varie localement, parce qu'une vraie
  // encre s'etale plus ici et moins la. On froisse le RAYON et non le seuil de
  // ton : un point d'offset garde sa position de trame, c'est son BORD qui est
  // sale. Froisser le ton deplacerait la rosette entiere.
  let rayon = rayonNet + ink_froisse(0.0, px / dims, encreEchelle, encreForce) * ${INK_EDGE_GAIN}.0 * size;
  let d = length(g - centre);
  // Transition d'au moins un pixel : le point est antialiasé par construction,
  // quelle que soit la valeur du fondu.
  let aa = max(softness * size * 0.5, 1.0);
  return 1.0 - smoothstep(rayon - aa, rayon + aa, d);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let size = max(params[0], 1.0);
  let scale = max(params[1], 0.0);
  let mode = i32(params[2] + 0.5);
  let rot = radians(params[3]);
  let center = vec2<f32>(params[4], params[5]);
  let softness = clamp(params[6], 0.0, 1.0);
  let blackPoint = clamp(params[7], 0.0, 0.95);
  let whitePoint = max(params[8], blackPoint + 0.001);
  // params[9] = rang du scan d'encre, lu par le CPU (FramePipelineExecutor)
  // pour choisir la texture liee au binding 7 — pas par ce shader.
  let encreForce = clamp(params[10], 0.0, 1.0);
  let encreEchelle = max(params[11], 0.05);

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let px = uv * dims;
  let centerPx = center * dims;
  let deg = 0.017453292519943295;

  if (mode == ${MODE_CMYK}) {
    // Les QUATRE angles d'écran de l'offset, décalés ensemble par la rotation :
    // leurs écarts sont conservés, donc la rosette aussi.
    let dC = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[0]}.0 * deg, size, scale, softness, 0, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    let dM = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[1]}.0 * deg, size, scale, softness, 1, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    let dY = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[2]}.0 * deg, size, scale, softness, 2, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    let dK = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[3]}.0 * deg, size, scale, softness, 3, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    // SOUSTRACTIF : papier blanc, chaque encre retire sa bande du spectre. Le
    // cyan absorbe le rouge, le magenta le vert, le jaune le bleu, le noir tout.
    // On multiplie des transmittances — additionner rendrait une superposition
    // plus claire que ses composants, ce qu'aucune encre ne fait.
    var papier = vec3<f32>(1.0);
    papier = papier * mix(vec3<f32>(1.0), vec3<f32>(0.0, 1.0, 1.0), dC);
    papier = papier * mix(vec3<f32>(1.0), vec3<f32>(1.0, 0.0, 1.0), dM);
    papier = papier * mix(vec3<f32>(1.0), vec3<f32>(1.0, 1.0, 0.0), dY);
    papier = papier * mix(vec3<f32>(1.0), vec3<f32>(0.0), dK);
    // Le calcul d'encre vit en valeurs PERCEPTUELLES, comme une presse : décodé
    // une seule fois, ici, vers le linéaire de la chaîne.
    return vec4<f32>(srgb_to_linear3(papier), color.a);
  }

  if (mode == 1) {
    // RVB : trois trames ADDITIVES sur du noir — le rendu d'un écran, pas d'une
    // presse. Les mêmes angles séparent les canaux, pour la même raison.
    let dR = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[0]}.0 * deg, size, scale, softness, 0, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    let dG = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[1]}.0 * deg, size, scale, softness, 1, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    let dB = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[2]}.0 * deg, size, scale, softness, 2, blackPoint, whitePoint, dims, encreForce, encreEchelle);
    // Les densités CMJ sont l'inverse des intensités RVB : un point de cyan
    // dense veut dire peu de rouge. On inverse donc la couverture.
    return vec4<f32>(srgb_to_linear3(vec3<f32>(1.0 - dR, 1.0 - dG, 1.0 - dB)), color.a);
  }

  // UNE SEULE ENCRE, à 45° — l'angle du noir en offset, et celui d'une trame
  // de journal. Le canal 3 est le noir extrait par l'UCR ; sur une image en
  // niveaux de gris il vaut exactement 1 moins le ton.
  let dK = halftone_dot(px, centerPx, rot + ${SCREEN_ANGLES[3]}.0 * deg, size, scale, softness, 3, blackPoint, whitePoint, dims, encreForce, encreEchelle);
  if (mode == 2) {
    return vec4<f32>(srgb_to_linear3(vec3<f32>(1.0 - dK)), color.a);
  }
  return vec4<f32>(srgb_to_linear3(vec3<f32>(dK)), color.a);
}
`,
};
