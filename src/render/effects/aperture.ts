/**
 * DIAPHRAGME — rayon du polygone régulier inscrit dans le disque unité.
 *
 * Extrait de `lensBlur.ts` le 2026-08-03, au moment où un SECOND effet en a eu
 * besoin (`lensFlare`, pour la forme du lobe injecté et donc de ses fantômes).
 * Même raison exactement que l'extraction de `edgeGradient.ts` et de
 * `blurChain.ts` : deux copies auraient dérivé, et l'écart se serait lu comme un
 * choix esthétique alors qu'il n'aurait été qu'un copier-coller qui a vieilli.
 *
 * Ici la conséquence serait pire qu'ailleurs. Le nombre de lames est la
 * SIGNATURE d'un objectif : c'est lui qui décide de la forme du bokeh comme de
 * celle des fantômes de flare, et les deux viennent du même diaphragme
 * physique. Deux effets posés sur la même photo qui rendraient un hexagone d'un
 * côté et un heptagone de l'autre ne seraient pas approximativement justes, ils
 * seraient faux — l'objectif n'a qu'un diaphragme.
 *
 * ⚠️ INSCRIT ET NON CIRCONSCRIT, et c'est le seul endroit où l'erreur passerait
 * pour une intention : un polygone circonscrit rendrait des taches plus GROSSES
 * que le rayon réglé, sans que rien ne le signale. Le rayon vaut donc
 * `cos(pi/n)` au milieu d'une arête et 1 aux sommets.
 *
 * ⚠️ Le jumeau TS et le corps WGSL disent la même chose deux fois, ce qui est
 * assumé (même dispositif que `channelMixSpec` et `inputDriver`) : le premier
 * rend la géométrie testable sans GPU, le second est ce qui tourne. Toute
 * modification se fait des DEUX côtés, et un test les compare.
 */

/** Jumeau TS de `aperture_radius`. Moins de 3 lames n'est pas un polygone :
 *  c'est le diaphragme circulaire, et la fonction rend 1 partout. */
export function apertureRadiusSpec(theta: number, blades: number, rotation: number): number {
  if (blades < 2.5) return 1;
  const seg = (2 * Math.PI) / blades;
  const a = theta + rotation;
  const k = a - seg * Math.floor(a / seg) - seg * 0.5;
  return Math.cos(Math.PI / blades) / Math.cos(k);
}

/**
 * Corps WGSL. Requiert la constante `TAU` — elle est déclarée par les deux
 * appelants et n'est PAS incluse ici : `lensBlur` la partage avec sa spirale
 * d'angle d'or, et la redéclarer dans ce bloc ferait un doublon que le
 * compilateur refuse.
 *
 * Le texte est celui d'origine au caractère près, y compris ses commentaires :
 * `shaderCompose` prend la chaîne WGSL pour clé de cache, et les cinq
 * références de pixels de `lensBlur` devaient rester valables à travers
 * l'extraction. Elles le sont — vérifié, `aucun ecart`.
 */
export const APERTURE_WGSL = `
// Rayon du polygone régulier inscrit dans le disque unité, dans la direction
// \`theta\`. Moins de 3 lames n'est pas un polygone : c'est le diaphragme
// circulaire, et la fonction rend 1 partout.
fn aperture_radius(theta: f32, blades: f32, rotation: f32) -> f32 {
  if (blades < 2.5) {
    return 1.0;
  }
  let seg = TAU / blades;
  let a = theta + rotation;
  // Repli dans un secteur, centré sur le milieu d'arête : le rayon y vaut
  // cos(pi/n) et monte à 1 aux deux sommets qui le bordent.
  let k = a - seg * floor(a / seg) - seg * 0.5;
  return cos(3.141592653589793 / blades) / cos(k);
}
`;
