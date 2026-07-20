import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/** Guide `I` = luminance Rec. 709 de la couleur du calque (déjà linéaire —
 *  cohérent avec le pipeline sRGB strict du moteur, design.md §4bis). */
export function buildLuminanceWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var colorTexture: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs_luminance(in: VertexOut) -> @location(0) vec4<f32> {
  let c = textureSample(colorTexture, maskSampler, in.uv).rgb;
  let l = clamp(dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  return vec4<f32>(l, l, l, 1.0);
}
`;
}

/** Empaquette I (r8, canal r) et p (r8, canal g) dans une seule texture rg8
 *  — un box filter séparable unique produit ensuite mean_I ET mean_p (2
 *  passes H+V au lieu de 4). */
export function buildPackWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcI: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var srcP: texture_2d<f32>;

@fragment
fn fs_pack(in: VertexOut) -> @location(0) vec4<f32> {
  let i = textureSample(srcI, maskSampler, in.uv).r;
  let p = textureSample(srcP, maskSampler, in.uv).r;
  return vec4<f32>(i, p, 0.0, 1.0);
}
`;
}

/** À partir de la texture rg8 (I,p) empaquetée : sort I² (r) et I·p (g) en
 *  rg16float — un second box filter séparable produit corr_I ET corr_Ip. */
export function buildSquareCorrWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcIp: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs_squareCorr(in: VertexOut) -> @location(0) vec4<f32> {
  let ip = textureSample(srcIp, maskSampler, in.uv).rg;
  let i = ip.x;
  let p = ip.y;
  return vec4<f32>(i * i, i * p, 0.0, 1.0);
}
`;
}

/** Box-filter séparable (He et al. — réduit O(radius²) à O(radius) par
 *  passe, cf. design.md §4bis). `channels=1` lit/écrit rg8 en niveaux de
 *  gris répliqué (r seul utilisé) ; `channels=2` lit/écrit rg16float sur
 *  les deux canaux simultanément. Rayon en uniform, en TEXELS. */
function boxFilterWgsl(direction: "H" | "V", channels: 1 | 2): string {
  const offset = direction === "H" ? "vec2<f32>(texel.x, 0.0)" : "vec2<f32>(0.0, texel.y)";
  const entryPoint = direction === "H" ? "fs_boxH" : "fs_boxV";
  const sampleExpr = channels === 2 ? "textureSample(src, maskSampler, uv).rg" : "vec2<f32>(textureSample(src, maskSampler, uv).r, 0.0)";
  const outExpr = channels === 2 ? "vec4<f32>(sum, 0.0, 1.0)" : "vec4<f32>(sum.x, sum.x, sum.x, 1.0)";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> radius: f32;

@fragment
fn ${entryPoint}(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let step = ${offset};
  let n = i32(radius);
  var sum = vec2<f32>(0.0, 0.0);
  var count = 0.0;
  for (var k = -n; k <= n; k = k + 1) {
    let uv = in.uv + step * f32(k);
    sum = sum + ${sampleExpr};
    count = count + 1.0;
  }
  sum = sum / max(count, 1.0);
  return ${outExpr};
}
`;
}

export function buildBoxFilterHWgsl(channels: 1 | 2): string {
  return boxFilterWgsl("H", channels);
}
export function buildBoxFilterVWgsl(channels: 1 | 2): string {
  return boxFilterWgsl("V", channels);
}

/** À partir de mean_Ip (rg16float: mean_I, mean_p) et corr (rg16float:
 *  corr_I, corr_Ip) : calcule a/b (design.md §4bis étape 2), sortie
 *  rg16float SANS clamp (a/b non bornés par construction). */
export function buildComputeABWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var meanIp: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var corr: texture_2d<f32>;

@fragment
fn fs_computeAB(in: VertexOut) -> @location(0) vec4<f32> {
  let mi = textureSample(meanIp, maskSampler, in.uv).x;
  let mp = textureSample(meanIp, maskSampler, in.uv).y;
  let ci = textureSample(corr, maskSampler, in.uv).x;
  let cip = textureSample(corr, maskSampler, in.uv).y;
  let eps = 1e-4;
  // max(varI, 0.0) : la variance est mathématiquement >= 0, mais la
  // soustraction ci - mi*mi (cancellation) peut la faire ressortir
  // légèrement négative avec des intermédiaires r16float — sans ce clamp,
  // varI + eps peut retomber à 0/négatif et produire Inf/NaN (finding
  // codex-crosscheck HAUTE, commit 87ce5ad).
  let varI = max(ci - mi * mi, 0.0);
  let covIp = cip - mi * mp;
  let a = covIp / (varI + eps);
  let b = mp - a * mi;
  return vec4<f32>(a, b, 0.0, 1.0);
}
`;
}

/** Composite final (design.md §4bis étape 4-5) : `q = mean_a*I + mean_b`,
 *  puis `lerp(p, q, edgeStrength)` borné [0,1]. Sortie r8unorm — c'est le
 *  résultat qui remplace la texture masque foldée. */
export function buildCompositeWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var meanAB: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var srcI: texture_2d<f32>;
@group(0) @binding(3) var srcP: texture_2d<f32>;
@group(0) @binding(4) var<uniform> edgeStrength: f32;

@fragment
fn fs_composite(in: VertexOut) -> @location(0) vec4<f32> {
  let ab = textureSample(meanAB, maskSampler, in.uv).xy;
  let i = textureSample(srcI, maskSampler, in.uv).r;
  let p = textureSample(srcP, maskSampler, in.uv).r;
  let q = clamp(ab.x * i + ab.y, 0.0, 1.0);
  let out = clamp(mix(p, q, edgeStrength), 0.0, 1.0);
  return vec4<f32>(out, out, out, 1.0);
}
`;
}
