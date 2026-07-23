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

/** Downscale du guide (I ou p, r8unorm) avant le filtre guidé — moyenne de
 *  boîte 2x2 (4 échantillons bilinéaires) plutôt qu'un simple resize
 *  1-tap, pour limiter l'aliasing au facteur de réduction typique (~3x sur
 *  une photo 24MP downscalée au plafond de 2048px, cf. spec design). */
export function buildDownsampleWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;

@fragment
fn fs_downsample(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let o = texel * 0.5;
  let a = textureSample(src, srcSampler, in.uv + vec2<f32>(-o.x, -o.y)).r;
  let b = textureSample(src, srcSampler, in.uv + vec2<f32>(o.x, -o.y)).r;
  let c = textureSample(src, srcSampler, in.uv + vec2<f32>(-o.x, o.y)).r;
  let d = textureSample(src, srcSampler, in.uv + vec2<f32>(o.x, o.y)).r;
  let v = (a + b + c + d) * 0.25;
  return vec4<f32>(v, v, v, 1.0);
}
`;
}

/** Première étape d'une SAT (image intégrale) : convertit une source rg8/
 *  rg16 (packedIp, squareCorr, ab) en rg32float via `textureLoad` (jamais
 *  `textureSample` — `rg32float` est `unfilterable-float` en WebGPU, voir
 *  spec design § Lookup SAT via textureLoad). Passthrough identité, aucune
 *  somme — la construction Hillis-Steele proprement dite commence à la
 *  passe suivante (`buildSatScanWgsl`). */
export function buildSatWidenWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;

@fragment
fn fs_satWiden(in: VertexOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(in.position.xy);
  let c = textureLoad(src, coord, 0).rg;
  return vec4<f32>(c, 0.0, 1.0);
}
`;
}

/** Un pas de scan Hillis-Steele (prefix-sum inclusif) le long d'un axe —
 *  appelé ceil(log2(largeur)) fois en H puis ceil(log2(hauteur)) fois en V
 *  (offset = 2^k à chaque appel) pour obtenir la SAT 2D complète (technique
 *  séparable standard). `radius` (l'utilisateur) n'intervient JAMAIS ici —
 *  c'est ce qui rend la construction de la SAT indépendante du rayon
 *  choisi (voir spec design § Cache à deux niveaux) ; le rayon n'entre en
 *  jeu qu'au lookup (`buildSatLookupWgsl`). */
export function buildSatScanWgsl(direction: "H" | "V"): string {
  const entryPoint = direction === "H" ? "fs_satScanH" : "fs_satScanV";
  const prevCoordExpr =
    direction === "H"
      ? "vec2<i32>(coord.x - off, coord.y)"
      : "vec2<i32>(coord.x, coord.y - off)";
  const boundsCheck = direction === "H" ? "prevCoord.x >= 0" : "prevCoord.y >= 0";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<uniform> offset: f32;

@fragment
fn ${entryPoint}(in: VertexOut) -> @location(0) vec4<f32> {
  let coord = vec2<i32>(in.position.xy);
  let off = i32(offset);
  var sum = textureLoad(src, coord, 0).rg;
  let prevCoord = ${prevCoordExpr};
  if (${boundsCheck}) {
    sum = sum + textureLoad(src, prevCoord, 0).rg;
  }
  return vec4<f32>(sum, 0.0, 1.0);
}
`;
}

/** Lookup O(1) d'une moyenne de boîte de rayon quelconque à partir d'une
 *  SAT complète (4 échantillons coin, différence d'aires — technique
 *  standard des images intégrales). `radius` est déjà mis à l'échelle du
 *  guide réduit par l'appelant (`edgeRadius * scale`, voir spec design §
 *  Mise à l'échelle du rayon) — cette fonction ne connaît que des texels
 *  du guide réduit, jamais la résolution de la photo source. */
export function buildSatLookupWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var sat: texture_2d<f32>;
@group(0) @binding(1) var<uniform> radius: f32;

fn satAt(coord: vec2<i32>, dims: vec2<i32>) -> vec2<f32> {
  if (coord.x < 0 || coord.y < 0) {
    return vec2<f32>(0.0, 0.0);
  }
  let clamped = vec2<i32>(min(coord.x, dims.x - 1), min(coord.y, dims.y - 1));
  return textureLoad(sat, clamped, 0).rg;
}

@fragment
fn fs_satLookup(in: VertexOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(sat));
  let coord = vec2<i32>(in.position.xy);
  let r = max(i32(radius), 0);
  let x1 = max(coord.x - r, 0);
  let x2 = min(coord.x + r, dims.x - 1);
  let y1 = max(coord.y - r, 0);
  let y2 = min(coord.y + r, dims.y - 1);
  let a = satAt(vec2<i32>(x2, y2), dims);
  let b = satAt(vec2<i32>(x1 - 1, y2), dims);
  let c = satAt(vec2<i32>(x2, y1 - 1), dims);
  let d = satAt(vec2<i32>(x1 - 1, y1 - 1), dims);
  let sum = a - b - c + d;
  let count = f32((x2 - x1 + 1) * (y2 - y1 + 1));
  let mean = sum / max(count, 1.0);
  return vec4<f32>(mean, 0.0, 1.0);
}
`;
}
