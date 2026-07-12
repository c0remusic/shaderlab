import type { EffectModule } from "./types";

export const glow: EffectModule = {
  id: "glow",
  name: "Glow",
  params: [
    { name: "threshold", min: 0, max: 1, default: 0.7, step: 0.01 },
    { name: "intensity", min: 0, max: 3, default: 1.0, step: 0.05 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[0];
  let intensity = params[1];
  var glowAccum = vec3<f32>(0.0);
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  for (var dx = -2; dx <= 2; dx = dx + 1) {
    for (var dy = -2; dy <= 2; dy = dy + 1) {
      let offset = vec2<f32>(f32(dx), f32(dy)) * texel * 3.0;
      let sample = textureSample(srcTexture, srcSampler, uv + offset).rgb;
      let brightness = max(sample.r, max(sample.g, sample.b));
      let bright = max(brightness - threshold, 0.0);
      glowAccum = glowAccum + sample * bright;
    }
  }
  glowAccum = glowAccum / 25.0;
  return vec4<f32>(color.rgb + glowAccum * intensity, color.a);
}
`,
};
