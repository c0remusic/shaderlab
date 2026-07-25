import type { EffectModule } from "./types";

export const posterize: EffectModule = {
  id: "posterize",
  name: "Posterize",
  params: [
    { name: "levels", label: "Paliers", unit: "none", min: 2, max: 16, default: 5, step: 1, hint: "Nombre de paliers de ton par canal — bas = aplats larges, haut = dégradé quasi continu" },
  ],
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let levels = max(params[0], 2.0);
  let stepSize = 1.0 / (levels - 1.0);
  let quantized = floor(color.rgb / stepSize + 0.5) * stepSize;
  return vec4<f32>(quantized, color.a);
}
`,
};
