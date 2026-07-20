import type { MaskSourceModule } from "./types";

/**
 * Masque par plage tonale (prd.md §Masques-sources : "masquer selon les
 * tons de la photo — ombres/tons moyens/hautes lumières, avec courbe de
 * tolérance"). Continu (jamais binaire, contrainte inacceptable du PRD) :
 * deux rampes `smoothstep` (montante pour la borne basse, descendante pour
 * la haute) sur la luminance Rec.709 CALCULÉE EN LINÉAIRE (cohérent
 * "linéaire strict"). `tolerance` élargit la largeur de chaque rampe.
 * Paramètres sérialisés : `params[0]=shadowsMin, [1]=shadowsMax,
 * [2]=highlightsMin, [3]=highlightsMax, [4]=tolerance, [5]=invert`.
 * Une plage `[shadowsMin,shadowsMax]` = "ombres", `[highlightsMin,
 * highlightsMax]` = "hautes lumières" ; le masque est la RÉUNION (max) des
 * deux rampes — sélectionner les deux extrêmes en même temps est un usage
 * valide (ex. masquer tout sauf les tons moyens via invert).
 */
export const luminositySource: MaskSourceModule = {
  id: "luminosity", name: "Luminosité",
  defaultParams: { shadowsMin: 0, shadowsMax: 0.33, highlightsMin: 0.66, highlightsMax: 1, tolerance: 0.1, invert: 0 },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 {
  let luminance = clamp(dot(colorLinear, vec3<f32>(0.2126, 0.7152, 0.0722)), 0.0, 1.0);
  let shadowsMin = params[0];
  let shadowsMax = params[1];
  let highlightsMin = params[2];
  let highlightsMax = params[3];
  let tolerance = max(params[4], 0.001);
  let invert = params[5];

  let shadowMask = smoothstep(shadowsMin - tolerance, shadowsMin + tolerance, luminance)
    * (1.0 - smoothstep(shadowsMax - tolerance, shadowsMax + tolerance, luminance));
  let highlightMask = smoothstep(highlightsMin - tolerance, highlightsMin + tolerance, luminance)
    * (1.0 - smoothstep(highlightsMax - tolerance, highlightsMax + tolerance, luminance));
  let value = clamp(max(shadowMask, highlightMask), 0.0, 1.0);
  return select(value, 1.0 - value, invert > 0.5);
}
`,
};
