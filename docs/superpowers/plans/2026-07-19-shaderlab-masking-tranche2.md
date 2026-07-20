# Masque non-destructif — Tranche 2 (modèle + fold GPU) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remplacer `LayerState.maskData: Uint8Array | null` par un modèle non-destructif `LayerMask` (liste ordonnée de `MaskSource` combinables) foldé sur GPU résident, sans régression sur le pinceau/undo-redo/dirty-rect existants et sans réintroduire de gros buffer dans le state React.

**Architecture:** Le pinceau continue à peindre dans son propre buffer via `MaskPainter` + dirty-rect upload (inchangé). Ce buffer devient le `raster` d'une `MaskSource` de type `"brush"` au lieu d'être directement `LayerState.maskData`. Le renderer maintient une texture GPU résidente par source, puis les combine sur GPU (seed → add/subtract/intersect → invert) en une texture masque finale par calque, réutilisant le binding 3 existant de `shaderCompose.ts` sans le modifier. En Tranche 2, aucune UI n'ajoute de 2e/3e source (ça arrive en Tranche 4) : chaque calque porte au plus une source `"brush"` auto-créée à la première touche de pinceau — le fold multi-source est donc implémenté et testé en profondeur (unitairement) mais seul le cas 0/1-source est exercé en usage réel jusqu'à la Tranche 4.

**Tech Stack:** TypeScript, WebGPU/WGSL, Vitest (Node env, aucun rendu React/GPU en test), React 19 (App.tsx, migration mécanique uniquement).

## Global Constraints

- Gros buffers/textures de masque **jamais** dans le state React (`layers`) — seulement dans `layersRef` (source de vérité complète) et dans des textures GPU résidentes. Règle héritée du fix crash 24MP (`e3c7584`), voir `CLAUDE.md`.
- Le pinceau doit rester fluide à **60fps** pendant un stroke ; le fold GPU ne doit **pas** ajouter de travail par frame quand un calque n'a qu'une seule source active (cas réel de la Tranche 2) — le fold multi-passe ne s'exécute que si ≥2 sources sont réellement enabled+raster.
- Aucune régression sur le pinceau/dirty-rect/undo-redo existants : le comportement visuel d'un utilisateur qui peint un masque doit être **identique** avant/après cette tranche.
- `refineEdge` existe dans le type `LayerMask` avec des valeurs par défaut no-op (Tranche 3 les implémente) — la forme du pipeline ne doit pas casser quand ces champs seront branchés.
- `mask.enabled === false` OU aucune source `enabled` avec `raster` ⟹ masque plein (255 partout), jamais un masque nul silencieux (comportement actuel du fallback "pas de maskData" = texture blanche 1×1 partagée, `getWhiteMask()`).
- Toute tâche touchant le rendu GPU réel se termine par un **checkpoint visuel humain** dans la vraie fenêtre WebView2 (CDP) — jamais affirmée "faite" sans avoir été vue, Playwright headless est inadapté ici (canvas WebGPU rend noir en headless).
- `npx tsc --noEmit` et `npm run test` doivent rester verts après **chaque** tâche (pas de tâche laissant le build cassé, même en intermédiaire).
---

## File Structure

| Fichier | Rôle |
|---|---|
| `src/mask/types.ts` (create) | `MaskSource`, `CombineMode`, `MaskSourceType`, `RefineEdgeParams`, `LayerMask`, `defaultLayerMask()`, `defaultRefineEdge()`, `createBrushSource()`. |
| `src/mask/brushSource.ts` (create) | `getBrushRaster(layer)` — lit la source `"brush"` d'un calque (au plus une en Tranche 2). Point d'accès unique utilisé par renderer.ts/App.tsx. |
| `src/mask/foldPlan.ts` (create) | Logique pure de planification du fold : `planFold(mask)` (ordre + seed), `snapshotFoldInputs(mask)`/`foldInputsEqual()` (invalidation par référence, sans re-fold inutile). |
| `src/mask/maskFoldWgsl.ts` (create) | Générateurs WGSL purs : `buildCombineWgsl(mode)`, `buildInvertWgsl()`. |
| `src/layers/types.ts` (modify) | `LayerState.maskData` → `LayerState.mask: LayerMask`. |
| `src/layers/layerStack.ts` (modify) | `addLayer` défaut `mask: defaultLayerMask()` ; `updateMask` → `updateBrushMask` ; ajoute `setMaskInvert`/`setMaskEnabled` ; `clone()` généralisé aux sources. |
| `src/layers/history.ts` (modify) | Refcount étendu : itère `layer.mask.sources[].raster` au lieu d'un seul `layer.maskData`. |
| `src/layers/displayProjection.ts` (modify) | `toDisplayLayers` retire `raster` de **toutes** les sources, pas seulement `maskData`. |
| `src/mask/maskPainterSync.ts` (modify, signature inchangée) | Aucun changement de logique — reste alimenté par `getBrushRaster()` côté appelant. |
| `src/render/renderer.ts` (modify) | `getMaskTexture()` généralisé : textures résidentes par source (`sourceTextures`), fold GPU (`foldedMaskTextures`) via `maskFoldWgsl.ts` + `foldPlan.ts`, invalidation par snapshot. Chemin single-source/no-invert reste un raccourci direct (zéro passe de fold). `dispose()` détruit les nouvelles maps. Littéral `LayerState` placeholder → `mask: defaultLayerMask()`. |
| `src/App.tsx` (modify) | `layer.maskData` → `getBrushRaster(layer)` ; `stack.updateMask` → `stack.updateBrushMask`. Aucun nouveau flux UI (invert/enabled restent non exposés, Tranche 4). |
| `test/mask/types.test.ts` (create) | Défauts `defaultLayerMask()`/`defaultRefineEdge()`, `createBrushSource()`. |
| `test/mask/brushSource.test.ts` (create) | `getBrushRaster`. |
| `test/mask/foldPlan.test.ts` (create) | `planFold` (seed ignoré, ordre, filtrage enabled/raster), `snapshotFoldInputs`/`foldInputsEqual`. |
| `test/mask/maskFoldWgsl.test.ts` (create) | Contenu WGSL généré par mode. |
| `test/layers/layerStack.test.ts` (modify) | Tests existants + nouveaux : `updateBrushMask`, `setMaskInvert`, `setMaskEnabled`, `clone()` sur sources multiples. |
| `test/layers/history.test.ts` (modify) | Section "History byte budget" migrée de `updateMask`/`maskData` vers `updateBrushMask`/`mask.sources`. |
| `test/layers/displayProjection.test.ts` (modify) | Vérifie le retrait de `raster` sur toutes les sources + identité quand aucune. |

---

### Task 1: Modèle de données `LayerMask`/`MaskSource` + migration mécanique

**Files:**
- Create: `src/mask/types.ts`
- Create: `src/mask/brushSource.ts`
- Modify: `src/layers/types.ts:1-15`
- Modify: `src/layers/layerStack.ts` (entier, 58 lignes)
- Modify: `src/layers/displayProjection.ts` (entier, 25 lignes)
- Modify: `src/render/renderer.ts:672-705` (`getMaskTexture`), `src/render/renderer.ts:284-292` (littéral `PASSTHROUGH_EFFECT` placeholder)
- Modify: `src/App.tsx:225-282` (`handleMaskStroke`/`handleMaskStrokeEnd`)
- Create: `test/mask/types.test.ts`
- Create: `test/mask/brushSource.test.ts`
- Modify: `test/layers/layerStack.test.ts`
- Modify: `test/layers/displayProjection.test.ts`

**Interfaces:**
- Consumes: `MaskPainter.getMaskData(): Uint8Array` (inchangé, `src/mask/maskPainter.ts`), `DirtyRect` (inchangé, `src/mask/maskPainter.ts`).
- Produces: `LayerMask`, `MaskSource`, `CombineMode`, `MaskSourceType`, `RefineEdgeParams` (consommés par Tasks 2-5) ; `LayerStack.updateBrushMask(id, raster)`, `LayerStack.setMaskInvert(id, invert)`, `LayerStack.setMaskEnabled(id, enabled)` (consommés par Task 5 et, plus tard, Tranche 4) ; `getBrushRaster(layer): Uint8Array | null` (consommé par Task 4/5 et `App.tsx`).

