import type { MaskSourceModule } from "./types";

/** Nombre max d'échantillons couleur cumulables dans UNE source colorRange
 *  (contrainte de taille de tableau uniform fixe — voir note d'implémentation
 *  du plan Tranche 3, Task 5). Au-delà, les échantillons supplémentaires
 *  sont ignorés silencieusement côté UI (Task 6 doit désactiver l'ajout). */
export const MAX_COLOR_RANGE_SAMPLES = 6;

/**
 * Range couleur (prd.md §Masques-sources) : masque continu qui suit une ou
 * plusieurs couleurs de référence échantillonnées dans la photo (cumulées
 * dans la MÊME source, une tolérance/dureté globale). Distance colorimétrique
 * euclidienne en espace linéaire (cohérent "linéaire strict") à
 * l'échantillon le PLUS PROCHE parmi ceux fournis. Paramètres sérialisés
 * dans un tableau ÉTENDU `array<f32,32>` (PAS le contrat générique 8 floats
 * des autres sources — voir note d'implémentation) :
 * `params[0]=tolerance, [1]=hardness, [2]=invert, [3]=sampleCount,
 * [4..21]=jusqu'à 6 échantillons RGB (r,g,b consécutifs)`.
 */
export const colorRangeSource: MaskSourceModule = {
  id: "colorRange", name: "Range couleur",
  defaultParams: { tolerance: 0.15, hardness: 0.5, invert: 0, samples: [] },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 32>) -> f32 {
  let tolerance = max(params[0], 0.001);
  let hardness = clamp(params[1], 0.0, 1.0);
  let invert = params[2];
  let sampleCount = i32(params[3]);

  var minDist = 999.0;
  for (var i = 0; i < ${MAX_COLOR_RANGE_SAMPLES}; i = i + 1) {
    if (i >= sampleCount) { continue; }
    let base = 4 + i * 3;
    let sample = vec3<f32>(params[base], params[base + 1], params[base + 2]);
    minDist = min(minDist, distance(colorLinear, sample));
  }
  if (sampleCount == 0) { return 0.0; }

  // hardness=0 -> transition douce sur toute la tolérance ; hardness=1 -> bord net.
  let softness = mix(tolerance, tolerance * 0.05, hardness);
  let value = 1.0 - smoothstep(tolerance - softness, tolerance, minDist);
  let clamped = clamp(value, 0.0, 1.0);
  return select(clamped, 1.0 - clamped, invert > 0.5);
}
`,
};
