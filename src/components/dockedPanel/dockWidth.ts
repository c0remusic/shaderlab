/**
 * Bornes de largeur du dock — mêmes valeurs que les tokens
 * `--inspector-width-min`/`--inspector-width-max` (src/design/components.css),
 * dupliquées ici en constantes JS pour le clamp du drag (même pattern que
 * les constantes déjà utilisées ailleurs dans le projet).
 */
export const DOCK_WIDTH_MIN = 240;
export const DOCK_WIDTH_MAX = 400;

export function clampDockWidth(width: number): number {
  return Math.min(DOCK_WIDTH_MAX, Math.max(DOCK_WIDTH_MIN, width));
}
