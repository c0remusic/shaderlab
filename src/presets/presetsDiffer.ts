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
