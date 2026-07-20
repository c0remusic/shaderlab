import type { MaskSourceModule } from "./types";

// stub, remplacé Task 4
export const luminositySource: MaskSourceModule = {
  id: "luminosity",
  name: "Luminosité",
  defaultParams: { shadowsMin: 0, shadowsMax: 0.33, highlightsMin: 0.66, highlightsMax: 1, tolerance: 0.1, invert: 0 },
  wgsl: `fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 { return 0.0; }`,
};
