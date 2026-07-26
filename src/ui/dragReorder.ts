import { useCallback, useRef, useState } from "react";

/**
 * Réordonnancement générique par pointer events, PAS le DnD HTML5 natif —
 * extrait de LayerPanel.tsx (2026-07-21). dragover/drop ne sont JAMAIS
 * relayés par WebView2 au contenu web (preuve CDP sur un geste humain réel,
 * bug d'intégration confirmé, pas une erreur de câblage React) — les pointer
 * events fonctionnent déjà pour le pinceau et le pan/zoom de ce projet.
 */
export type DropPosition = "before" | "after";

export interface DragReorderState {
  draggedId: string;
  pointerId: number;
  /** Décalage curseur -> coin haut-gauche de l'élément déplacé au pointerdown
   *  (pour qu'un fantôme éventuel suive le curseur sans "sauter" au premier
   *  mouvement) — non consommé par LayerPanel (pas de fantôme), consommé par
   *  PanelColumn. */
  grabOffset: { x: number; y: number };
  /** Position courante du curseur (coordonnées écran) — mise à jour à chaque
   *  pointermove, pour un fantôme éventuel. */
  pointerPosition: { x: number; y: number };
  overIndex: number | null;
  overPosition: DropPosition | null;
}

/**
 * Traduit "poser AVANT/APRÈS la ligne `hoverIndex`" (ce que l'utilisateur
 * voit et choisit) en `newIndex` pour un tableau dont la sémantique de
 * réordonnancement est "retire `fromIndex`, puis insère à `newIndex` DANS LE
 * TABLEAU DÉJÀ AMPUTÉ" — pas la même chose qu'un index dans le tableau
 * d'origine. Sans cette traduction, "avant B" peut visuellement finir
 * "après B" selon le sens du geste.
 */
export function computeInsertIndex(fromIndex: number, hoverIndex: number, position: DropPosition): number {
  const hoverIndexAfterRemoval = hoverIndex - (fromIndex < hoverIndex ? 1 : 0);
  return position === "before" ? hoverIndexAfterRemoval : hoverIndexAfterRemoval + 1;
}

/**
 * Déplace l'élément identifié par `id` à la position `newIndex` (sémantique
 * "retire puis insère dans le tableau amputé", cf. computeInsertIndex).
 * Si `id` est introuvable, retourne le tableau d'origine inchangé.
 */
export function reorderById<T>(items: T[], getId: (item: T) => string, id: string, newIndex: number): T[] {
  const fromIndex = items.findIndex((item) => getId(item) === id);
  if (fromIndex === -1) return items;
  const next = items.slice();
  const [moved] = next.splice(fromIndex, 1);
  next.splice(newIndex, 0, moved);
  return next;
}

/**
 * Hook générique de réordonnancement par glisser-déposer (pointer events).
 * `indexAttribute` est le nom de l'attribut `data-*` (sans les crochets)
 * posé sur chaque élément réordonnable, utilisé pour le hit-test manuel via
 * `elementFromPoint` (aucun événement natif de survol/drop n'est exploité).
 */
