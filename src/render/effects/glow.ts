import type { EffectModule } from "./types";
import { SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

/**
 * Dual-filter downsample kernel (ARM/Marius Bjørge, "Bandwidth-Efficient
 * Rendering", SIGGRAPH 2015) — a 4-tap box average of the texel's diagonal
 * neighbors plus itself, weighted so it stays energy-preserving across the
 * resolution halving. Reused at every downsample step of the bloom chain.
 */
const DOWNSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  let o = texel * 1.0;
  var sum = textureSample(srcTexture, srcSampler, uv).rgb * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb;
  return vec4<f32>(sum / 8.0, 1.0);
}
`;

/**
 * Dual-filter upsample kernel — an 8-tap "tent" filter (cardinal neighbors
 * weighted x1, diagonal neighbors weighted x2) sampling the SMALLER (input)
 * texture at the LARGER (output) resolution, which is what produces the
 * wide, soft falloff: each upsample step spreads the previous, already-blurred
 * level back out over a bigger area instead of just upscaling it sharply.
 */
const UPSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  // DEMI-texel, pas un texel entier. Les huit taps forment un anneau : aucun
  // n'est au centre. À un texel entier, les taps diagonaux tombent exactement
  // sur des centres de texels voisins et l'interpolation bilinéaire ne ramène
  // presque rien du texel courant — le noyau devient une coquille trouée.
  // Simulé sur une impulsion unité : 1,0 % de l'énergie seulement restait sur
  // le texel d'origine, et le pixel central ne valait que 0,105 du maximum du
  // noyau. À un demi-texel, les taps diagonaux tombent ENTRE les texels, la
  // bilinéaire ramène le centre, qui remonte à 19,8 % de l'énergie et redevient
  // le maximum du noyau.
  let o = texel * 0.5;
  var sum = vec3<f32>(0.0);
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x * 2.0, 0.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(0.0,  o.y * 2.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x * 2.0, 0.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(0.0, -o.y * 2.0)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb * 2.0;
  return vec4<f32>(sum / 12.0, 1.0);
}
`;

/**
 * Glow: dual-filter bloom (Task 13 — replaces the naive single-pass 5x5
 * kernel from Task 5, which only produced a tight ~5px fringe). Chain:
 * bright-pass extract (half res) -> downsample to quarter, eighth res ->
 * upsample back to quarter, half res -> final composite adds the resulting
 * half-res bloom buffer (`prevPass`) back onto the full-res source. This
 * produces a wide, soft, natural halo at a fraction of the cost of an
 * equivalent-radius single-pass Gaussian.
 */
export const glow: EffectModule = {
  id: "glow",
  name: "Glow",
  params: [
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 1, default: 0.7, step: 0.01 },
    { name: "intensity", label: "Intensité", unit: "none", min: 0, max: 3, default: 1.0, step: 0.05 },
  ],
  passes: [
    {
      // Bright-pass extract at half resolution: keep only the part of each
      // channel above `threshold`, scaled back onto the original color so
      // hue is preserved in the bloom.
      scale: 0.5,
      wgsl: `${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Le seuil vient d'un slider : c'est une valeur PERCEPTUELLE (sRGB), alors
  // que \`brightness\` est LINÉAIRE (le format -srgb décode déjà à
  // l'échantillonnage). Comparés tels quels, le défaut 0.7 posait la bascule
  // à 0.7 LINÉAIRE, soit ~0.87 perceptuel : le slider n'entamait l'image que
  // sur ses zones cramées, donc
  // inerte sur ~85% de sa course. On décode la CONSTANTE vers le linéaire —
  // l'échantillon d'image, lui, n'est jamais converti. À 0.5 le seuil tombe
  // désormais à ~0.214 linéaire : le bloom prend les nuages et les peaux
  // claires.
  let threshold = srgb_to_linear(params[0]);
  let brightness = max(color.r, max(color.g, color.b));
  let contribution = max(brightness - threshold, 0.0) / max(brightness, 0.0001);
  return vec4<f32>(color.rgb * contribution, 1.0);
}
`,
    },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.25, wgsl: UPSAMPLE_WGSL },
    { scale: 0.5, wgsl: UPSAMPLE_WGSL },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[1];
  let bloom = textureSample(prevPass, srcSampler, uv).rgb;
  return vec4<f32>(color.rgb + bloom * intensity, color.a);
}
`,
};
