import type { CanvasFrameState } from "../layers/canvasFrame";

/**
 * PROJECTION D'UN CADRE DE TOILE VERS LE RENDU — deux fonctions pures, la
 * frontière que le câblage du recadrage (ticket 32, tranche A) rend testable
 * sans GPU.
 *
 * INVARIANT QUI GOUVERNE LES DEUX : le pipeline évalue TOUT en espace
 * d'ORIGINE (masques, dégradés, transforms). Le cadre n'entre QUE dans la
 * présentation et l'export — jamais dans l'évaluation. Ces deux fonctions ne
 * décrivent donc qu'un DÉCOUPAGE de la sortie déjà composée, jamais un
 * changement de repère d'entrée. Évaluer dans l'espace du cadre ferait glisser
 * le dégradé (ticket 28, § « second défaut silencieux »).
 */

/** Sous-rectangle, en pixels entiers, de la texture d'export à relire. */
export interface RegionLecture {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Région de la texture d'export à relire pour un cadre donné.
 *
 * `null` (pas de recadrage) → la toile entière, exactement le comportement
 * d'avant le câblage. La lecture de ce sous-rectangle de la texture d'export
 * PLEINE — qui a été composée en espace d'origine — est ce qui garantit que
 * l'export cadré est le crop octet pour octet de l'export non cadré.
 *
 * ÉCRÊTAGE (et non refus) d'un cadre débordant : `composerCadre` borne déjà le
 * cadre stocké aux dimensions de la toile, donc un cadre hors bornes ne devrait
 * jamais arriver ici. L'intersection avec `[0,W]×[0,H]` est un plancher
 * défensif — de la géométrie, pas un fallback qui masquerait une erreur : sans
 * elle, un `origin + size` débordant ferait échouer `copyTextureToBuffer`.
 * `Math.round` parce qu'une région de lecture est en texels entiers, alors
 * qu'un cadre issu de l'interface peut être fractionnaire.
 */
export function regionDeLecture(
  cadre: CanvasFrameState,
  largeur: number,
  hauteur: number,
): RegionLecture {
  if (!cadre) return { x: 0, y: 0, width: largeur, height: hauteur };
  const x = Math.max(0, Math.min(Math.round(cadre.x), largeur));
  const y = Math.max(0, Math.min(Math.round(cadre.y), hauteur));
  const width = Math.max(0, Math.min(Math.round(cadre.width), largeur - x));
  const height = Math.max(0, Math.min(Math.round(cadre.height), hauteur - y));
  return { x, y, width, height };
}

/** Remappage d'UV : `uvSource = offset + uv * scale`. */
export interface UvRemap {
  offset: [number, number];
  scale: [number, number];
}

/** Identité — un cadre `null` ne déplace ni ne redimensionne l'échantillonnage. */
export const IDENTITY_UV_REMAP: UvRemap = { offset: [0, 0], scale: [1, 1] };

/**
 * Remappage UV de la passe de présentation pour n'afficher que le
 * sous-rectangle du cadre. La cible de présentation reçoit `uv ∈ [0,1]` sur
 * toute sa surface ; ce remappage renvoie vers `[x/W, (x+w)/W] × [y/H,
 * (y+h)/H]` de la texture composée, dont les dimensions sont celles du DOCUMENT
 * (`W`/`H`), pas celles de la cible.
 *
 * `null` → identité, donc rendu inchangé au bit près (c'est ce qui garde les
 * références et le rendu d'écran actuel intacts tant qu'aucun cadre n'est posé).
 * Partage l'écrêtage de `regionDeLecture` pour que l'écran et l'export ne
 * puissent pas cadrer différemment.
 */
export function remapUvPourCadre(
  cadre: CanvasFrameState,
  largeur: number,
  hauteur: number,
): UvRemap {
  if (!cadre) return IDENTITY_UV_REMAP;
  const r = regionDeLecture(cadre, largeur, hauteur);
  return {
    offset: [r.x / largeur, r.y / hauteur],
    scale: [r.width / largeur, r.height / hauteur],
  };
}
