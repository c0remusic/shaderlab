/**
 * Magnétisme de FloatingPanel — appliqué UNE fois au relâchement du drag ou
 * du nudge clavier, jamais pendant (design.md §5 : pas de recalcul dynamique
 * si un panneau ancre bouge ensuite).
 *
 * Deux familles de candidats, résolues séparément par axe (x et y) :
 * - bords des autres panneaux visibles (écart PANEL_GAP, jamais 0)
 * - bords du canvas (flush, 0px)
 * Le candidat retenu par axe est celui de distance minimale sous SNAP_DISTANCE ;
 * égalité exacte -> le premier trouvé dans l'ordre de `others` (déterministe).
 * Enfin, le résultat est contraint aux limites du canvas (jamais hors-écran).
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
  let best: AxisSnap | null = null;
  const size = draggedEnd - draggedStart;
  for (let i = 0; i < neighborEnds.length; i++) {
    const endCandidate = neighborEnds[i] + PANEL_GAP;
    const endDistance = Math.abs(draggedStart - endCandidate);
    if (endDistance <= SNAP_DISTANCE && (best === null || endDistance < best.distance)) {
      best = { value: endCandidate, distance: endDistance };
    }
    const startCandidate = neighborStarts[i] - PANEL_GAP - size;
    const startDistance = Math.abs(draggedStart - startCandidate);
    if (startDistance <= SNAP_DISTANCE && (best === null || startDistance < best.distance)) {
      best = { value: startCandidate, distance: startDistance };
    }
  }
  return best;
}

function snapAxisToCanvasEdges(draggedStart: number, draggedEnd: number, canvasExtent: number): AxisSnap | null {
  let best: AxisSnap | null = null;
  const distanceToStart = Math.abs(draggedStart - 0);
  if (distanceToStart <= SNAP_DISTANCE) best = { value: 0, distance: distanceToStart };
  const flushEndValue = canvasExtent - (draggedEnd - draggedStart);
  const distanceToEnd = Math.abs(draggedStart - flushEndValue);
  if (distanceToEnd <= SNAP_DISTANCE && (best === null || distanceToEnd < best.distance)) {
    best = { value: flushEndValue, distance: distanceToEnd };
  }
  return best;
}

function resolveAxis(
  draggedStart: number,
  draggedSize: number,
  neighborStarts: number[],
  neighborEnds: number[],
  canvasExtent: number
): number {
  const draggedEnd = draggedStart + draggedSize;
  const neighborSnap = snapAxisToNeighbors(draggedStart, draggedEnd, neighborStarts, neighborEnds);
  const edgeSnap = snapAxisToCanvasEdges(draggedStart, draggedEnd, canvasExtent);
  if (neighborSnap && edgeSnap) {
    return neighborSnap.distance <= edgeSnap.distance ? neighborSnap.value : edgeSnap.value;
  }
  if (neighborSnap) return neighborSnap.value;
  if (edgeSnap) return edgeSnap.value;
  return draggedStart;
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

  const snappedX = resolveAxis(dragged.x, dragged.width, neighborStartsX, neighborEndsX, canvasSize.width);
  const snappedY = resolveAxis(dragged.y, dragged.height, neighborStartsY, neighborEndsY, canvasSize.height);

  return {
    x: clampToCanvas(snappedX, dragged.width, canvasSize.width),
    y: clampToCanvas(snappedY, dragged.height, canvasSize.height),
  };
}
