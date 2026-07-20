/**
 * Magnétisme de FloatingPanel — appliqué UNE fois au relâchement du drag ou
 * du nudge clavier, jamais pendant (design.md §5 : pas de recalcul dynamique
 * si un panneau ancre bouge ensuite).
 *
 * Deux familles de candidats, résolues séparément par axe (x et y) :
 * - bords des autres panneaux visibles (écart PANEL_GAP)
 * - bords du canvas (écart CANVAS_EDGE_MARGIN)
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
// Écart panneau↔bord canvas. Le design.md d'origine visait un flush 0px,
// mais rendu en vrai (retour Antoine, 2026-07-20) ça lit comme cassé — un
// panneau collé au bord de fenêtre sans respiration, contrairement à la
// référence Photoshop qui garde toujours une marge visible. Même valeur que
// PANEL_GAP*2 pour rester dans la même famille d'espacement que
// panneau↔panneau (--space-6 = 16px, cf. src/design/primitives.css).
export const CANVAS_EDGE_MARGIN = 16;
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

function snapAxisToCanvasEdges(draggedStart: number, draggedEnd: number, canvasExtent: number): AxisSnap | null {
  // Seuil mesuré sur la distance bord-à-bord réelle (dragged vs bord du
  // canvas), pas sur la distance à la position finale incluant
  // CANVAS_EDGE_MARGIN — même principe que snapAxisToNeighbors (finding
  // codex-crosscheck déjà appliqué là, cohérence des deux familles).
  let best: AxisSnap | null = null;
  const distanceToStart = Math.abs(draggedStart - 0);
  if (distanceToStart <= SNAP_DISTANCE) best = { value: CANVAS_EDGE_MARGIN, distance: distanceToStart };
  const size = draggedEnd - draggedStart;
  const distanceToEnd = Math.abs(draggedEnd - canvasExtent);
  if (distanceToEnd <= SNAP_DISTANCE && (best === null || distanceToEnd < best.distance)) {
    best = { value: canvasExtent - CANVAS_EDGE_MARGIN - size, distance: distanceToEnd };
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
