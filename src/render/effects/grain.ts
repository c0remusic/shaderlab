import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { LINEAR_TO_SRGB_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

export const grain: EffectModule = {
  id: "grain",
  name: "Grain",
  params: [
    { name: "intensity", label: "Intensité", unit: "percent", min: 0, max: 0.4, default: 0.12, step: 0.01 },
    { name: "size", label: "Taille", unit: "pixels", min: 1, max: 8, default: 2, step: 0.5 },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 1000, default: 0, step: 1 },
  ],
  wgsl: `${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${HASH_WGSL}${VALUE_NOISE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[0];
  let size = params[1];
  let seed = params[2];
  let dims = vec2<f32>(textureDimensions(srcTexture));
  // Grain coordinates in pixel space divided by grain size → visible clumps, not per-pixel snow.
  let gp = (uv * dims) / size + vec2<f32>(seed * 17.0, seed * 9.0);
  let noise = valueNoise(gp) - 0.5;
  // Luminance response: peak in midtones, fades in deep shadows and highlights.
  let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  // La courbe se pose sur la luminance PERCEPTUELLE, pas linéaire. Évaluée sur
  // la luma linéaire, son maximum (luma 0.5) tombait à ~0.735 en sRGB, donc
  // dans les hautes lumières : un vrai grain argentique est maximal dans les
  // DEMI-TONS. Même convention que les bascules du duotone (bb114f3) : seule
  // la POSITION de la courbe change, le mélange reste linéaire — "response"
  // est un scalaire de pondération, pas une valeur de couleur.
  let tone = linear_to_srgb(luma);
  let response = 4.0 * tone * (1.0 - tone);
  // La courbe de réponse était posée sur l'axe perceptuel, mais l'addition
  // restait linéaire — et une amplitude linéaire constante ne produit PAS un
  // écart perceptuel constant : la compression sRGB l'amplifie dans les ombres
  // et l'écrase dans les hautes lumières. Le grain culminait donc au ton 0.19
  // et non 0.50, à rebours du contrat écrit deux lignes plus haut, avec 26,8 %
  // de bruit écrêté à zéro au ton 0.10.
  //
  // Le décalage se pose maintenant sur le ton PERCEPTUEL, et c'est la fonction
  // de transfert PARTAGÉE qui le ramène en linéaire. Deux propriétés tenues :
  // le mélange reste linéaire (on ajoute un delta linéaire à une couleur
  // linéaire, aucun gamma manuel sur la couleur), et aucune seconde formule de
  // transfert n'apparaît ici — srgbTransfer.ts reste la source unique.
  let perturbe = srgb_to_linear(tone + noise * intensity * response);
  return vec4<f32>(color.rgb + vec3<f32>(perturbe - srgb_to_linear(tone)), color.a);
}
`,
};
