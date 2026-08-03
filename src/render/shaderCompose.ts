/** Taille du uniform `params: array<f32, N>` du header WGSL partagé.
 *  Un effet déclarant plus de paramètres est rejeté au chargement du
 *  registry (voir effects/validate.ts).
 *
 *  Élargi de 8 à 11 pour le duotone tritone (3 couleurs HSL + contraste +
 *  pivot = 11), puis de 11 à 16 (2026-07-31) : le plafond était SATURÉ —
 *  duotone en consommait exactement 11 — et la campagne d'élargissement des
 *  réglages d'effets (genou de seuil et teinte de halo sur le glow, présence
 *  centrale / asymétrie / orientation sur le chromatic bleed) n'avait plus
 *  aucun slot libre. 16 laisse 5 slots au-dessus de l'effet le plus gourmand.
 *
 *  Puis de 16 à 24 (2026-08-01) : la remontée de `gradientMap` au niveau de sa
 *  référence (cahier du 2026-08-01, §6) lui ajoute cinq réglages — espace de
 *  mélange, décalage, répétition, type de répétition, dispersion — et le porte
 *  à 18, au-dessus du plafond. 24 laisse 6 slots au-dessus du plus gourmand,
 *  la même marge que celle visée au précédent élargissement.
 *
 *  Puis de 24 à 32 (2026-08-03) : `outlines` absorbe `echoOutlines` (ADR-0015)
 *  et gagne un troisième mode de détection. Sept réglages n'ont aucun
 *  équivalent dans les deux premiers — lissage de la forme, espacement,
 *  nombre d'échos, atténuation, et les trois composantes du dernier écho — ce
 *  qui le porte à 26. Les sept AUTRES paramètres de l'effet absorbé, eux, se
 *  recouvrent (seuil, entrée, épaisseur, encre, effacement, fond,
 *  remplissage) : le plafond ne paie que ce qui est réellement neuf. 32 laisse
 *  6 slots au-dessus du plus gourmand, la même marge qu'aux deux
 *  élargissements précédents.
 *
 *  Ce que ça coûte : le uniform passe de 96 à 128 octets par passe d'effet, et
 *  `effectPassRunner` en alloue un par passe et par frame. À neuf passes de
 *  pyramide, 288 octets de plus par calque — sans commune mesure avec les
 *  cibles de rendu que la même pyramide emprunte au pool.
 *
 *  Le header ci-dessous interpole cette constante (`array<f32, ${...}>`) : il
 *  n'y a donc plus qu'UN endroit à modifier, et `MAX_EFFECT_PARAMS` reste la
 *  seule source pour la taille du Float32Array côté CPU
 *  (`effectPassRunner.ts`) comme pour la déclaration WGSL. */
export const MAX_EFFECT_PARAMS = 32;

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
  /** Écrêtage (design 2026-07-27 §3.3) : ce calque est un calque d'EFFET
   *  écrêté à la couverture du calque photo situé en dessous. Partage le
   *  binding 6 (`coverageTexture`) avec `hasImageSource`, mais n'a pas le même
   *  sens : l'entrée d'effet reste le composite en dessous (`color`), seule la
   *  BORNE du poids de compositing change. Mutuellement exclusif avec
   *  `hasImageSource` — un calque photo ne peut pas être écrêté
   *  (`LayerStack.setLayerClip` le refuse), donc la levée ci-dessous est un
   *  assert inatteignable, pas un chemin utilisateur. */
  clipToCoverage?: boolean;
  /** Corps `fn blend(base, top)` du mode de fusion du calque. Requis quand
   *  applyMask=true. Ignoré sinon (les passes internes ne compositent pas). */
  blendWgsl?: string;
}

/** Conversions sRGB↔linéaire partagées. Exportées parce que la passe de
 *  présentation (`presentPass.ts`) en a besoin pour poser les gris du damier
 *  en valeurs sRGB lisibles plutôt qu'en constantes linéaires magiques — pas
 *  pour un gamma manuel sur les couleurs du pipeline, que les formats `-srgb`
 *  interdisent (CLAUDE.md § Décisions techniques verrouillées). */
