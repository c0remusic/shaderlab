import { useCallback, useState } from "react";
import type { PresetStore, PresetSummary } from "../presets/presetStore";
import { apply, capture } from "../presets/presetDocument";
import { presetsDiffer } from "../presets/presetsDiffer";
import type { PresetLayer } from "../presets/presetTypes";
import { getEffect } from "../render/effects/registry";
import { freshId } from "../layers/layerStack";
import type { LayerState } from "../layers/types";
import type { EffectParam } from "../render/effects/types";

/** Same 5-field projection as `presetDocument.capture`'s per-layer shape,
 *  WITHOUT allocating a full `PresetDocument` — used only to feed
 *  `presetsDiffer`, never persisted. */
function toPresetLayers(layers: LayerState[]): PresetLayer[] {
  return layers
    .filter((l) => !l.imageSource)
    .map((l) => ({ effectId: l.effectId, params: { ...l.params }, enabled: l.enabled, opacity: l.opacity, blendMode: l.blendMode }));
}

function effectExists(effectId: string): boolean {
  try {
    getEffect(effectId);
    return true;
  } catch {
    return false;
  }
}

function effectParamsFor(effectId: string): EffectParam[] | null {
  try {
    return getEffect(effectId).params;
  } catch {
    return null;
  }
}

export function usePresets(store: PresetStore) {
  const [summaries, setSummaries] = useState<PresetSummary[]>([]);
  const [active, setActive] = useState<{ id: string; snapshot: PresetLayer[] } | null>(null);

  const refresh = useCallback(async () => {
    setSummaries(await store.list());
  }, [store]);

  const isDirtyOf = useCallback(
    (currentLayers: LayerState[]) => (active ? presetsDiffer(toPresetLayers(currentLayers), active.snapshot) : false),
    [active]
  );

  const clearActive = useCallback(() => setActive(null), []);

  /** Captures `layers` under `name` and saves it as a brand-new preset
   *  (crypto.randomUUID()'d id, see presetDocument.capture). Overwrite-by-
   *  name confirmation (C1, design.md §5.3) and the photo-layer-exclusion
   *  confirmation (design doc §9) are both the CALLER's responsibility
   *  (`App.tsx`'s `requestSavePreset`) — this function always creates a
   *  fresh id, it never checks for a name collision itself. */
  const save = useCallback(
    async (layers: LayerState[], name: string) => {
      const { preset } = capture(layers, name);
      await store.save(preset.id, preset);
      await refresh();
    },
    [store, refresh]
  );

  /** Overwrites an EXISTING preset (`id`) with a fresh capture of `layers`,
   *  keeping the same `id`/`createdAt` (only `updatedAt`/`layers`/`name`
   *  change) — the C1 "overwrite an existing name" path. Distinct from
   *  `save` (always a new id) and from `rename` (Task 2's PresetStore method,
   *  changes only the name, never the layer content). */
  const overwrite = useCallback(
    async (id: string, layers: LayerState[], name: string) => {
      const existing = await store.load(id);
      const { preset } = capture(layers, name);
      await store.save(id, { ...preset, id, createdAt: existing.createdAt });
      await refresh();
    },
    [store, refresh]
  );

  /** C2 (PRD.md:64-65): `PresetStore.rename` (Task 2) exists but had no
   *  consumer before this task — wired to `PresetPanel`'s double-click-to-
   *  rename affordance. */
  const rename = useCallback(
    async (id: string, name: string) => {
      await store.rename(id, name);
      await refresh();
    },
    [store, refresh]
  );

  /** Loads preset `id` and rebuilds it into fresh `LayerState[]` (Task 1's
   *  `apply`, sharing `LayerStack`'s `freshId` counter — see the injection
   *  note on that export). The confirmation-on-non-empty-stack gate is the
   *  CALLER's responsibility (`App.tsx`'s `requestApplyPreset`, mirroring
   *  `save`/`overwrite`'s division of labor above): this function always
   *  applies immediately, it never checks whether `currentLayers` is empty
   *  itself — `currentLayers` is accepted only so the signature documents
   *  what the caller is expected to have already checked. A layer whose
   *  effect no longer resolves is dropped with a warning (never a throw
   *  that would abort the rest of the preset); `onWarning` is only called
   *  when there's something to report. */
  const applyTo = useCallback(
    async (
      id: string,
      _currentLayers: LayerState[],
      onApply: (layers: LayerState[]) => void,
      onWarning: (message: string) => void
    ) => {
      const preset = await store.load(id);
      const { layers: newLayers, warnings } = apply(preset, effectExists, effectParamsFor, freshId);
      onApply(newLayers);
      setActive({ id, snapshot: toPresetLayers(newLayers) });
      if (warnings.length > 0) {
        onWarning(warnings.map((w) => w.message).join(" "));
      }
    },
    [store]
  );

  /** Overwrites the currently-active preset with a fresh capture of
   *  `currentLayers`, keeping its existing name — the "Mettre à jour" banner
   *  action. The photo-layer-exclusion gate is the CALLER's responsibility
   *  (`App.tsx`'s `requestUpdateActive`, same division of labor as `save`/
   *  `overwrite` above): this function always writes immediately. */
  const updateActive = useCallback(
    async (currentLayers: LayerState[]) => {
      if (!active) return;
      const existing = await store.load(active.id);
      const { preset } = capture(currentLayers, existing.name);
      const updated = { ...preset, id: active.id, createdAt: existing.createdAt };
      await store.save(active.id, updated);
      setActive({ id: active.id, snapshot: toPresetLayers(currentLayers) });
      await refresh();
    },
    [active, store, refresh]
  );

  /** Captures `currentLayers` under a NEW name/id — the "Créer une copie"
   *  banner action. Same photo-layer-exclusion gating contract as
   *  `updateActive`/`save`. The new copy becomes the active preset. */
  const copyActiveAsNew = useCallback(
    async (currentLayers: LayerState[], name: string) => {
      const { preset } = capture(currentLayers, name);
      await store.save(preset.id, preset);
      setActive({ id: preset.id, snapshot: toPresetLayers(currentLayers) });
      await refresh();
    },
    [store, refresh]
  );

  return {
    summaries,
    refresh,
    save,
    overwrite,
    rename,
    applyTo,
    isDirtyOf,
    activePresetId: active?.id ?? null,
    updateActive,
    copyActiveAsNew,
    clearActive,
  };
}
