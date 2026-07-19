import type { CombineMode } from "./types";
import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/**
 * Passe de combinaison GPU (design.md §4, étape 2) : combine un accumulateur
 * `srcA` (le fold jusqu'ici) avec la source suivante `srcB` selon `mode`,
 * sortie r8 dans [0,1] (les deux entrées sont déjà r8unorm, donc déjà
 * bornées — `clamp` n'est nécessaire QUE pour `subtract`, qui peut descendre
 * sous 0). N'est JAMAIS appelée sur la 1ère source d'un fold (le seed est un
 * `copyTextureToTexture` direct, son combineMode est ignoré — voir
 * `foldPlan.planFold`).
 */
export function buildCombineWgsl(mode: CombineMode): string {
  const op =
    mode === "add" ? "max(a, b)" : mode === "subtract" ? "clamp(a - b, 0.0, 1.0)" : "min(a, b)";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcA: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var srcB: texture_2d<f32>;

@fragment
fn fs_combine(in: VertexOut) -> @location(0) vec4<f32> {
  let a = textureSample(srcA, maskSampler, in.uv).r;
  let b = textureSample(srcB, maskSampler, in.uv).r;
  let out = ${op};
  return vec4<f32>(out, out, out, 1.0);
}
`;
}

/** Passe d'inversion (design.md §4, étape 3 : `mask.invert` -> `acc = 1 - acc`). */
export function buildInvertWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcA: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs_invert(in: VertexOut) -> @location(0) vec4<f32> {
  let a = textureSample(srcA, maskSampler, in.uv).r;
  let out = 1.0 - a;
  return vec4<f32>(out, out, out, 1.0);
}
`;
}
