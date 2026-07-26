import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";

export const chromaticBleed: EffectModule = {
  id: "chromaticBleed",
  name: "Chromatic bleed",
  params: [
    { name: "amount", label: "Décalage chromatique", unit: "percent", min: 0, max: 0.15, default: 0.008, step: 0.001 },
    { name: "centerFalloff", label: "Atténuation centrale", unit: "none", min: 0.5, max: 4, default: 2, step: 0.1 },
  ],
  wgsl: `
${UV_SPACE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let amount = params[0];
  let falloff = params[1];
  // Isotropie (voir effects/uvSpace.ts) : tout le calcul radial se fait dans
  // l'espace corrigé de l'aspect, où une même distance vaut le même nombre de
  // pixels en X et en Y — sinon l'aberration est ~1.5x plus forte à
  // l'horizontale sur une photo 3:2, et les "cercles" d'égale aberration sont
  // des ellipses. Le décalage est reconverti en UV en fin de calcul (/ ar).
  let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
  let fromCenter = (uv - vec2<f32>(0.5, 0.5)) * ar;
  let dist = length(fromCenter);
  // Shift grows with distance from center, shaped by the falloff exponent.
  let shift = fromCenter * amount * pow(dist * 2.0, falloff) / ar;
  // mirrorUv : le décalage est maximal AU BORD, donc les taps R/B sortent du
  // cadre là où l'effet est le plus visible. Sans repli, le sampler
  // clamp-to-edge étire le texel de bord en traînée.
  let r = textureSample(srcTexture, srcSampler, mirrorUv(uv + shift)).r;
  let g = textureSample(srcTexture, srcSampler, uv).g;
  let b = textureSample(srcTexture, srcSampler, mirrorUv(uv - shift)).b;
  return vec4<f32>(r, g, b, color.a);
}
`,
};
