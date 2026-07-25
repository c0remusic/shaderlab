import type { EffectModule } from "./types";

export const chromaticBleed: EffectModule = {
  id: "chromaticBleed",
  name: "Chromatic bleed",
  params: [
    { name: "amount", label: "Décalage chromatique", unit: "percent", min: 0, max: 0.15, default: 0.008, step: 0.001 },
    { name: "centerFalloff", label: "Atténuation centrale", unit: "none", min: 0.5, max: 4, default: 2, step: 0.1 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let amount = params[0];
  let falloff = params[1];
  let fromCenter = uv - vec2<f32>(0.5, 0.5);
  let dist = length(fromCenter);
  // Shift grows with distance from center, shaped by the falloff exponent.
  let shift = fromCenter * amount * pow(dist * 2.0, falloff);
  let r = textureSample(srcTexture, srcSampler, uv + shift).r;
  let g = textureSample(srcTexture, srcSampler, uv).g;
  let b = textureSample(srcTexture, srcSampler, uv - shift).b;
  return vec4<f32>(r, g, b, color.a);
}
`,
};
