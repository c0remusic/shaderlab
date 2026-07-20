/**
 * Magnétisme de FloatingPanel — appliqué UNE fois au relâchement du drag ou
 * du nudge clavier, jamais pendant (design.md §5 : pas de recalcul dynamique
 * si un panneau ancre bouge ensuite).
 *
 * Le magnétisme fonctionne UNIQUEMENT entre panneaux — jamais contre le bord
 * du canvas/de la fenêtre (retour Antoine, 2026-07-20 : "le magnétisme
 * devrait surtout fonctionner entre modules", corrigé après un premier essai
 * avec accrochage aux bords qui a été jugé indésirable). Un panneau relâché
 * près d'un voisin (dans SNAP_DISTANCE) accroche avec un écart PANEL_GAP ;
 * sinon il reste à la position brute du relâchement — `clampToCanvas`
 * n'est PAS du magnétisme, juste une garde pour ne jamais laisser un
 * panneau partiellement hors-écran.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SnapCandidate {
  id: string;
  rect: Rect;
}

export const PANEL_GAP = 8;
export const SNAP_DISTANCE = 12;

interface AxisSnap {
  value: number;
  distance: number;
}

function snapAxisToNeighbors(
  draggedStart: number,
  draggedEnd: number,
  neighborStarts: number[],
  neighborEnds: number[]
): AxisSnap | null {
  // Parcourt CHAQUE voisin dans l'ordre de `others` (fin puis début du même
  // voisin), pas famille par famille pour tous les voisins — sinon l'ordre de
  // `others` ne décide jamais un cas d'égalité stricte entre deux voisins
  // (repro : deux voisins symétriques, distance identique via des familles
  // différentes -> seul l'ordre par-voisin fait gagner le premier trouvé).
  // Le seuil SNAP_DISTANCE se mesure sur la distance bord-à-bord RÉELLE
  // (dragged vs voisin), jamais sur la distance à la position finale
  // incluant PANEL_GAP — sinon un bord à 20px snappe à tort tandis qu'un
  // bord à 5px est refusé (finding codex-crosscheck).
  let best: AxisSnap | null = null;
  const size = draggedEnd - draggedStart;
  for (let i = 0; i < neighborEnds.length; i++) {
    const endDistance = Math.abs(draggedStart - neighborEnds[i]);
    if (endDistance <= SNAP_DISTANCE && (best === null || endDistance < best.distance)) {
      best = { value: neighborEnds[i] + PANEL_GAP, distance: endDistance };
    }
    const startDistance = Math.abs(draggedEnd - neighborStarts[i]);
    if (startDistance <= SNAP_DISTANCE && (best === null || startDistance < best.distance)) {
      best = { value: neighborStarts[i] - PANEL_GAP - size, distance: startDistance };
    }
  }
  return best;
}

function resolveAxis(
  draggedStart: number,
  draggedSize: number,
  neighborStarts: number[],
  neighborEnds: number[]
): number {
  const draggedEnd = draggedStart + draggedSize;
  const neighborSnap = snapAxisToNeighbors(draggedStart, draggedEnd, neighborStarts, neighborEnds);
  return neighborSnap ? neighborSnap.value : draggedStart;
}

function clampToCanvas(value: number, size: number, canvasExtent: number): number {
  const max = Math.max(0, canvasExtent - size);
  return Math.min(Math.max(value, 0), max);
}

export function computeSnappedPosition(
  dragged: Rect,
  others: SnapCandidate[],
  canvasSize: { width: number; height: number }
): { x: number; y: number } {
  const neighborStartsX = others.map((o) => o.rect.x);
  const neighborEndsX = others.map((o) => o.rect.x + o.rect.width);
  const neighborStartsY = others.map((o) => o.rect.y);
  const neighborEndsY = others.map((o) => o.rect.y + o.rect.height);

  const snappedX = resolveAxis(dragged.x, dragged.width, neighborStartsX, neighborEndsX);
  const snappedY = resolveAxis(dragged.y, dragged.height, neighborStartsY, neighborEndsY);

  return {
    x: clampToCanvas(snappedX, dragged.width, canvasSize.width),
    y: clampToCanvas(snappedY, dragged.height, canvasSize.height),
  };
}
