export interface BlendMode {
  id: string;
  name: string;
  /** WGSL définissant `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32>`.
   *  `base` = calque du dessous (input), `top` = sortie d'effet. Travaille en
   *  LINÉAIRE pour les modes séparables ; les modes définis-gamma décodent en
   *  sRGB via les helpers `srgb2lin`/`lin2srgb` injectés par le shader (voir
   *  shaderCompose.ts), appliquent la formule, puis ré-encodent — le pipeline
   *  reste linéaire strict. */
  wgsl: string;
}
