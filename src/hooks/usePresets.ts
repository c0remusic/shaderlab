import { useCallback, useState } from "react";
import type { PresetStore, PresetSummary } from "../presets/presetStore";
import { capture } from "../presets/presetDocument";
import type { LayerState } from "../layers/types";

export function usePresets(store: PresetStore) {
  const [summaries, setSummaries] = useState<PresetSummary[]>([]);

  const refresh = useCallback(async () => {
    setSummaries(await store.list());
  }, [store]);

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

  return { summaries, refresh, save, overwrite, rename };
}
