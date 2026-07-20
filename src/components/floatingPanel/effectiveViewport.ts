/**
 * Compensation STATIQUE du centrage canvas pour la largeur par défaut du dock
 * virtuel (Calques + Réglages à leur position de départ) — design.md §8.
 * Calculée UNE fois sur cette constante, jamais recalculée sur la position
 * réelle des panneaux si l'utilisateur les déplace ensuite. La valeur reprend
 * `--inspector-width-default` (288px, src/design/components.css) : le dock
 * virtuel occupe visuellement la même largeur que l'ancien Inspector docké.
 */
export const DEFAULT_PANEL_COLUMN_WIDTH = 288;

// Plancher aligné sur --canvas-min-width (src/design/components.css) : la
// compensation ne doit jamais réduire le viewport effectif sous ce minimum,
// même sur la largeur de fenêtre plancher du projet (--window-min-width: 900px).
const CANVAS_MIN_WIDTH = 480;

export function computeEffectiveViewportWidth(windowWidth: number): number {
  return Math.max(windowWidth - DEFAULT_PANEL_COLUMN_WIDTH, CANVAS_MIN_WIDTH);
}
