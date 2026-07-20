import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/** Morphologie (contracter/dilater, design.md §4) : `erode` = min du
 *  voisinage (contracte le bord vers l'intérieur), `dilate` = max (dilate
 *  vers l'extérieur). `contract` (px SIGNÉ dans RefineEdgeParams) : négatif
 *  -> erode, positif -> dilate — l'appelant choisit le mode et passe
 *  `abs(contract)` comme radius. */
export function buildMorphologyWgsl(mode: "dilate" | "erode"): string {
  const op = mode === "dilate" ? "max(acc, s)" : "min(acc, s)";
  const init = mode === "dilate" ? "0.0" : "1.0";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> radius: f32;

@fragment
fn fs_morphology(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let n = i32(radius);
  var acc = ${init};
  for (var kx = -n; kx <= n; kx = kx + 1) {
    for (var ky = -n; ky <= n; ky = ky + 1) {
      let s = textureSample(src, maskSampler, in.uv + texel * vec2<f32>(f32(kx), f32(ky))).r;
      acc = ${op};
    }
  }
  return vec4<f32>(acc, acc, acc, 1.0);
}
`;
}
