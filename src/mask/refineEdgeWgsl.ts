import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/** Les deux passes 1D qui composent la part CARRÉE de la morphologie, dans
 *  l'ordre d'encodage. L'ordre entre passes est indifférent au résultat
 *  (min/max commutent — prouvé dans test/mask/morphologySeparable.test.ts),
 *  mais il est figé pour que le pipeline soit déterministe.
 *  ⚠️ Depuis le 2026-08-19, l'élément structurant n'est plus le carré seul :
 *  `planRefine` ajoute deux passes DIAGONALES ("D1"/"D2") pour former un
 *  OCTOGONE — mesuré chez Affinity (`growShrinkRasterSelection(radius,
 *  circular)`), leur grow est un disque euclidien, et notre carré débordait
 *  de 41 % sur les diagonales (audit du 2026-08-19, axe outils internes). */
export const MORPHOLOGY_PASS_AXES = ["H", "V"] as const;
export type MorphologyAxis = "H" | "V" | "D1" | "D2";

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
  // "D1"/"D2" : pas DIAGONAL — un pas vaut √2 px euclidiens, le rayon de la
  // passe est donc compté en PAS de texel diagonaux, pas en px (le plan en
  // tient compte : `octagonRadii`, src/mask/refinePlan.ts). D1 ⊕ D2 forme un
  // LOSANGE (carré tourné de 45°), et carré ⊕ losange, l'octogone.
  const offset =
    axis === "H"
      ? "vec2<f32>(texel.x, 0.0)"
      : axis === "V"
        ? "vec2<f32>(0.0, texel.y)"
        : axis === "D1"
          ? "vec2<f32>(texel.x, texel.y)"
          : "vec2<f32>(texel.x, -texel.y)";
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

/** Les quatre fenêtres du lookup de feather : décomposition en tranches
 *  (« layer cake ») d'une gaussienne d'écart-type σ = 0,4·rayon, en quatre
 *  boxcars concentriques de hauteurs égales. `scale` est la demi-largeur de
 *  la fenêtre en fraction du rayon du curseur (t_i = σ·√(−2·ln λ_i),
 *  λ ∈ {7/8, 5/8, 3/8, 1/8}), `weight` le poids de sa MOYENNE dans la somme
 *  (∝ t_i, normalisé à 1).
 *
 *  Pourquoi : mesuré chez Affinity le 2026-08-19 (featherRasterSelection(32),
 *  profil relevé au pixel), leur feather est une courbe en S de type erf —
 *  σ ≈ 0,4·rayon sur leur transition 10–90 % — quand un box UNE passe rend
 *  une rampe à deux cassures (C0). Itérer la passe SAT aurait donné le même S
 *  (3 box ≈ B-spline quadratique) mais aurait DÉTRUIT le cache de la table :
 *  les passes 2 et 3 dépendraient du rayon, et glisser le curseur
 *  reconstruirait deux SAT par cran — exactement le coût que le chantier SAT
 *  du 2026-08-13 a retiré. La somme pondérée de quatre fenêtres donne le S en
 *  UNE passe sur la MÊME table : le cache et le coût plat au rayon survivent.
 *
 *  L'écart du profil à l'erf cible est borné par test
 *  (test/mask/featherProfile.test.ts) — modèle CPU du même calcul, balayé sur
 *  plusieurs rayons, même patron que la courbure des lames
 *  (effects/aperture.ts). */
export const FEATHER_WINDOWS: ReadonlyArray<{ scale: number; weight: number }> = (() => {
  const SIGMA_PER_RADIUS = 0.4;
  const halfWidths = [1 / 8, 3 / 8, 5 / 8, 7 / 8].map(
    (lambda) => SIGMA_PER_RADIUS * Math.sqrt(-2 * Math.log(lambda)),
  );
  const total = halfWidths.reduce((s, t) => s + t, 0);
  return halfWidths.map((t) => ({ scale: t, weight: t / total }));
})();

/** Lookup du feather sur la SAT : quatre moyennes de boîte concentriques,
 *  pondérées (voir `FEATHER_WINDOWS`). Même table, mêmes quatre coins par
 *  fenêtre, même clamp aux bords que `buildSatLookupWgsl`
 *  (mask/edgeAwareWgsl.ts) — qui, lui, reste un box PUR : le guided filter
 *  edge-aware consomme de vraies moyennes locales, son profil ne doit PAS
 *  changer. Chaque fenêtre est normalisée par SON compte de texels réel,
 *  donc le comportement au bord de l'image reste exact fenêtre par fenêtre. */
export function buildFeatherLookupWgsl(): string {
  const windows = FEATHER_WINDOWS.map(
    (w) => `vec2<f32>(${w.scale.toFixed(6)}, ${w.weight.toFixed(6)})`,
  ).join(",\n  ");
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var sat: texture_2d<f32>;
@group(0) @binding(1) var<uniform> radius: f32;

const FENETRES = array<vec2<f32>, 4>(
  ${windows}
);

fn satAt(coord: vec2<i32>, dims: vec2<i32>) -> vec2<f32> {
  if (coord.x < 0 || coord.y < 0) {
    return vec2<f32>(0.0, 0.0);
  }
  let clamped = vec2<i32>(min(coord.x, dims.x - 1), min(coord.y, dims.y - 1));
  return textureLoad(sat, clamped, 0).rg;
}

fn boxMean(coord: vec2<i32>, dims: vec2<i32>, r: i32) -> vec2<f32> {
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
  return sum / max(count, 1.0);
}

@fragment
fn fs_featherLookup(in: VertexOut) -> @location(0) vec4<f32> {
  let dims = vec2<i32>(textureDimensions(sat));
  let coord = vec2<i32>(in.position.xy);
  var acc = vec2<f32>(0.0, 0.0);
  for (var i = 0; i < 4; i = i + 1) {
    let r = max(i32(round(radius * FENETRES[i].x)), 0);
    acc = acc + boxMean(coord, dims, r) * FENETRES[i].y;
  }
  return vec4<f32>(acc, 0.0, 1.0);
}
`;
}
