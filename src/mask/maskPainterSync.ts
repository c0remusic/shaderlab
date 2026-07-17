import { MaskPainter } from "./maskPainter";

export interface MaskPainterEntry {
  painter: MaskPainter;
  /** The `LayerState.maskData` reference this painter's buffer currently
   *  reflects — `null` means "no mask yet" (a fully-cleared buffer), never
   *  "unknown." Compared by reference, not content: masks are immutable by
   *  convention (updateMask replaces the reference, never mutates in place),
   *  so a reference change always means a real change (e.g. undo/redo). */
  syncedFrom: Uint8Array | null;
}

/**
 * Returns the cached `MaskPainter` for `layerId`, creating one (seeded from
 * `currentMaskData`) if this is the first stroke on this layer, or
 * re-seeding it if `currentMaskData` has changed since the last stroke —
 * e.g. an undo/redo restored a different mask snapshot for this same layer
 * id between strokes. Painting on top of a stale cached buffer would
 * silently overwrite what undo/redo just restored.
 *
 * Extracted from `App.tsx`'s `handleMaskStroke` (audit 2026-07-17, finding
 * 3) so this resync logic has real test coverage instead of living
 * untested inside a component.
 */
export function getSyncedMaskPainter(
  entries: Map<string, MaskPainterEntry>,
  layerId: string,
  currentMaskData: Uint8Array | null,
  imageWidth: number,
  imageHeight: number
): MaskPainterEntry {
  let entry = entries.get(layerId);
  if (!entry) {
    const painter = new MaskPainter(imageWidth, imageHeight);
    if (currentMaskData) painter.loadFrom(currentMaskData);
    entry = { painter, syncedFrom: currentMaskData };
    entries.set(layerId, entry);
    return entry;
  }
  if (entry.syncedFrom !== currentMaskData) {
    if (currentMaskData) entry.painter.loadFrom(currentMaskData);
    else entry.painter.clear(0);
    entry.syncedFrom = currentMaskData;
  }
  return entry;
}
