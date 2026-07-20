/**
 * Positionnement de la listbox portalée de Select.tsx (position: fixed,
 * ancrée sur le rect du trigger). Fonction pure, sans DOM — extraite pour
 * être testable unitairement (finding codex-crosscheck MOYENNE, 2026-07-20 :
 * le retournement bord de viewport + le bornage de hauteur n'avaient aucune
 * couverture de cas limite).
 */
export interface TriggerRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

export interface ListboxPlacement {
  left: number;
  width: number;
  /** Un seul des deux est posé : `top` (ouverture vers le bas, cas par
   *  défaut) ou `bottom` (retourné vers le haut si la place manque en bas
   *  du viewport). */
  top?: number;
  bottom?: number;
  /** Espace réellement disponible du côté choisi, borné à maxHeightCap. */
  maxHeight: number;
}

export function computeListboxPlacement(
  trigger: TriggerRect,
  viewportHeight: number,
  gapPx: number,
  maxHeightCap: number
): ListboxPlacement {
  const spaceBelow = viewportHeight - trigger.bottom;
  const spaceAbove = trigger.top;
  const needsFlip = spaceBelow < maxHeightCap + gapPx && spaceAbove > spaceBelow;
  const availableSpace = (needsFlip ? spaceAbove : spaceBelow) - gapPx;
  const maxHeight = Math.max(0, Math.min(maxHeightCap, availableSpace));

  return needsFlip
    ? { bottom: viewportHeight - trigger.top + gapPx, left: trigger.left, width: trigger.width, maxHeight }
    : { top: trigger.bottom + gapPx, left: trigger.left, width: trigger.width, maxHeight };
}
