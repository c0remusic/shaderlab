/**
 * Compensation STATIQUE du centrage canvas pour la largeur par défaut du dock
 * virtuel (Calques + Réglages à leur position de départ) — design.md §8.
 * Calculée UNE fois sur cette constante, jamais recalculée sur la position
 * réelle des panneaux si l'utilisateur les déplace ensuite. La valeur reprend
 * `--inspector-width-default` (288px, src/design/components.css) : le dock
 * virtuel occupe visuellement la même largeur que l'ancien Inspector docké.
 */
export const DEFAULT_PANEL_COLUMN_WIDTH = 288;

/**
 * Hauteur d'un FloatingPanel replié — reprend `--section-header-height`
 * (28px, src/design/components.css), seule hauteur visible restante étant la
 * barre de titre. Exportée ici (pas seulement en constante locale App.tsx)
 * pour éviter une deuxième valeur en dur qui pourrait diverger du token
 * (finding auditor MOYENNE, 2026-07-20).
 */
export const COLLAPSED_PANEL_HEIGHT = 28;

/**
 * Marge de départ entre Calques (sans voisin, jamais snappé — le magnétisme
 * n'existe qu'entre panneaux, cf. snapping.ts) et le bord droit du canvas.
 * Même famille que --space-6 (16px, src/design/primitives.css). Exportée
 * ici (pas une constante locale App.tsx) pour la même raison que
 * COLLAPSED_PANEL_HEIGHT ci-dessus — une seule source, pas une valeur en
 * dur dupliquée (finding codex-crosscheck MOYENNE, 2026-07-20).
 */
export const PANEL_START_MARGIN = 16;

// Plancher aligné sur --canvas-min-width (src/design/components.css) : la
// compensation ne doit jamais réduire le viewport effectif sous ce minimum,
// même sur la largeur de fenêtre plancher du projet (--window-min-width: 900px).
const CANVAS_MIN_WIDTH = 480;

export function computeEffectiveViewportWidth(windowWidth: number): number {
  return Math.max(windowWidth - DEFAULT_PANEL_COLUMN_WIDTH, CANVAS_MIN_WIDTH);
}
