/**
 * Seuil de déclenchement du glisser-déposer des cartes du dock.
 *
 * Pourquoi un seuil : jusqu'ici `handlePointerDown` construisait le
 * `DockDragState` complet dès l'appui (`PanelColumn.tsx`), donc un simple clic
 * sur la barre de titre entrait déjà en glissement — fantôme affiché, guide
 * d'insertion calculé — avant même que la souris ait bougé. Un déplacement
 * accidentel d'un pixel pendant un clic suffisait à réordonner le dock.
 *
 * 4 px est la distance conventionnelle : assez pour absorber le tremblement
 * d'un clic, assez peu pour qu'un glissement intentionnel démarre sans latence
 * perceptible.
 */
export const DRAG_THRESHOLD_PX = 4;

export interface DragPoint {
  x: number;
  y: number;
}

/**
 * Vrai dès que le pointeur s'est éloigné de son origine d'au moins `threshold`
 * pixels, DISTANCE EUCLIDIENNE comprise — pas par axe. Un déplacement de 3 px
 * en X et 3 px en Y ne franchit aucun axe pris seul mais parcourt 4,24 px :
 * c'est un glissement, et le mesurer axe par axe le raterait.
 *
 * Comparaison `>=` : à la distance exacte du seuil, le glissement démarre.
 */
export function hasExceededDragThreshold(
  origin: DragPoint,
  point: DragPoint,
  threshold: number = DRAG_THRESHOLD_PX,
): boolean {
  return Math.hypot(point.x - origin.x, point.y - origin.y) >= threshold;
}