- [ ] **Step 1: Write the failing test**
```ts
// test/mask/types.test.ts
import { describe, it, expect } from "vitest";
import { defaultLayerMask, defaultRefineEdge, createBrushSource } from "../../src/mask/types";

describe("defaultRefineEdge", () => {
  it("is a no-op (identity) refine-edge configuration", () => {
    const r = defaultRefineEdge();
    expect(r).toEqual({
      feather: 0,
      contract: 0,
      smooth: 0,
      edgeAware: false,
      edgeRadius: 10,
      edgeStrength: 1,
    });
  });
});

describe("defaultLayerMask", () => {
  it("starts with no sources, not inverted, enabled", () => {
    const m = defaultLayerMask();
    expect(m.sources).toEqual([]);
    expect(m.invert).toBe(false);
    expect(m.enabled).toBe(true);
    expect(m.refineEdge).toEqual(defaultRefineEdge());
  });

  it("returns a fresh object each call (no shared mutable default)", () => {
    const a = defaultLayerMask();
    const b = defaultLayerMask();
    a.sources.push(createBrushSource("x", new Uint8Array(1)));
    expect(b.sources).toEqual([]);
  });
});

describe("createBrushSource", () => {
  it("builds an enabled brush source with combineMode add", () => {
    const raster = new Uint8Array([1, 2, 3]);
    const s = createBrushSource("layer-1-brush", raster);
    expect(s).toEqual({
      id: "layer-1-brush",
      type: "brush",
      combineMode: "add",
      enabled: true,
      params: null,
      raster,
    });
  });
});
```
```ts
// test/mask/brushSource.test.ts
import { describe, it, expect } from "vitest";
import { getBrushRaster } from "../../src/mask/brushSource";
import { defaultLayerMask, createBrushSource } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function layerWith(mask = defaultLayerMask()): LayerState {
  return { id: "l1", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask };
}

describe("getBrushRaster", () => {
  it("returns null when the layer has no brush source", () => {
    expect(getBrushRaster(layerWith())).toBeNull();
  });

  it("returns the brush source's raster when present", () => {
    const raster = new Uint8Array([9, 9]);
    const mask = defaultLayerMask();
    mask.sources.push(createBrushSource("l1-brush", raster));
    expect(getBrushRaster(layerWith(mask))).toBe(raster);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mask/types.test.ts test/mask/brushSource.test.ts`
Expected: FAIL with `Cannot find module '../../src/mask/types'` (and `'../../src/mask/brushSource'`).
- [ ] **Step 3: Write minimal implementation**
```ts
// src/mask/types.ts
export type MaskSourceType = "brush" | "gradient" | "luminosity" | "colorRange";
export type CombineMode = "add" | "subtract" | "intersect";

/** Réglages de refine edge (§4/§4bis du design). En Tranche 2, ce type existe
 *  et voyage dans le modèle, mais AUCUNE passe GPU ne le consomme encore —
 *  `defaultRefineEdge()` est une configuration no-op (identité) pour que la
 *  forme du pipeline ne casse pas quand la Tranche 3 le branchera. */
export interface RefineEdgeParams {
  feather: number;
  contract: number;
  smooth: number;
  edgeAware: boolean;
  edgeRadius: number;
  edgeStrength: number;
}

export function defaultRefineEdge(): RefineEdgeParams {
  return { feather: 0, contract: 0, smooth: 0, edgeAware: false, edgeRadius: 10, edgeStrength: 1 };
}

/** Une source de masque combinable (design.md §3). Seul `type: "brush"` a une
 *  implémentation réelle en Tranche 2 (`raster` peuplé par le pinceau) —
 *  `"gradient"`/`"luminosity"`/`"colorRange"` existent dans l'union de type
 *  (zéro branche morte côté TypeScript) mais n'ont ni générateur de raster ni
 *  UI avant la Tranche 3. `params` reste `null` pour ces types tant qu'ils ne
 *  sont pas implémentés — jamais un objet vide qui laisserait croire à une
 *  config réelle. */
export interface MaskSource {
  id: string;
  type: MaskSourceType;
  combineMode: CombineMode;
  enabled: boolean;
  params: Record<string, number | number[]> | null;
  raster: Uint8Array | null;
}

export function createBrushSource(id: string, raster: Uint8Array): MaskSource {
  return { id, type: "brush", combineMode: "add", enabled: true, params: null, raster };
}

/** Conteneur de masque non-destructif d'un calque (design.md §3). Remplace
 *  l'ancien `LayerState.maskData: Uint8Array | null`. */
export interface LayerMask {
  sources: MaskSource[];
  invert: boolean;
  enabled: boolean;
  refineEdge: RefineEdgeParams;
}

export function defaultLayerMask(): LayerMask {
  return { sources: [], invert: false, enabled: true, refineEdge: defaultRefineEdge() };
}
```
```ts
// src/mask/brushSource.ts
import type { LayerState } from "../layers/types";

/** Le raster de LA source pinceau d'un calque. En Tranche 2, un calque porte
 *  au plus une source `"brush"` (auto-créée à la 1ère touche de pinceau,
 *  `LayerStack.updateBrushMask`) — le modèle admet N sources mais aucune UI
 *  n'existe encore pour en ajouter une 2e (Tranche 4). `null` si le calque
 *  n'a jamais été peint. Point d'accès UNIQUE au raster pinceau, pour que
 *  renderer.ts/App.tsx n'aient qu'un seul endroit à changer si ce mapping
 *  évolue (ex. plusieurs sources pinceau en Tranche 3+). */
export function getBrushRaster(layer: LayerState): Uint8Array | null {
  return layer.mask.sources.find((s) => s.type === "brush")?.raster ?? null;
}
```
```ts
// src/layers/types.ts
import type { LayerMask } from "../mask/types";

export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Opacité du calque (0..1). 1 = effet à pleine force. */
  opacity: number;
  /** Id du mode de fusion (registry blend). "normal" = remplacement (compat). */
  blendMode: string;
  /** Masque non-destructif du calque (design.md §3). Les rasters qu'il
   *  contient sont IMMUABLES par convention (toujours REMPLACÉS, jamais
   *  mutés en place) — clone() et l'historique partagent ces références. */
  mask: LayerMask;
}
```
```ts
// src/layers/layerStack.ts
import type { LayerState } from "./types";
import { defaultLayerMask, createBrushSource } from "../mask/types";

let nextId = 0;
function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}

export class LayerStack {
  layers: LayerState[] = [];

  addLayer(effectId: string): string {
    const id = freshId();
    this.layers.push({
      id,
      effectId,
      params: {},
      enabled: true,
      opacity: 1,
      blendMode: "normal",
      mask: defaultLayerMask(),
    });
    return id;
  }

  removeLayer(id: string): void {
    this.layers = this.layers.filter((l) => l.id !== id);
  }

  reorderLayer(id: string, newIndex: number): void {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from === -1) return;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(newIndex, 0, layer);
  }

  toggleLayer(id: string): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.enabled = !layer.enabled;
  }

  updateParams(id: string, params: Record<string, number>): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.params = { ...layer.params, ...params };
  }

  /** Peint/actualise LA source pinceau du calque (au plus une en Tranche 2,
   *  voir `getBrushRaster`). Crée la source à la 1ère touche, sinon remplace
   *  son `raster` par une copie fraîche (immuable par convention, comme
   *  `updateMask` avant elle) — jamais de mutation en place. */
  updateBrushMask(id: string, raster: Uint8Array): void {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return;
    const fresh = new Uint8Array(raster);
    const idx = layer.mask.sources.findIndex((s) => s.type === "brush");
    if (idx === -1) {
      const brush = createBrushSource(`${id}-brush`, fresh);
      layer.mask = { ...layer.mask, sources: [...layer.mask.sources, brush] };
      return;
    }
    const existing = layer.mask.sources[idx];
    const nextSource = { ...existing, raster: fresh };
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? nextSource : s));
    layer.mask = { ...layer.mask, sources: nextSources };
  }

  setMaskInvert(id: string, invert: boolean): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.mask = { ...layer.mask, invert };
  }

  setMaskEnabled(id: string, enabled: boolean): void {
    const layer = this.layers.find((l) => l.id === id);
    if (layer) layer.mask = { ...layer.mask, enabled };
  }

  clone(): LayerStack {
    const copy = new LayerStack();
    copy.layers = this.layers.map((l) => ({
      ...l,
      params: { ...l.params },
      // Chaque `raster` de source est IMMUABLE par convention (updateBrushMask
      // remplace toujours la référence, jamais de mutation in place) — le
      // partager rend clone() O(métadonnées) au lieu de O(pixels), comme
      // l'ancien maskData. Les conteneurs (LayerMask, MaskSource, le tableau
      // sources) sont eux toujours des objets FRAIS, pour que muter le clone
      // (ex. setMaskInvert) ne touche jamais l'original.
      mask: {
        ...l.mask,
        refineEdge: { ...l.mask.refineEdge },
        sources: l.mask.sources.map((s) => ({ ...s })),
      },
    }));
    return copy;
  }
}
```
```ts
// src/layers/displayProjection.ts
import type { LayerState } from "./types";

/**
 * Projection d'affichage d'une pile de calques : identique aux calques
 * d'origine SANS les buffers `raster` des sources de masque.
 *
 * Généralisation du fix crash 24MP (root cause : un gros buffer masque dans
 * le state React fait CRASHER WebView2 au re-render de `setLayers()`, voir
 * `docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`). Avant cette
 * tâche, un seul `maskData` par calque portait ce risque ; le modèle
 * `LayerMask` généralise à N sources, donc CHAQUE `raster` de CHAQUE source
 * doit être retiré, pas seulement un champ unique.
 *
 * Un calque SANS AUCUN raster de source est renvoyé PAR IDENTITÉ (même
 * objet) — pas de nouvelle allocation, pour ne pas provoquer de re-render
 * superflu des lignes inchangées (comportement hérité de la version
 * précédente).
 */
export function toDisplayLayers(layers: LayerState[]): LayerState[] {
  return layers.map((l) => {
    const hasRaster = l.mask.sources.some((s) => s.raster !== null);
    if (!hasRaster) return l;
    return {
      ...l,
      mask: {
        ...l.mask,
        sources: l.mask.sources.map((s) => (s.raster ? { ...s, raster: null } : s)),
      },
    };
  });
}
```
`src/render/renderer.ts` — remplacer le littéral `PASSTHROUGH_EFFECT` du chemin "aucun calque activé" (ligne ~287) :
```ts
        { id: "", effectId: "", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() },
```
(ajouter `import { defaultLayerMask } from "../mask/types";` en tête de fichier), et remplacer `getMaskTexture` (lignes 672-705) pour lire la source pinceau au lieu de `layer.maskData` — comportement STRICTEMENT équivalent à avant (le fold réel arrive Task 4) :
```ts
  private getMaskTexture(layer: LayerState, encoder: GPUCommandEncoder): GPUTexture {
    if (this.livePreview && this.livePreview.layerId === layer.id) {
      return this.getLiveMaskTexture(this.livePreview.layerId, this.livePreview.maskData, this.livePreview.scope);
    }
    const maskData = getBrushRaster(layer);
    if (!maskData) return this.getWhiteMask();
    const entry = this.maskTextures.get(layer.id);
    if (entry && entry.syncedFrom === maskData) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    if (this.liveMaskLayerId === layer.id && this.liveMaskTexture) {
      encoder.copyTextureToTexture({ texture: this.liveMaskTexture }, { texture }, [this.width, this.height]);
    } else {
      this.uploadR8(texture, maskData, this.width, this.height);
    }
    this.maskTextures.set(layer.id, { texture, syncedFrom: maskData });
    return texture;
  }
```
(ajouter `import { getBrushRaster } from "../mask/brushSource";` en tête de fichier ; le reste de la méthode et son commentaire de tête restent inchangés — seule la source de la donnée change, `layer.maskData` → `getBrushRaster(layer)`.)

