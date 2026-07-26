import type { PresetLayer } from "./presetTypes";

function paramsDiffer(a: Record<string, number>, b: Record<string, number>): boolean {
  const aKeys = Object.keys(a);
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return true;
  return aKeys.some((key) => a[key] !== b[key]);
}

/** True iff the two PresetLayer arrays differ in any field that would
 *  change what a re-`capture()` of the current stack would produce —
 *  effectId, params, enabled, opacity, blendMode, IN ORDER (design.md §5.4:
 *  reordering a layer counts as a change). Used to detect whether the
 *  currently-selected preset's snapshot still matches the live stack. */
export function presetsDiffer(a: PresetLayer[], b: PresetLayer[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((layerA, i) => {
    const layerB = b[i];
    return (
      layerA.effectId !== layerB.effectId ||
      layerA.enabled !== layerB.enabled ||
      layerA.opacity !== layerB.opacity ||
      layerA.blendMode !== layerB.blendMode ||
      paramsDiffer(layerA.params, layerB.params)
    );
  });
}

/** Coarser than `presetsDiffer` above: true only if the layer COUNT or the
 *  effectId SEQUENCE differs, ignoring params/enabled/opacity/blendMode.
 *  Used by `usePresets.reconcileActiveAfterHistoryChange` (final-review fix,
 *  Critique 1) to decide whether an undo/redo should sever the link to the
 *  active preset. A plain param-value undo (same layers, same effects, in
 *  the same order) must NOT clear the active preset — that's what makes the
 *  dirty banner correctly disappear when undoing a live edit back to the
 *  preset's own state. Only a STRUCTURAL change — most importantly, undoing
 *  the preset APPLICATION itself, which can restore an empty or
 *  differently-shaped stack — should sever the link, so a stale
 *  `activePresetId` can never be used to overwrite a preset file with an
 *  undone (possibly empty) stack. */
export function presetStructureDiffers(a: PresetLayer[], b: PresetLayer[]): boolean {
  if (a.length !== b.length) return true;
  return a.some((layerA, i) => layerA.effectId !== b[i].effectId);
}
