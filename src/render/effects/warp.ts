import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";

export const warp: EffectModule = {
  id: "warp",
  name: "Warp",
  params: [
    { name: "scale", label: "Échelle", unit: "none", min: 0.5, max: 12, default: 3, step: 0.25 },
    { name: "amplitude", label: "Amplitude", unit: "percent", min: 0, max: 0.08, default: 0.02, step: 0.002 },
    { name: "octaves", label: "Détails", unit: "none", min: 1, max: 4, default: 3, step: 1 },
    { name: "seed", label: "Graine", unit: "none", min: 0, max: 100, default: 0, step: 1 },
  ],
  wgsl: `
${UV_SPACE_WGSL}
// 2D simplex-style gradient noise (self-contained WGSL).
fn hash2(p: vec2<f32>) -> vec2<f32> {
  let k = vec2<f32>(0.3183099, 0.3678794);
  let x = p * k + k.yx;
  return -1.0 + 2.0 * fract(16.0 * k * fract(x.x * x.y * (x.x + x.y)));
}

fn gnoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(dot(hash2(i + vec2<f32>(0.0, 0.0)), f - vec2<f32>(0.0, 0.0)),
        dot(hash2(i + vec2<f32>(1.0, 0.0)), f - vec2<f32>(1.0, 0.0)), u.x),
    mix(dot(hash2(i + vec2<f32>(0.0, 1.0)), f - vec2<f32>(0.0, 1.0)),
        dot(hash2(i + vec2<f32>(1.0, 1.0)), f - vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}

fn fbm(p: vec2<f32>, octaves: i32) -> f32 {
  var value = 0.0;
  var amplitude = 0.5;
  var freq = p;
  for (var i = 0; i < 4; i = i + 1) {
    if (i >= octaves) { break; }
    value = value + amplitude * gnoise(freq);
    amplitude = amplitude * 0.5;
    freq = freq * 2.0;
  }
  return value;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let scale = params[0];
  let amplitude = params[1];
  let octaves = i32(params[2]);
  let seed = params[3];
  let p = uv * scale + vec2<f32>(seed * 13.7, seed * 7.3);
  // Isotropie (voir effects/uvSpace.ts) : le décalage nominal est divisé par le
  // facteur d'aspect, sinon la même amplitude déplace ~1.5x plus de pixels à
  // l'horizontale qu'à la verticale sur une photo 3:2 (étirement du warp).
  let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
  let offset = vec2<f32>(
    fbm(p, octaves),
    fbm(p + vec2<f32>(5.2, 1.3), octaves)
  ) * amplitude / ar;
  // mirrorUv : près du bord, uv + offset sort du cadre — sans repli, le
  // sampler clamp-to-edge étire le texel de bord en traînée.
  return textureSample(srcTexture, srcSampler, mirrorUv(uv + offset));
}
`,
};
