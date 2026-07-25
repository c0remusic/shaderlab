/** Taille du uniform `params: array<f32, N>` du header WGSL partagé.
 *  Un effet déclarant plus de paramètres est rejeté au chargement du
 *  registry (voir effects/validate.ts) — élargir cette constante et le
 *  header ensemble si le besoin apparaît. Élargi de 8 à 11 pour le duotone
 *  tritone (3 couleurs HSL + contraste + pivot = 11). */
export const MAX_EFFECT_PARAMS = 11;

export const FULLSCREEN_VERTEX_WGSL = `
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
  /** Double exposure (ARCHITECTURE.md §4.3, approche C2) : ce calque porte
   *  un `imageSource` déjà résolu par `PhotoLayerInputResolver` en une
   *  texture pleine taille (RGB=photo A transformée, alpha=couverture).
   *  Optionnel (défaut `false`) pour ne pas casser les appelants existants
   *  (effets réguliers sans calque photo). Ignoré quand `applyMask` est
   *  faux (les passes internes d'effet reçoivent directement cette texture
   *  comme `srcTexture` — pas besoin d'un second binding, voir
   *  `framePipelineExecutor.ts`). */
  hasImageSource?: boolean;
  /** Corps `fn blend(base, top)` du mode de fusion du calque. Requis quand
   *  applyMask=true. Ignoré sinon (les passes internes ne compositent pas). */
  blendWgsl?: string;
}

const SRGB_HELPERS_WGSL = `
fn srgb2lin(c: vec3<f32>) -> vec3<f32> {
  let lo = c / 12.92;
  let hi = pow((c + vec3<f32>(0.055)) / vec3<f32>(1.055), vec3<f32>(2.4));
  return select(hi, lo, c <= vec3<f32>(0.04045));
}
fn lin2srgb(c: vec3<f32>) -> vec3<f32> {
  let lo = c * 12.92;
  let hi = 1.055 * pow(c, vec3<f32>(1.0 / 2.4)) - vec3<f32>(0.055);
  return select(hi, lo, c <= vec3<f32>(0.0031308));
}
`;

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
  // blend + opacité + helpers sRGB seulement sur le chemin de compositing.
  const compositingBinding = opts.applyMask
    ? "@group(0) @binding(5) var<uniform> compositing: vec4<f32>;"
    : "";
  // Le binding imageSource n'a de sens QUE sur le chemin de compositing
  // (applyMask) — les passes internes d'effet reçoivent directement la
  // texture résolue comme srcTexture (binding 0), voir framePipelineExecutor.ts.
  const hasImageSource = opts.applyMask && (opts.hasImageSource ?? false);
  const imageSourceBinding = hasImageSource
    ? "@group(0) @binding(6) var imageSourceTexture: texture_2d<f32>;"
    : "";
  const blendBlock = opts.applyMask ? SRGB_HELPERS_WGSL + "\n" + (opts.blendWgsl ?? "") : "";
  const effectInputExpr = hasImageSource
    ? "textureSample(imageSourceTexture, srcSampler, in.uv);"
    : "color;";
  const coverageMixWeight = hasImageSource
    ? "compositing.x * maskValue * effectInput.a"
    : "compositing.x * maskValue";
  const coverageComment = hasImageSource
    ? `  // Calque photo (hasImageSource) : effectInput.a porte la COUVERTURE de
  // la pré-passe (ARCHITECTURE.md §4.3) — hors des bornes de la photo A,
  // effectInput.a=0 -> poids nul -> color.rgb (le fond) reste inchangé,
  // jamais un bord répété/clampé visible.\n`
    : "";
  const fsBody = opts.applyMask
    ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  let blended = blend(color.rgb, effected.rgb);
  // Passe color.a tel quel (ne le mélange plus avec effected.a) : hypothèse
  // sûre tant que tout effet préserve l'alpha (source JPEG opaque, α≡1
  // partout — vérifié pour glow/chromaticBleed/grain/warp). Si un futur
  // effet produit un alpha ≠ color.a, ce court-circuit le perdrait
  // silencieusement — revoir alors ce mix si un effet à alpha variable arrive.
${coverageComment}  return vec4<f32>(mix(color.rgb, blended, ${coverageMixWeight}), color.a);`
    : "return effected;";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, ${MAX_EFFECT_PARAMS}>;
${maskBinding}
${prevPassBinding}
${compositingBinding}
${imageSourceBinding}

${blendBlock}
${effectWgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effectInput = ${effectInputExpr}
  let effected = fs_main(in.uv, effectInput);
  ${fsBody}
}
`;
}
