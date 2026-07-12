import type { EffectModule } from "./types";

export const warp: EffectModule = {
  id: "warp",
  name: "Warp",
  params: [
    { name: "scale", min: 1, max: 20, default: 6, step: 0.5 },
    { name: "amplitude", min: 0, max: 0.05, default: 0.015, step: 0.001 },
    { name: "seed", min: 0, max: 100, default: 0, step: 1 },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let scale = params[0];
  let amplitude = params[1];
  let seed = params[2];
  let offset = vec2<f32>(
    sin(uv.y * scale + seed) * amplitude,
    cos(uv.x * scale + seed * 1.37) * amplitude
  );
  return textureSample(srcTexture, srcSampler, uv + offset);
}
`,
};
