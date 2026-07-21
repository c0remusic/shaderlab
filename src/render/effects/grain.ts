import type { EffectModule } from "./types";

export const grain: EffectModule = {
  id: "grain",
  name: "Grain",
  params: [
    { name: "intensity", label: "Intensité", unit: "percent", min: 0, max: 0.4, default: 0.12, step: 0.01 },
    { name: "size", label: "Taille", unit: "pixels", min: 1, max: 8, default: 2, step: 0.5 },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 1000, default: 0, step: 1 },
  ],
  wgsl: `
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

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
  let response = 4.0 * luma * (1.0 - luma);
  return vec4<f32>(color.rgb + vec3<f32>(noise) * intensity * response, color.a);
}
`,
};
