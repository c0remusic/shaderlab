import type { EffectModule } from "./types";
import { BAYER4_WGSL } from "./bayer";
import {
  LINEAR_TO_SRGB_VEC3_WGSL,
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/** Étiquettes de l'axe de répartition. L'index EST la valeur du paramètre. */
const DISTRIBUTIONS = ["Linéaire", "Perceptuel"] as const;
const DISTRIB_LINEAR = 0;

/**
 * Posterize — la quantification en aplats d'encre.
 *
 * D'OÙ ÇA VIENT. Cahier §5 : la référence est la **sérigraphie**, pas la photo.
 * Une presse ne reproduit qu'une cinquantaine de niveaux par encre, ce qui
 * *impose* la quantification au lieu de la simuler.
 *
 * QUATRE CONTRÔLES AJOUTÉS LE 2026-08-02, sur un retour d'Antoine — « posterize
 * a très peu de contrôles ». Il en avait UN. Tous par défaut neutres, donc la
 * référence de pixels d'avant reste valable au bit près.
 *
 * 1. **L'AXE DE RÉPARTITION, et c'est une question que le cahier laissait
 *    OUVERTE.** §5, mot pour mot : « les paliers doivent-ils se répartir sur
 *    l'axe linéaire ou perceptuel ? n'est pas tranchée par les sources : une
 *    presse quantifie sur la densité d'encre, ce qui penche perceptuel, mais
 *    l'audit a mesuré que basculer éclaircit l'image de 27 points sRGB à
 *    levels=2. Reste une décision de look, à prendre à l'œil. » Une décision de
 *    look que les sources ne tranchent pas n'a pas à être tranchée dans le
 *    code : elle devient un contrôle. Défaut Linéaire — le comportement d'avant.
 *
 * 2. **LE TRAMAGE SE COUPE.** Il était toujours à pleine amplitude, et c'est
 *    précisément ce qu'une affiche ne veut pas : le dither existe pour casser la
 *    bande sur un dégradé doux, alors qu'un aplat sérigraphié veut la frontière
 *    FRANCHE. Ne pas pouvoir l'éteindre interdisait le rendu de référence de
 *    l'effet. Défaut 1, l'amplitude d'avant.
 *
 * 3. **PLAGE D'ENTRÉE (point noir / point blanc).** Même contrôle que
 *    `hatching` et `halftone`, et pour la même raison : sans lui, les paliers
 *    tombent là où la photo les met, pas là où on les veut. Une photo qui
 *    n'atteint jamais le noir gaspille son palier le plus sombre. Défauts 0 et
 *    1, donc identité.
 *
 * CE QUI N'A PAS BOUGÉ : la quantification reste PAR CANAL. Quantifier la
 * luminance en gardant la teinte donnerait des aplats de ton mais des couleurs
 * continues — c'est un autre effet, pas un réglage de celui-ci, et la
 * sérigraphie sépare bien ses encres.
 */
export const posterize: EffectModule = {
  id: "posterize",
  name: "Posterize",
  params: [
    { name: "levels", label: "Paliers", unit: "none", min: 2, max: 16, default: 5, step: 1, hint: "Nombre de paliers de ton par canal — bas = aplats larges, haut = dégradé quasi continu" },
    { name: "dither", label: "Tramage", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, hint: "Casse la frontière entre deux paliers par un motif fin. À 0 les aplats ont un bord FRANC — c'est le rendu sérigraphie ; à 1 le dégradé doux reste lisible" },
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0, step: 0.01, hint: "Ton d'entrée qui reçoit le palier le plus sombre — le monter écrase les ombres sur cet aplat" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, hint: "Ton d'entrée qui reçoit le palier le plus clair — le descendre écrase les hautes lumières sur cet aplat" },
    { name: "distribution", label: "Répartition", unit: "none", min: 0, max: DISTRIBUTIONS.length - 1, default: DISTRIB_LINEAR, step: 1, choices: [...DISTRIBUTIONS], hint: "Linéaire : les paliers sont également espacés en lumière. Perceptuel : ils le sont à l'œil, donc plus nombreux dans les ombres — plus proche d'une presse, qui quantifie la densité d'encre. Le second éclaircit nettement à peu de paliers" },
  ],
  wgsl: `
${BAYER4_WGSL}${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let levels = max(params[0], 2.0);
  let dither = clamp(params[1], 0.0, 1.0);
  let blackPoint = params[2];
  // Plancher d'écart : point blanc et point noir confondus feraient une
  // division par zéro, donc du NaN qui se propage en pixels noirs.
  let whitePoint = max(params[3], blackPoint + 0.001);
  let perceptual = params[4] > 0.5;

  let stepSize = 1.0 / (levels - 1.0);

  // AXE DE RÉPARTITION. Le format de texture est -srgb, donc \`color.rgb\` est
  // déjà LINÉAIRE : quantifier tel quel espace les paliers en lumière. Passer
  // en perceptuel les espace à l'œil, ce qui en met davantage dans les ombres —
  // et éclaircit franchement à peu de paliers (mesuré : 27 points sRGB à
  // levels=2, cahier §5).
  var v = select(color.rgb, linear_to_srgb3(color.rgb), perceptual);

  // PLAGE D'ENTRÉE. Sans remise à l'échelle, les paliers tombent là où la photo
  // les met : une image qui n'atteint jamais le noir gaspille son palier le plus
  // sombre. Défauts 0/1 = identité.
  v = clamp((v - vec3<f32>(blackPoint)) / (whitePoint - blackPoint), vec3<f32>(0.0), vec3<f32>(1.0));

  // Dither ordonné (Bayer 4x4, voir effects/bayer.ts) : décalage d'au plus un
  // demi-palier AVANT quantification — la frontière entre deux paliers devient
  // un motif fin au lieu d'une bande franche sur un dégradé doux. Le seuil ne
  // dépend que de la position en PIXELS, donc stable d'une frame à l'autre
  // (aucun scintillement), et son amplitude suit stepSize (un dither de
  // taille fixe serait invisible à 16 paliers et destructeur à 2).
  //
  // \`dither\` le module : à 0 la frontière redevient FRANCHE, ce qui est le
  // rendu sérigraphie que la référence décrit et que l'effet ne savait pas
  // faire.
  let px = vec2<u32>(uv * vec2<f32>(textureDimensions(srcTexture)));
  let dithered = v + vec3<f32>(bayerThreshold(px) * stepSize * dither);
  let quantized = floor(dithered / stepSize + 0.5) * stepSize;
  // clamp : le demi-palier ajouté peut pousser un blanc pur au-dessus de 1.0
  // (et un noir pur sous 0.0) une fois quantifié.
  let plat = clamp(quantized, vec3<f32>(0.0), vec3<f32>(1.0));

  return vec4<f32>(select(plat, srgb_to_linear3(plat), perceptual), color.a);
}
`,
};
