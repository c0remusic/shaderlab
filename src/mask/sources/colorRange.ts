import type { MaskSourceModule } from "./types";

// stub, remplacé Task 5
export const colorRangeSource: MaskSourceModule = {
  id: "colorRange",
  name: "Range couleur",
  defaultParams: { tolerance: 0.15, hardness: 0.5, invert: 0, samples: [] },
  wgsl: `fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 { return 0.0; }`,
};