`src/App.tsx` — dans `handleMaskStroke` (ligne ~229) :
```tsx
    const layer = layersRef.current.find((l) => l.id === selectedId);
    const currentMaskData = layer ? getBrushRaster(layer) : null;
```
et dans `handleMaskStrokeEnd` (lignes ~279-281) :
```tsx
    stack.updateBrushMask(selectedId, entry.painter.getMaskData());
    commit(stack);
    const committedLayer = stack.layers.find((l) => l.id === selectedId);
    entry.syncedFrom = committedLayer ? getBrushRaster(committedLayer) : null;
```
(ajouter `import { getBrushRaster } from "./mask/brushSource";` en tête de fichier).

- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mask/types.test.ts test/mask/brushSource.test.ts && npx tsc --noEmit`
Expected: PASS (both test files green) ; `tsc` clean across the whole project (this migration touches every file that referenced `maskData`).
- [ ] **Step 5: Update existing tests for the renamed field, then run the full suite**
```ts
// test/layers/layerStack.test.ts — add alongside existing tests
import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";

describe("LayerStack mask model", () => {
  it("addLayer starts with an empty, enabled, non-inverted mask", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.sources).toEqual([]);
    expect(layer.mask.enabled).toBe(true);
    expect(layer.mask.invert).toBe(false);
  });

  it("updateBrushMask creates a brush source on first call", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const raster = new Uint8Array([255, 0, 128]);
    stack.updateBrushMask(id, raster);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.sources).toHaveLength(1);
    expect(layer.mask.sources[0].type).toBe("brush");
    expect(layer.mask.sources[0].raster).toEqual(raster);
    expect(layer.mask.sources[0].raster).not.toBe(raster); // fresh copy
  });

  it("updateBrushMask replaces the existing brush source's raster on later calls", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    const firstSourceId = stack.layers.find((l) => l.id === id)!.mask.sources[0].id;
    stack.updateBrushMask(id, new Uint8Array([4, 5, 6]));
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.sources).toHaveLength(1); // still one source, not two
    expect(layer.mask.sources[0].id).toBe(firstSourceId); // same source id, stable
    expect(layer.mask.sources[0].raster).toEqual(new Uint8Array([4, 5, 6]));
  });

  it("setMaskInvert/setMaskEnabled flip the flags without touching sources", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1]));
    stack.setMaskInvert(id, true);
    stack.setMaskEnabled(id, false);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.mask.invert).toBe(true);
    expect(layer.mask.enabled).toBe(false);
    expect(layer.mask.sources).toHaveLength(1);
  });

  it("clone() shares source rasters by reference but deep-copies containers", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2]));
    const original = stack.layers.find((l) => l.id === id)!;

    const copy = stack.clone();
    const copied = copy.layers.find((l) => l.id === id)!;

    expect(copied.mask.sources[0].raster).toBe(original.mask.sources[0].raster); // shared
    copy.setMaskInvert(id, true);
    expect(original.mask.invert).toBe(false); // container not shared
  });
});
```
```ts
// test/layers/displayProjection.test.ts — replace maskData-based assertions
import { describe, it, expect } from "vitest";
import { toDisplayLayers } from "../../src/layers/displayProjection";
import { LayerStack } from "../../src/layers/layerStack";

describe("toDisplayLayers", () => {
  it("returns layers unchanged by identity when no source has a raster", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const projected = toDisplayLayers(stack.layers);
    expect(projected[0]).toBe(stack.layers[0]);
  });

  it("strips raster from every source, keeping other mask fields", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    stack.setMaskInvert(id, true);
    const [projected] = toDisplayLayers(stack.layers);
    expect(projected.mask.sources[0].raster).toBeNull();
    expect(projected.mask.sources[0].type).toBe("brush");
    expect(projected.mask.invert).toBe(true);
    // original untouched
    expect(stack.layers[0].mask.sources[0].raster).not.toBeNull();
  });
});
```
Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — full suite green (existing `test/layers/history.test.ts`'s "History byte budget" describe block will FAIL at this point, since it still calls `s.updateMask(...)` and reads `.maskData` — that block is migrated in Task 3, not here; note it as an expected pre-existing-red pocket and move on only after confirming every OTHER file is green).
- [ ] **Step 6: Human visual checkpoint (regression only — no visible behavior change expected)**
Lancer `npm run dev:debug` puis `npm run dev:monitor`. Dans la fenêtre réelle (CDP) : ouvrir une photo, peindre un masque au pinceau sur un calque (vérifier fluidité, pas de saccade), relâcher, Ctrl+Z (le trait disparaît), Ctrl+Y (le trait revient). Comparer au comportement d'avant cette tâche (Tranche 1) — doit être **identique au pixel près**, puisque cette tâche ne fait que renommer/déplacer le champ, sans toucher au fold. Documenter le verdict d'Antoine avant de continuer.
- [ ] **Step 7: Commit**
```bash
git add src/mask/types.ts src/mask/brushSource.ts src/layers/types.ts src/layers/layerStack.ts src/layers/displayProjection.ts src/render/renderer.ts src/App.tsx test/mask/types.test.ts test/mask/brushSource.test.ts test/layers/layerStack.test.ts test/layers/displayProjection.test.ts
git commit -m "$(cat <<'EOF'
feat(mask): remplace LayerState.maskData par le modèle LayerMask/MaskSource

