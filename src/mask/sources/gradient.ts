import type { MaskSourceModule } from "./types";

/**
 * Dégradé linéaire (design.md §3, prd.md §Sources) : masque continu qui
 * varie de 0 à 1 entre un point de départ et un point de fin (coordonnées
 * image normalisées [0,1]), avec feather (adoucissement de la transition)
 * et invert. Paramètres sérialisés dans cet ORDRE FIXE (contrat wgsl) :
 * `params[0]=startX, [1]=startY, [2]=endX, [3]=endY, [4]=feather, [5]=invert (0/1)`.
 * `angle` fait partie de `defaultParams` pour l'UI (calcul du point de fin
 * par défaut à partir d'un angle) mais N'EST PAS un paramètre wgsl séparé —
 * le dégradé est entièrement décrit par ses deux points, l'angle n'est
 * qu'une commodité de saisie côté UI (Task 5).
 */
/** Recalcule `startX/startY/endX/endY` pour un nouvel angle (degrés), en
 *  conservant le centre et la longueur du segment courant — c'est la
 *  "commodité de saisie" documentée sur `angle` ci-dessus, jusqu'ici jamais
 *  câblée : le slider "Angle" du panneau Masque modifiait `params.angle`
 *  sans que rien ne reconvertisse ça vers les points lus par le shader,
 *  donc bougeait le slider sans aucun effet visuel. Longueur par défaut
 *  0.4 (== écart par défaut startX/endX) si le segment courant est nul. */
export function angleToEndpoints(
  params: { startX: number; startY: number; endX: number; endY: number },
  angleDeg: number,
): { startX: number; startY: number; endX: number; endY: number } {
  const centerX = (params.startX + params.endX) / 2;
  const centerY = (params.startY + params.endY) / 2;
  const length = Math.hypot(params.endX - params.startX, params.endY - params.startY) || 0.4;
  const rad = (angleDeg * Math.PI) / 180;
  const halfX = (length / 2) * Math.cos(rad);
  const halfY = (length / 2) * Math.sin(rad);
  return {
    startX: centerX - halfX,
    startY: centerY - halfY,
    endX: centerX + halfX,
    endY: centerY + halfY,
  };
}

export const gradientSource: MaskSourceModule = {
  id: "gradient",
  name: "Dégradé",
  defaultParams: { angle: 0, startX: 0.3, startY: 0.5, endX: 0.7, endY: 0.5, feather: 0.1, invert: 0 },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 {
  let start = vec2<f32>(params[0], params[1]);
  let end = vec2<f32>(params[2], params[3]);
  let feather = max(params[4], 0.0001);
  let invert = params[5];
  let axis = end - start;
  let len2 = max(dot(axis, axis), 0.0001);
  let t = dot(uv - start, axis) / len2;
  let eased = smoothstep(0.0 - feather, 1.0 + feather, clamp(t, -feather, 1.0 + feather));
  let value = clamp(eased, 0.0, 1.0);
  return select(value, 1.0 - value, invert > 0.5);
}
`,
};