export const SRGB_HELPERS_WGSL = `
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
  // Exclusion mutuelle : un calque est SOIT une photo (sa propre couverture
  // sert aussi d'entrée d'effet), SOIT un calque d'effet écrêté à la couverture
  // d'un AUTRE calque. Les deux à la fois n'a pas de sens et n'est pas
  // atteignable (`LayerStack.setLayerClip` refuse un calque photo) — d'où une
  // levée, jamais un repli silencieux.
  if ((opts.hasImageSource ?? false) && (opts.clipToCoverage ?? false)) {
    throw new Error(
      "composeShader: hasImageSource et clipToCoverage sont mutuellement exclusifs (un calque photo ne peut pas être écrêté).",
    );
  }
  // Le binding de couverture n'a de sens QUE sur le chemin de compositing
  // (applyMask) — les passes internes d'effet reçoivent directement la
  // texture résolue comme srcTexture (binding 0), voir framePipelineExecutor.ts.
  const hasImageSource = opts.applyMask && (opts.hasImageSource ?? false);
  const clipToCoverage = opts.applyMask && (opts.clipToCoverage ?? false);
  // Binding 6 partagé par les deux chemins, d'où son nom neutre : sur le chemin
  // écrêté, l'appeler `imageSourceTexture` serait un mensonge (la texture
  // appartient au calque photo du DESSOUS, pas à celui-ci).
  const coverageBinding = hasImageSource || clipToCoverage
    ? "@group(0) @binding(6) var coverageTexture: texture_2d<f32>;"
    : "";
  const blendBlock = opts.applyMask ? SRGB_HELPERS_WGSL + "\n" + (opts.blendWgsl ?? "") : "";
  // Écrêté : l'entrée d'effet reste `color` (le composite en dessous) — l'effet
  // doit voir les pixels qu'il traite. Seul le POIDS est borné par la couverture.
  const effectInputExpr = hasImageSource
    ? "textureSample(coverageTexture, srcSampler, in.uv);"
    : "color;";
  const coverageMixWeight = hasImageSource
    ? "compositing.x * maskValue * effectInput.a"
    : clipToCoverage
      ? "compositing.x * maskValue * textureSample(coverageTexture, srcSampler, in.uv).a"
      : "compositing.x * maskValue";
  const coverageComment = hasImageSource
    ? `  // Calque photo (hasImageSource) : effectInput.a porte la COUVERTURE de
  // la pré-passe (ARCHITECTURE.md §4.3) — hors des bornes de la photo A,
  // effectInput.a=0 -> poids nul -> color.rgb (le fond) reste inchangé,
  // jamais un bord répété/clampé visible.\n`
    : clipToCoverage
      ? `  // Calque écrêté (clipToCoverage) : le poids est borné par l'alpha de la
  // couverture du calque photo du DESSOUS. Produit de bornes indépendantes —
  // opacité x masque peint x couverture — donc hors de la silhouette le poids
  // est nul et color.rgb ressort intact, quel que soit le mode de fusion.\n`
      : "";
  const fsBody = opts.applyMask
    ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  // Alpha du CALQUE (la source du source-over) : opacité × masque peint ×
  // couverture. C'est le même poids qu'avant — il porte désormais aussi
  // l'alpha, au lieu de ne piloter que le mélange des couleurs.
  let srcAlpha = ${coverageMixWeight};
  let backdropAlpha = color.a;
  // Source-over (Porter-Duff) : l'alpha est COMPOSÉ, plus hérité du bas de
  // chaîne. Le court-circuit précédent (alpha recopié tel quel depuis color.a)
  // se documentait lui-même comme conditionnel ; il rendait impossible de savoir,
  // par pixel, si quelque chose couvre — ce qu'exige le damier de transparence
  // (design 2026-07-28 « le fond devient un calque », tranche T0).
  let outAlpha = srcAlpha + backdropAlpha * (1.0 - srcAlpha);
  // Le mode de fusion n'agit que sur la part RÉELLEMENT couverte du backdrop
  // (formule de composition PDF, celle de Photoshop) : là où le backdrop est
  // transparent, le calque ressort tel quel au lieu de fusionner avec du vide.
  // Sur un backdrop opaque (backdropAlpha=1) ce mix rend blend(color, effected)
  // à l'identique — voir la propriété d'identité ci-dessous.
  let blended = mix(effected.rgb, blend(color.rgb, effected.rgb), backdropAlpha);
${coverageComment}  // Alpha DROIT (non prémultiplié) dans toute la chaîne : les effets et les
  // passes internes échantillonnent ces textures et attendent une couleur
  // réelle, pas une couleur assombrie par sa propre couverture. La
  // prémultiplication/l'aplatissement sur fond opaque n'a lieu qu'une fois, à
  // la présentation (render/presentPass.ts).
  //
  // IDENTITÉ (non-régression) : avec backdropAlpha=1 — le seul cas qui existe
  // tant que la toile porte la photo — outAlpha=1, srcAlpha/outAlpha=srcAlpha
  // et blended=blend(color.rgb, effected.rgb), donc cette expression se réduit
  // EXACTEMENT à l'ancienne forme vec4(mix(color.rgb, blended, poids), color.a).
  let outRgb = select(vec3<f32>(0.0), mix(color.rgb, blended, srcAlpha / outAlpha), outAlpha > 0.0);
  return vec4<f32>(outRgb, outAlpha);`
    : "return effected;";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, ${MAX_EFFECT_PARAMS}>;
${maskBinding}
${prevPassBinding}
${compositingBinding}
${coverageBinding}

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
