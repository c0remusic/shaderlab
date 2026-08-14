import type { MaskSourceModule } from "./types";

/**
 * Dégradé LINÉAIRE OU RADIAL (design.md §3, prd.md §Sources) : masque continu
 * qui varie de 0 à 1 entre un point de départ et un point de fin (coordonnées
 * image normalisées [0,1]), avec feather (adoucissement de la transition) et
 * invert. Paramètres sérialisés dans cet ORDRE FIXE (contrat wgsl) :
 * `params[0]=startX, [1]=startY, [2]=endX, [3]=endY, [4]=feather,
 * [5]=invert (0/1), [6]=mode (0 linéaire, 1 radial)`.
 * `angle` fait partie de `defaultParams` pour l'UI (calcul du point de fin
 * par défaut à partir d'un angle) mais N'EST PAS un paramètre wgsl séparé —
 * le dégradé est entièrement décrit par ses deux points, l'angle n'est
 * qu'une commodité de saisie côté UI (Task 5).
 *
 * ⚠️ **`mode` EST LE DERNIER, ET CE N'EST PAS UN DÉTAIL DE STYLE.** Le
 * résolveur sérialise `Object.keys(defaultParams)` DANS L'ORDRE
 * (`maskTextureResolver.ts`, `flatten`) : insérer une clé au milieu décalerait
 * tous les slots suivants d'un cran — le défaut exact qui avait fait recevoir
 * à `feather` la valeur d'`endY`. Ajouté à la fin, un masque enregistré avant
 * le 2026-08-14 (donc sans `mode`) reçoit le défaut 0 et rend le dégradé
 * linéaire d'avant, au bit près.
 *
 * LES DEUX MODES PARTAGENT LEURS DEUX POINTS, ce qui évite d'ajouter un
 * centre et un rayon : en radial, `start` est le CENTRE et `end` un point du
 * BORD. Un même geste décrit donc les deux, et basculer de mode ne perd aucun
 * réglage.
 *
 * Le radial est CIRCULAIRE SUR LA TOILE, pas dans l'espace UV : les distances
 * sont corrigées de l'aspect via `maskDims` — les dimensions du DOCUMENT,
 * fournies par le wrapper du résolveur, et surtout pas celles de `srcColor`
 * (la photo la plus basse de la pile, dont l'aspect diverge dès qu'une toile
 * est créée à un autre format, ADR-0007). Même raison d'être que `uvSpace.ts`
 * côté effets — l'espace UV n'est pas isotrope. Mesuré sur une toile
 * 320 × 192 : l'empreinte du masque fait 132 × 134 px avec la correction et
 * **132 × 80** sans, soit exactement l'aspect de la toile.
 *
 * Promis en vague 1 par `2026-07-18-shaderlab-layers-masking-prd.md:76`
 * (« Dégradé linéaire/radial »), livré à moitié, et le manque n'a été signalé
 * nulle part pendant 27 jours — le PRD s'en servait même comme MOTIF pour
 * différer la sélection géométrique rect/ellipse (« dégradé radial déjà
 * prévu »), un motif qui n'existait donc pas en code.
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
  defaultParams: { angle: 0, startX: 0.3, startY: 0.5, endX: 0.7, endY: 0.5, feather: 0.1, invert: 0, mode: 0 },
  wgsl: `
fn fs_generate(uv: vec2<f32>, colorLinear: vec3<f32>, params: array<f32, 8>) -> f32 {
  let start = vec2<f32>(params[0], params[1]);
  let end = vec2<f32>(params[2], params[3]);
  let feather = max(params[4], 0.0001);
  let invert = params[5];
  // MODE. La projection diffère, tout le reste — adoucissement, bornage,
  // inversion — est commun : c'est la seule chose que le radial change.
  var t = 0.0;
  if (params[6] > 0.5) {
    // RADIAL. \`start\` est le centre, \`end\` un point du bord : aucun paramètre
    // en plus, et basculer de mode ne perd aucun réglage.
    //
    // Distances corrigées de l'ASPECT, sinon un masque rond sortirait en
    // ellipse sur toute toile qui n'est pas carrée. Les dimensions viennent de
    // \`maskDims\` (le wrapper du résolveur), c'est-à-dire du DOCUMENT — et
    // surtout pas de \`textureDimensions(srcColor)\`, qui est la photo la plus
    // basse de la pile : les deux coïncident souvent et divergent dès qu'une
    // toile est créée à un autre format (ADR-0007), ce qui aurait donné un
    // masque juste à l'essai et faux à l'usage.
    let ar = vec2<f32>(max(maskDims.x, 1.0) / max(maskDims.y, 1.0), 1.0);
    let rayon = max(length((end - start) * ar), 0.0001);
    t = length((uv - start) * ar) / rayon;
  } else {
    let axis = end - start;
    let len2 = max(dot(axis, axis), 0.0001);
    t = dot(uv - start, axis) / len2;
  }
  let eased = smoothstep(0.0 - feather, 1.0 + feather, clamp(t, -feather, 1.0 + feather));
  let value = clamp(eased, 0.0, 1.0);
  return select(value, 1.0 - value, invert > 0.5);
}
`,
};