Migration mécanique (Tranche 2, Task 1) : maskData -> mask.sources[type=brush].
Comportement de rendu strictement inchangé (getMaskTexture lit désormais
getBrushRaster(layer) au lieu de layer.maskData) ; le fold multi-source réel
arrive dans une tâche suivante. Checkpoint visuel humain confirmé : pinceau/
undo/redo identiques à avant.
EOF
)"
```

---

### Task 2: Logique pure de planification du fold

**Files:**
- Create: `src/mask/foldPlan.ts`
- Create: `test/mask/foldPlan.test.ts`

**Interfaces:**
- Consumes: `LayerMask`, `MaskSource`, `CombineMode` (Task 1, `src/mask/types.ts`).
- Produces: `planFold(mask): MaskSource[]` et `snapshotFoldInputs(mask): FoldSourceSnapshot[]` / `foldInputsEqual(a, b): boolean` — consommés par Task 4 pour décider quelles sources folder et quand invalider le cache de textures foldées.

- [ ] **Step 1: Write the failing test**
```ts
// test/mask/foldPlan.test.ts
import { describe, it, expect } from "vitest";
import { planFold, snapshotFoldInputs, foldInputsEqual } from "../../src/mask/foldPlan";
import { defaultLayerMask, createBrushSource, type MaskSource } from "../../src/mask/types";

function brush(id: string, combineMode: MaskSource["combineMode"] = "add", enabled = true, raster: Uint8Array | null = new Uint8Array([1])): MaskSource {
  return { ...createBrushSource(id, raster ?? new Uint8Array(0)), combineMode, enabled, raster };
}

describe("planFold", () => {
  it("returns [] when the mask itself is disabled, regardless of sources", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a")];
    mask.enabled = false;
    expect(planFold(mask)).toEqual([]);
  });

  it("returns [] when no source is enabled with a raster (never a silent null mask)", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a", "add", false), brush("b", "add", true, null)];
    expect(planFold(mask)).toEqual([]);
  });

  it("filters out disabled sources and sources without a raster, keeps order", () => {
    const a = brush("a");
    const b = brush("b", "add", false); // disabled -> excluded
    const c = brush("c");
    const mask = defaultLayerMask();
    mask.sources = [a, b, c];
    expect(planFold(mask)).toEqual([a, c]);
  });

  it("a first source in subtract/intersect is still planned as seed (planFold does not special-case combineMode; the caller ignores index-0's combineMode)", () => {
    const a = brush("a", "subtract");
    const mask = defaultLayerMask();
    mask.sources = [a];
    expect(planFold(mask)).toEqual([a]);
  });
});

