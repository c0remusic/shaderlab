# Presets — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a "Presets" docked panel (first in the column, before Calques/Réglages/Masque) that captures the active layer stack (effect/params/enabled/opacity/blendMode, no masks) into a named JSON file, applies a saved preset back onto the current document (with a hard confirmation when the stack isn't empty), lets the user rename/overwrite/update/copy/export/import presets, and degrades gracefully when a preset references an effect no longer in the registry.

**Architecture:** Pure data-model layer (`src/presets/presetTypes.ts` + `presetDocument.ts`, zero IO/React/GPU) → storage port + Tauri/in-memory adapters (`src/presets/presetStore.ts`) backed by 8 new Rust commands (`src-tauri/src/lib.rs`) → a feature-owned hook `usePresets` (`src/hooks/usePresets.ts`) that `App.tsx` wires into a 4th `useContextualPanel(true, "static")` slot, ahead of `"layers"` in both the `panels` array and `dockLayout`. Confirmations reuse the existing, currently-unconsumed `src/ui/Dialog.tsx`. No new component invents its own modal/confirmation primitive.

**Tech Stack:** React 19 + TypeScript, Vitest (Node environment — no test renders a React component, this project's fixed convention), Tauri v2 commands (`rfd` for native dialogs, never `@tauri-apps/plugin-dialog`). (`serde_json` is already a `src-tauri/Cargo.toml:16` dependency, but no Rust command in this plan calls it — every preset command moves a raw `String` and lets TS own `JSON.stringify`/`JSON.parse`; not listed here as it stays unused by this plan's code.)

## Global Constraints

- No test in this repo renders a React component (Node-environment Vitest only). `PresetPanel`, the confirmation wiring, and the "update/copy" banner are verified visually via CDP + human checkpoint (`CLAUDE.md` § Moyen de preuve), never via `@testing-library/react` (not a project dependency).
- `src/components/dockedPanel/PanelColumn.tsx`, `DockedPanelCard.tsx`, `src/ui/dockLayout.ts`, `src/components/dockedPanel/dockWidth.ts` are **not modified** by this plan.
- `@tauri-apps/plugin-dialog` stays banned (known IPC hang, `CLAUDE.md` § bug `@tauri-apps/plugin-dialog`). Every native dialog in this plan is a new Rust command wrapping `rfd`, on the same pattern as `pick_image_file`/`pick_export_folder` (`src-tauri/src/lib.rs:114-120,158-163`).
- Token discipline: no hardcoded color/spacing/z-index literal that duplicates an existing token in `src/design/{primitives,semantic,components}.css`. `npm run lint:tokens` must stay clean (the 2 pre-existing findings in `EmptyWorkspace.stories.tsx` are unrelated and not to be touched).
- Commits use an explicit pathspec (`git commit -m "msg" -- <files>`), never a bare `git commit`.
- `PresetLayer`/`PresetDocument`/`SkipNotice`/`ApplyWarning` shapes are locked by `docs/superpowers/specs/2026-07-26-shaderlab-presets-design.md` §3.2 — copy them verbatim, do not rename a field.
- `src/ui/Dialog.tsx`'s `DialogProps` (`open`, `title`, `description?`, `children`, `actions?`, `onClose`, `closeLabel?`) is the ONLY confirmation primitive used in this plan. Every destructive/data-loss confirmation (T4's stack replacement, T3's photo-layer-exclusion-at-capture) puts `autoFocus` on its Cancel/Annuler button inside `actions` — per the component's own doc comment (`Dialog.tsx:25-30`), omitting this sends focus to the close (X) button instead, on a destructive action that must default to the safe choice. `children` is currently NON-optional in `DialogProps` (`Dialog.tsx:9`) — T3 Step 0 makes it `children?: ReactNode` so a self-closing `<Dialog ... />` (T3/T4's confirmations, which pass no children) type-checks.
- **The capture path has exactly one door.** `App.tsx`'s `gateOnPhotoLayers` (T3) is the ONLY function allowed to call `presets.save`/`presets.overwrite`/`presets.updateActive`/`presets.copyActiveAsNew` — it is what runs `capture()` up front, detects an excluded photo layer, and blocks on the confirmation `Dialog` before any write. `requestSavePreset`/`requestUpdateActive`/`requestCopyActiveAsNew` (T3/T5) are the caller-facing entry points that all funnel through it. Never wire `PresetPanel`'s `onSave` (or the "Mettre à jour"/"Créer une copie" banner buttons) directly to a `usePresets` write method; always route through the gating functions in `App.tsx`, or the photo-layer-exclusion confirmation silently stops firing. `presets.rename` is the one write method exempt from this door — renaming never touches `layers`/photo-layer content, only the `name` field, so it has no exclusion to gate on.
- **Decided by Antoine 2026-07-26** (design doc §9, no longer open): (a) capturing a preset that excludes a photo layer (double exposure) is a BLOCKING confirmation via the same `Dialog`, enumerating the excluded layers by position (not just a count), shown BEFORE the file is written — Cancel writes nothing (T3). (b) an import that collides on `name` with an existing preset is neither silent nor blocked: the incoming preset is renamed `"<name> (copie)"`, then `"<name> (copie 2)"`, `"(copie 3)"`, ... — the first free suffix — via a pure, unit-tested naming function (T6).
- **`delete_preset` (T2)/`PresetStore.remove` are infrastructure with no UI consumer in this plan — intentionally, not an oversight.** `PRD.md:55-89` (verified against the Self-review's coverage list) never asks for a "delete a preset" affordance; `remove`/`delete_preset` exist because the `PresetStore` port needed a complete CRUD surface for its own internal consistency (and `InMemoryPresetStore.remove` is exercised by Task 2's tests), but no task in this plan wires a delete button into `PresetPanel`. If a future plan adds one, it reuses `PresetStore.remove`/`delete_preset` as-is (and would add a `remove` action to `usePresets`, mirroring `save`/`rename` — not present in this plan's hook) — no new Rust command needed.
- `src/layers/layerStack.ts`'s `freshId()` (line 6-10) is currently module-private (not exported) — Task 1 exports it so `presetDocument.apply()`'s injected `freshId` parameter shares the exact same counter as `LayerStack.addLayer`/`addPhotoLayer`, avoiding any risk of two id-generation sequences colliding after a preset is applied. This is a real, verified gap in the design doc (§3.4 assumes reuse without checking the export existed) — see the note in Task 1.
- Every new Rust command is added to the single `tauri::generate_handler![...]` call (`src-tauri/src/lib.rs:209-219`) in the same commit as the command itself — a command defined but not registered compiles fine and fails silently at invoke time, which is exactly the kind of failure this project's error-handling discipline forbids.

---

### Task 1: Preset pure data model (`presetTypes.ts` + `presetDocument.ts`)

**Files:**
- Create: `src/presets/presetTypes.ts`
- Create: `src/presets/presetDocument.ts`
- Test: `test/presets/presetDocument.test.ts`
- Modify: `src/layers/layerStack.ts` (export `freshId`)

**Interfaces:**
- Consumes: `LayerState` (`src/layers/types.ts:21-41`), `EffectParam` (`src/render/effects/types.ts:1-15`), `getEffect` (`src/render/effects/registry.ts:19-24`, throws `Error("Effet inconnu: " + id)` on an unknown id), `freshId` (`src/layers/layerStack.ts`, exported by this task).
- Produces (consumed by Task 2's `presetStore.ts`, Task 3's `usePresets.save`, Task 4's `usePresets.applyTo`, Task 5's `presetsDiffer`, Task 6's import validation):
  ```ts
  export const PRESET_SCHEMA_VERSION = 1;
  export interface PresetLayer { effectId: string; params: Record<string, number>; enabled: boolean; opacity: number; blendMode: string; }
  export interface PresetDocument { schemaVersion: number; id: string; name: string; createdAt: string; updatedAt: string; layers: PresetLayer[]; }
  // `SkipNotice.layerIndex` names WHICH excluded layer this notice is about (its
  // index in the ORIGINAL `layers` array passed to `capture`, not in the
  // resulting `PresetDocument.layers`, which no longer contains it). Needed so
  // T3's confirmation Dialog can enumerate the excluded layers by name/position
  // instead of only reporting a count (Antoine's decision requires "énumérant
  // les calques exclus", not a bare number — see I2 in the review that produced
  // this revision).
  export interface SkipNotice { reason: "missing-effect" | "photo-layer"; effectId?: string; layerIndex: number; }
  export interface ApplyWarning { message: string; }
  export function capture(layers: LayerState[], name: string): { preset: PresetDocument; skipped: SkipNotice[] };
  export function apply(preset: PresetDocument, effectExists: (effectId: string) => boolean, effectParams: (effectId: string) => EffectParam[] | null, freshId: () => string): { layers: LayerState[]; warnings: ApplyWarning[] };
  export function migratePresetDocument(doc: PresetDocument): PresetDocument;
  ```

- [ ] **Step 1: Export `freshId` from `layerStack.ts`**

Change line 6-10 of `src/layers/layerStack.ts` from:

```ts
let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}
```

to:

```ts
let nextId = 0;
/** Exported so `presetDocument.apply()` (src/presets/) can inject the SAME
 *  counter instead of running a second, independently-seeded id sequence —
 *  two separate generators could otherwise both produce "layer-3" and
 *  silently collide once a preset-applied layer and a manually-added layer
 *  coexist in the same document. */
export function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}
```

No other line in the file changes — `LayerStack.addLayer`/`addPhotoLayer` keep calling the bare `freshId()` name, now just exported alongside.

- [ ] **Step 2: Write the failing tests**

```ts
// test/presets/presetDocument.test.ts
import { describe, expect, it } from "vitest";
import { capture, apply, migratePresetDocument, PRESET_SCHEMA_VERSION } from "../../src/presets/presetDocument";
import type { PresetDocument } from "../../src/presets/presetTypes";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";
import type { EffectParam } from "../../src/render/effects/types";

function layer(overrides: Partial<LayerState> = {}): LayerState {
  return {
    id: "layer-1",
    effectId: "glow",
    params: { intensity: 0.5 },
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

const GLOW_PARAMS: EffectParam[] = [
  { name: "intensity", label: "Intensité", min: 0, max: 1, default: 0.3, step: 0.01 },
];

function effectExists(id: string): boolean {
  return id === "glow";
}

function effectParams(id: string): EffectParam[] | null {
  return id === "glow" ? GLOW_PARAMS : null;
}

describe("capture", () => {
  it("captures effectId/params/enabled/opacity/blendMode, in stack order, without id/mask", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "glow", opacity: 0.8 }),
      layer({ id: "layer-2", effectId: "grain", params: { amount: 0.2 }, blendMode: "screen" }),
    ];
    const { preset, skipped } = capture(layers, "Mon preset");
    expect(skipped).toEqual([]);
    expect(preset.name).toBe("Mon preset");
    expect(preset.schemaVersion).toBe(PRESET_SCHEMA_VERSION);
    expect(preset.layers).toEqual([
      { effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 0.8, blendMode: "normal" },
      { effectId: "grain", params: { amount: 0.2 }, enabled: true, opacity: 1, blendMode: "screen" },
    ]);
    expect(preset.id).not.toBe("");
    expect(preset.createdAt).toBe(preset.updatedAt);
  });

  it("excludes a photo layer (imageSource present) and reports a photo-layer SkipNotice", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "passthrough", imageSource: { sourceId: "src-1" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
      layer({ id: "layer-2", effectId: "glow" }),
    ];
    const { preset, skipped } = capture(layers, "Avec photo");
    expect(preset.layers).toHaveLength(1);
    expect(preset.layers[0].effectId).toBe("glow");
    expect(skipped).toEqual([{ reason: "photo-layer", layerIndex: 0 }]);
  });

  it("reports each excluded layer's index in `layers`, in original order (not the compacted output index)", () => {
    const layers = [
      layer({ id: "layer-1", effectId: "glow" }),
      layer({ id: "layer-2", effectId: "passthrough", imageSource: { sourceId: "src-1" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
      layer({ id: "layer-3", effectId: "grain" }),
      layer({ id: "layer-4", effectId: "passthrough", imageSource: { sourceId: "src-2" }, transform: { x: 0, y: 0, scale: 1, rotation: 0 } }),
    ];
    const { skipped } = capture(layers, "Deux photos");
    expect(skipped).toEqual([
      { reason: "photo-layer", layerIndex: 1 },
      { reason: "photo-layer", layerIndex: 3 },
    ]);
  });
});

describe("apply", () => {
  const basePreset: PresetDocument = {
    schemaVersion: PRESET_SCHEMA_VERSION,
    id: "preset-1",
    name: "Test",
    createdAt: "2026-07-26T00:00:00.000Z",
    updatedAt: "2026-07-26T00:00:00.000Z",
    layers: [{ effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal" }],
  };

  it("rebuilds LayerState with a fresh id, default mask, no imageSource/transform", () => {
    let counter = 0;
    const { layers, warnings } = apply(basePreset, effectExists, effectParams, () => `fresh-${++counter}`);
    expect(warnings).toEqual([]);
    expect(layers).toEqual([
      { id: "fresh-1", effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() },
    ]);
  });

  it("clamps a param outside the registry's current min/max bounds", () => {
    const preset: PresetDocument = { ...basePreset, layers: [{ ...basePreset.layers[0], params: { intensity: 5 } }] };
    const { layers } = apply(preset, effectExists, effectParams, () => "fresh-1");
    expect(layers[0].params.intensity).toBe(1); // clamped to GLOW_PARAMS max
  });

  it("skips a layer whose effect no longer exists and pushes an ApplyWarning, without throwing", () => {
    const preset: PresetDocument = { ...basePreset, layers: [...basePreset.layers, { effectId: "vanished-effect", params: {}, enabled: true, opacity: 1, blendMode: "normal" }] };
    const { layers, warnings } = apply(preset, effectExists, effectParams, () => "fresh-1");
    expect(layers).toHaveLength(1); // only the glow layer survives
    expect(warnings).toHaveLength(1);
    expect(warnings[0].message).toMatch(/vanished-effect/);
  });

  it("refuses a schemaVersion newer than PRESET_SCHEMA_VERSION", () => {
    const future: PresetDocument = { ...basePreset, schemaVersion: PRESET_SCHEMA_VERSION + 1 };
    expect(() => apply(future, effectExists, effectParams, () => "fresh-1")).toThrow(/schemaVersion/);
  });
});

describe("migratePresetDocument", () => {
  it("is a no-op on the current (only) schema version", () => {
    const doc: PresetDocument = {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: "p1",
      name: "n",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      layers: [],
    };
    expect(migratePresetDocument(doc)).toEqual(doc);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test -- test/presets/presetDocument.test.ts`
Expected: FAIL — `Cannot find module '../../src/presets/presetDocument'`.

- [ ] **Step 4: Implement `src/presets/presetTypes.ts`**

```ts
// src/presets/presetTypes.ts
export const PRESET_SCHEMA_VERSION = 1;

/** Sous-ensemble sérialisable de LayerState — délibérément SANS id/mask/
 *  imageSource/transform (design.md §3.1). */
export interface PresetLayer {
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  opacity: number;
  blendMode: string;
}

export interface PresetDocument {
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  layers: PresetLayer[];
}

export interface SkipNotice {
  reason: "missing-effect" | "photo-layer";
  effectId?: string;
}

export interface ApplyWarning {
  message: string;
}
```

- [ ] **Step 5: Implement `src/presets/presetDocument.ts`**

```ts
// src/presets/presetDocument.ts
import type { LayerState } from "../layers/types";
import { defaultLayerMask } from "../mask/types";
import type { EffectParam } from "../render/effects/types";
import { PRESET_SCHEMA_VERSION, type PresetDocument, type PresetLayer, type SkipNotice, type ApplyWarning } from "./presetTypes";

/** Captures the current layer stack into a PresetDocument, in stack order.
 *  A photo layer (imageSource present, double exposure) is excluded and
 *  reported via SkipNotice — a preset never captures a source-specific
 *  photo reference (design.md §3.1). */
export function capture(layers: LayerState[], name: string): { preset: PresetDocument; skipped: SkipNotice[] } {
  const skipped: SkipNotice[] = [];
  const presetLayers: PresetLayer[] = [];

  layers.forEach((layer, layerIndex) => {
    if (layer.imageSource) {
      skipped.push({ reason: "photo-layer", layerIndex });
      return;
    }
    presetLayers.push({
      effectId: layer.effectId,
      params: { ...layer.params },
      enabled: layer.enabled,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
    });
  });

  const now = new Date().toISOString();
  return {
    preset: {
      schemaVersion: PRESET_SCHEMA_VERSION,
      id: crypto.randomUUID(),
      name,
      createdAt: now,
      updatedAt: now,
      layers: presetLayers,
    },
    skipped,
  };
}

function clampParam(value: number, param: EffectParam): number {
  return Math.min(param.max, Math.max(param.min, value));
}

/** Rebuilds a full LayerState per preset layer: fresh id (via the injected
 *  generator, same counter as LayerStack — see layerStack.ts's exported
 *  freshId), default (empty) mask, no imageSource/transform. A layer whose
 *  effectId no longer resolves is skipped with an ApplyWarning — never a
 *  throw that would abort the rest of the preset (design.md §3.4/§5.5).
 *  Each surviving layer's params are clamped to the CURRENT registry's
 *  min/max, protecting against bound drift between the version of the code
 *  that captured the preset and the version applying it. */
export function apply(
  preset: PresetDocument,
  effectExists: (effectId: string) => boolean,
  effectParams: (effectId: string) => EffectParam[] | null,
  freshId: () => string
): { layers: LayerState[]; warnings: ApplyWarning[] } {
  if (preset.schemaVersion > PRESET_SCHEMA_VERSION) {
    throw new Error(
      `Preset "${preset.name}" a un schemaVersion (${preset.schemaVersion}) plus récent que celui supporté par cette version de l'app (${PRESET_SCHEMA_VERSION}).`
    );
  }
  const migrated = migratePresetDocument(preset);

  const layers: LayerState[] = [];
  const warnings: ApplyWarning[] = [];

  for (const presetLayer of migrated.layers) {
    if (!effectExists(presetLayer.effectId)) {
      warnings.push({ message: `Calque ignoré : l'effet "${presetLayer.effectId}" n'existe plus.` });
      continue;
    }
    const params = effectParams(presetLayer.effectId);
    const clamped: Record<string, number> = {};
    for (const [key, value] of Object.entries(presetLayer.params)) {
      const paramDef = params?.find((p) => p.name === key);
      clamped[key] = paramDef ? clampParam(value, paramDef) : value;
    }
    layers.push({
      id: freshId(),
      effectId: presetLayer.effectId,
      params: clamped,
      enabled: presetLayer.enabled,
      opacity: presetLayer.opacity,
      blendMode: presetLayer.blendMode,
      mask: defaultLayerMask(),
    });
  }

  return { layers, warnings };
}