export function usePointerReorder<T>(
  items: T[],
  getId: (item: T) => string,
  indexAttribute: string,
  onReorder: (id: string, newIndex: number) => void
) {
  const [dragState, setDragStateRaw] = useState<DragReorderState | null>(null);
  // Miroir synchrone de `dragState`, même pattern que `PanelColumn.tsx`
  // (setDragState) : `captureTarget.setPointerCapture` (handlePointerDown)
  // et `onReorder` (handlePointerUp) sont des EFFETS DE BORD — l'un un appel
  // DOM, l'autre un setState d'un composant ANCÊTRE (App, via onReorder).
  // Un updater fonctionnel passé à `setState` peut être réévalué par React
  // PENDANT le rendu du composant propriétaire (ici LayerPanel, via
  // usePointerReorder) pour reconcilier la file d'attente — si l'updater
  // contient un effet de bord, celui-ci s'exécute alors PENDANT ce rendu.
  // Pour `onReorder`, ça déclenche precisément le warning React "Cannot
  // update a component (App) while rendering a different component
  // (LayerPanel)" — confirmé par repro CDP le 2026-07-26 (stack : LayerPanel
  // → usePointerReorder → useState → updateReducerImpl → l'updater lui-même).
  // Fix : lire ce miroir AVANT d'appeler setDragState, jamais depuis
  // l'intérieur d'un updater ; l'updater lui-même reste pur.
  const dragStateRef = useRef<DragReorderState | null>(null);
  const setDragState = useCallback(
    (updater: DragReorderState | null | ((current: DragReorderState | null) => DragReorderState | null)) => {
      setDragStateRaw((current) => {
        const next = typeof updater === "function" ? updater(current) : updater;
        dragStateRef.current = next;
        return next;
      });
    },
    []
  );

  const handlePointerDown = useCallback(
    (id: string, pointerId: number, captureTarget: Element, measureElement: Element, clientX: number, clientY: number) => {
      // Ignore un 2e pointeur tant qu'un drag est déjà en cours — sinon il
      // écraserait dragState et le drag du 1er pointeur serait silencieusement
      // perdu.
      if (dragStateRef.current) return;
      captureTarget.setPointerCapture(pointerId);
      const rect = measureElement.getBoundingClientRect();
      setDragState({
        draggedId: id,
        pointerId,
        grabOffset: { x: clientX - rect.left, y: clientY - rect.top },
        pointerPosition: { x: clientX, y: clientY },
        overIndex: null,
        overPosition: null,
      });
    },
    [setDragState]
  );

  // Continue de recevoir les événements même quand le pointeur sort de son
  // rectangle grâce à setPointerCapture ci-dessus — elementFromPoint fait le
  // hit-test manuel sur l'élément survolé. La moitié haute/basse décide
  // avant/après.
  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      setDragState((prev) => {
        if (!prev || e.pointerId !== prev.pointerId) return prev;
        const el = document.elementFromPoint(e.clientX, e.clientY);
        const rowEl = el?.closest<HTMLElement>(`[${indexAttribute}]`);
        const pointerPosition = { x: e.clientX, y: e.clientY };
        if (!rowEl) {
          return prev.overIndex === null && prev.pointerPosition.x === pointerPosition.x && prev.pointerPosition.y === pointerPosition.y
            ? prev
            : { ...prev, overIndex: null, overPosition: null, pointerPosition };
        }
        const overIndex = Number(rowEl.getAttribute(indexAttribute));
        const rect = rowEl.getBoundingClientRect();
        const overPosition: DropPosition = e.clientY - rect.top < rect.height / 2 ? "before" : "after";
        return { ...prev, overIndex, overPosition, pointerPosition };
      });
    },
    [indexAttribute, setDragState]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent) => {
      // Lu depuis le miroir synchrone, PAS depuis l'intérieur de l'updater
      // setDragState — onReorder doit s'exécuter dans le call stack de
      // l'event handler, jamais dans un updater potentiellement rejoué
      // pendant le rendu de LayerPanel (cf. commentaire sur dragStateRef).
      const prev = dragStateRef.current;
      if (prev && e.pointerId === prev.pointerId && prev.overIndex !== null && prev.overPosition !== null) {
        const fromIndex = items.findIndex((item) => getId(item) === prev.draggedId);
        if (fromIndex !== -1 && fromIndex !== prev.overIndex) {
          const newIndex = computeInsertIndex(fromIndex, prev.overIndex, prev.overPosition);
          // Déposer "avant" son voisin immédiat suivant (ou "après" son
          // voisin immédiat précédent) ne change rien à l'ordre final —
          // computeInsertIndex peut renvoyer fromIndex dans ce cas.
          if (newIndex !== fromIndex) onReorder(prev.draggedId, newIndex);
        }
      }
      setDragState((current) => (current && e.pointerId === current.pointerId ? null : current));
    },
    [items, getId, onReorder, setDragState]
  );

  // pointercancel (perte de capture, interruption tactile...) N'EST PAS un
  // dépôt valide — annule le drag sans réordonner, contrairement à pointerup.
  const handlePointerCancel = useCallback(
    (e: React.PointerEvent) => {
      setDragState((prev) => (prev && e.pointerId === prev.pointerId ? null : prev));
    },
    [setDragState]
  );

  return { dragState, handlePointerDown, handlePointerMove, handlePointerUp, handlePointerCancel };
}
