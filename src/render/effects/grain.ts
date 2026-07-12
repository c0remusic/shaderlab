import type { EffectModule } from "./types";

export const grain: EffectModule = {
  id: "grain",
  name: "Grain",
  params: [
    { name: "intensity", min: 0, max: 0.3, default: 0.08, step: 0.01 },
    { name: "seed", min: 0, max: 1000, default: 0, step: 1 },
  ],
  wgsl: `
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[0];
  let seed = params[1];
  let noise = hash(uv * vec2<f32>(4096.0, 4096.0) + seed) - 0.5;
  return vec4<f32>(color.rgb + vec3<f32>(noise) * intensity, color.a);
}
`,
};
