import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/** Les deux passes 1D qui composent UNE morphologie carrée, dans l'ordre
 *  d'encodage. L'ordre entre H et V est indifférent au résultat (prouvé dans
 *  test/mask/morphologySeparable.test.ts), mais il est figé ici pour que le
 *  pipeline soit déterministe. */
export const MORPHOLOGY_PASS_AXES = ["H", "V"] as const;
export type MorphologyAxis = (typeof MORPHOLOGY_PASS_AXES)[number];

/** Morphologie (contracter/dilater, design.md §4) : `erode` = min du
 *  voisinage (contracte le bord vers l'intérieur), `dilate` = max (dilate
 *  vers l'extérieur). `contract` (px SIGNÉ dans RefineEdgeParams) : négatif
 *  -> erode, positif -> dilate — l'appelant choisit le mode et passe
 *  `abs(contract)` comme radius.
 *
 *  SÉPARABLE, et exactement (pas une approximation) : l'élément structurant
 *  est un CARRÉ (2r+1)², et min/max sur un produit cartésien se décomposent
 *  en min/max par axe. L'appelant encode donc DEUX passes 1D (H puis V) au
 *  lieu d'une passe carrée. Le clamp-to-edge du sampler ne casse pas la
 *  propriété : il s'applique indépendamment par axe.
 *
 *  Pourquoi ça compte : la version carrée faisait (2r+1)² textureSample par
 *  pixel, soit 10 201 à r=50 (le maximum du slider, MaskPanel.tsx) — environ
 *  2,45e11 échantillons sur une photo 24 MP, dans UNE passe, rejoués à chaque
 *  cran d'un drag de slider (`contract` est dans la clé du cache de refine).
 *  Séparée : 2 x (2r+1) = 202 échantillons par pixel, facteur 50. Le pire cas
 *  edge-aware AVANT le chantier SAT était à ~600 échantillons par pixel et
 *  avait déjà produit un GPUDevice.lost documenté
 *  (docs/superpowers/specs/2026-07-23-shaderlab-edge-aware-fast-guided-filter-design.md,
 *  dont le scope excluait explicitement refine()). */
export function buildMorphologyWgsl(
  mode: "dilate" | "erode",
  axis: MorphologyAxis,
): string {
  const op = mode === "dilate" ? "max(acc, s)" : "min(acc, s)";
  const init = mode === "dilate" ? "0.0" : "1.0";
  const offset =
    axis === "H" ? "vec2<f32>(texel.x, 0.0)" : "vec2<f32>(0.0, texel.y)";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> radius: f32;

@fragment
fn fs_morphology${axis}(in: VertexOut) -> @location(0) vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(src));
  let step = ${offset};
  let n = i32(radius);
  var acc = ${init};
  for (var k = -n; k <= n; k = k + 1) {
    let s = textureSample(src, maskSampler, in.uv + step * f32(k)).r;
    acc = ${op};
  }
  return vec4<f32>(acc, acc, acc, 1.0);
}
`;
}
