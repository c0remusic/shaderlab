/**
 * Convention d'espace UV des effets GÉOMÉTRIQUES (ceux qui déplacent leur
 * point d'échantillonnage : chromaticBleed, warp). Deux problèmes, un seul
 * endroit où ils sont résolus :
 *
 * 1. **Isotropie.** Un décalage exprimé en UV est ANISOTROPE dès que l'image
 *    n'est pas carrée : le même 0.01 vaut 0.01*W pixels en X et 0.01*H pixels
 *    en Y. Sur une photo 3:2 l'aberration était ~1.5x plus forte à
 *    l'horizontale. `aspectScale` donne le facteur par lequel diviser un
 *    décalage nominal pour que le déplacement PIXEL soit le même sur les deux
 *    axes. Normalisation par la moyenne géométrique sqrt(W*H) (et non par W ou
 *    par H) : le facteur vaut exactement (1,1) sur image carrée — aucun
 *    changement de rendu sur ce cas — et conserve l'ordre de grandeur global de
 *    l'effet sur une image allongée, au lieu de l'amplifier ou de l'écraser.
 *
 * 2. **Bord.** Ces effets échantillonnent hors du cadre près des bords. Le
 *    sampler partagé du `Renderer` est en `clamp-to-edge` (et doit le rester :
 *    les passes photo/masque/SAT/bloom en dépendent — voir le commentaire de
 *    `renderer.ts`), ce qui étire le pixel de bord en traînée. `mirrorUv` replie
 *    la coordonnée dans [0,1] par réflexion : le tap hors cadre retombe sur du
 *    contenu plausible et continu au bord, au lieu d'un texel répété.
 *
 * `UV_SPACE_WGSL` est la seule définition GPU ; les fonctions TS en-dessous en
 * sont la spécification pure, testée en Node (`test/render/effects/uvSpace.test.ts`).
 * Toute modification de la formule doit être faite des DEUX côtés.
 */

/** Facteur d'anisotropie de l'image : (W,H) normalisé par sqrt(W*H).
 *  Vaut {x:1,y:1} sur une image carrée. */
export function aspectScale(width: number, height: number): { x: number; y: number } {
  if (!(width > 0) || !(height > 0)) {
    throw new Error(`aspectScale: dimensions invalides (${width}x${height}) — attendu > 0.`);
  }
  const ref = Math.sqrt(width * height);
  return { x: width / ref, y: height / ref };
}

/** Décalage UV à appliquer pour obtenir un déplacement PIXEL isotrope à partir
 *  d'un décalage nominal (exprimé dans l'espace corrigé de l'aspect). */
export function isotropicUvOffset(
  nominal: { x: number; y: number },
  width: number,
  height: number,
): { x: number; y: number } {
  const ar = aspectScale(width, height);
  return { x: nominal.x / ar.x, y: nominal.y / ar.y };
}

/** Réflexion d'une coordonnée hors [0,1] dans [0,1] (onde triangulaire de
 *  période 2), miroir TS de `mirrorUv` en WGSL. */
export function mirrorCoord(v: number): number {
  const f = (Math.abs(v) * 0.5 - Math.floor(Math.abs(v) * 0.5)) * 2;
  return f > 1 ? 2 - f : f;
}

export const UV_SPACE_WGSL = `
fn aspectScale(dims: vec2<f32>) -> vec2<f32> {
  return dims / sqrt(dims.x * dims.y);
}

fn mirrorUv(uv: vec2<f32>) -> vec2<f32> {
  let f = fract(abs(uv) * 0.5) * 2.0;
  return select(f, vec2<f32>(2.0) - f, f > vec2<f32>(1.0));
}
`;