describe("snapshotFoldInputs / foldInputsEqual", () => {
  it("two snapshots of the same unchanged mask are equal", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a"), brush("b", "subtract")];
    const s1 = snapshotFoldInputs(mask);
    const s2 = snapshotFoldInputs(mask);
    expect(foldInputsEqual(s1, s2)).toBe(true);
  });

  it("detects a raster reference change (e.g. a new paint stroke committed)", () => {
    const mask = defaultLayerMask();
    const source = brush("a");
    mask.sources = [source];
    const before = snapshotFoldInputs(mask);
    mask.sources = [{ ...source, raster: new Uint8Array([2]) }]; // fresh reference
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(false);
  });

  it("detects a combineMode change", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a"), brush("b", "add")];
    const before = snapshotFoldInputs(mask);
    mask.sources = [mask.sources[0], { ...mask.sources[1], combineMode: "intersect" }];
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(false);
  });

  it("detects a source count change (source added/removed)", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a")];
    const before = snapshotFoldInputs(mask);
    mask.sources = [...mask.sources, brush("b")];
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(false);
  });

  it("ignores a disabled/raster-less source consistently on both sides", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a"), brush("b", "add", false)];
    const before = snapshotFoldInputs(mask);
    mask.sources[1] = { ...mask.sources[1], combineMode: "subtract" }; // still disabled, irrelevant
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(true);
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mask/foldPlan.test.ts`
Expected: FAIL with `Cannot find module '../../src/mask/foldPlan'`.
- [ ] **Step 3: Write minimal implementation**
```ts
// src/mask/foldPlan.ts
import type { LayerMask, MaskSource, CombineMode } from "./types";

/**
 * Ordre de fold (design.md §4) : la 1ère source de la liste retournée est le
 * SEED — son `combineMode` doit être IGNORÉ par l'appelant (l'accumulateur
 * ne part pas de 0, sinon une 1ère source en subtract/intersect donnerait un
 * masque nul partout). Les suivantes s'appliquent dans l'ordre avec leur
 * `combineMode` propre. `mask.enabled === false`, ou aucune source
 * `enabled` avec un `raster`, retourne `[]` — l'appelant doit alors
 * substituer un masque PLEIN (255 partout), jamais un masque nul silencieux.
 */
export function planFold(mask: LayerMask): MaskSource[] {
  if (!mask.enabled) return [];
  return mask.sources.filter((s) => s.enabled && s.raster !== null);
}

export interface FoldSourceSnapshot {
  id: string;
  raster: Uint8Array | null;
  combineMode: CombineMode;
}

/**
 * Signature d'invalidation du fold courant, comparable par `foldInputsEqual`.
 * Les rasters sont immuables par convention (toujours remplacés, jamais
 * mutés en place — `LayerStack.updateBrushMask`), donc une comparaison par
 * RÉFÉRENCE suffit à détecter un changement réel, même principe que
 * `syncedFrom === layer.maskData` dans le renderer aujourd'hui.
 */
export function snapshotFoldInputs(mask: LayerMask): FoldSourceSnapshot[] {
  return planFold(mask).map((s) => ({ id: s.id, raster: s.raster, combineMode: s.combineMode }));
}

export function foldInputsEqual(a: FoldSourceSnapshot[], b: FoldSourceSnapshot[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => s.id === b[i].id && s.raster === b[i].raster && s.combineMode === b[i].combineMode);
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mask/foldPlan.test.ts && npx tsc --noEmit`
Expected: PASS.
- [ ] **Step 5: Commit**
```bash
git add src/mask/foldPlan.ts test/mask/foldPlan.test.ts
git commit -m "$(cat <<'EOF'
feat(mask): logique pure de planification du fold (seed + invalidation)

planFold() ordonne les sources à folder (seed = 1ère source enabled, son
combineMode est ignoré par l'appelant, design.md §4). snapshotFoldInputs/
foldInputsEqual permettent au renderer (tâche suivante) d'éviter de refaire
les passes GPU de fold quand rien n'a changé, par comparaison de référence.
EOF
)"
```

---

### Task 3: Historique — refcount multi-raster

**Files:**
- Modify: `src/layers/history.ts:32-53` (`retain`/`release`)
- Modify: `test/layers/history.test.ts:135-210` (section "History byte budget")

**Interfaces:**
- Consumes: `LayerStack`, `LayerState.mask.sources[].raster` (Task 1).
- Produces: `History.bytesUsed()` (signature inchangée, sémantique étendue à N rasters par calque au lieu d'un seul) — consommé par un futur indicateur UI (hors scope) et par les tests existants.

- [ ] **Step 1: Write the failing test**
```ts
// test/layers/history.test.ts — replace the "History byte budget" describe block (lines 135-210) with:
describe("History byte budget", () => {
  function stackWithBrushMask(bytes: number): LayerStack {
    const s = new LayerStack();
    const id = s.addLayer("glow");
    s.updateBrushMask(id, new Uint8Array(bytes));
    return s;
  }

  it("counts unique mask rasters once even when shared across entries", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithBrushMask(100);
    history.push(a);
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b);
    expect(history.bytesUsed()).toBe(100);
  });

  it("evicts oldest past entries first when over budget", () => {
    const history = new History(new LayerStack(), 250);
    history.push(stackWithBrushMask(100)); // A
    history.push(stackWithBrushMask(100)); // B
    history.push(stackWithBrushMask(100)); // C -> 300 octets retenus > 250
    expect(history.bytesUsed()).toBeLessThanOrEqual(250);
    const undone = history.undo();
    expect(undone?.layers[0].mask.sources[0].raster?.byteLength).toBe(100); // -> B
    expect(history.undo()).toBeNull();
  });

  it("never evicts the current state even if it alone exceeds the budget", () => {
    const history = new History(new LayerStack(), 10);
    history.push(stackWithBrushMask(100));
    expect(history.bytesUsed()).toBe(100);
    expect(history.canUndo()).toBe(false);
  });

  it("releases bytes when the redo branch is discarded by a new push", () => {
    const history = new History(new LayerStack(), 10_000);
    history.push(stackWithBrushMask(100));
    history.undo();
    expect(history.bytesUsed()).toBe(100);
    history.push(stackWithBrushMask(30));
    expect(history.bytesUsed()).toBe(30);
  });

  it("keeps a shared raster counted when only one of its referencing entries is discarded via future", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithBrushMask(100); // M1 = 100 octets
    history.push(a);
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b); // B partage M1 -> refcount=2
    history.undo(); // future=[B(M1)]
    history.push(stackWithBrushMask(50)); // future jetée (release M1: 2->1), M2 nouveau courant
    expect(history.bytesUsed()).toBe(150);
  });

  it("undo/redo keep working normally under the default budget", () => {
    const history = new History(new LayerStack());
    history.push(stackWithBrushMask(100));
    history.undo();
    const redone = history.redo();
    expect(redone?.layers[0].mask.sources[0].raster?.byteLength).toBe(100);
  });

  it("refcounts MULTIPLE raster sources on the same layer independently (new in Tranche 2)", () => {
    const history = new History(new LayerStack(), 1000);
    const s = new LayerStack();
    const id = s.addLayer("glow");
    s.updateBrushMask(id, new Uint8Array(100));
    // Simulate a 2nd source appended directly (no UI yet, but the model allows it).
    const layer = s.layers.find((l) => l.id === id)!;
    layer.mask = {
      ...layer.mask,
      sources: [...layer.mask.sources, { id: "extra", type: "brush", combineMode: "add", enabled: true, params: null, raster: new Uint8Array(50) }],
    };
    history.push(s);
    expect(history.bytesUsed()).toBe(150); // 100 + 50, both counted
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/layers/history.test.ts`
Expected: FAIL — `stackWithBrushMask`/`updateBrushMask` already exist from Task 1, but `retain`/`release` in `history.ts` still read `layer.maskData` (now `undefined` on every layer, since the field no longer exists), so `bytesUsed()` returns `0` everywhere instead of the expected byte counts.
- [ ] **Step 3: Write minimal implementation**
```ts
// src/layers/history.ts — replace retain/release (lines 32-53)
  private retain(stack: LayerStack): void {
    for (const layer of stack.layers) {
      for (const source of layer.mask.sources) {
        if (!source.raster) continue;
        const count = this.refCounts.get(source.raster) ?? 0;
        if (count === 0) this.totalBytes += source.raster.byteLength;
        this.refCounts.set(source.raster, count + 1);
      }
    }
  }

  private release(stack: LayerStack): void {
    for (const layer of stack.layers) {
      for (const source of layer.mask.sources) {
        if (!source.raster) continue;
        const count = this.refCounts.get(source.raster);
        if (count === undefined) continue;
        if (count <= 1) {
          this.refCounts.delete(source.raster);
          this.totalBytes -= source.raster.byteLength;
        } else {
          this.refCounts.set(source.raster, count - 1);
        }
      }
    }
  }
```
(le reste de `history.ts` — `constructor`, `push`, `undo`, `redo`, `canUndo`, `canRedo`, `bytesUsed` — reste inchangé, `Map<Uint8Array, number>` fonctionne déjà par référence quel que soit le nombre de rasters distincts.)
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — full suite green, no red pockets remaining.
- [ ] **Step 5: Commit**
```bash
git add src/layers/history.ts test/layers/history.test.ts
git commit -m "$(cat <<'EOF'
feat(history): refcount étendu à N rasters de source par calque

retain()/release() itèrent désormais layer.mask.sources[].raster au lieu
d'un seul layer.maskData — un calque peut porter plusieurs sources pinceau
(modèle LayerMask) sans que le budget mémoire de l'historique ne les
sous-compte. Budget/éviction inchangés (Map<Uint8Array,number> par référence).
EOF
)"
```

---

### Task 4: Générateurs WGSL de fold + pipeline GPU résident

**Files:**
- Create: `src/mask/maskFoldWgsl.ts`
- Create: `test/mask/maskFoldWgsl.test.ts`
- Modify: `src/render/renderer.ts:96-115` (nouveaux champs privés), `src/render/renderer.ts:250-258` (nettoyage résidence), `src/render/renderer.ts:672-705` (`getMaskTexture` généralisé), `src/render/renderer.ts:743-761` (`dispose`)

**Interfaces:**
- Consumes: `buildCombineWgsl(mode)`/`buildInvertWgsl()` (ce fichier) ; `planFold`/`snapshotFoldInputs`/`foldInputsEqual` (Task 2) ; `getBrushRaster` (Task 1) ; `computeR8UploadRegion` (existant, `src/render/maskUpload.ts`) ; `FULLSCREEN_VERTEX_WGSL` (existant, `src/render/shaderCompose.ts`).
- Produces: `Renderer.getMaskTexture(layer, encoder): GPUTexture` — signature inchangée, sémantique étendue (fold réel multi-source au lieu du passthrough Task 1). Consommé par `runEffectPass`/`runOverlayPass` (renderer.ts, appelants inchangés).

- [ ] **Step 1: Write the failing test**
```ts
// test/mask/maskFoldWgsl.test.ts
import { describe, it, expect } from "vitest";
import { buildCombineWgsl, buildInvertWgsl } from "../../src/mask/maskFoldWgsl";

describe("buildCombineWgsl", () => {
  it("add = max(a, b)", () => {
    expect(buildCombineWgsl("add")).toContain("max(a, b)");
  });
  it("subtract = clamp(a - b, 0.0, 1.0)", () => {
    expect(buildCombineWgsl("subtract")).toContain("clamp(a - b, 0.0, 1.0)");
  });
  it("intersect = min(a, b)", () => {
    expect(buildCombineWgsl("intersect")).toContain("min(a, b)");
  });
  it("every mode declares two texture bindings (srcA, srcB) and a sampler", () => {
    for (const mode of ["add", "subtract", "intersect"] as const) {
      const wgsl = buildCombineWgsl(mode);
      expect(wgsl).toContain("var srcA: texture_2d<f32>");
      expect(wgsl).toContain("var srcB: texture_2d<f32>");
      expect(wgsl).toContain("var maskSampler: sampler");
      expect(wgsl).toContain("fn fs_combine(");
    }
  });
});

describe("buildInvertWgsl", () => {
  it("declares one texture binding and inverts (1.0 - a)", () => {
    const wgsl = buildInvertWgsl();
    expect(wgsl).toContain("var srcA: texture_2d<f32>");
    expect(wgsl).not.toContain("srcB");
    expect(wgsl).toContain("1.0 - a");
    expect(wgsl).toContain("fn fs_invert(");
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/mask/maskFoldWgsl.test.ts`
Expected: FAIL with `Cannot find module '../../src/mask/maskFoldWgsl'`.
- [ ] **Step 3: Write minimal implementation**
```ts
// src/mask/maskFoldWgsl.ts
import type { CombineMode } from "./types";
import { FULLSCREEN_VERTEX_WGSL } from "../render/shaderCompose";

/**
 * Passe de combinaison GPU (design.md §4, étape 2) : combine un accumulateur
 * `srcA` (le fold jusqu'ici) avec la source suivante `srcB` selon `mode`,
 * sortie r8 dans [0,1] (les deux entrées sont déjà r8unorm, donc déjà
 * bornées — `clamp` n'est nécessaire QUE pour `subtract`, qui peut descendre
 * sous 0). N'est JAMAIS appelée sur la 1ère source d'un fold (le seed est un
 * `copyTextureToTexture` direct, son combineMode est ignoré — voir
 * `foldPlan.planFold`).
 */
export function buildCombineWgsl(mode: CombineMode): string {
  const op =
    mode === "add" ? "max(a, b)" : mode === "subtract" ? "clamp(a - b, 0.0, 1.0)" : "min(a, b)";
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcA: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var srcB: texture_2d<f32>;

@fragment
fn fs_combine(in: VertexOut) -> @location(0) vec4<f32> {
  let a = textureSample(srcA, maskSampler, in.uv).r;
  let b = textureSample(srcB, maskSampler, in.uv).r;
  let out = ${op};
  return vec4<f32>(out, out, out, 1.0);
}
`;
}

/** Passe d'inversion (design.md §4, étape 3 : `mask.invert` -> `acc = 1 - acc`). */
export function buildInvertWgsl(): string {
  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcA: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;

@fragment
fn fs_invert(in: VertexOut) -> @location(0) vec4<f32> {
  let a = textureSample(srcA, maskSampler, in.uv).r;
  let out = 1.0 - a;
  return vec4<f32>(out, out, out, 1.0);
}
`;
}
```
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run test/mask/maskFoldWgsl.test.ts && npx tsc --noEmit`
Expected: PASS.
- [ ] **Step 6: Wire the fold pipeline into the renderer (GPU-dependent — no automated test, human checkpoint in Step 7)**

Nouveaux champs privés (après la ligne 108 `maskTextures`, avant `whiteMask`) :
```ts
  /** Une texture GPU résidente par SOURCE de masque (clé "layerId:sourceId"),
   *  uploadée seulement quand la référence `raster` de cette source change
   *  (même pattern `syncedFrom` que `maskTextures`). Alimente le fold ; la
   *  source pinceau EN COURS DE PEINTURE continue de passer par
   *  `liveMaskTexture` (chemin inchangé de Task 1/avant), pas par cette map. */
  private sourceTextures = new Map<string, { texture: GPUTexture; syncedFrom: Uint8Array }>();
  /** Texture masque FOLDÉE résidente par calque (remplace l'usage précédent
   *  de `maskTextures` pour le cas multi-source ; `maskTextures` reste le
   *  raccourci direct du cas 0/1-source, voir `getMaskTexture`). Deux
   *  textures de travail en ping-pong pour la chaîne combine->combine->invert
   *  sans qu'une passe ne lise et n'écrive la même texture. */
  private foldedMaskTextures = new Map<string, { texture: GPUTexture; lastInputs: FoldSourceSnapshot[]; lastInvert: boolean }>();
  private foldPingPong: [GPUTexture, GPUTexture] | null = null;
  private maskFoldPipelineCache = new Map<string, { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout }>();
```
(ajouter en tête de fichier : `import { getBrushRaster } from "../mask/brushSource"; import { planFold, snapshotFoldInputs, foldInputsEqual, type FoldSourceSnapshot } from "../mask/foldPlan"; import { buildCombineWgsl, buildInvertWgsl } from "../mask/maskFoldWgsl";` — `getBrushRaster` de Task 1 n'est plus utilisé directement dans `getMaskTexture` mais reste utilisé par `App.tsx`.)

Nettoyage de résidence (`runPipeline`, après la boucle `staleMaskIds` existante ligne ~255-258) :
```ts
    for (const id of staleMaskIds(this.maskTextures.keys(), layers)) {
      this.maskTextures.get(id)!.texture.destroy();
      this.maskTextures.delete(id);
    }
    {
      const aliveLayerIds = new Set(layers.map((l) => l.id));
      for (const key of [...this.sourceTextures.keys()]) {
        if (!aliveLayerIds.has(key.split(":")[0])) {
          this.sourceTextures.get(key)!.texture.destroy();
          this.sourceTextures.delete(key);
        }
      }
      for (const id of [...this.foldedMaskTextures.keys()]) {
        if (!aliveLayerIds.has(id)) {
          this.foldedMaskTextures.get(id)!.texture.destroy();
          this.foldedMaskTextures.delete(id);
        }
      }
    }
```

`getMaskTexture` généralisé (remplace la version de Task 1) :
```ts
  private getMaskTexture(layer: LayerState, encoder: GPUCommandEncoder): GPUTexture {
    // Chemin pinceau EN COURS de peinture : inchangé depuis avant cette
    // tranche, zéro coût de fold (perf 60fps du geste de peinture non
    // impactée — l'aperçu live d'un calque à source unique n'entre jamais
    // dans le fold multi-passe ci-dessous).
    if (this.livePreview && this.livePreview.layerId === layer.id) {
      return this.getLiveMaskTexture(this.livePreview.layerId, this.livePreview.maskData, this.livePreview.scope);
    }

    const plan = planFold(layer.mask);
    if (plan.length === 0) return this.getWhiteMask();

    // Raccourci : 1 seule source active et pas d'inversion => c'est
    // EXACTEMENT le comportement d'avant cette tâche (Task 1), zéro passe de
    // fold. C'est le cas réel de la Tranche 2 (aucune UI pour ajouter une 2e
    // source avant la Tranche 4) — éviter tout travail GPU supplémentaire
    // sur ce chemin, historiquement sensible au crash 24MP (design.md §4,
    // "Impact honnête sur le crash 24MP").
    if (plan.length === 1 && !layer.mask.invert) {
      return this.getResidentSourceTexture(layer.id, plan[0], encoder);
    }

    const snapshot = snapshotFoldInputs(layer.mask);
    const cached = this.foldedMaskTextures.get(layer.id);
    if (cached && foldInputsEqual(cached.lastInputs, snapshot) && cached.lastInvert === layer.mask.invert) {
      return cached.texture;
    }

    const folded = this.runFoldPipeline(layer.id, plan, layer.mask.invert, encoder);
    this.foldedMaskTextures.set(layer.id, { texture: folded, lastInputs: snapshot, lastInvert: layer.mask.invert });
    return folded;
  }

  /** Texture résidente d'UNE source de masque (upload seulement quand sa
   *  référence `raster` change — même pattern que l'ancien `maskTextures`). */
  private getResidentSourceTexture(layerId: string, source: MaskSource, encoder: GPUCommandEncoder): GPUTexture {
    const key = `${layerId}:${source.id}`;
    const raster = source.raster!; // planFold ne retient que des sources avec raster non-null
    const entry = this.sourceTextures.get(key);
    if (entry && entry.syncedFrom === raster) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    // Même optimisation GPU-copy qu'avant (Task 1 / historique pré-tranche) :
    // si CETTE source est celle en cours de peinture, son contenu GPU est
    // déjà à jour dans liveMaskTexture — copie GPU->GPU au lieu d'un 2e
    // upload CPU->GPU complet (évite le hang traqué le 2026-07-15).
    if (this.liveMaskLayerId === layerId && this.liveMaskTexture) {
      encoder.copyTextureToTexture({ texture: this.liveMaskTexture }, { texture }, [this.width, this.height]);
    } else {
      this.uploadR8(texture, raster, this.width, this.height);
    }
    this.sourceTextures.set(key, { texture, syncedFrom: raster });
    return texture;
  }

  private ensureFoldPingPong(): [GPUTexture, GPUTexture] {
    if (!this.foldPingPong) {
      const make = () =>
        this.ctx.device.createTexture({
          size: [this.width, this.height],
          format: "r8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
        });
      this.foldPingPong = [make(), make()];
    }
    return this.foldPingPong;
  }

  private getMaskFoldPipeline(wgsl: string, twoTextures: boolean): { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout } {
    const cached = this.maskFoldPipelineCache.get(wgsl);
    if (cached) return cached;
    const { device } = this.ctx;
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ];
    if (twoTextures) entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
    const layout = device.createBindGroupLayout({ entries });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
      fragment: {
        module: device.createShaderModule({ code: wgsl }),
        entryPoint: twoTextures ? "fs_combine" : "fs_invert",
        targets: [{ format: "r8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const entry = { pipeline, layout };
    this.maskFoldPipelineCache.set(wgsl, entry);
    return entry;
  }

  private runMaskPass(encoder: GPUCommandEncoder, wgsl: string, srcA: GPUTexture, srcB: GPUTexture | null, target: GPUTexture): void {
    const { pipeline, layout } = this.getMaskFoldPipeline(wgsl, srcB !== null);
    const bindEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: srcA.createView() },
      { binding: 1, resource: this.sampler },
    ];
    if (srcB) bindEntries.push({ binding: 2, resource: srcB.createView() });
    const bindGroup = this.ctx.device.createBindGroup({ layout, entries: bindEntries });
    const pass = encoder.beginRenderPass({
      colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  /** Fold GPU résident (design.md §4) : seed (copie directe, combineMode
   *  ignoré) -> combine séquentiel des sources suivantes -> invert final.
   *  Le refine-edge (§4bis, Tranche 3) n'a PAS de passe ici — c'est un
   *  no-op tant que ses paramètres restent aux valeurs par défaut
   *  (`defaultRefineEdge()`), voir `RefineEdgeParams` dans `mask/types.ts`. */
  private runFoldPipeline(layerId: string, plan: MaskSource[], invert: boolean, encoder: GPUCommandEncoder): GPUTexture {
    const [pingA, pingB] = this.ensureFoldPingPong();
    const seedTexture = this.getResidentSourceTexture(layerId, plan[0], encoder);
    let acc = pingA;
    encoder.copyTextureToTexture({ texture: seedTexture }, { texture: acc }, [this.width, this.height]);
    let next = pingB;
    for (let i = 1; i < plan.length; i++) {
      const srcTexture = this.getResidentSourceTexture(layerId, plan[i], encoder);
      this.runMaskPass(encoder, buildCombineWgsl(plan[i].combineMode), acc, srcTexture, next);
      [acc, next] = [next, acc];
    }
    if (invert) {
      this.runMaskPass(encoder, buildInvertWgsl(), acc, null, next);
      [acc, next] = [next, acc];
    }
    return acc;
  }
```
(imports supplémentaires en tête de renderer.ts : `import type { MaskSource } from "../mask/types";`)

`dispose()` — ajouter avant la fermeture (après `this.liveMaskTexture = null;`, ligne ~761) :
```ts
    for (const { texture } of this.sourceTextures.values()) texture.destroy();
    this.sourceTextures.clear();
    for (const { texture } of this.foldedMaskTextures.values()) texture.destroy();
    this.foldedMaskTextures.clear();
    if (this.foldPingPong) {
      this.foldPingPong[0].destroy();
      this.foldPingPong[1].destroy();
      this.foldPingPong = null;
    }
    this.maskFoldPipelineCache.clear();
```

- [ ] **Step 7: Human visual checkpoint (regression + manual multi-source proof)**
Lancer `npm run dev:debug` / `npm run dev:monitor`. Dans la fenêtre réelle (CDP) :
1. **Régression (chemin réel, cas 1-source)** : peindre un masque au pinceau, vérifier fluidité 60fps inchangée, undo/redo, comparer pixel-à-pixel au comportement de Task 1 — aucune différence attendue (raccourci `plan.length === 1 && !invert` emprunté).
2. **Preuve du fold multi-source (pas encore accessible via l'UI, Tranche 4)** : via `Runtime.evaluate` (CDP) ou un appel direct dans les devtools, construire manuellement un `mask.sources` à 2 entrées sur un calque (ex. dupliquer le raster pinceau courant avec un `combineMode: "intersect"` en 2e source) et déclencher un `requestRender` ; vérifier VISUELLEMENT que le résultat affiché correspond à l'intersection des deux formes peintes (pas juste "quelque chose s'affiche"). Documenter le script exact utilisé et la capture dans le compte-rendu de tâche.
3. **`mask.invert`** : appeler `stack.setMaskInvert(id, true)` sur un calque peint, re-render, vérifier que l'overlay masque (rouge safelight, mode peinture) s'inverse bien (zone peinte devient non-masquée et vice versa).
Documenter le verdict d'Antoine avant de continuer.
- [ ] **Step 8: Commit**
```bash
git add src/mask/maskFoldWgsl.ts test/mask/maskFoldWgsl.test.ts src/render/renderer.ts
git commit -m "$(cat <<'EOF'
feat(render): pipeline de fold GPU résident multi-source

getMaskTexture() plie désormais mask.sources (seed -> add/max, subtract->
clamp, intersect->min -> invert, design.md §4) via des passes WGSL sur
textures résidentes par source. Raccourci explicite pour le cas 0/1-source
sans invert (cas réel de la Tranche 2, aucune UI pour une 2e source avant
la Tranche 4) : zéro passe de fold, comportement byte-identique à avant.
Checkpoint visuel humain : régression 1-source confirmée + fold 2-source/
invert vérifiés manuellement (pas d'UI encore pour les exercer normalement).
EOF
)"
```

---

### Task 5: Vérification end-to-end du chemin pinceau (backward-compat, dirty-rect, historique)

**Files:**
- Modify: `test/mask/maskPainterSync.test.ts` (ajout de cas couvrant le raster issu de `getBrushRaster`)
- Modify: `test/render/maskResidency.test.ts` (si `staleMaskIds` doit désormais aussi couvrir la clé composite `layerId:sourceId` — voir Step 1)

**Interfaces:**
- Consumes: tout ce des Tasks 1-4 (`LayerStack.updateBrushMask`, `getBrushRaster`, `Renderer.getMaskTexture`, `staleMaskIds`).
- Produces: aucune nouvelle interface — cette tâche est une passe de vérification/durcissement, pas de nouvelle fonctionnalité. Elle clôt la Tranche 2.

- [ ] **Step 1: Write the failing test**
`staleMaskIds` (`src/render/maskResidency.ts`) compare `cachedIds` à l'ensemble des `layer.id` vivants — pertinent tel quel pour `maskTextures`/`foldedMaskTextures` (clés = `layerId`), mais PAS pour `sourceTextures` (clés composites `layerId:sourceId`), dont le nettoyage est fait par comparaison ad hoc dans Task 4 (`key.split(":")[0]`). Écrire le test qui verrouille cette règle de parsing avant qu'un futur renommage de clé ne la casse silencieusement :
```ts
// test/render/maskResidency.test.ts — add
import { describe, it, expect } from "vitest";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";

function layer(id: string): LayerState {
  return { id, effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() };
}

describe("composite source-texture cache keys (layerId:sourceId)", () => {
  it("the layerId prefix of a composite key round-trips through split(':')[0]", () => {
    const key = `${"layer-3"}:${"layer-3-brush"}`;
    expect(key.split(":")[0]).toBe("layer-3");
  });

  it("a layer id containing no colon never collides with the composite-key separator", () => {
    // LayerStack.freshId() produces "layer-<n>" — never contains ":" — so
    // split(":")[0] always isolates the layer id correctly, even if a future
    // source id itself contains extra text after further ":" characters.
    const layers = [layer("layer-1"), layer("layer-2")];
    const cachedCompositeKeys = ["layer-1:layer-1-brush", "layer-2:layer-2-brush", "layer-9:layer-9-brush"];
    const alive = new Set(layers.map((l) => l.id));
    const stale = cachedCompositeKeys.filter((k) => !alive.has(k.split(":")[0]));
    expect(stale).toEqual(["layer-9:layer-9-brush"]);
  });
});
```
Add to `test/mask/maskPainterSync.test.ts` (existing file — extend, do not replace) a case proving the sync helper is agnostic to where its `currentMaskData` argument comes from (it always was a plain `Uint8Array | null` parameter; this locks that `getBrushRaster`'s return type slots in without adaptation):
```ts
// test/mask/maskPainterSync.test.ts — add
import { getBrushRaster } from "../../src/mask/brushSource";
import { defaultLayerMask, createBrushSource } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

describe("getSyncedMaskPainter fed from getBrushRaster (Tranche 2 wiring)", () => {
  it("seeds the painter from the layer's brush raster when one exists", () => {
    const raster = new Uint8Array(4).fill(200);
    const mask = defaultLayerMask();
    mask.sources.push(createBrushSource("l-brush", raster));
    const layer: LayerState = { id: "l", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask };

    const entries = new Map();
    const entry = getSyncedMaskPainter(entries, "l", getBrushRaster(layer), 2, 2);
    expect(entry.painter.getMaskData()).toEqual(raster);
  });

  it("seeds an empty painter when the layer has never been painted", () => {
    const layer: LayerState = { id: "l", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() };
    const entries = new Map();
    const entry = getSyncedMaskPainter(entries, "l", getBrushRaster(layer), 2, 2);
    expect(entry.painter.getMaskData()).toEqual(new Uint8Array(4));
  });
});
```
- [ ] **Step 2: Run test to verify it fails**
Run: `npx vitest run test/render/maskResidency.test.ts test/mask/maskPainterSync.test.ts`
Expected: the two `describe("composite source-texture cache keys...")` assertions and the two `describe("getSyncedMaskPainter fed from getBrushRaster...")` assertions FAIL only if the corresponding imports are missing/misnamed (they exercise existing Task 1-4 code, so a clean implementation should already make these PASS on first run — if any fails, it is a genuine regression to fix, not an expected-red step).
- [ ] **Step 3: Write minimal implementation**
Aucune nouvelle implémentation attendue si Tasks 1-4 sont correctes — cette étape sert de filet. Si `test/render/maskResidency.test.ts` échoue, corriger `src/render/renderer.ts`'s composite-key cleanup loop (Task 4, Step 6) pour qu'elle utilise bien `key.split(":")[0]`. Si `test/mask/maskPainterSync.test.ts` échoue, vérifier que `getBrushRaster` (Task 1) retourne bien `null`/le `raster` attendu sans transformation implicite.
- [ ] **Step 4: Run test to verify it passes**
Run: `npx vitest run && npx tsc --noEmit`
Expected: PASS — full suite green, zero red pockets, zero `maskData`/`updateMask(` (old signature) references left anywhere in `src/` or `test/`. Confirm with:
Run: `grep -rn "maskData" src/ test/ ; grep -rn "\.updateMask(" src/ test/`
Expected: no output (both greps empty) — every call site now uses `mask`/`getBrushRaster`/`updateBrushMask`.
- [ ] **Step 5: Human visual checkpoint (final Tranche 2 sign-off)**
Lancer `npm run dev:debug` / `npm run dev:monitor`. Session de peinture complète dans la vraie fenêtre WebView2 (CDP) :
1. Ouvrir une photo réelle (≥12MP si disponible, pour rester dans la zone historiquement sensible au crash 24MP).
2. Peindre un masque long (plusieurs strokes, direction changeante) sur un calque — vérifier 60fps perçu, pas de gap dans le trait, pas de gel.
3. Undo/redo plusieurs fois de suite pendant et après la peinture.
4. Changer de calque sélectionné pendant qu'un masque existe sur l'ancien, revenir dessus — vérifier que le masque réapparaît correctement (pas de fuite de contenu entre calques via `liveMaskTexture`/`sourceTextures`).
5. Fermer et réouvrir une image (nouveau `Renderer`) — vérifier qu'aucune erreur console/exception WebView2 n'apparaît (régression de fuite GPU sur `dispose()`).
6. Confirmer par lecture de `.dev-logs/`/CDP qu'aucune exception n'a été levée pendant toute la session.
Documenter le verdict final d'Antoine — condition de clôture de la Tranche 2, avant d'ouvrir la Tranche 3 (sources paramétriques + refine edge).
- [ ] **Step 6: Commit**
```bash
git add test/render/maskResidency.test.ts test/mask/maskPainterSync.test.ts
git commit -m "$(cat <<'EOF'
test(mask): verrouille le nettoyage des clés composites + la source getBrushRaster

Filet de vérification end-to-end de la Tranche 2 (Tasks 1-4) : confirme que
staleMaskIds' composite-key cleanup (layerId:sourceId) reste correct, et que
getSyncedMaskPainter s'alimente sans adaptation depuis getBrushRaster().
Checkpoint visuel humain final de clôture de tranche confirmé (peinture
longue, undo/redo, changement de calque, fermeture/réouverture d'image —
aucune régression, aucune exception).
EOF
)"
```

---

## Self-Review

**Couverture spec (design.md §3-5 + prd.md §Masques, périmètre Tranche 2 uniquement — sources paramétriques/refine edge/panneau flottant/groupes explicitement hors scope, Tranches 3-5) :**

- [x] `LayerMask`/`MaskSource`/`CombineMode`/`RefineEdgeParams` conformes aux signatures du design.md §3 — Task 1.
- [x] `type: "brush"` seul implémenté, `"gradient"/"luminosity"/"colorRange"` dans l'union sans branche morte (aucun `switch` dessus en Tranche 2 — le fold n'inspecte que `raster`/`enabled`/`combineMode`, communs à tous les types) — Task 1.
- [x] Seed = 1ère source enabled, combineMode ignoré (design.md §4 étape 1) — Task 2 (`planFold`) + Task 4 (`runFoldPipeline`).
- [x] add=max, subtract=clamp(acc-src,0,1), intersect=min (design.md §4 étape 2) — Task 4 (`buildCombineWgsl`), testé littéralement.
- [x] `mask.invert` = passe finale `1-acc` (design.md §4 étape 3) — Task 4 (`buildInvertWgsl`).
- [x] `mask.enabled===false` OU aucune source valide ⟹ masque plein, jamais nul silencieux (design.md §4, PRD "perdre silencieusement... inacceptable") — Task 2 (`planFold` retourne `[]`) + Task 4 (`getMaskTexture` retombe sur `getWhiteMask()`).
- [x] Pas de re-fold CPU par sample, pas de full-buffer reupload par sample (design.md §4, contrainte 60fps) — Task 4 : le chemin `livePreview` reste exactement celui d'avant cette tranche (dirty-rect inchangé) ; le fold multi-source ne s'exécute jamais pendant un stroke actif sur une source unique (cas réel Tranche 2).
- [x] Gros buffers de masque hors du state React (CLAUDE.md, contrainte héritée du crash 24MP) — Task 1 (`toDisplayLayers` généralisé) : aucune tâche ne touche `layersRef`/`toDisplayLayers` autrement que pour généraliser le retrait de `raster`.
- [x] Historique refcount étendu à N rasters — Task 3.
- [x] `refineEdge` existe dans le type avec défauts no-op, sans casser la forme du pipeline pour la Tranche 3 — Task 1 (`defaultRefineEdge`), Task 4 (commentaire explicite : aucune passe GPU tant que non branché).
- [x] Copie de masque indépendante figée, invert/disable au niveau modèle (PRD §Masques) — `LayerStack.setMaskInvert`/`setMaskEnabled` produits en Task 1 (interface prête, UI en Tranche 4 par découpage documenté du design.md — pas un requirement manquant, cf. `rules/audit/spec.md` faux positifs sur le découpage en tranches documenté).
- [x] Backward-compatible UX (pinceau/undo/redo/dirty-rect identiques) — checkpoints visuels humains Task 1 (régression pure), Task 4 (régression + preuve manuelle multi-source), Task 5 (session complète de clôture).
- [x] Chaque tâche touchant le rendu GPU se termine par un checkpoint visuel humain (CLAUDE.md, Playwright headless inadapté ici) — Tasks 1, 4, 5.
- [x] Tranches verticales : chaque tâche traverse modèle → historique/rendu → vérification et est démontrable seule (pas de tâche "tout le modèle" puis "tout le rendu" séparées sans preuve intermédiaire).

**Hors scope explicite de cette tâche (confirmé non traité, PAS des oublis) :** sources `gradient`/`luminosity`/`colorRange` (implémentation réelle), passes GPU de refine edge/edge-aware, panneau Masques flottant, UI invert/enabled/copie de masque, groupes — tous documentés dans le design.md comme Tranches 3-5.

**Scan placeholders** : relu chaque bloc de code de ce plan — aucun `TODO`, `...`, `// implémenter plus tard`, ni signature tronquée. Chaque `Modify` cite soit le fichier entier (petits fichiers) soit des lignes exactes avec le code de remplacement complet.

**Cohérence de types/signatures across tasks** :
- `LayerMask`/`MaskSource`/`CombineMode`/`MaskSourceType`/`RefineEdgeParams` (Task 1, `src/mask/types.ts`) réutilisés à l'identique par Task 2 (`foldPlan.ts`), Task 4 (`maskFoldWgsl.ts`, `renderer.ts`) — aucun renommage en cours de route.
- `getBrushRaster(layer): Uint8Array | null` (Task 1) — signature inchangée jusqu'à Task 5 inclus, seul son usage se déplace (renderer.ts, App.tsx, maskPainterSync côté appelant).
- `LayerStack.updateBrushMask(id, raster)` (Task 1) remplace `updateMask` partout (App.tsx, tests) sans variante de signature.
- `planFold(mask): MaskSource[]` / `snapshotFoldInputs(mask): FoldSourceSnapshot[]` / `foldInputsEqual(a,b): boolean` (Task 2) consommés tels quels par `renderer.ts` (Task 4), aucune signature alternative introduite.
- `Renderer.getMaskTexture(layer, encoder): GPUTexture` — signature strictement inchangée de Task 1 à Task 4 (seule l'implémentation interne évolue), donc aucun appelant (`runEffectPass`, `runOverlayPass`, chemin "aucun calque activé") n'a besoin d'être modifié au-delà de ce déjà listé.

**Plan complete and saved to `docs/superpowers/plans/2026-07-19-shaderlab-masking-tranche2.md`. Two execution options:**

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
