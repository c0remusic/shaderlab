/** Taille du uniform `params: array<f32, N>` du header WGSL partagé.
 *  Un effet déclarant plus de paramètres est rejeté au chargement du
 *  registry (voir effects/validate.ts) — élargir cette constante et le
 *  header ensemble si le besoin apparaît. */
export const MAX_EFFECT_PARAMS = 8;

const FULLSCREEN_VERTEX_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(pos[i], 0.0, 1.0);
  out.uv = pos[i] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

export interface ComposeOptions {
  applyMask: boolean;
  hasPrevPass: boolean;
}

/**
 * Composition pure du shader complet d'une passe. La chaîne retournée est
 * déterministe pour des entrées identiques : elle sert de CLÉ au cache de
 * pipelines du Renderer — toute variation d'entrée (corps d'effet, masque,
 * prevPass) produit une chaîne différente, donc un pipeline distinct.
 */
export function composeShader(effectWgsl: string, opts: ComposeOptions): string {
  const maskBinding = opts.applyMask
    ? "@group(0) @binding(3) var maskTexture: texture_2d<f32>;"
    : "";
  const prevPassBinding = opts.hasPrevPass
    ? "@group(0) @binding(4) var prevPass: texture_2d<f32>;"
    : "";
  const fsBody = opts.applyMask
    ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  return mix(color, effected, maskValue);`
    : "return effected;";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, ${MAX_EFFECT_PARAMS}>;
${maskBinding}
${prevPassBinding}

${effectWgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effected = fs_main(in.uv, color);
  ${fsBody}
}
`;
}