/** No-op today: PRESET_SCHEMA_VERSION === 1 is the only version that has
 *  ever existed. The chain of `if (doc.schemaVersion === N) doc = migrateN(doc)`
 *  steps this function will grow into is deliberately NOT built ahead of a
 *  second version actually existing (YAGNI, design.md §3.3). */
export function migratePresetDocument(doc: PresetDocument): PresetDocument {
  return doc;
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm run test -- test/presets/presetDocument.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors, including in `src/layers/layerStack.ts` (the `freshId` export is additive).

- [ ] **Step 8: Commit**

```bash
git add src/presets/presetTypes.ts src/presets/presetDocument.ts test/presets/presetDocument.test.ts src/layers/layerStack.ts
git commit -m "feat(presets): add pure preset data model (capture/apply/migration)" -- src/presets/presetTypes.ts src/presets/presetDocument.ts test/presets/presetDocument.test.ts src/layers/layerStack.ts
```

---

### Task 2: Disk storage (8 Rust commands + `presetStore.ts` port/adapters)

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Create: `src/presets/presetStore.ts`
- Test: `test/presets/presetStore.test.ts`
- Modify: `src/launch.ts`

**Interfaces:**
- Consumes: `PresetDocument`/`PresetLayer` (Task 1), Tauri's `invoke` (`@tauri-apps/api/core`, same import as the rest of `launch.ts`).
- Produces (consumed by Task 3's `usePresets`, Task 4's `applyTo`, Task 6's export/import):
  ```ts
  export interface PresetSummary { id: string; name: string; updatedAt: string; }
  export interface PresetStore {
    list(): Promise<PresetSummary[]>;
    load(id: string): Promise<PresetDocument>;
    save(id: string, doc: PresetDocument): Promise<void>;
    rename(id: string, name: string): Promise<void>;
    remove(id: string): Promise<void>;
    exportTo(defaultFileName: string, doc: PresetDocument): Promise<boolean>;
    importFrom(): Promise<PresetDocument | null>;
  }
  export class TauriPresetStore implements PresetStore { ... }
  export class InMemoryPresetStore implements PresetStore { ... }
  ```

- [ ] **Step 1: Add the 4 Family-A Rust commands (`list_preset_ids`, `read_preset`, `write_preset`, `delete_preset`), plus 2 private helpers (`presets_dir`, `is_safe_preset_id`)**

Insert into `src-tauri/src/lib.rs`, after `pick_export_folder` (line 163) and before `log_diagnostic`:

```rust
/// Dossier de bibliothèque locale des presets, sous le dossier de config
/// app — même famille d'API que `default_export_dir` (`app.path().picture_dir()`).
/// Ne crée pas le dossier lui-même : `write_preset` le fait via
/// `ensure_parent_dir`, un seul point de création comme pour l'export.
fn presets_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_config_dir()
        .map_err(|e| format!("Dossier de config app introuvable: {e}"))?;
    Ok(dir.join("presets"))
}

/// Confinement d'id, symétrique à `is_jpeg_path` : rejeté même si l'id vient
/// d'un `crypto.randomUUID()` TS de confiance — défense en profondeur contre
/// un id malformé qui traverserait accidentellement vers ce code (ex. après
/// une désérialisation ratée côté appelant).
fn is_safe_preset_id(id: &str) -> bool {
    !id.is_empty()
        && id.chars().all(|c| c.is_ascii_alphanumeric() || c == '-')
        && !id.contains("..")
}

fn preset_path(app: &tauri::AppHandle, id: &str) -> Result<std::path::PathBuf, String> {
    if !is_safe_preset_id(id) {
        return Err(format!("Id de preset invalide: {id}"));
    }
    Ok(presets_dir(app)?.join(format!("{id}.json")))
}

#[tauri::command]
fn list_preset_ids(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let dir = presets_dir(&app)?;
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = fs::read_dir(&dir).map_err(|e| format!("Lecture du dossier presets échouée: {e}"))?;
    let mut ids = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|e| format!("Entrée de dossier illisible: {e}"))?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                if is_safe_preset_id(stem) {
                    ids.push(stem.to_string());
                }
            }
        }
    }
    Ok(ids)
}

#[tauri::command]
fn read_preset(app: tauri::AppHandle, id: String) -> Result<String, String> {
    let path = preset_path(&app, &id)?;
    fs::read_to_string(&path).map_err(|e| format!("Lecture du preset {id} échouée: {e}"))
}

#[tauri::command]
fn write_preset(app: tauri::AppHandle, id: String, contents: String) -> Result<(), String> {
    let path = preset_path(&app, &id)?;
    let path_str = path.to_string_lossy().into_owned();
    ensure_parent_dir(&path_str)?;
    write_atomic(&path_str, contents.as_bytes())
}

#[tauri::command]
fn delete_preset(app: tauri::AppHandle, id: String) -> Result<(), String> {
    let path = preset_path(&app, &id)?;
    if !path.exists() {
        return Ok(()); // suppression d'un preset déjà absent = no-op, pas une erreur
    }
    fs::remove_file(&path).map_err(|e| format!("Suppression du preset {id} échouée: {e}"))
}
```

- [ ] **Step 2: Register the 4 commands**

In `tauri::generate_handler![...]` (`src-tauri/src/lib.rs:209-219`), add after `join_export_target`:

```rust
            join_export_target,
            list_preset_ids,
            read_preset,
            write_preset,
            delete_preset
```

- [ ] **Step 3: Write the failing Rust tests**

Add to the `#[cfg(test)] mod tests` block at the bottom of `src-tauri/src/lib.rs`, after `ensure_parent_dir_creates_missing_directories`:

```rust
    #[test]
    fn is_safe_preset_id_accepts_uuid_like_ids() {
        assert!(is_safe_preset_id("a1b2c3d4-e5f6-47a8-89bc-0123456789ab"));
    }

    #[test]
    fn is_safe_preset_id_rejects_path_traversal_and_separators() {
        assert!(!is_safe_preset_id(""));
        assert!(!is_safe_preset_id("../secret"));
        assert!(!is_safe_preset_id("a/b"));
        assert!(!is_safe_preset_id("a\\b"));
        assert!(!is_safe_preset_id("a..b"));
    }

    #[test]
    fn preset_round_trip_write_read_delete() {
        // preset_path() needs an AppHandle, which requires a running Tauri
        // app — exercised here at the level BELOW it (write_atomic +
        // ensure_parent_dir, already unit-tested above) plus a direct
        // is_safe_preset_id check, matching the split already used by
        // path_exists_on_disk/path_exists for the same reason (§ commandes
        // pas testables sans IPC réel, design.md §8 "Testé (Rust)").
        let dir = std::env::temp_dir().join("shaderlab-test-presets");
        let _ = std::fs::remove_dir_all(&dir);
        let id = "test-preset-1";
        assert!(is_safe_preset_id(id));
        let path = dir.join(format!("{id}.json"));
        let path_str = path.to_str().unwrap();

        ensure_parent_dir(path_str).unwrap();
        write_atomic(path_str, b"{\"schemaVersion\":1}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"schemaVersion\":1}");

        write_atomic(path_str, b"{\"schemaVersion\":1,\"name\":\"renamed\"}").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{\"schemaVersion\":1,\"name\":\"renamed\"}");

        std::fs::remove_file(&path).unwrap();
        assert!(!path.exists());

        let _ = std::fs::remove_dir_all(&dir);
    }
```

Run: `cd src-tauri && cargo test is_safe_preset_id`
Expected: FAIL — `is_safe_preset_id` not yet defined (compile error) before Step 1 lands; run this AFTER Step 1/2 to confirm PASS instead, since Rust has no red/green split as clean as Vitest's module-not-found — the meaningful check here is `cargo test` passing after implementation, not a pre-implementation red run.

- [ ] **Step 4: Verify Rust tests and full build**

Run: `cd src-tauri && cargo test`
Expected: PASS, including the 3 new tests above plus all pre-existing ones.

Run: `cd src-tauri && cargo check`
Expected: 0 errors, 0 warnings about unused `list_preset_ids`/`read_preset`/`write_preset`/`delete_preset` (they're registered in `generate_handler!`).

- [ ] **Step 5: Add `launch.ts` wrappers**

Append to `src/launch.ts`:

```ts
/** Bibliothèque locale de presets (design.md §4). `crypto.randomUUID()`
 *  côté TS génère l'id, jamais dérivé du nom affiché (renommer un preset ne
 *  renomme jamais son fichier). */
export async function listPresetIds(): Promise<string[]> {
  return invoke<string[]>("list_preset_ids");
}

export async function readPreset(id: string): Promise<string> {
  return invoke<string>("read_preset", { id });
}

export async function writePreset(id: string, contents: string): Promise<void> {
  await invoke("write_preset", { id, contents });
}

export async function deletePreset(id: string): Promise<void> {
  await invoke("delete_preset", { id });
}
```

- [ ] **Step 6: Write the failing `presetStore.ts` tests**

```ts
// test/presets/presetStore.test.ts
import { describe, expect, it, vi, beforeEach } from "vitest";
import { InMemoryPresetStore, TauriPresetStore } from "../../src/presets/presetStore";
import type { PresetDocument } from "../../src/presets/presetTypes";
import * as launch from "../../src/launch";

const doc: PresetDocument = {
  schemaVersion: 1,
  id: "preset-1",
  name: "Mon preset",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  layers: [],
};

describe("InMemoryPresetStore", () => {
  it("saves then lists a summary with id/name/updatedAt", async () => {
    const store = new InMemoryPresetStore();
    await store.save(doc.id, doc);
    expect(await store.list()).toEqual([{ id: "preset-1", name: "Mon preset", updatedAt: doc.updatedAt }]);
    expect(await store.load(doc.id)).toEqual(doc);
  });

  it("rename updates the name and is visible in list()", async () => {
    const store = new InMemoryPresetStore();
    await store.save(doc.id, doc);
    await store.rename(doc.id, "Nouveau nom");
    const [summary] = await store.list();
    expect(summary.name).toBe("Nouveau nom");
  });

  it("remove deletes the preset", async () => {
    const store = new InMemoryPresetStore();
    await store.save(doc.id, doc);
    await store.remove(doc.id);
    expect(await store.list()).toEqual([]);
  });
});

describe("TauriPresetStore", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("list() calls listPresetIds then readPreset per id, mapping to summaries", async () => {
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["preset-1"]);
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const store = new TauriPresetStore();
    const summaries = await store.list();
    expect(summaries).toEqual([{ id: "preset-1", name: "Mon preset", updatedAt: doc.updatedAt }]);
  });

  it("list() uses the FILENAME STEM as id, not doc.id from the file's content, when they diverge", async () => {
    // A hand-edited file: the disk filename is "stem-on-disk.json" but the
    // JSON content's own `id` field still says "preset-1" — proves list()
    // doesn't silently trust the content over the real filename (see
    // presetStore.ts's `list()` doc comment).
    vi.spyOn(launch, "listPresetIds").mockResolvedValue(["stem-on-disk"]);
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc)); // doc.id === "preset-1"
    const store = new TauriPresetStore();
    const summaries = await store.list();
    expect(summaries).toEqual([{ id: "stem-on-disk", name: "Mon preset", updatedAt: doc.updatedAt }]);
  });

  it("save() calls writePreset with the id and a JSON-stringified doc", async () => {
    const writeSpy = vi.spyOn(launch, "writePreset").mockResolvedValue(undefined);
    const store = new TauriPresetStore();
    await store.save(doc.id, doc);
    expect(writeSpy).toHaveBeenCalledWith(doc.id, JSON.stringify(doc, null, 2));
  });

  it("load() calls readPreset and parses the JSON", async () => {
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const store = new TauriPresetStore();
    expect(await store.load(doc.id)).toEqual(doc);
  });

  it("rename() loads, patches name+updatedAt, then saves under the same id", async () => {
    vi.spyOn(launch, "readPreset").mockResolvedValue(JSON.stringify(doc));
    const writeSpy = vi.spyOn(launch, "writePreset").mockResolvedValue(undefined);
    const store = new TauriPresetStore();
    await store.rename(doc.id, "Renommé");
    const [id, contents] = writeSpy.mock.calls[0];
    expect(id).toBe(doc.id);
    expect(JSON.parse(contents).name).toBe("Renommé");
  });

  it("remove() calls deletePreset", async () => {
    const deleteSpy = vi.spyOn(launch, "deletePreset").mockResolvedValue(undefined);
    const store = new TauriPresetStore();
    await store.remove(doc.id);
    expect(deleteSpy).toHaveBeenCalledWith(doc.id);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm run test -- test/presets/presetStore.test.ts`
Expected: FAIL — `Cannot find module '../../src/presets/presetStore'`.

- [ ] **Step 8: Implement `src/presets/presetStore.ts`**

```ts
// src/presets/presetStore.ts
import type { PresetDocument } from "./presetTypes";
import { listPresetIds, readPreset, writePreset, deletePreset } from "../launch";

export interface PresetSummary {
  id: string;
  name: string;
  updatedAt: string;
}

/** Port for the preset library — production (`TauriPresetStore`) and test
 *  (`InMemoryPresetStore`) implementations, same shape as `PathAvailability`
 *  in `src/export/exportImage.ts`. `rename` is load+patch+save, not a
 *  dedicated Rust command (design.md §4.2 — the file never moves). */
export interface PresetStore {
  list(): Promise<PresetSummary[]>;
  load(id: string): Promise<PresetDocument>;
  save(id: string, doc: PresetDocument): Promise<void>;
  rename(id: string, name: string): Promise<void>;
  remove(id: string): Promise<void>;
  exportTo(defaultFileName: string, doc: PresetDocument): Promise<boolean>;
  importFrom(): Promise<PresetDocument | null>;
}

export class TauriPresetStore implements PresetStore {
  /** `id` comes from the FILENAME STEM returned by `list_preset_ids`
   *  (`src-tauri/src/lib.rs`'s `list_preset_ids`, which derives it from
   *  `path.file_stem()`), never from `doc.id` inside the parsed content.
   *  `save`/`rename` always keep the two in sync, but a hand-edited file on
   *  disk could diverge — using the content's `id` here would then produce a
   *  summary whose `id` doesn't match any real filename, and a later
   *  `load(id)`/`rename(id, ...)` call built from that summary would 404
   *  against `preset_path`. The stem is the source of truth for "which file
   *  is this", exactly like `TauriPresetStore.rename` already treats `id` as
   *  immutable and separate from `doc.name`. */
  async list(): Promise<PresetSummary[]> {
    const ids = await listPresetIds();
    const summaries: PresetSummary[] = [];
    for (const id of ids) {
      const doc: PresetDocument = JSON.parse(await readPreset(id));
      summaries.push({ id, name: doc.name, updatedAt: doc.updatedAt });
    }
    return summaries;
  }

  async load(id: string): Promise<PresetDocument> {
    return JSON.parse(await readPreset(id));
  }

  async save(id: string, doc: PresetDocument): Promise<void> {
    await writePreset(id, JSON.stringify(doc, null, 2));
  }

  async rename(id: string, name: string): Promise<void> {
    const doc = await this.load(id);
    const updated: PresetDocument = { ...doc, name, updatedAt: new Date().toISOString() };
    await this.save(id, updated);
  }

  async remove(id: string): Promise<void> {
    await deletePreset(id);
  }

  // Implemented in Task 6 (Family B commands don't exist yet).
  async exportTo(): Promise<boolean> {
    throw new Error("exportTo: not implemented until Task 6");
  }

  async importFrom(): Promise<PresetDocument | null> {
    throw new Error("importFrom: not implemented until Task 6");
  }
}

/** In-memory double for tests — same role as the Set-backed
 *  `fakeAvailability` in `test/export/exportImage.test.ts`, no real IPC. */
export class InMemoryPresetStore implements PresetStore {
  private docs = new Map<string, PresetDocument>();

  async list(): Promise<PresetSummary[]> {
    return [...this.docs.values()].map((d) => ({ id: d.id, name: d.name, updatedAt: d.updatedAt }));
  }

  async load(id: string): Promise<PresetDocument> {
    const doc = this.docs.get(id);
    if (!doc) throw new Error(`Preset introuvable: ${id}`);
    return doc;
  }

  async save(id: string, doc: PresetDocument): Promise<void> {
    this.docs.set(id, doc);
  }

  async rename(id: string, name: string): Promise<void> {
    const doc = await this.load(id);
    this.docs.set(id, { ...doc, name, updatedAt: new Date().toISOString() });
  }

  async remove(id: string): Promise<void> {
    this.docs.delete(id);
  }

  async exportTo(): Promise<boolean> {
    throw new Error("exportTo: not implemented until Task 6");
  }

  async importFrom(): Promise<PresetDocument | null> {
    throw new Error("importFrom: not implemented until Task 6");
  }
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -- test/presets/presetStore.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 10: Type-check + full suite**

Run: `npx tsc --noEmit`
Expected: 0 errors.

Run: `npm run test`
Expected: PASS, no regression.

- [ ] **Step 11: Commit**

```bash
git add src-tauri/src/lib.rs src/launch.ts src/presets/presetStore.ts test/presets/presetStore.test.ts
git commit -m "feat(presets): add local preset storage (4 Rust commands + PresetStore port/adapters)" -- src-tauri/src/lib.rs src/launch.ts src/presets/presetStore.ts test/presets/presetStore.test.ts
```

---

### Task 3: "Presets" card + save (`usePresets` partial, `PresetPanel`, `App.tsx` wiring)

**Files:**
- Modify: `src/ui/Dialog.tsx` (`children` becomes optional — B1 below)
- Create: `src/hooks/usePresets.ts`
- Create: `src/components/PresetPanel.tsx`
- Create: `src/components/PresetPanel.css`
- Create: `src/components/PresetPanel.stories.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `PresetStore`/`TauriPresetStore` (Task 2), `capture` (Task 1), `useContextualPanel` (existing, `src/ui/contextualPanel.ts` — search `export function useContextualPanel`), `PanelRail`/`PanelRailItem` (existing, `src/components/dockedPanel/PanelRail.tsx`), `DockedPanelSpec` (existing, `src/components/dockedPanel/PanelColumn.tsx` — search `interface DockedPanelSpec`).
- Produces (this task's partial surface; Task 4/5 extend the same hook and file, never duplicate them — signatures below match the CODE in this task's steps, not an idealized sketch, per the review that produced this revision):
  ```ts
  export function usePresets(store: PresetStore): {
    summaries: PresetSummary[];
    refresh: () => Promise<void>;
    save: (layers: LayerState[], name: string) => Promise<void>;
    overwrite: (id: string, layers: LayerState[], name: string) => Promise<void>;
    rename: (id: string, name: string) => Promise<void>;
    // applyTo/remove/exportPreset/importPreset/activePresetId/isDirtyOf/
    // updateActive/copyActiveAsNew/clearActive added in Task 4/5/6 — NOT
    // stubbed here, added when their task lands (no placeholder methods).
  }
  export interface PresetPanelProps {
    summaries: PresetSummary[];
    hasLayers: boolean;
    onSave: (name: string) => void;
  }
  export function PresetPanel(props: PresetPanelProps): JSX.Element;
  ```

- [ ] **Step 0: Make `Dialog`'s `children` optional**

`src/ui/Dialog.tsx:5-13` currently declares:

```ts
export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}
```

Both confirmations this task adds (`pendingPhotoLayerSave`'s Dialog below, and T4's stack-replacement Dialog) are self-closing (`<Dialog ... />`, no children) — `children` required means `TS2741` on every one of them. Change the field to optional:

```ts
export interface DialogProps {
  open: boolean;
  title: string;
  description?: string;
  children?: ReactNode;
  actions?: ReactNode;
  onClose: () => void;
  closeLabel?: string;
}
```

Aucune autre ligne de `Dialog.tsx` ne change pour ce point — `{children}` rend déjà `undefined` sans broncher (React l'ignore).

- [ ] **Step 0b: Faire importer sa feuille de style par `Dialog`**

`src/ui/dialog.css` existe mais **n'est importé nulle part** — vérifie-le avant
de corriger :

```bash
grep -rn "dialog.css" src/
```

Attendu : une seule occurrence, la définition du fichier lui-même, aucun import.
`Dialog.tsx` n'importe que React, `lucide-react` et `IconButton` ; `Dialog`
n'ayant eu aucun consommateur jusqu'ici, personne ne l'a jamais constaté. Sans
cet import, les trois dialogues de ce chantier rendront un `<dialog>` natif
brut, non stylé — et `tsc`, les tests et `lint:tokens` passeront tous au vert.

Tous les autres composants du projet importent leur CSS eux-mêmes
(`src/components/ColorPickerPanel.tsx:5`, `src/components/dockedPanel/PanelRail.tsx:2`,
`src/components/LayerPanel.tsx:11`) : suivre la même convention.

Ajouter en tête de `src/ui/Dialog.tsx`, après les imports existants :

```ts
import "./dialog.css";
```

- [ ] **Step 1: Implement `src/hooks/usePresets.ts` (save/summaries/refresh only)**

No test file for this hook: it is a thin `useState`+`useCallback` wrapper around `PresetStore`/`capture`, whose only non-trivial logic (`capture`, `PresetStore` implementations) is already unit-tested in Task 1/2. Testing the hook itself would require `renderHook` (not a project dependency, forbidden by the Global Constraints).

```ts
// src/hooks/usePresets.ts
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
   *  (`App.tsx`'s `requestSavePreset`, Step 3 below) — this function always
   *  creates a fresh id, it never checks for a name collision itself. */
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
   *  rename affordance below. */
  const rename = useCallback(
    async (id: string, name: string) => {
      await store.rename(id, name);
      await refresh();
    },
    [store, refresh]
  );

  return { summaries, refresh, save, overwrite, rename };
}
```

Note: `save`'s real signature takes `(layers, name)`, not `(name)` alone as design.md §6.2's ideal sketch suggested — `App.tsx` is the only caller and already holds `layers` from `sessionRef.current.layers()`; passing it explicitly here (rather than closing over a ref inside the hook) keeps `usePresets` a pure function of its arguments, consistent with every other `App.tsx`-owned hook in this file (e.g. `useContextualPanel` takes `conditionMet`/`triggerKey` as arguments rather than reading from a ref).

- [ ] **Step 2: Implement `src/components/PresetPanel.tsx`**

No test file (project convention: no test renders a React component; verified visually in Task 3's checkpoint below, folded into Task 4's full checkpoint).

```tsx
// src/components/PresetPanel.tsx
import { useState } from "react";
import type { PresetSummary } from "../presets/presetStore";
import { Button } from "./ui/button";
import "./PresetPanel.css";

export interface PresetPanelProps {
  summaries: PresetSummary[];
  hasLayers: boolean;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
}

export function PresetPanel({ summaries, hasLayers, onSave, onRename }: PresetPanelProps) {
  const [nameInput, setNameInput] = useState("");
  // C2 (PRD.md:64-65), decided by Antoine 2026-07-26 (no interaction spec
  // existed in design.md — double-click-to-edit is this plan's own decision,
  // not invented UI behavior design.md described differently): double-click
  // a preset's name to replace it with a text input, pre-filled and
  // selected. Enter or blur commits (a no-op/empty name cancels instead of
  // writing); Escape cancels explicitly.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");

  function startRename(summary: PresetSummary) {
    setEditingId(summary.id);
    setEditingValue(summary.name);
  }

  function commitRename() {
    const trimmed = editingValue.trim();
    const original = summaries.find((s) => s.id === editingId)?.name;
    if (editingId && trimmed !== "" && trimmed !== original) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  return (
    <div className="preset-panel">
      <div className="preset-panel__save-row">
        <input
          type="text"
          className="preset-panel__name-input"
          placeholder="Nom du preset"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          disabled={!hasLayers}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasLayers || nameInput.trim() === ""}
          onClick={() => {
            onSave(nameInput.trim());
            setNameInput("");
          }}
        >
          Enregistrer
        </Button>
      </div>
      {summaries.length === 0 ? (
        <p className="preset-panel__empty">Aucun preset enregistré.</p>
      ) : (
        <ul className="preset-panel__list">
          {summaries.map((summary) =>
            editingId === summary.id ? (
              <li key={summary.id} className="preset-panel__row">
                <input
                  type="text"
                  autoFocus
                  className="preset-panel__name-input"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur(); // triggers onBlur -> commitRename
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={summary.id} className="preset-panel__row">
                <span className="preset-panel__row-name" onDoubleClick={() => startRename(summary)}>
                  {summary.name}
                </span>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
```

(Task 4 adds the "apply on click" handler to `preset-panel__row-name` — a single click applies, a double click renames, standard disambiguation already used nowhere else in this codebase so this is this plan's own decision, not copied convention. Task 5's dirty banner is added below the list in the same file, not inside it.)

```css
/* src/components/PresetPanel.css */
.preset-panel {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  padding: var(--space-2);
}

.preset-panel__save-row {
  display: flex;
  gap: var(--space-2);
}

.preset-panel__name-input {
  flex: 1;
  background: var(--surface-inset);
  border: 1px solid var(--border-default);
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
  color: var(--text-primary);
  font-size: var(--font-size-sm);
}

.preset-panel__empty {
  color: var(--text-secondary);
  font-size: var(--font-size-sm);
}

.preset-panel__list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  list-style: none;
  margin: 0;
  padding: 0;
}

.preset-panel__row {
  display: flex;
  align-items: center;
  border-radius: var(--radius-control);
  padding: var(--space-1) var(--space-2);
}

.preset-panel__row-name {
  flex: 1;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
}

.preset-panel__excluded-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-1);
  margin: 0;
  padding-left: var(--space-4);
  font-size: var(--font-size-sm);
  color: var(--text-secondary);
}
```

**Token names verified on disk for this revision** (`--input-background`, `--border`, `--foreground`, `--surface-warning` from the plan's earlier draft do NOT exist in `src/design/{primitives,semantic,components}.css` — confirmed by grep, zero matches): the CSS above already uses the real names — `--surface-inset` (`src/design/semantic.css:14`, also the input-like background used by `src/components/ParamPanel.css:24,65`), `--border-default` (`src/design/semantic.css:38`), `--text-primary`/`--text-secondary` (`src/design/semantic.css:30-31`), `--radius-control` (`src/design/primitives.css:105`), `--font-size-sm` (`src/design/primitives.css:85`), `--space-1/2/3` (`src/design/primitives.css:68-70`). **`npm run lint:tokens` does NOT catch a wrong/nonexistent token name** — it only flags a hardcoded literal value that duplicates an existing token; `var(--a-name-that-does-not-exist)` passes the linter clean and silently resolves to nothing at runtime (invisible CSS, only caught on screen). Do not rely on it for this class of mistake — verify every token name against `src/design/*.css` directly before writing it.

- [ ] **Step 3: Wire `App.tsx`**

Add imports near the other feature imports (`App.tsx` line numbers drift as this plan lands — search for the anchor pattern given, not a line number. Anchor: `import { ColorPickerPanel } from "./components/ColorPickerPanel";` immediately followed by `import type { EffectParam } from "./render/effects/types";` — add the new imports right after that pair):

```ts
import { usePresets } from "./hooks/usePresets";
import { PresetPanel } from "./components/PresetPanel";
import { TauriPresetStore } from "./presets/presetStore";
import { capture } from "./presets/presetDocument";
import { Dialog } from "./ui/Dialog";
import { Button } from "./components/ui/button";
```

**`PackagePlus` merges into the EXISTING `lucide-react` import, not a second import line.** `App.tsx` already has `import { Layers, SlidersHorizontal, Brush as BrushRailIcon } from "lucide-react";` — search for that line and change it to:

```ts
import { Layers, SlidersHorizontal, Brush as BrushRailIcon, PackagePlus } from "lucide-react";
```

(`Button` may already be imported in `App.tsx` under a different alias or not at all — grep `from "./components/ui/button"` in the file first; if already imported, reuse the existing import line instead of adding a duplicate. Task 4 needs the same `Dialog`/`Button` imports for its own confirmation — if this task lands first, Task 4 reuses these same import lines rather than re-adding them.)

Add the store instance and hook, near the other `useRef`/hook calls. Anchor: search for `const sessionRef = useRef(new DocumentSession());` — add these two lines directly after it:

```ts
  const presetStoreRef = useRef(new TauriPresetStore());
  const presets = usePresets(presetStoreRef.current);
```

Load the list once on mount, alongside the existing app-init `useEffect` (find it — the effect that calls `initGpu`/sets up the renderer — and add a sibling effect rather than merging into it, since preset loading has nothing to do with GPU init):

```ts
  useEffect(() => {
    presets.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refresh is stable (useCallback), run once on mount only.
  }, []);
```

Add the 4th contextual panel, alongside the 3 existing ones. Anchor: search for `const layersPanel = useContextualPanel(true, "static");` — add `presetsPanel` as a sibling line, in the same block as `layersPanel`/`paramsPanel`/`maskPanel`:

```ts
  const presetsPanel = useContextualPanel(true, "static");
  const layersPanel = useContextualPanel(true, "static");
  const paramsPanel = useContextualPanel(selectedId !== null, selectedId);
  const maskPanel = useContextualPanel(selectedId !== null, selectedId);
```

Extend `panelVisibility` — **the real code is a table, not a ternary chain.** `App.tsx` (search for `const panelVisibility: Record<string, boolean> = useMemo`) currently reads:

```ts
  // Table explicite plutôt qu'une chaîne de ternaires : sans branche par
  // défaut, un id inconnu héritait silencieusement de la visibilité du Masque.
  // Ce prédicat ne sert plus seulement à filtrer l'affichage, il alimente aussi
  // la traduction des index de glisser-déposer (`toFullDockTarget`) — un id
  // oublié y fausserait le déplacement sans jamais lever d'erreur. Le chantier
  // Presets ajoute un 4e panneau : il DOIT échouer bruyamment ici s'il oublie
  // sa ligne (fail-fast projet, pas de repli silencieux).
  const panelVisibility: Record<string, boolean> = useMemo(
    () => ({ layers: layersPanel.visible, params: paramsPanel.visible, mask: maskPanel.visible }),
    [layersPanel.visible, paramsPanel.visible, maskPanel.visible]
  );
  const isPanelVisible = useCallback(
    (id: string) => {
      const visible = panelVisibility[id];
      if (visible === undefined) throw new Error(`Panneau inconnu dans le dock : "${id}" (ajouter sa visibilité à panelVisibility).`);
      return visible;
    },
    [panelVisibility]
  );
```

The comment above `panelVisibility` literally names this chantier ("Le chantier Presets ajoute un 4e panneau") as the fail-fast guard's intended trigger — it exists specifically so a missed 4th entry throws instead of silently inheriting Mask's visibility. **Add `presets: presetsPanel.visible` to the object AND `presetsPanel.visible` to the `useMemo` deps array. Do NOT touch `isPanelVisible` itself** — its throw-on-unknown-id behavior is intentional and must survive this task unchanged:

```ts
  const panelVisibility: Record<string, boolean> = useMemo(
    () => ({ presets: presetsPanel.visible, layers: layersPanel.visible, params: paramsPanel.visible, mask: maskPanel.visible }),
    [presetsPanel.visible, layersPanel.visible, paramsPanel.visible, maskPanel.visible]
  );
```

Change the initial `dockLayout` to lead with `"presets"`. Anchor: search for `const [dockLayout, setDockLayout] = useState<DockLayout>(`:

```ts
  const [dockLayout, setDockLayout] = useState<DockLayout>([["presets", "layers", "params", "mask"]]);
```

Add a `presetsFolded` state alongside `layersFolded`/`paramsFolded`/`maskFolded`. Anchor: search for `const [layersFolded, setLayersFolded] = useState(false);`:

```ts
  const [presetsFolded, setPresetsFolded] = useState(false);
```

**Two confirmations can stack on one save — the chain, in order** (both decided in this revision; neither existed as a real implementation before):

1. **C1 — overwrite-by-name** (`PRD.md:63-64`, previously unimplemented): if `name` already matches an existing preset's `summaries[].name`, a first `Dialog` asks to confirm overwriting it. Cancel here stops the whole save — nothing is written, no second dialog appears.
2. **Photo-layer exclusion** (design doc §9, decided by Antoine 2026-07-26): `capture()` is pure and cheap, so `App.tsx` calls it to inspect `skipped` BEFORE ever writing to disk, listing every excluded layer by position (`SkipNotice.layerIndex`, Task 1) — not just a count (a bare count doesn't satisfy "énumérant les calques exclus"). Cancel here ALSO stops the whole save, even if the user already confirmed the overwrite in step 1 — an overwrite confirmation is not a standing authorization to write, it only answers "is this the right target file", not "write now regardless of what else changed".

Only when BOTH gates are passed (or never triggered) does the actual write happen, and it always goes through `presets.save`/`presets.overwrite` inside a `try/catch` (I1: no floating promise, no silent rejection — see `importPresetFile`, Task 6, for the pattern this copies).

Add state for the pending confirmations, alongside `presetsFolded`. `pendingPhotoLayerSave` carries an `onConfirm` CALLBACK rather than a fixed "overwrite or not" flag — Task 5 reuses this same gate for "Mettre à jour"/"Créer une copie" (I3), which don't fit an overwrite-id shape but do need the same "confirm, then run this one specific write" contract:

```ts
  const [pendingOverwrite, setPendingOverwrite] = useState<{ id: string; name: string } | null>(null);
  const [pendingPhotoLayerSave, setPendingPhotoLayerSave] = useState<{ excludedLayerIndexes: number[]; onConfirm: () => void } | null>(null);
```

Add the gating functions, near the other `handle*` functions. **`gateOnPhotoLayers` is this plan's ONE place that inspects `capture()`'s `skipped` before a write — every write path (save, overwrite, and Task 5's update/copy) calls it, never `presets.save`/`overwrite`/`updateActive`/`copyActiveAsNew` directly:**

```ts
  function requestSavePreset(name: string) {
    const existing = presets.summaries.find((s) => s.name === name);
    if (existing) {
      setPendingOverwrite({ id: existing.id, name });
      return;
    }
    gateOnPhotoLayers(name, () => commitSavePreset(name, null));
  }

  /** Runs `capture(sessionRef.current.layers(), name)` purely to inspect
   *  `skipped` — if it reports any excluded photo layer, blocks on the
   *  `pendingPhotoLayerSave` Dialog and defers `onConfirmed` to its
   *  "Enregistrer quand même" button; otherwise runs `onConfirmed`
   *  immediately. `name` is only used to compute `skipped` (a photo-layer
   *  exclusion doesn't depend on the target name) — callers that don't have
   *  a natural "new name" yet (Task 5's `updateActive`) pass the CURRENT
   *  preset's existing name, which is what would be recaptured anyway. */
  function gateOnPhotoLayers(name: string, onConfirmed: () => void) {
    const { skipped } = capture(sessionRef.current.layers(), name);
    const excludedLayerIndexes = skipped.filter((s) => s.reason === "photo-layer").map((s) => s.layerIndex);
    if (excludedLayerIndexes.length > 0) {
      setPendingPhotoLayerSave({ excludedLayerIndexes, onConfirm: onConfirmed });
      return;
    }
    onConfirmed();
  }

  async function commitSavePreset(name: string, overwriteId: string | null) {
    try {
      if (overwriteId) {
        await presets.overwrite(overwriteId, sessionRef.current.layers(), name);
      } else {
        await presets.save(sessionRef.current.layers(), name);
      }
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  async function handleRenamePreset(id: string, name: string) {
    try {
      await presets.rename(id, name);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }
```

Add the "presets" entry as the FIRST item of the `panels` array (before `"layers"`, inside the `<PanelColumn panels={[...]}>` block — search for `<PanelColumn`), wired to `requestSavePreset`/`handleRenamePreset` rather than calling `presets.save`/`presets.rename` directly (per the Global Constraints' "one door" rule):

```tsx
            {
              id: "presets", title: "Presets", collapsed: presetsFolded, onCollapsedChange: setPresetsFolded,
              content: <PresetPanel
                  summaries={presets.summaries}
                  hasLayers={layers.length > 0}
                  onSave={requestSavePreset}
                  onRename={handleRenamePreset}
                />
            },
```

Render both confirmation `Dialog`s, alongside the `PanelColumn`/`PanelRail` block (inside `<main className="workspace">`, after `PanelRail`):

```tsx
        <Dialog
          open={pendingOverwrite !== null}
          title="Remplacer le preset existant ?"
          description={pendingOverwrite ? `Un preset nommé "${pendingOverwrite.name}" existe déjà. L'enregistrement va écraser son contenu.` : undefined}
          onClose={() => setPendingOverwrite(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingOverwrite(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingOverwrite) gateOnPhotoLayers(pendingOverwrite.name, () => commitSavePreset(pendingOverwrite.name, pendingOverwrite.id));
                  setPendingOverwrite(null);
                }}
              >
                Écraser
              </Button>
            </>
          }
        />
        <Dialog
          open={pendingPhotoLayerSave !== null}
          title="Calque(s) photo exclu(s) du preset"
          description={
            pendingPhotoLayerSave
              ? `${pendingPhotoLayerSave.excludedLayerIndexes.length} calque${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "s" : ""} de photo (double exposure) ne ${pendingPhotoLayerSave.excludedLayerIndexes.length > 1 ? "seront" : "sera"} pas inclus dans le preset — une source de photo n'a de sens que dans ce document.`
              : undefined
          }
          onClose={() => setPendingPhotoLayerSave(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPhotoLayerSave(null)}>
                Annuler
              </Button>
              <Button
                variant="default"
                onClick={() => {
                  pendingPhotoLayerSave?.onConfirm();
                  setPendingPhotoLayerSave(null);
                }}
              >
                Enregistrer quand même
              </Button>
            </>
          }
        >
          {pendingPhotoLayerSave && (
            <ul className="preset-panel__excluded-list">
              {pendingPhotoLayerSave.excludedLayerIndexes.map((layerIndex) => (
                <li key={layerIndex}>Calque {layerIndex + 1} — photo (double exposure)</li>
              ))}
            </ul>
          )}
        </Dialog>
```

(`capture()` is called twice on a gated write — once by `gateOnPhotoLayers` to inspect `skipped`, once more inside `presets.save`/`presets.overwrite`/`presets.updateActive`/`presets.copyActiveAsNew` itself. This is intentional, not a bug: `capture` is a pure function of its `layers`/`name` arguments, so calling it twice with the SAME `layers` produces the same `skipped` set both times — it is NOT "deterministically identical" in the sense of "always the same output regardless of input" (false: it stamps a fresh `crypto.randomUUID()`/`new Date()` on every call, see Task 1's `capture` implementation), only in the narrower sense that matters here — same input layers, same exclusion verdict.)

Add the "presets" rail item as the FIRST item of `PanelRail`'s `items` array. Anchor: search for `<PanelRail` — its `items={[` array's first entry is currently `{ id: "layers", ... }`:

```tsx
        <PanelRail
          items={[
            { id: "presets", icon: PackagePlus, label: "Presets", active: presetsPanel.visible, onClick: presetsPanel.toggleRail },
            { id: "layers", icon: Layers, label: "Calques", active: layersPanel.visible, onClick: layersPanel.toggleRail },
            { id: "params", icon: SlidersHorizontal, label: "Réglages", active: paramsPanel.visible, onClick: paramsPanel.toggleRail },
            { id: "mask", icon: BrushRailIcon, label: "Masque", active: maskPanel.visible, onClick: maskPanel.toggleRail },
          ] satisfies PanelRailItem[]}
        />
```

The `colorPicker`'s `right` calc — search for `right: "calc(var(--space-6)` — counts `visibleLayout.length` columns, which now potentially includes the presets column; the formula itself is unchanged, it already reads `visibleLayout.length` generically, so NO edit is needed there — verify this at Step 4's type-check, do not touch that block.

- [ ] **Step 4: `src/components/PresetPanel.stories.tsx`**

`PRD.md:143-147` requires Storybook visual verification, and every sibling panel already has one (`src/components/LayerPanel.stories.tsx`, `ParamPanel.stories.tsx`, `MaskPanel.stories.tsx`) — `PresetPanel` needs the same, following the exact shape already used by `ParamPanel.stories.tsx` (`Meta`/`StoryObj`, `args` on `meta`, empty-object stories overriding only what differs):

```tsx
// src/components/PresetPanel.stories.tsx
import type { Meta, StoryObj } from "@storybook/react-vite";
import { PresetPanel } from "./PresetPanel";
import type { PresetSummary } from "../presets/presetStore";

const threePresets: PresetSummary[] = [
  { id: "p1", name: "Film grain lourd", updatedAt: "2026-07-20T10:00:00.000Z" },
  { id: "p2", name: "Glow doux", updatedAt: "2026-07-22T14:30:00.000Z" },
  { id: "p3", name: "Chromatic aberration", updatedAt: "2026-07-25T09:15:00.000Z" },
];

const meta: Meta<typeof PresetPanel> = {
  title: "Components/PresetPanel",
  component: PresetPanel,
  args: {
    summaries: threePresets,
    hasLayers: true,
    onSave: () => {},
    onRename: () => {},
  },
};

export default meta;
type Story = StoryObj<typeof PresetPanel>;

export const Default: Story = {};

export const EmptyList: Story = {
  args: { summaries: [] },
};

export const NoLayersToSave: Story = {
  args: { hasLayers: false },
};
```

- [ ] **Step 5: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 6: Full test suite**

Run: `npm run test`
Expected: PASS, no regression (Tasks 1/2's new suites plus all existing ones).

- [ ] **Step 7: Lint tokens**

Run: `npm run lint:tokens`
Expected: no new violations beyond the 2 pre-existing `EmptyWorkspace.stories.tsx` findings. Remember this linter does NOT catch a wrong/nonexistent token NAME (`var(--typo)` passes clean) — it only catches a hardcoded literal that duplicates an existing token. A clean run here is not proof the token names in `PresetPanel.css` are real; that was already verified against `src/design/*.css` in Step 2 above.

- [ ] **Step 8: Commit**

```bash
git add src/ui/Dialog.tsx src/hooks/usePresets.ts src/components/PresetPanel.tsx src/components/PresetPanel.css src/components/PresetPanel.stories.tsx src/App.tsx
git commit -m "feat(app): add Presets docked card (save/overwrite/rename) wired into contextual panels" -- src/ui/Dialog.tsx src/hooks/usePresets.ts src/components/PresetPanel.tsx src/components/PresetPanel.css src/components/PresetPanel.stories.tsx src/App.tsx
```

- [ ] **Step 9: Visual checkpoint (CDP, human verdict)**

Run: `npm run dev:debug` then `npm run dev:monitor` (check `Get-Process -Name shaderlab` first if another worktree/session may be running its own instance, per `CLAUDE.md` § Méthode).

Checklist:
1. "Presets" is the first card in the dock column, and the first icon on `PanelRail`.
2. With an image open and at least one layer added, type a name and click "Enregistrer" → a new entry appears in the list.
3. Check the file landed on disk: the app-config `presets/` directory (path varies by OS install — ask Antoine to confirm the exact resolved path via the dev build, or inspect `%APPDATA%/com.shaderlab.app/presets/` on Windows, adjusting for the app's actual bundle identifier in `tauri.conf.json`) contains a new `{uuid}.json` file whose `layers` match the stack, with no `id`/`mask`/`imageSource`/`transform` per layer.
4. Close and reopen the app (`dev:debug` again) → the preset is still listed (proves `list()`/`refresh()` round-trips through real IPC, not just in-memory state).
5. Save under a name that already exists → the overwrite confirmation appears first; confirm it → the photo-layer-exclusion confirmation appears next if applicable, or the write happens immediately if the stack has no photo layer; cancel the overwrite confirmation → nothing written, no second dialog.
6. Import a photo layer (double exposure), add at least one effect layer, click "Enregistrer" → the blocking `Dialog` enumerates the excluded layer(s) by position (not just a count); initial focus is on "Annuler" (verify via `document.activeElement` over CDP); clicking "Annuler" writes nothing to disk (re-check the `presets/` directory's file count); clicking "Enregistrer quand même" writes the preset with only the effect layer.
7. Double-click a preset's name → it becomes an editable text input, pre-selected; type a new name and press Enter → the list shows the new name, the file on disk keeps the same id (still `{uuid}.json`, just its `name` field changed). Escape while editing → reverts to the original name, no write.

Report the observation to Antoine; this step's PASS/FAIL verdict is his call, not the implementing agent's, per project convention.

---

### Task 4: Apply a preset (confirmation + degradation)

**Files:**
- Modify: `src/hooks/usePresets.ts`
- Modify: `src/components/PresetPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `apply` (Task 1), `Dialog`/`DialogProps` (`src/ui/Dialog.tsx`, existing), `DocumentSession.commit`/`layers`/`select` (`src/application/documentSession.ts:17-19,29-31,48-52`), `getEffect`/`effectRegistry` (`src/render/effects/registry.ts`), `ErrorBanner`'s `setError` channel (`src/App.tsx`'s existing `const [error, setError] = useState<string | null>(null)`).
- Produces (extends `usePresets`'s return shape from Task 3, consumed by Task 5's dirty-tracking):
  ```ts
  // usePresets(store) now additionally returns:
  applyTo: (id: string, currentLayers: LayerState[], onApply: (layers: LayerState[]) => void, onWarning: (msg: string) => void) => Promise<void>;
  ```

- [ ] **Step 1: Extend `usePresets` with `applyTo`**

Add to `src/hooks/usePresets.ts` (after `save`):

```ts
import { apply } from "../presets/presetDocument";
import { getEffect, effectRegistry } from "../render/effects/registry";
import { freshId } from "../layers/layerStack";
import type { EffectParam } from "../render/effects/types";

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
```

(`effectRegistry` import is unused by `applyTo` itself but documents the alternative considered and rejected: iterating `effectRegistry.find(...)` directly instead of `try { getEffect(...) } catch`. `getEffect` is preferred because it is the single existing source of truth for "does this effectId resolve", already handling the `"passthrough"` special case — re-deriving that logic here would duplicate it. Remove the unused import if a linter flags it; keep `effectExists`/`effectParamsFor` as-is.)

Inside `usePresets`, add:

```ts
  const applyTo = useCallback(
    async (id: string, currentLayers: LayerState[], onApply: (layers: LayerState[]) => void, onWarning: (msg: string) => void) => {
      const preset = await store.load(id);
      const { layers: newLayers, warnings } = apply(preset, effectExists, effectParamsFor, freshId);
      onApply(newLayers);
      if (warnings.length > 0) {
        onWarning(warnings.map((w) => w.message).join(" "));
      }
    },
    [store]
  );

  return { summaries, refresh, save, overwrite, rename, applyTo };
```

(`currentLayers` is accepted but intentionally unused inside `applyTo` itself — App.tsx's confirmation gate, Step 3 below, is what reads it to decide whether to show the Dialog BEFORE calling `applyTo` at all. Passing it through keeps the signature self-documenting about what the caller is expected to have checked, without `usePresets` re-implementing that check.)

- [ ] **Step 2: Add "Appliquer" click + confirmation state to `PresetPanel.tsx`**

Task 3 already put a double-click-to-rename affordance on the row name (`onDoubleClick={() => startRename(summary)}`, no `onClick`). Wiring a plain `onClick={() => onApply(summary.id)}` onto that SAME element now would fire the apply exactly the way a native double-click does — a real browser double-click dispatches TWO `click` events before the `dblclick` event, so a naive click handler would apply the preset (twice) on every attempt to rename it. The fix is the standard click/dblclick disambiguation: delay the single-click action, and cancel it if a `dblclick` arrives within the window.

```tsx
// src/components/PresetPanel.tsx — full file, changes from Task 3 highlighted in comments
import { useRef, useState } from "react";
import type { PresetSummary } from "../presets/presetStore";
import { Button } from "./ui/button";
import "./PresetPanel.css";

export interface PresetPanelProps {
  summaries: PresetSummary[];
  hasLayers: boolean;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onApply: (id: string) => void; // new this task
}

// Single click applies with a short delay, cancelled if a double click
// (rename) arrives first — see the disambiguation note above. 200ms matches
// this OS's default double-click timing threshold closely enough that a
// deliberate double click never misfires as two applies.
const APPLY_CLICK_DELAY_MS = 200;

export function PresetPanel({ summaries, hasLayers, onSave, onRename, onApply }: PresetPanelProps) {
  const [nameInput, setNameInput] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const applyTimerRef = useRef<number | null>(null);

  function startRename(summary: PresetSummary) {
    setEditingId(summary.id);
    setEditingValue(summary.name);
  }

  function commitRename() {
    const trimmed = editingValue.trim();
    const original = summaries.find((s) => s.id === editingId)?.name;
    if (editingId && trimmed !== "" && trimmed !== original) {
      onRename(editingId, trimmed);
    }
    setEditingId(null);
  }

  function handleNameClick(id: string) {
    if (applyTimerRef.current !== null) window.clearTimeout(applyTimerRef.current);
    applyTimerRef.current = window.setTimeout(() => {
      onApply(id);
      applyTimerRef.current = null;
    }, APPLY_CLICK_DELAY_MS);
  }

  function handleNameDoubleClick(summary: PresetSummary) {
    if (applyTimerRef.current !== null) {
      window.clearTimeout(applyTimerRef.current);
      applyTimerRef.current = null;
    }
    startRename(summary);
  }

  return (
    <div className="preset-panel">
      <div className="preset-panel__save-row">
        <input
          type="text"
          className="preset-panel__name-input"
          placeholder="Nom du preset"
          value={nameInput}
          onChange={(e) => setNameInput(e.target.value)}
          disabled={!hasLayers}
        />
        <Button
          variant="secondary"
          size="sm"
          disabled={!hasLayers || nameInput.trim() === ""}
          onClick={() => {
            onSave(nameInput.trim());
            setNameInput("");
          }}
        >
          Enregistrer
        </Button>
      </div>
      {summaries.length === 0 ? (
        <p className="preset-panel__empty">Aucun preset enregistré.</p>
      ) : (
        <ul className="preset-panel__list">
          {summaries.map((summary) =>
            editingId === summary.id ? (
              <li key={summary.id} className="preset-panel__row">
                <input
                  type="text"
                  autoFocus
                  className="preset-panel__name-input"
                  value={editingValue}
                  onChange={(e) => setEditingValue(e.target.value)}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur(); // triggers onBlur -> commitRename
                    else if (e.key === "Escape") setEditingId(null);
                  }}
                />
              </li>
            ) : (
              <li key={summary.id} className="preset-panel__row">
                <button
                  type="button"
                  className="preset-panel__row-name"
                  onClick={() => handleNameClick(summary.id)}
                  onDoubleClick={() => handleNameDoubleClick(summary)}
                >
                  {summary.name}
                </button>
              </li>
            )
          )}
        </ul>
      )}
    </div>
  );
}
```

Add to `PresetPanel.css`:

```css
.preset-panel__row-name {
  flex: 1;
  text-align: left;
  background: none;
  border: none;
  font-size: var(--font-size-sm);
  color: var(--text-primary);
  cursor: pointer;
  padding: var(--space-1);
  border-radius: var(--radius-control);
}

.preset-panel__row-name:hover {
  background: var(--surface-hover);
}
```

`--surface-hover` is already verified real (`src/design/semantic.css:15`) — reused as-is, no further check needed here (the linter caveat from Task 3 Step 2 stands: it wouldn't have caught a wrong name anyway).

- [ ] **Step 3: Wire the confirmation Dialog in `App.tsx`**

Add state for the pending apply, near `colorPicker`. Anchor: search for `const [colorPicker, setColorPicker] = useState<{`:

```ts
  const [pendingPresetApply, setPendingPresetApply] = useState<string | null>(null);
```

Add the apply handler, near the other `handle*` functions. **Goes through the existing `commit` helper (search for `const commit = useCallback` in `App.tsx`) — do NOT hand-roll `sessionRef.current.commit(stack)` + `setLayers(...)` here.** `commit` already does three things in the right order: `sessionRef.current.commit(stack)`, `syncSession()` (which re-derives BOTH `layers` and `selectedId` from `sessionRef.current.displayLayers()`/`selectedId()`), and `rendererRef.current?.requestRender(...)`. A hand-rolled version that calls `setLayers(sessionRef.current.layers())` directly would push the FULL layer objects (with mask rasters) into React state — exactly the 24MP OOM crash this file's own comment above `syncSession` (search for `// DocumentSession est la source de vérité COMPLÈTE`) documents as already fixed once; `commit`'s `syncSession()` call is what keeps only the display projection (rasters stripped) in state. A hand-rolled version also skips `rendererRef.current?.requestRender(...)` entirely, so applying a preset would silently not redraw the canvas until some unrelated interaction forced a re-render:

```ts
  function applyPreset(id: string) {
    presets.applyTo(
      id,
      sessionRef.current.layers(),
      (newLayers) => {
        const stack = new LayerStack();
        stack.layers = newLayers;
        commit(stack);
      },
      (message) => setError(message)
    );
  }

  function requestApplyPreset(id: string) {
    if (sessionRef.current.layers().length > 0) {
      setPendingPresetApply(id);
      return;
    }
    applyPreset(id);
  }
```

Wire `PresetPanel`'s `onApply` to `requestApplyPreset` (in the `panels` array's `"presets"` entry, Task 3's block). **`onSave` stays `requestSavePreset` — do NOT rebind it to `presets.save` here** (the Global Constraints' "one door" rule: rebinding to `presets.save` directly would skip both the overwrite and the photo-layer-exclusion confirmations Task 3 built):

```tsx
              content: <PresetPanel
                  summaries={presets.summaries}
                  hasLayers={layers.length > 0}
                  onSave={requestSavePreset}
                  onRename={handleRenamePreset}
                  onApply={requestApplyPreset}
                />
```

Render the confirmation `Dialog`, alongside the `colorPicker` block (after it, still inside `<main className="workspace">`):

```tsx
        <Dialog
          open={pendingPresetApply !== null}
          title="Remplacer la pile de calques ?"
          description="Les masques peints sur les calques actuels seront perdus (annulable par Ctrl+Z après confirmation)."
          onClose={() => setPendingPresetApply(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPresetApply(null)}>
                Annuler
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  if (pendingPresetApply) applyPreset(pendingPresetApply);
                  setPendingPresetApply(null);
                }}
              >
                Remplacer
              </Button>
            </>
          }
        />
```

`Dialog` (`./ui/Dialog`) and `Button` (`./components/ui/button`) are already imported by Task 3's `App.tsx` changes (for the photo-layer-exclusion confirmation) — reuse those same import lines, do not add a second `import { Dialog } ...`/`import { Button } ...` line. If this task is somehow implemented before Task 3 (out of the plan's dependency order — Task 3 must land first per the ordering note at the end of the design doc §7), add them exactly as Task 3 specifies.

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 5: Full test suite**

Run: `npm run test`
Expected: PASS, no regression.

- [ ] **Step 6: Lint tokens**

Run: `npm run lint:tokens`
Expected: no new violations.

- [ ] **Step 7: Commit**

```bash
git add src/hooks/usePresets.ts src/components/PresetPanel.tsx src/components/PresetPanel.css src/App.tsx
git commit -m "feat(app): apply a preset with a hard confirmation on a non-empty stack" -- src/hooks/usePresets.ts src/components/PresetPanel.tsx src/components/PresetPanel.css src/App.tsx
```

- [ ] **Step 8: Visual checkpoint (CDP, human verdict)**

Checklist:
1. Empty stack (no layers) → clicking a preset applies it immediately, no confirmation.
2. Non-empty stack → clicking a preset opens the confirmation Dialog; initial focus is on "Annuler" (verify via `document.activeElement` over CDP), not the header close button.
3. Confirm → stack is replaced AND the canvas redraws immediately (no other interaction needed); Ctrl+Z undoes back to the previous stack (undo works because `applyPreset` goes through the shared `commit` helper — `sessionRef.current.commit` + `syncSession` + `requestRender` — same path as every other mutation).
4. Cancel → stack unchanged, Dialog closes.
5. Manually edit a saved preset's JSON on disk to reference a fake effect id (e.g. `"effectId": "no-such-effect"`) alongside a real one, reload the app, apply it → the real layer applies, an `ErrorBanner` shows a message naming the missing effect, no crash.

Report the observation to Antoine; PASS/FAIL is his call.

---

### Task 5: "Mettre à jour" / "Créer une copie"

**Files:**
- Create: `src/presets/presetsDiffer.ts`
- Test: `test/presets/presetsDiffer.test.ts`
- Modify: `src/hooks/usePresets.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `PresetLayer` (Task 1), `usePresets` (Task 3/4), `LayerState[]` → `PresetLayer[]` projection (same 5-field shape as `capture`, but WITHOUT allocating a full `PresetDocument`).
- Produces (consumed by Task 5's own `App.tsx` banner, no further tasks depend on this):
  ```ts
  export function presetsDiffer(a: PresetLayer[], b: PresetLayer[]): boolean;
  ```
  ```ts
  // usePresets(store) now additionally returns:
  activePresetId: string | null;
  isDirtyOf: (currentLayers: LayerState[]) => boolean; // NOT a plain `isDirty: boolean` — App.tsx computes it per-render by calling this with the current `layers` state, see Step 6
  updateActive: (currentLayers: LayerState[]) => Promise<void>;
  copyActiveAsNew: (currentLayers: LayerState[], name: string) => Promise<void>;
  clearActive: () => void;
  ```

- [ ] **Step 1: Write the failing tests**

```ts
// test/presets/presetsDiffer.test.ts
import { describe, expect, it } from "vitest";
import { presetsDiffer } from "../../src/presets/presetsDiffer";
import type { PresetLayer } from "../../src/presets/presetTypes";

function layer(overrides: Partial<PresetLayer> = {}): PresetLayer {
  return { effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal", ...overrides };
}

describe("presetsDiffer", () => {
  it("returns false for two structurally identical single-layer arrays", () => {
    expect(presetsDiffer([layer()], [layer()])).toBe(false);
  });

  it("returns true when a param value changed", () => {
    expect(presetsDiffer([layer()], [layer({ params: { intensity: 0.9 } })])).toBe(true);
  });

  it("returns true when the layer order changed", () => {
    const a = [layer({ effectId: "glow" }), layer({ effectId: "grain" })];
    const b = [layer({ effectId: "grain" }), layer({ effectId: "glow" })];
    expect(presetsDiffer(a, b)).toBe(true);
  });

  it("returns true when the layer count changed", () => {
    expect(presetsDiffer([layer()], [layer(), layer()])).toBe(true);
  });

  it("returns true when opacity, blendMode, or enabled changed", () => {
    expect(presetsDiffer([layer()], [layer({ opacity: 0.5 })])).toBe(true);
    expect(presetsDiffer([layer()], [layer({ blendMode: "screen" })])).toBe(true);
    expect(presetsDiffer([layer()], [layer({ enabled: false })])).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test -- test/presets/presetsDiffer.test.ts`
Expected: FAIL — `Cannot find module '../../src/presets/presetsDiffer'`.

- [ ] **Step 3: Implement `src/presets/presetsDiffer.ts`**

```ts
// src/presets/presetsDiffer.ts
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test -- test/presets/presetsDiffer.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 5: Extend `usePresets` with active-preset tracking**

Add to `src/hooks/usePresets.ts`:

```ts
import { presetsDiffer } from "../presets/presetsDiffer";
import type { PresetLayer } from "../presets/presetTypes";

function toPresetLayers(layers: LayerState[]): PresetLayer[] {
  return layers
    .filter((l) => !l.imageSource)
    .map((l) => ({ effectId: l.effectId, params: { ...l.params }, enabled: l.enabled, opacity: l.opacity, blendMode: l.blendMode }));
}
```

Inside `usePresets`, add state and derive `isDirty`:

```ts
  const [active, setActive] = useState<{ id: string; snapshot: PresetLayer[] } | null>(null);

  const isDirtyOf = useCallback(
    (currentLayers: LayerState[]) => (active ? presetsDiffer(toPresetLayers(currentLayers), active.snapshot) : false),
    [active]
  );
```

Update `applyTo` to set `active` on success (replace its body):

```ts
  const applyTo = useCallback(
    async (id: string, currentLayers: LayerState[], onApply: (layers: LayerState[]) => void, onWarning: (msg: string) => void) => {
      const preset = await store.load(id);
      const { layers: newLayers, warnings } = apply(preset, effectExists, effectParamsFor, freshId);
      onApply(newLayers);
      setActive({ id, snapshot: toPresetLayers(newLayers) });
      if (warnings.length > 0) onWarning(warnings.map((w) => w.message).join(" "));
    },
    [store]
  );

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

  const copyActiveAsNew = useCallback(
    async (currentLayers: LayerState[], name: string) => {
      const { preset } = capture(currentLayers, name);
      await store.save(preset.id, preset);
      setActive({ id: preset.id, snapshot: toPresetLayers(currentLayers) });
      await refresh();
    },
    [store, refresh]
  );

  return { summaries, refresh, save, overwrite, rename, applyTo, isDirtyOf, activePresetId: active?.id ?? null, updateActive, copyActiveAsNew };
```

**Correction from this revision's review (B7): the active preset is NOT cleared on a plain layer selection change.** design.md §5.4's original wording ("sélectionner un autre calque... efface activePresetId") turns out to be self-contradicting once traced against the actual code: `commit()` → `DocumentSession.commit` → `normalizeSelection()` (`src/application/documentSession.ts:78-82`) already resets `selectedLayerId` to `null` whenever the current selection doesn't exist in the new stack — and to edit a layer's params at all, the user must first select it. If selecting a layer also cleared `activePresetId`, the dirty banner (this task's entire purpose) could never appear: select a layer → active cleared → tweak a param → nothing left to compare against. The decision made in this revision: `activePresetId` clears on stack-shape changes only — applying a DIFFERENT preset, opening a new document, adding a layer, removing a layer — never on selection or on a param/opacity/blendMode edit. `usePresets` cannot see any of these events on its own (it only knows what `App.tsx` passes into `applyTo`/`updateActive`/`copyActiveAsNew`) — `App.tsx` (Step 6) is responsible for calling `clearActive` at the 4 real call sites. Add it:

```ts
  const clearActive = useCallback(() => setActive(null), []);

  return { summaries, refresh, save, applyTo, isDirtyOf, activePresetId: active?.id ?? null, updateActive, copyActiveAsNew, clearActive };
```

- [ ] **Step 6: Wire the dirty banner in `App.tsx`**

Compute `isDirty` from the hook. Add near `presets` (right after `const presets = usePresets(presetStoreRef.current);`, Task 3):

```ts
  const presetIsDirty = presets.isDirtyOf(layers);
```

**Where `clearActive()` actually goes — this is NOT `selectLayer`.** design.md §5.4 lists 4 events: applying a DIFFERENT preset, opening a new document, adding a layer, removing a layer. Selecting a layer or editing its params is deliberately NOT on that list — those are exactly the actions the dirty banner exists to detect ("preset modifié" only makes sense if picking a different layer or tweaking a param does NOT itself forget which preset is active). `selectLayer` (`App.tsx`, search for `const selectLayer = useCallback`) stays completely unchanged by this task:

```ts
  // UNCHANGED — do not add clearActive() here.
  const selectLayer = useCallback((id: string | null) => {
    sessionRef.current.select(id);
    setSelectedId(sessionRef.current.selectedId());
  }, []);
```

The 4 real call sites, each prepending `presets.clearActive();` as their first line (bodies otherwise unchanged — quoted from the current file so the diff is unambiguous):

```ts
  // 1. Opening a new document — search for `const openFile = useCallback`.
  //    clearActive() goes right after the new LayerStack is committed to
  //    the session, alongside the rest of this function's "new document"
  //    state resets (setImageSize/setSourcePath/setIsLaunchFile).
  const stack = new LayerStack();
  sessionRef.current.replaceDocument(stack);
  presets.clearActive();
  syncSession();
  rendererRef.current.render(sessionRef.current.layers());
  setError(null);
  // (openFile's useCallback deps array gains `presets.clearActive` — it's
  // referentially stable, from `usePresets`'s own `useCallback(..., [])`, so
  // this is a lint-satisfying addition, not a behavior change.)
```

```ts
  // 2. Adding a layer — search for `function handleAdd(effectId: string)`.
  function handleAdd(effectId: string) {
    presets.clearActive();
    const stack = currentStack();
    const id = stack.addLayer(effectId);
    commit(stack);
    selectLayer(id);
  }
```

```ts
  // 3. Removing a layer — search for `const handleRemove = useCallback`.
  const handleRemove = useCallback(
    (id: string) => {
      presets.clearActive();
      const stack = currentStack();
      if (!stack.removeLayer(id)) return;
      maskPaintersRef.current.delete(id);
      commit(stack);
    },
    [currentStack, commit, presets]
  );
```

(`handleRemove`'s existing early-return on `!stack.removeLayer(id)` — id already absent — happens AFTER `clearActive()` fires. That's an accepted, harmless over-clear: a no-op removal still forgets the active preset even though nothing changed. Moving the guard earlier would need `currentStack()`/`removeLayer` to run twice or restructure the check, for a scenario — removing an id that's already gone — that shouldn't occur through normal UI interaction.)

Also call `presets.clearActive()` when applying a DIFFERENT preset than the currently active one — inside `applyPreset` (Task 4), before calling `presets.applyTo`:

```ts
  function applyPreset(id: string) {
    if (presets.activePresetId !== id) presets.clearActive();
    presets.applyTo(
      id,
      sessionRef.current.layers(),
      (newLayers) => {
        const stack = new LayerStack();
        stack.layers = newLayers;
        commit(stack);
      },
      (message) => setError(message)
    );
  }
```

**"Mettre à jour"/"Créer une copie" route through the SAME `gateOnPhotoLayers` gate as `requestSavePreset`** (I3 — calling `presets.updateActive`/`presets.copyActiveAsNew` directly here would silently drop a photo layer without ever asking, exactly the silent-loss bug the Global Constraints forbid). Add these two request functions near `requestSavePreset`:

```ts
  function requestUpdateActive() {
    if (!presets.activePresetId) return;
    const layers = sessionRef.current.layers();
    // Reuses the active preset's own current name — updateActive keeps the
    // name unchanged, capture() only needs SOME name to run its exclusion
    // check, the actual name written is decided inside usePresets.updateActive.
    const name = presets.summaries.find((s) => s.id === presets.activePresetId)?.name ?? "";
    gateOnPhotoLayers(name, async () => {
      try {
        await presets.updateActive(layers);
      } catch (e) {
        setError(messageFromUnknown(e));
      }
    });
  }

  function requestCopyActiveAsNew(name: string) {
    const layers = sessionRef.current.layers();
    gateOnPhotoLayers(name, async () => {
      try {
        await presets.copyActiveAsNew(layers, name);
      } catch (e) {
        setError(messageFromUnknown(e));
      }
    });
  }
```

Render the banner inside the `"presets"` panel content, below `PresetPanel` (in the `panels` array's `"presets"` entry — `onSave`/`onRename` stay wired to the Task 3 gating functions, never to `presets.save`/`presets.rename` directly):

```tsx
              content: (
                <>
                  <PresetPanel
                    summaries={presets.summaries}
                    hasLayers={layers.length > 0}
                    onSave={requestSavePreset}
                    onRename={handleRenamePreset}
                    onApply={requestApplyPreset}
                  />
                  {presetIsDirty && presets.activePresetId && (
                    <div className="preset-panel__dirty-banner">
                      <span>Preset modifié.</span>
                      <Button size="sm" variant="secondary" onClick={requestUpdateActive}>
                        Mettre à jour
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setPendingPresetCopyName("")}>
                        Créer une copie
                      </Button>
                    </div>
                  )}
                </>
              )
```

Add `pendingPresetCopyName` state (a simple inline-name-prompt gate, same pattern as `colorPicker`'s presence check) near `pendingPresetApply`:

```ts
  const [pendingPresetCopyName, setPendingPresetCopyName] = useState<string | null>(null);
```

Render a minimal copy-name `Dialog` alongside the apply-confirmation one:

```tsx
        <Dialog
          open={pendingPresetCopyName !== null}
          title="Créer une copie du preset"
          onClose={() => setPendingPresetCopyName(null)}
          actions={
            <>
              <Button variant="secondary" autoFocus onClick={() => setPendingPresetCopyName(null)}>
                Annuler
              </Button>
              <Button
                variant="default"
                disabled={!pendingPresetCopyName || pendingPresetCopyName.trim() === ""}
                onClick={() => {
                  if (pendingPresetCopyName) requestCopyActiveAsNew(pendingPresetCopyName.trim());
                  setPendingPresetCopyName(null);
                }}
              >
                Créer
              </Button>
            </>
          }
        >
          <input
            type="text"
            className="preset-panel__name-input"
            placeholder="Nom du nouveau preset"
            value={pendingPresetCopyName ?? ""}
            onChange={(e) => setPendingPresetCopyName(e.target.value)}
          />
        </Dialog>
```

Add the `.preset-panel__dirty-banner` rule to `PresetPanel.css`:

```css
.preset-panel__dirty-banner {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  padding: var(--space-2);
  background: var(--status-warning-bg);
  border-radius: var(--radius-control);
  font-size: var(--font-size-sm);
}
```

`--surface-warning` (the plan's earlier draft) does not exist anywhere in `src/design/*.css` — confirmed by grep. The project DOES already have a real warning-family token: `--status-warning-bg` (`src/design/semantic.css:68`, alongside `--status-warning`/`--status-warning-text`) — used directly above, no fallback needed and no new token to add (the Global Constraints' "add a token if none exists" clause doesn't apply here, since one already does).

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 8: Full test suite**

Run: `npm run test`
Expected: PASS, no regression.

- [ ] **Step 9: Lint tokens**

Run: `npm run lint:tokens`
Expected: no new violations.

- [ ] **Step 10: Commit**

```bash
git add src/presets/presetsDiffer.ts test/presets/presetsDiffer.test.ts src/hooks/usePresets.ts src/App.tsx src/components/PresetPanel.css
git commit -m "feat(app): update-active-preset / copy-as-new banner after params drift" -- src/presets/presetsDiffer.ts test/presets/presetsDiffer.test.ts src/hooks/usePresets.ts src/App.tsx src/components/PresetPanel.css
```

- [ ] **Step 11: Visual checkpoint (CDP, human verdict)**

Checklist:
1. Apply a preset, then tweak one of its params in Réglages → the dirty banner appears in the Presets card.
2. Select a DIFFERENT layer (no param edit) → the banner stays exactly as it was (still dirty if it was dirty, still absent if it wasn't) — selection alone never clears `activePresetId` (B7's correction; this is the opposite of what an earlier draft of this plan would have shown).
3. Click "Mettre à jour" → the preset's saved file (on disk) now matches the current stack; banner disappears.
4. Apply a preset, tweak a param, click "Créer une copie", type a name, confirm → a NEW preset entry appears (original unchanged); banner disappears (the new copy becomes `activePresetId`).
5. Add or remove a layer while a preset is active (even without touching any param) → banner disappears (`activePresetId` cleared) — matches the 4-event list this task actually implements (apply a different preset / open a new document / add a layer / remove a layer).
6. With a photo layer in the stack, apply a preset, tweak a param, click "Mettre à jour" → the photo-layer-exclusion confirmation appears (same gate as saving), listing the excluded layer; only on confirm does the file update.

Report the observation to Antoine; PASS/FAIL is his call.

---

### Task 6: Export / Import JSON

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/launch.ts`
- Modify: `src/presets/presetStore.ts`
- Test: `test/presets/presetImportValidation.test.ts`
- Create: `src/presets/presetImportValidation.ts`
- Test: `test/presets/presetImportNaming.test.ts`
- Create: `src/presets/presetImportNaming.ts`
- Modify: `src/components/PresetPanel.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `PresetDocument`/`PRESET_SCHEMA_VERSION` (Task 1), `PresetStore` (Task 2).
- Produces:
  ```ts
  export function validatePresetDocument(raw: unknown): { valid: true; doc: PresetDocument } | { valid: false; error: string };
  export function resolveImportName(existingNames: string[], incomingName: string): string;
  ```
  `PresetStore.exportTo`/`importFrom` become real implementations (Task 2 left them throwing). `importFrom` internally calls `resolveImportName` against the current `list()` before returning the (possibly renamed) document — **decided by Antoine 2026-07-26** (design doc §9): a name collision on import is neither silent nor blocking, the incoming preset is renamed `"<name> (copie)"`, then `"(copie 2)"`, `"(copie 3)"`, ... (first free suffix), never the previously-proposed silent-duplicate default.

- [ ] **Step 1: Add the 4 Family-B Rust commands**

Insert into `src-tauri/src/lib.rs`, after `delete_preset` (Task 2's last command) and before `log_diagnostic`:

```rust
fn is_json_path(path: &str) -> bool {
    path.to_ascii_lowercase().ends_with(".json")
}

/// Dialogue "enregistrer sous..." filtré .json — même contournement `rfd`
/// que `pick_export_folder` (bug IPC connu de `tauri-plugin-dialog`).
#[tauri::command]
fn pick_preset_export_path(default_file_name: String) -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Preset shaderlab", &["json"])
        .set_file_name(&default_file_name)
        .save_file()
        .map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn export_preset(path: String, contents: String) -> Result<(), String> {
    if !is_json_path(&path) {
        return Err(format!("Refus d'écrire {path} : seuls les fichiers .json sont autorisés."));
    }
    ensure_parent_dir(&path)?;
    write_atomic(&path, contents.as_bytes())
}

#[tauri::command]
fn pick_preset_import_path() -> Option<String> {
    rfd::FileDialog::new()
        .add_filter("Preset shaderlab", &["json"])
        .pick_file()
        .map(|p| p.to_string_lossy().into_owned())
}

/// Lecture brute uniquement — AUCUNE validation de schéma ici (design.md
/// §5.6, §4.2): la structure PresetDocument est validée côté TS
/// (`presetImportValidation.ts`), Rust ne fait que de l'IO texte, même
/// partage des responsabilités que le reste du projet (voir `read_preset`).
#[tauri::command]
fn import_preset(path: String) -> Result<String, String> {
    fs::read_to_string(&path).map_err(|e| format!("Lecture du fichier {path} échouée: {e}"))
}
```

- [ ] **Step 2: Register the 4 commands**

In `tauri::generate_handler![...]`, add after `delete_preset`:

```rust
            delete_preset,
            pick_preset_export_path,
            export_preset,
            pick_preset_import_path,
            import_preset
```

- [ ] **Step 3: Add the failing Rust test for `is_json_path`**

Add to the `#[cfg(test)] mod tests` block:

```rust
    #[test]
    fn json_paths_are_accepted_case_insensitively() {
        assert!(is_json_path("C:\\presets\\Mon Preset.JSON"));
        assert!(is_json_path("preset.json"));
    }

    #[test]
    fn non_json_paths_are_rejected() {
        assert!(!is_json_path("C:\\presets\\preset.json.exe"));
        assert!(!is_json_path("preset.txt"));
        assert!(!is_json_path("sans-extension"));
    }
```

Run: `cd src-tauri && cargo test json_paths`
Expected: PASS (added alongside the implementation above; same non-red-run rationale as Task 2 Step 3 — Rust's compile step makes a true pre-implementation red run impractical here, the check that matters is green after Steps 1-2 land).

- [ ] **Step 4: Verify Rust build**

Run: `cd src-tauri && cargo check && cargo test`
Expected: 0 errors, all tests (old + new) PASS.

- [ ] **Step 5: Add `launch.ts` wrappers**

Append to `src/launch.ts`:

```ts
export async function pickPresetExportPath(defaultFileName: string): Promise<string | null> {
  return invoke<string | null>("pick_preset_export_path", { defaultFileName });
}

export async function exportPreset(path: string, contents: string): Promise<void> {
  await invoke("export_preset", { path, contents });
}

export async function pickPresetImportPath(): Promise<string | null> {
  return invoke<string | null>("pick_preset_import_path");
}

export async function importPreset(path: string): Promise<string> {
  return invoke<string>("import_preset", { path });
}
```

- [ ] **Step 6: Write the failing import-validation tests**

```ts
// test/presets/presetImportValidation.test.ts
import { describe, expect, it } from "vitest";
import { validatePresetDocument } from "../../src/presets/presetImportValidation";
import { PRESET_SCHEMA_VERSION } from "../../src/presets/presetTypes";

const valid = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: "p1",
  name: "Valide",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  layers: [{ effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal" }],
};

describe("validatePresetDocument", () => {
  it("accepts a well-formed document", () => {
    const result = validatePresetDocument(valid);
    expect(result.valid).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validatePresetDocument("not json").valid).toBe(false);
    expect(validatePresetDocument(null).valid).toBe(false);
    expect(validatePresetDocument(42).valid).toBe(false);
  });

  it("rejects a missing schemaVersion", () => {
    const { schemaVersion, ...rest } = valid;
    expect(validatePresetDocument(rest).valid).toBe(false);
  });

  it("rejects a schemaVersion newer than PRESET_SCHEMA_VERSION", () => {
    const result = validatePresetDocument({ ...valid, schemaVersion: PRESET_SCHEMA_VERSION + 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/schemaVersion/);
  });

  it("rejects a malformed layers entry (missing effectId)", () => {
    const bad = { ...valid, layers: [{ params: {}, enabled: true, opacity: 1, blendMode: "normal" }] };
    expect(validatePresetDocument(bad).valid).toBe(false);
  });

  it("rejects layers that isn't an array", () => {
    expect(validatePresetDocument({ ...valid, layers: "oops" }).valid).toBe(false);
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `npm run test -- test/presets/presetImportValidation.test.ts`
Expected: FAIL — `Cannot find module '../../src/presets/presetImportValidation'`.

- [ ] **Step 8: Implement `src/presets/presetImportValidation.ts`**

```ts
// src/presets/presetImportValidation.ts
import { PRESET_SCHEMA_VERSION, type PresetDocument, type PresetLayer } from "./presetTypes";

function isPresetLayer(value: unknown): value is PresetLayer {
  if (typeof value !== "object" || value === null) return false;
  const l = value as Record<string, unknown>;
  return (
    typeof l.effectId === "string" &&
    typeof l.params === "object" &&
    l.params !== null &&
    typeof l.enabled === "boolean" &&
    typeof l.opacity === "number" &&
    typeof l.blendMode === "string"
  );
}

/** Validates a parsed JSON value against the PresetDocument shape BEFORE
 *  any use — a hand-edited or corrupted file must fail here with a clear
 *  message, never reach `presetDocument.apply()`/crash the app (design.md
 *  §5.6, R8). Rust's `import_preset` does zero validation by design (§4.2) —
 *  this is the ONLY place schema validation happens. */
export function validatePresetDocument(raw: unknown): { valid: true; doc: PresetDocument } | { valid: false; error: string } {
  if (typeof raw !== "object" || raw === null) {
    return { valid: false, error: "Fichier de preset invalide : contenu JSON attendu, objet introuvable." };
  }
  const d = raw as Record<string, unknown>;

  if (typeof d.schemaVersion !== "number") {
    return { valid: false, error: "Fichier de preset invalide : schemaVersion manquant." };
  }
  if (d.schemaVersion > PRESET_SCHEMA_VERSION) {
    return {
      valid: false,
      error: `Fichier de preset invalide : schemaVersion (${d.schemaVersion}) plus récent que celui supporté par cette version de l'app (${PRESET_SCHEMA_VERSION}).`,
    };
  }
  if (typeof d.name !== "string" || typeof d.id !== "string" || typeof d.createdAt !== "string" || typeof d.updatedAt !== "string") {
    return { valid: false, error: "Fichier de preset invalide : champs id/name/createdAt/updatedAt manquants ou mal typés." };
  }
  if (!Array.isArray(d.layers) || !d.layers.every(isPresetLayer)) {
    return { valid: false, error: "Fichier de preset invalide : le tableau layers est absent ou contient une entrée malformée." };
  }

  return { valid: true, doc: raw as PresetDocument };
}
```

- [ ] **Step 9: Run tests to verify they pass**

Run: `npm run test -- test/presets/presetImportValidation.test.ts`
Expected: PASS, all cases green.

- [ ] **Step 10: Write the failing tests for `resolveImportName`**

**Decided by Antoine 2026-07-26** (design doc §9): an import that collides on `name` gets renamed `"<name> (copie)"`, then `"(copie 2)"`, `"(copie 3)"`, ... — this is pure logic and MUST have its own unit-tested suite (Antoine's instruction verbatim), covering: no collision (name unchanged), one collision, two successive collisions, and a name that already contains `"(copie)"` (proves the suffix sequence still terminates on a free name instead of looping or re-colliding).

```ts
// test/presets/presetImportNaming.test.ts
import { describe, expect, it } from "vitest";
import { resolveImportName } from "../../src/presets/presetImportNaming";

describe("resolveImportName", () => {
  it("returns the name unchanged when there is no collision", () => {
    expect(resolveImportName(["Autre preset"], "Mon preset")).toBe("Mon preset");
    expect(resolveImportName([], "Mon preset")).toBe("Mon preset");
  });

  it("appends ' (copie)' on a single collision", () => {
    expect(resolveImportName(["Mon preset"], "Mon preset")).toBe("Mon preset (copie)");
  });

  it("appends ' (copie 2)' when '(copie)' is also already taken", () => {
    expect(resolveImportName(["Mon preset", "Mon preset (copie)"], "Mon preset")).toBe("Mon preset (copie 2)");
  });

  it("keeps incrementing across further successive collisions", () => {
    const existing = ["Mon preset", "Mon preset (copie)", "Mon preset (copie 2)", "Mon preset (copie 3)"];
    expect(resolveImportName(existing, "Mon preset")).toBe("Mon preset (copie 4)");
  });

  it("still resolves to a name absent from existingNames when the incoming name already contains '(copie)'", () => {
    const existing = ["Mon preset (copie)"];
    const resolved = resolveImportName(existing, "Mon preset (copie)");
    expect(existing).not.toContain(resolved);
    expect(resolved).not.toBe("Mon preset (copie)");
  });

  it("does not loop forever across many successive collisions (termination guard)", () => {
    const existing = ["N", ...Array.from({ length: 50 }, (_, i) => (i === 0 ? "N (copie)" : `N (copie ${i + 1})`))];
    const resolved = resolveImportName(existing, "N");
    expect(existing).not.toContain(resolved);
  });
});
```

- [ ] **Step 11: Run tests to verify they fail**

Run: `npm run test -- test/presets/presetImportNaming.test.ts`
Expected: FAIL — `Cannot find module '../../src/presets/presetImportNaming'`.

- [ ] **Step 12: Implement `src/presets/presetImportNaming.ts`**

```ts
// src/presets/presetImportNaming.ts

/** Yields "<name> (copie)", "<name> (copie 2)", "<name> (copie 3)", ...
 *  indefinitely — same shape as `candidateCopyPaths` in
 *  `src/export/exportImage.ts` (the project's existing "-edited"/"-edited-N"
 *  generator), reused as the pattern rather than reinvented. */
function* candidateImportNames(name: string): Generator<string> {
  yield `${name} (copie)`;
  let counter = 2;
  while (true) {
    yield `${name} (copie ${counter})`;
    counter += 1;
  }
}

/** Decided by Antoine 2026-07-26 (design.md §9, P3): an import colliding on
 *  `name` with an existing preset is renamed to the first free
 *  "<name> (copie[ N])" suffix — never silently duplicated, never blocked.
 *  Pure function of `existingNames`/`incomingName`; `presetStore.importFrom`
 *  is the only caller, supplying `list().map(s => s.name)`. */
export function resolveImportName(existingNames: string[], incomingName: string): string {
  if (!existingNames.includes(incomingName)) return incomingName;
  const taken = new Set(existingNames);
  for (const candidate of candidateImportNames(incomingName)) {
    if (!taken.has(candidate)) return candidate;
  }
  /* istanbul ignore next -- candidateImportNames never terminates on its
   * own; TS control-flow analysis can't prove that, so this satisfies the
   * "string" return type without ever actually running. */
  throw new Error("unreachable");
}
```

- [ ] **Step 13: Run tests to verify they pass**

Run: `npm run test -- test/presets/presetImportNaming.test.ts`
Expected: PASS, all 6 cases green.

- [ ] **Step 14: Implement `exportTo`/`importFrom` in `presetStore.ts`**

Replace both throwing stubs in `TauriPresetStore` (Task 2, Step 8):

```ts
  async exportTo(defaultFileName: string, doc: PresetDocument): Promise<boolean> {
    const path = await pickPresetExportPath(defaultFileName);
    if (!path) return false;
    await exportPreset(path, JSON.stringify(doc, null, 2));
    return true;
  }

  async importFrom(): Promise<PresetDocument | null> {
    const path = await pickPresetImportPath();
    if (!path) return null;
    const raw = JSON.parse(await importPreset(path));
    const result = validatePresetDocument(raw);
    if (!result.valid) throw new Error(result.error);
    // Decided by Antoine 2026-07-26 (design.md §9, P3): a name collision is
    // renamed to the first free "(copie[ N])" suffix, never silently
    // duplicated — resolveImportName is pure, this.list() supplies the
    // current names to check against.
    const existingNames = (await this.list()).map((s) => s.name);
    const resolvedName = resolveImportName(existingNames, result.doc.name);
    return { ...result.doc, id: crypto.randomUUID(), name: resolvedName }; // jamais l'id du fichier importé (design.md §5.6)
  }
```

Update the imports at the top of `src/presets/presetStore.ts`:

```ts
import { listPresetIds, readPreset, writePreset, deletePreset, pickPresetExportPath, exportPreset, pickPresetImportPath, importPreset } from "../launch";
import { validatePresetDocument } from "./presetImportValidation";
import { resolveImportName } from "./presetImportNaming";
```

`InMemoryPresetStore`'s stubs stay throwing — no test exercises export/import through the in-memory double (design.md doesn't require it, and Task 6's own tests target `validatePresetDocument`/`resolveImportName`/the Rust functions directly instead).

- [ ] **Step 15: Add Export/Import buttons to `PresetPanel.tsx`**

```tsx
// src/components/PresetPanel.tsx — additional props/rows (on top of Task 3/4's onSave/onRename/onApply)
export interface PresetPanelProps {
  summaries: PresetSummary[];
  hasLayers: boolean;
  onSave: (name: string) => void;
  onRename: (id: string, name: string) => void;
  onApply: (id: string) => void;
  onExport: (id: string) => void;
  onImport: () => void;
}
```

Add an "Importer" button near the save row, and an inline "Exporter" affordance per NON-editing row (the editing-row branch, Task 3, is untouched — you don't export a preset mid-rename):

```tsx
      <div className="preset-panel__save-row">
        {/* ...unchanged name input + Enregistrer button... */}
        <Button variant="ghost" size="sm" onClick={onImport}>
          Importer
        </Button>
      </div>
      {/* ...editing-row branch (Task 3) unchanged. Non-editing row gains an export button: */}
              <li key={summary.id} className="preset-panel__row">
                <button
                  type="button"
                  className="preset-panel__row-name"
                  onClick={() => handleNameClick(summary.id)}
                  onDoubleClick={() => handleNameDoubleClick(summary)}
                >
                  {summary.name}
                </button>
                <Button variant="ghost" size="sm" onClick={() => onExport(summary.id)}>
                  Exporter
                </Button>
              </li>
```

- [ ] **Step 16: Wire `App.tsx`**

Add handlers near `applyPreset`. Both wrapped in `try/catch` (I1 — `exportPresetFile`'s earlier draft had none; a picker cancel, a disk-full write, or a load failure would otherwise reject silently with nothing shown to the user). `importPresetFile` already had this shape correctly in the earlier draft — kept as the reference pattern:

```ts
  async function exportPresetFile(id: string) {
    try {
      const doc = await presetStoreRef.current.load(id);
      const sanitized = doc.name.replace(/[\\/:*?"<>|]/g, "_");
      await presetStoreRef.current.exportTo(`${sanitized}.json`, doc);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }

  async function importPresetFile() {
    try {
      const doc = await presetStoreRef.current.importFrom();
      if (!doc) return; // annulé par l'utilisateur
      await presetStoreRef.current.save(doc.id, doc);
      await presets.refresh();
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }
```

Wire the two new `PresetPanel` props (`onSave`/`onRename` still `requestSavePreset`/`handleRenamePreset` from Task 3 — never rebound to `presets.save`/`presets.rename`, per the Global Constraints' "one door" rule):

```tsx
              content: (
                <>
                  <PresetPanel
                    summaries={presets.summaries}
                    hasLayers={layers.length > 0}
                    onSave={requestSavePreset}
                    onRename={handleRenamePreset}
                    onApply={requestApplyPreset}
                    onExport={exportPresetFile}
                    onImport={importPresetFile}
                  />
                  {/* ...dirty banner unchanged... */}
                </>
              )
```

- [ ] **Step 17: Type-check**

Run: `npx tsc --noEmit`
Expected: 0 errors.

- [ ] **Step 18: Full test suite**

Run: `npm run test`
Expected: PASS, no regression — full presets suite (Tasks 1/2/5/6) plus every pre-existing test.

- [ ] **Step 19: Lint tokens**

Run: `npm run lint:tokens`
Expected: no new violations.

- [ ] **Step 20: Commit**

```bash
git add src-tauri/src/lib.rs src/launch.ts src/presets/presetStore.ts src/presets/presetImportValidation.ts test/presets/presetImportValidation.test.ts src/presets/presetImportNaming.ts test/presets/presetImportNaming.test.ts src/components/PresetPanel.tsx src/App.tsx
git commit -m "feat(presets): export/import JSON with schema validation and copy-renaming on name collision" -- src-tauri/src/lib.rs src/launch.ts src/presets/presetStore.ts src/presets/presetImportValidation.ts test/presets/presetImportValidation.test.ts src/presets/presetImportNaming.ts test/presets/presetImportNaming.test.ts src/components/PresetPanel.tsx src/App.tsx
```

- [ ] **Step 21: Visual checkpoint (CDP, human verdict)**

Checklist:
1. Export a preset → native save dialog opens (filtered to `.json`), file lands at the chosen path with the preset's exact saved content.
2. Import that same file → native open dialog opens, a NEW entry appears in the list under the SAME name suffixed `" (copie)"` (a fresh id, `resolveImportName` renamed it because the original name is still present locally).
3. Import it a second time → a THIRD entry appears, named `" (copie 2)"` (proves the suffix sequence keeps advancing, not just appending `"(copie)"` again).
4. Hand-edit the exported file to remove `"schemaVersion"` entirely, then import it → `ErrorBanner` shows the exact validation message, no crash, nothing added to the list.
5. Hand-edit the exported file to set `"schemaVersion": 999`, import it → same clean rejection, message names the version mismatch.

Report the observation to Antoine; PASS/FAIL is his call.

---

## Self-review (updated in the revision that fixed the 7 blockers / 3 coverage gaps / 8 importants raised by adversarial review, 2026-07-26)

**1. PRD § Presets coverage** — every bullet in `PRD.md:55-89` has a task, and the two gaps this section previously left open are now CLOSED, not deferred:
- Capture without masks → T1 (`capture`).
- Confirmation on non-empty stack apply → T4.
- **Confirmation on save-under-existing-name (C1, PRD.md:63-64) → now built, T3.** `requestSavePreset` checks `presets.summaries` for a name collision BEFORE the photo-layer-exclusion check; on collision it blocks on a dedicated overwrite `Dialog`, and only on confirm does it proceed to the photo-layer gate. The two confirmations chain in a fixed order (overwrite first, exclusion second) and either one's Cancel aborts the whole save — this ordering and its cancel semantics are documented inline in T3.
- **Rename by double-click (C2, PRD.md:64-65) → now built, T3.** Double-clicking a preset's name swaps it for a pre-selected text input; Enter/blur commits via the newly-wired `PresetStore.rename` (T2, previously an orphaned method), Escape or an empty/unchanged name cancels without writing. Disambiguated from T4's single-click-to-apply via a short delayed-click pattern (see T4 Step 2) so a real double click never fires two applies first.
- Update vs copy after param drift → T5, and now correctly gated on the SAME photo-layer-exclusion check as a plain save (I3 — `requestUpdateActive`/`requestCopyActiveAsNew` both route through `gateOnPhotoLayers`, they no longer call `presets.updateActive`/`copyActiveAsNew` directly).
- Missing-effect degradation → T1 (`apply`) + T4 (banner via `setError`).
- Export/Import JSON → T6.
- **PresetPanel Storybook coverage (C3, PRD.md:143-147) → now built, T3** (`src/components/PresetPanel.stories.tsx`, empty/3-presets/no-layers states, matching the shape of every sibling panel's story).
- Docked card, first in column, `useContextualPanel`+`PanelRail` integration → T3.
- Photo-layer exclusion at capture requires a BLOCKING confirmation, not a silent warning (design doc §9, decided by Antoine 2026-07-26, PRD.md:129-131's "no silent loss" rule) → T3 (`pendingPhotoLayerSave` + `Dialog`, gated by `requestSavePreset`/`gateOnPhotoLayers` calling pure `capture()` before any write, and now ENUMERATING each excluded layer by position rather than only reporting a count — I2, `SkipNotice.layerIndex` added in T1).
- Import name collision resolves to `"<name> (copie[ N])"`, not silent duplication or a block (design doc §9, decided by Antoine 2026-07-26) → T6 (`resolveImportName`, unit-tested per Antoine's explicit instruction: no-collision / one collision / two successive collisions / a name already containing `"(copie)"`).

No gap is deferred to a follow-up plan in this revision — C1/C2/C3 were the three the earlier draft left open, and this revision built all three inside T3 rather than reopening them with Antoine, since none required a product decision Antoine hadn't already made (design doc §9 + this review's mission both specified enough to implement without guessing).

**2. Placeholder-pattern hunt** — grepped this plan's own text for "TODO", "à compléter", "similaire à la tâche", "gestion d'erreur appropriée": none found. Every "not implemented until Task N" stub (T2's `exportTo`/`importFrom`) names the exact task that replaces it and is itself a real, compiling throwing implementation, not a comment placeholder.

**3. Type/name consistency across tasks** — cross-checked:
- `PresetLayer`/`PresetDocument`/`SkipNotice` (now carrying `layerIndex`)/`ApplyWarning` (T1) used identically in T2 (`PresetStore`), T4 (`apply`/`applyTo`), T5 (`toPresetLayers`/`presetsDiffer`), T6 (`validatePresetDocument`).
- `usePresets`'s return shape grows monotonically: T3 `{summaries, refresh, save, overwrite, rename}` → T4 adds `applyTo` → T5 adds `isDirtyOf, activePresetId, updateActive, copyActiveAsNew, clearActive` → T6 touches nothing on the hook (only `PresetPanel`/`App.tsx`/`presetStore.ts`). No task removes or renames a field a later task depends on; every `return { ... }` statement shown in a later task's step includes every field the previous task's step returned (verified line-by-line while writing this revision, not just asserted).
- `freshId` exported in T1 is imported by name in T4's `usePresets.ts` — same identifier, same module path (`../layers/layerStack`).
- `PresetStore.exportTo`/`importFrom` signatures declared in T2 match their T6 implementations exactly (`exportTo(defaultFileName, doc): Promise<boolean>`, `importFrom(): Promise<PresetDocument | null>`).
- `Dialog`'s `children` is now optional (T3 Step 0, B1) — every self-closing `<Dialog ... />` across T3/T4 type-checks; `PresetPanel.tsx`'s `dialog.css` import gap (B5) is fixed by the same T3 step that fixes `children`.
- `Dialog`/`Button` are imported once, in T3 (for `pendingPhotoLayerSave`'s confirmation) — T4's own confirmation (`pendingPresetApply`) explicitly notes reusing those same import lines instead of re-declaring them, avoiding a duplicate-import compile error if both tasks touch `App.tsx`'s import block.
- `resolveImportName(existingNames, incomingName)` (T6) is called exactly once, inside `TauriPresetStore.importFrom`, with `(await this.list()).map(s => s.name)` as `existingNames` — no other module reimplements name-collision resolution.
- `gateOnPhotoLayers` (T3) is the single choke point every write path funnels through — `requestSavePreset`/the overwrite Dialog's confirm handler (T3), `requestUpdateActive`/`requestCopyActiveAsNew` (T5) — never `presets.save`/`overwrite`/`updateActive`/`copyActiveAsNew` called directly from a click handler. This is the Global Constraints' "one door" rule made concrete; grepped this plan's own `App.tsx` snippets for `presets.save(`/`presets.overwrite(`/`presets.updateActive(`/`presets.copyActiveAsNew(` outside of `commitSavePreset`/`requestUpdateActive`/`requestCopyActiveAsNew` — none found.
- All CSS token names used across T3/T5's `PresetPanel.css` snippets (`--surface-inset`, `--border-default`, `--text-primary`, `--text-secondary`, `--radius-control`, `--font-size-sm`, `--space-1/2/3/4`, `--surface-hover`, `--status-warning-bg`) were verified against `src/design/{primitives,semantic,components}.css` while writing this revision — none are invented.
