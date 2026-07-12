import type { EffectModule } from "./types";

export const chromaticBleed: EffectModule = {
  id: "chromaticBleed",
  name: "Chromatic bleed",
  params: [
    { name: "amount", min: 0, max: 0.05, default: 0.01, step: 0.001 },
    { name: "angleDeg", min: 0, max: 360, default: 0, step: 1 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let amount = params[0];
  let angle = radians(params[1]);
  let dir = vec2<f32>(cos(angle), sin(angle)) * amount;
  let r = textureSample(srcTexture, srcSampler, uv + dir).r;
  let g = textureSample(srcTexture, srcSampler, uv).g;
  let b = textureSample(srcTexture, srcSampler, uv - dir).b;
  return vec4<f32>(r, g, b, color.a);
}
`,
};
