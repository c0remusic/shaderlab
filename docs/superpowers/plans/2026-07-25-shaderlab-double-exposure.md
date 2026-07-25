# Double exposure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a document compose two photos — a background (the document's existing base image) and a silhouette (a second imported photo, positioned/scaled/rotated, masked by hand) — through the existing layer/effect/mask/blend pipeline, with zero regression on documents without a photo layer.

**Architecture:** `LayerState` gains two optional fields (`imageSource: { sourceId }`, `transform: { x, y, scale, rotation }`) — approach (C) from the validated design doc, no new layer type, no new "photoOverlay" effect. The `GPUTexture` for the imported photo never touches `LayerState`/React state/history (invariant OOM, `e3c7584`) — it lives in a new `PhotoSourceStore` (render/). Where photo A enters the pipeline: approach (C2) — a dedicated pre-pass (`PhotoLayerInputResolver`) renders photo A, transformed, into a full-background-size texture with coverage in alpha, BEFORE the existing chain (internal effect passes → composite → mask → blend) runs, unchanged in structure. The composite shader gains one new conditional binding (`hasImageSource`) that swaps what `fs_main` receives as input (photo content instead of the composite-below) and folds coverage into the compositing mix weight — the mix's "off" state (`color`, sampled from the untouched composite-below) is never replaced, so mask=0 always reveals the background underneath, exactly like today for ordinary effect layers.

**Tech Stack:** Tauri v2 (Rust shell, unchanged for this feature — `pick_image_file` is reused) · React 19 + TS · Vite · WebGPU/WGSL brut · Vitest (Node env, no test renders a React component).

## Global Constraints

- Pipeline linéaire strict / sRGB : toute nouvelle texture couleur (photo A, texture transitoire de pré-passe) est créée avec `ctx.srgbFormat` — jamais de gamma manuel en WGSL (`CLAUDE.md`, `ARCHITECTURE.md` §2.1).
- Un seul pipeline, résolution native — pas de distinction preview/export pour le calque photo (`ARCHITECTURE.md` §2.2).
- **Aucun gros buffer/handle GPU dans le state React ni dans un snapshot d'historique.** `LayerState.imageSource` ne porte QUE `{ sourceId: string }` — jamais une `GPUTexture`/`ImageBitmap` (`ARCHITECTURE.md` §2.4/§4.2, invariant `e3c7584`).
- Registry pour les extensions du moteur : la double exposure n'est PAS un effet du registry — `MAX_EFFECT_PARAMS = 11` et le contrat `fs_main(uv, color) -> vec4` des effets existants restent inchangés (`ARCHITECTURE.md` §2.3).
- Pas de fallback silencieux — toute erreur (import photo invalide, limite de 2 photos dépassée, source introuvable dans `PhotoSourceStore`) est visible (`ErrorBanner`) ou lève, jamais un état qui se dit fini sans l'être (`CLAUDE.md`, `PRD.md`).
- Une interaction = une entrée d'historique — le drag d'une poignée de transform suit le même pattern live+commit que `handleParamChange`/`handleParamCommit` (mise à jour vivante sans historique pendant le drag, une entrée à la fin).
- Limite dure : au plus 1 calque `imageSource` par document (2 photos sources = la photo de fond, toujours hors modèle `LayerState`, + au plus une silhouette) — garde applicative NOMMÉE (`MAX_PHOTO_LAYERS`), jamais codée en dur dans `LayerStack` ou le shader (`ARCHITECTURE.md` §5).
- Round-trip Lightroom désactivé (bascule vers "Exporter sous...") dès qu'un calque `imageSource` existe dans le document — jamais un bouton silencieusement grisé sans message (`PRD.md`).
- Isolation du sujet v1 = `MaskPainter` existant, aucun changement à cet outil. Le masque d'un calque photo vit dans l'espace de coordonnées du FOND (conséquence assumée, documentée, pas un bug — `ARCHITECTURE.md` §4.5).
- Aucun test ne rend de composant React (convention Vitest du projet, Node env). Le rendu shader/canvas se vérifie visuellement via CDP sur la fenêtre réelle (canvas WebGPU non capturable par Playwright headless — `CLAUDE.md` § Moyen de preuve).
- Import de la 2e photo réutilise `pick_image_file` (commande Rust existante) — aucun nouveau point d'entrée IPC.
- `npm run test` (Vitest) et `npx tsc --noEmit` doivent passer après chaque tâche.

---

### Task 1: Modèle de données — `imageSource`/`transform`, mutateurs, gardes

**Files:**
- Modify: `src/layers/types.ts` (ajout `ImageSourceRef`, `LayerTransform`, champs optionnels sur `LayerState`)
- Modify: `src/layers/layerStack.ts` (`addPhotoLayer`, `updateLayerTransform`)
- Modify: `src/render/effects/registry.ts` (`getEffect("passthrough")` résolu sans polluer `effectRegistry`/le sélecteur d'effet UI)
- Create: `src/layers/photoLayer.ts` (`MAX_PHOTO_LAYERS`, `countPhotoLayers`, `canAddPhotoLayer`, `hasPhotoLayer`)
- Test: `test/layers/layerStack.test.ts` (étendu), `test/layers/history.test.ts` (étendu), `test/layers/photoLayer.test.ts` (nouveau), `test/render/effects/registry.test.ts` (nouveau, si absent — vérifié étape 1)

**Interfaces:**
- Consumes: rien (fondation).
- Produces:
  - `interface ImageSourceRef { sourceId: string }`
  - `interface LayerTransform { x: number; y: number; scale: number; rotation: number }`
  - `LayerState.imageSource?: ImageSourceRef`, `LayerState.transform?: LayerTransform`
  - `LayerStack.addPhotoLayer(sourceId: string, transform: LayerTransform): string`
  - `LayerStack.updateLayerTransform(id: string, transform: LayerTransform): boolean`
  - `getEffect("passthrough"): EffectModule` (déjà exporté comme `PASSTHROUGH_EFFECT` par `effectPassRunner.ts`)
  - `MAX_PHOTO_LAYERS: number`, `countPhotoLayers(layers: LayerState[]): number`, `canAddPhotoLayer(layers: LayerState[]): boolean`, `hasPhotoLayer(layers: LayerState[]): boolean`

- [ ] **Step 1: Vérifier si `test/render/effects/registry.test.ts` existe déjà**

Run: `ls test/render/effects/ 2>/dev/null || echo "absent"` (PowerShell : `Get-ChildItem test/render/effects -ErrorAction SilentlyContinue`)

Si le fichier existe déjà, l'étendre au lieu d'en créer un nouveau à l'étape 6 — adapter les chemins ci-dessous en conséquence.

- [ ] **Step 2: Write the failing test — `LayerState`/`LayerStack` portent `imageSource`/`transform`**

`test/layers/layerStack.test.ts`, ajouter à la fin du fichier :

```ts
describe("LayerStack photo layers", () => {
  it("addPhotoLayer crée un calque avec imageSource/transform et effectId=passthrough", () => {
    const stack = new LayerStack();
    const transform = { x: 100, y: 50, scale: 1, rotation: 0 };
    const id = stack.addPhotoLayer("photo-1", transform);
    const layer = stack.layers.find((l) => l.id === id)!;
    expect(layer.effectId).toBe("passthrough");
    expect(layer.imageSource).toEqual({ sourceId: "photo-1" });
    expect(layer.transform).toEqual(transform);
    expect(layer.opacity).toBe(1);
    expect(layer.blendMode).toBe("normal");
  });

  it("updateLayerTransform remplace le transform d'un calque photo existant", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    const changed = stack.updateLayerTransform(id, { x: 10, y: 20, scale: 1.5, rotation: 0.2 });
    expect(changed).toBe(true);
    expect(stack.layers[0].transform).toEqual({ x: 10, y: 20, scale: 1.5, rotation: 0.2 });
  });

  it("updateLayerTransform est un no-op (retourne false) si le transform n'a pas changé", () => {
    const stack = new LayerStack();
    const t = { x: 0, y: 0, scale: 1, rotation: 0 };
    const id = stack.addPhotoLayer("photo-1", t);
    expect(stack.updateLayerTransform(id, { ...t })).toBe(false);
  });

  it("updateLayerTransform retourne false pour un calque sans imageSource", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    expect(stack.updateLayerTransform(id, { x: 0, y: 0, scale: 1, rotation: 0 })).toBe(false);
  });

  it("updateLayerTransform retourne false pour un id absent", () => {
    const stack = new LayerStack();
    expect(stack.updateLayerTransform("no-such-id", { x: 0, y: 0, scale: 1, rotation: 0 })).toBe(false);
  });

  it("clone() préserve imageSource/transform d'un calque photo", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-1", { x: 5, y: 5, scale: 2, rotation: 1 });
    const copy = stack.clone();
    expect(copy.layers[0].imageSource).toEqual({ sourceId: "photo-1" });
    expect(copy.layers[0].transform).toEqual({ x: 5, y: 5, scale: 2, rotation: 1 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npx vitest run test/layers/layerStack.test.ts`
Expected: FAIL — `addPhotoLayer`/`updateLayerTransform` n'existent pas encore sur `LayerStack`.

- [ ] **Step 4: Implémenter `ImageSourceRef`/`LayerTransform` et étendre `LayerState`**

`src/layers/types.ts`, remplacer tout le fichier :

```ts
import type { LayerMask } from "../mask/types";

/** Référence sérialisable vers la texture GPU d'une photo importée (double
 *  exposure, ARCHITECTURE.md §4.2) — ne contient JAMAIS la texture
 *  elle-même. `sourceId` est résolu par `PhotoSourceStore` (src/render/),
 *  hors state React et hors historique. */
export interface ImageSourceRef {
  sourceId: string;
}

/** Position/échelle/rotation d'un calque de photo, en coordonnées PIXELS
 *  de la photo de FOND (origine haut-gauche), pas de la photo elle-même —
 *  `(x, y)` est le centre de la photo transformée. `rotation` en radians. */
export interface LayerTransform {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

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
  /** Double exposure (2026-07-25). Présent ssi ce calque porte une photo
   *  importée (silhouette) plutôt que de traiter la photo de base du
   *  document. `imageSource`/`transform` sont TOUJOURS présents ensemble ou
   *  absents ensemble (posés une seule fois par `LayerStack.addPhotoLayer`,
   *  jamais l'un sans l'autre). */
  imageSource?: ImageSourceRef;
  transform?: LayerTransform;
}
```

- [ ] **Step 5: Ajouter `addPhotoLayer`/`updateLayerTransform` à `LayerStack`**

`src/layers/layerStack.ts`, modifier l'import en tête de fichier :

```ts
import type { LayerState, LayerTransform } from "./types";
```

Ajouter juste après `addLayer` (après la ligne `return id;` / avant `removeLayer`) :

```ts
  /** Crée un calque de photo (double exposure) : `effectId` par défaut
   *  "passthrough" (résolu par `getEffect`, voir effects/registry.ts —
   *  n'apparaît pas dans le sélecteur "ajouter un effet" de LayerPanel).
   *  L'appelant reste responsable de vérifier `canAddPhotoLayer` (limite
   *  dure, photoLayer.ts) AVANT d'appeler cette méthode — elle ne l'impose
   *  pas elle-même, comme les autres mutateurs de ce fichier qui ne
   *  connaissent pas les règles produit de plus haut niveau. */
  addPhotoLayer(sourceId: string, transform: LayerTransform): string {
    const id = freshId();
    this.layers.push({
      id,
      effectId: "passthrough",
      params: {},
      enabled: true,
      opacity: 1,
      blendMode: "normal",
      mask: defaultLayerMask(),
      imageSource: { sourceId },
      transform,
    });
    return id;
  }

  /** Returns `true` iff `id` existe, porte un `imageSource` (un calque sans
   *  photo n'a pas de transform à changer), et `transform` diffère
   *  réellement du courant (même discipline no-op que le reste du fichier). */
  updateLayerTransform(id: string, transform: LayerTransform): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || !layer.imageSource) return false;
    if (layer.transform && paramsEqual(layer.transform, transform)) return false;
    layer.transform = transform;
    return true;
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `npx vitest run test/layers/layerStack.test.ts`
Expected: PASS (toutes les specs, y compris `LayerStack photo layers`).

- [ ] **Step 7: Commit**

```bash
git add src/layers/types.ts src/layers/layerStack.ts test/layers/layerStack.test.ts
git commit -m "feat(layers): add imageSource/transform fields and photo layer mutators"
```

- [ ] **Step 8: Write the failing test — un calque photo survit à un undo/redo**

`test/layers/history.test.ts`, ajouter à la fin du fichier :

```ts
describe("History photo layers", () => {
  it("un calque photo (imageSource/transform) survit à un undo/redo en ne transportant qu'un sourceId", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const withPhoto = initial.clone();
    withPhoto.addPhotoLayer("photo-1", { x: 10, y: 20, scale: 1, rotation: 0 });
    history.push(withPhoto);

    const undone = history.undo();
    expect(undone?.layers).toHaveLength(0);

    const redone = history.redo();
    expect(redone?.layers).toHaveLength(1);
    expect(redone?.layers[0].imageSource).toEqual({ sourceId: "photo-1" });
    expect(redone?.layers[0].transform).toEqual({ x: 10, y: 20, scale: 1, rotation: 0 });
  });
});
```

- [ ] **Step 9: Run test to verify it fails**

Run: `npx vitest run test/layers/history.test.ts`
Expected: FAIL — `addPhotoLayer` n'existe pas encore au moment où ce test tourne isolément si Step 5 n'est pas fait ; comme Step 5 est déjà fait, ce test doit en réalité déjà PASSER. Lancer quand même la commande pour confirmer qu'aucune régression n'est introduite (le step "fail d'abord" est ici informatif : la fonctionnalité sous test — l'historique — est déjà correcte par construction, `LayerStack.clone()` copiant `imageSource`/`transform` par simple spread).
Expected réel : PASS immédiatement — documenter ce cas dans le commit (test de non-régression, pas de nouveau comportement à coder).

- [ ] **Step 10: Commit**

```bash
git add test/layers/history.test.ts
git commit -m "test(layers): cover photo layer survival across undo/redo"
```

- [ ] **Step 11: Write the failing test — `getEffect("passthrough")`**

Vérifier d'abord s'il existe un fichier `test/render/effects/registry.test.ts` (Step 1). S'il n'existe pas, le créer :

```ts
import { describe, it, expect } from "vitest";
import { getEffect, effectRegistry } from "../../../src/render/effects/registry";
import { PASSTHROUGH_EFFECT } from "../../../src/render/effectPassRunner";

describe("effects registry", () => {
  it("getEffect resolves a real registry effect", () => {
    expect(getEffect("glow").id).toBe("glow");
  });

  it("getEffect resolves \"passthrough\" to PASSTHROUGH_EFFECT without adding it to effectRegistry", () => {
    expect(getEffect("passthrough")).toBe(PASSTHROUGH_EFFECT);
    expect(effectRegistry.some((e) => e.id === "passthrough")).toBe(false);
  });

  it("getEffect throws on an unknown id", () => {
    expect(() => getEffect("no-such-effect")).toThrow("Effet inconnu");
  });
});
```

- [ ] **Step 12: Run test to verify it fails**

Run: `npx vitest run test/render/effects/registry.test.ts`
Expected: FAIL sur `getEffect("passthrough")` — lève `Effet inconnu: passthrough` (pas encore résolu).

- [ ] **Step 13: Implémenter la résolution spéciale de `"passthrough"`**

`src/render/effects/registry.ts`, remplacer tout le fichier :

```ts
import type { EffectModule } from "./types";
import { validateEffect } from "./validate";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
import { warp } from "./warp";
import { grain } from "./grain";
import { duotone } from "./duotone";
import { posterize } from "./posterize";
import { PASSTHROUGH_EFFECT } from "../effectPassRunner";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed, warp, grain, duotone, posterize];
effectRegistry.forEach(validateEffect);

/** `"passthrough"` résout vers `PASSTHROUGH_EFFECT` SANS apparaître dans
 *  `effectRegistry` — ce tableau alimente le sélecteur "ajouter un effet"
 *  de LayerPanel, et passthrough n'est pas un effet choisissable par
 *  l'utilisateur : c'est l'effectId par défaut d'un calque de photo (double
 *  exposure), posé par `LayerStack.addPhotoLayer`. */
export function getEffect(id: string): EffectModule {
  if (id === PASSTHROUGH_EFFECT.id) return PASSTHROUGH_EFFECT;
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}
```

- [ ] **Step 14: Run test to verify it passes**

Run: `npx vitest run test/render/effects/registry.test.ts`
Expected: PASS.

- [ ] **Step 15: Commit**

```bash
git add src/render/effects/registry.ts test/render/effects/registry.test.ts
git commit -m "feat(render): resolve passthrough effect without exposing it in the effect picker"
```

- [ ] **Step 16: Write the failing test — gardes `photoLayer.ts`**

Create `test/layers/photoLayer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { MAX_PHOTO_LAYERS, countPhotoLayers, canAddPhotoLayer, hasPhotoLayer } from "../../src/layers/photoLayer";

describe("photoLayer guards", () => {
  it("MAX_PHOTO_LAYERS vaut 1 (la photo de fond n'est pas un LayerState)", () => {
    expect(MAX_PHOTO_LAYERS).toBe(1);
  });

  it("countPhotoLayers compte les calques avec imageSource, ignore les calques d'effet", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(countPhotoLayers(stack.layers)).toBe(0);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(countPhotoLayers(stack.layers)).toBe(1);
  });

  it("canAddPhotoLayer refuse un second calque photo", () => {
    const stack = new LayerStack();
    expect(canAddPhotoLayer(stack.layers)).toBe(true);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(canAddPhotoLayer(stack.layers)).toBe(false);
  });

  it("hasPhotoLayer est false sur un document sans calque photo, true sinon", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(hasPhotoLayer(stack.layers)).toBe(false);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasPhotoLayer(stack.layers)).toBe(true);
  });
});
```

- [ ] **Step 17: Run test to verify it fails**

Run: `npx vitest run test/layers/photoLayer.test.ts`
Expected: FAIL — le module `src/layers/photoLayer.ts` n'existe pas.

- [ ] **Step 18: Créer `src/layers/photoLayer.ts`**

```ts
import type { LayerState } from "./types";

/** Limite dure v1 (PRD "Double exposure") : 2 photos sources max par
 *  document = la photo de fond (toujours 1, hors modèle `LayerState` — elle
 *  vit dans `ImageFrameResources.sourceTexture`) + au plus UNE silhouette
 *  importée comme calque de photo. Garde applicative NOMMÉE et vérifiable,
 *  jamais codée en dur dans `LayerStack` ou le shader — voir
 *  ARCHITECTURE.md §5 "N sources d'image". */
export const MAX_PHOTO_LAYERS = 1;

export function countPhotoLayers(layers: LayerState[]): number {
  return layers.filter((layer) => layer.imageSource !== undefined).length;
}

export function canAddPhotoLayer(layers: LayerState[]): boolean {
  return countPhotoLayers(layers) < MAX_PHOTO_LAYERS;
}

/** Prédicat pur : au moins un calque de photo dans le document — désactive
 *  le round-trip Lightroom pour cet export (ARCHITECTURE.md §4.6, PRD
 *  "Double exposure"). Vit ici (pas dans export/exportImage.ts) pour rester
 *  une seule source de vérité réutilisée par la limite d'import ET par la
 *  bascule d'export. */
export function hasPhotoLayer(layers: LayerState[]): boolean {
  return countPhotoLayers(layers) > 0;
}
```

- [ ] **Step 19: Run test to verify it passes**

Run: `npx vitest run test/layers/photoLayer.test.ts`
Expected: PASS.

- [ ] **Step 20: Type-check et suite complète**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS, zéro régression.

- [ ] **Step 21: Commit**

```bash
git add src/layers/photoLayer.ts test/layers/photoLayer.test.ts
git commit -m "feat(layers): add photo-layer guards (2-photo limit, round-trip predicate)"
```

---

### Task 2: `PhotoSourceStore` — propriétaire GPU exclusif des photos importées

**Files:**
- Create: `src/render/photoSourceStore.ts`
- Test: `test/render/photoSourceStore.test.ts`

**Interfaces:**
- Consumes: `assertImageFitsGpu` (`src/render/limits.ts:7`, déjà utilisé par `ImageFrameResources`).
- Produces:
  ```ts
  class PhotoSourceStore {
    constructor(device: GPUDevice, srgbFormat: GPUTextureFormat, maxTextureDimension2D: number);
    register(bitmap: ImageBitmap): string;                              // -> sourceId "photo-N"
    get(sourceId: string): GPUTexture | null;
    dimensions(sourceId: string): { width: number; height: number } | null;
    dispose(): void;
  }
  ```

- [ ] **Step 1: Write the failing test**

Create `test/render/photoSourceStore.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoSourceStore } from "../../src/render/photoSourceStore";

vi.stubGlobal("GPUTextureUsage", {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
});

function texture() {
  return { destroy: vi.fn() };
}

function createStore() {
  const created: ReturnType<typeof texture>[] = [];
  const device = {
    createTexture: vi.fn(() => {
      const t = texture();
      created.push(t);
      return t;
    }),
    queue: { copyExternalImageToTexture: vi.fn() },
  };
  return {
    store: new PhotoSourceStore(device as unknown as GPUDevice, "bgra8unorm-srgb", 8192),
    device,
    created,
  };
}

describe("PhotoSourceStore", () => {
  beforeEach(() => vi.clearAllMocks());

  it("register uploads the bitmap and returns a fresh sourceId each time", () => {
    const { store, device } = createStore();
    const bitmap = { width: 40, height: 30 } as ImageBitmap;

    const id1 = store.register(bitmap);
    const id2 = store.register(bitmap);

    expect(id1).not.toBe(id2);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledTimes(2);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: bitmap },
      { texture: expect.anything() },
      [40, 30],
    );
  });

  it("get returns the registered texture, null for an unknown id", () => {
    const { store, created } = createStore();
    const id = store.register({ width: 10, height: 10 } as ImageBitmap);
    expect(store.get(id)).toBe(created[0]);
    expect(store.get("no-such-id")).toBeNull();
  });

  it("dimensions returns the registered bitmap size, null for an unknown id", () => {
    const { store } = createStore();
    const id = store.register({ width: 40, height: 30 } as ImageBitmap);
    expect(store.dimensions(id)).toEqual({ width: 40, height: 30 });
    expect(store.dimensions("no-such-id")).toBeNull();
  });

  it("dispose destroys every registered texture and clears the store", () => {
    const { store, created } = createStore();
    const id = store.register({ width: 10, height: 10 } as ImageBitmap);

    store.dispose();

    expect(created[0].destroy).toHaveBeenCalledOnce();
    expect(store.get(id)).toBeNull();
    expect(store.dimensions(id)).toBeNull();
  });

  it("register fails fast before allocating an image beyond the device limit", () => {
    const { store, device } = createStore();
    expect(() => store.register({ width: 20000, height: 10 } as ImageBitmap)).toThrow("trop grande");
    expect(device.createTexture).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render/photoSourceStore.test.ts`
Expected: FAIL — le module `src/render/photoSourceStore.ts` n'existe pas.

- [ ] **Step 3: Implémenter `PhotoSourceStore`**

Create `src/render/photoSourceStore.ts`:

```ts
import { assertImageFitsGpu } from "./limits";

/**
 * Propriétaire GPU EXCLUSIF des textures de photo importée (double
 * exposure, ARCHITECTURE.md §4.2) — jamais référencée depuis
 * `LayerState`/le state React/un snapshot d'historique (invariant OOM,
 * `e3c7584`). Vit aux côtés d'`ImageFrameResources` dans `render/` (même
 * cycle de vie : créé/vidé avec le document), jamais dans `layers/`, qui ne
 * doit jamais dépendre de WebGPU.
 */
export class PhotoSourceStore {
  private textures = new Map<string, GPUTexture>();
  private sizes = new Map<string, { width: number; height: number }>();
  private nextId = 0;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly maxTextureDimension2D: number,
  ) {}

  /** Valide, alloue et uploade une nouvelle source de photo. Retourne un
   *  `sourceId` frais à CHAQUE appel, même pour un bitmap identique — deux
   *  imports distincts de la même photo sont deux sources indépendantes. */
  register(bitmap: ImageBitmap): string {
    assertImageFitsGpu(bitmap.width, bitmap.height, this.maxTextureDimension2D);
    this.nextId += 1;
    const sourceId = `photo-${this.nextId}`;
    const texture = this.device.createTexture({
      size: [bitmap.width, bitmap.height],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    this.device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture },
      [bitmap.width, bitmap.height],
    );
    this.textures.set(sourceId, texture);
    this.sizes.set(sourceId, { width: bitmap.width, height: bitmap.height });
    return sourceId;
  }

  get(sourceId: string): GPUTexture | null {
    return this.textures.get(sourceId) ?? null;
  }

  dimensions(sourceId: string): { width: number; height: number } | null {
    return this.sizes.get(sourceId) ?? null;
  }

  /** Détruit toutes les textures possédées — appelé au changement de
   *  document (même discipline que `ImageFrameResources.dispose()`), jamais
   *  au retrait d'un seul calque (pas de refcount : au plus un calque photo
   *  existe à la fois, `MAX_PHOTO_LAYERS`). */
  dispose(): void {
    for (const texture of this.textures.values()) texture.destroy();
    this.textures.clear();
    this.sizes.clear();
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/render/photoSourceStore.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check et suite complète**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/render/photoSourceStore.ts test/render/photoSourceStore.test.ts
git commit -m "feat(render): add PhotoSourceStore, exclusive GPU owner of imported photos"
```

---

### Task 3: `src/ui/transform.ts` — géométrie pure du transform

**Files:**
- Create: `src/ui/transform.ts`
- Test: `test/ui/transform.test.ts`

**Interfaces:**
- Consumes: `LayerTransform` (`src/layers/types.ts`, Task 1).
- Produces:
  ```ts
  interface PixelSize { width: number; height: number; }
  interface UvPoint { u: number; v: number; }
  interface PixelPoint { x: number; y: number; }
  interface TransformHandleGeometry {
    corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint]; // TL, TR, BR, BL — coordonnées PIXELS du fond
    rotationHandle: PixelPoint;
  }

  const MIN_TRANSFORM_SCALE: number;
  function clampTransformScale(scale: number): number;
  function compositeUvToPhotoUv(compositeUv: UvPoint, bgSize: PixelSize, transform: LayerTransform, photoSize: PixelSize): UvPoint | null;
  function computeHandleGeometry(transform: LayerTransform, photoSize: PixelSize): TransformHandleGeometry;
  function scaleFromCornerDrag(transform: LayerTransform, photoSize: PixelSize, pointer: PixelPoint): number;
  function rotationFromPointer(transform: LayerTransform, pointer: PixelPoint): number;
  ```

- [ ] **Step 1: Write the failing test — `clampTransformScale`/`compositeUvToPhotoUv`**

Create `test/ui/transform.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  MIN_TRANSFORM_SCALE,
  clampTransformScale,
  compositeUvToPhotoUv,
  computeHandleGeometry,
  scaleFromCornerDrag,
  rotationFromPointer,
} from "../../src/ui/transform";

describe("clampTransformScale", () => {
  it("laisse passer une échelle strictement positive", () => {
    expect(clampTransformScale(1.5)).toBe(1.5);
  });

  it("clampe à MIN_TRANSFORM_SCALE une échelle nulle ou négative", () => {
    expect(clampTransformScale(0)).toBe(MIN_TRANSFORM_SCALE);
    expect(clampTransformScale(-3)).toBe(MIN_TRANSFORM_SCALE);
  });
});

describe("compositeUvToPhotoUv", () => {
  const bgSize = { width: 1000, height: 1000 };
  const photoSize = { width: 200, height: 100 };

  it("identité (scale=1, rotation=0) : le centre composite tombe au centre photo", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const uv = compositeUvToPhotoUv({ u: 0.5, v: 0.5 }, bgSize, transform, photoSize);
    expect(uv).toEqual({ u: 0.5, v: 0.5 });
  });

  it("un point hors des bornes de la photo transformée retourne null (transparent)", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const uv = compositeUvToPhotoUv({ u: 0.0, v: 0.0 }, bgSize, transform, photoSize);
    expect(uv).toBeNull();
  });

  it("un point juste à l'intérieur du bord de la photo (scale=1) reste dans [0,1)", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    // Photo 200x100 centrée en (500,500) -> bornes X [400,600), Y [450,550).
    const uv = compositeUvToPhotoUv({ u: 0.4005, v: 0.5 }, bgSize, transform, photoSize);
    expect(uv).not.toBeNull();
    expect(uv!.u).toBeCloseTo(0.0025, 3);
  });

  it("une échelle 2 double la taille apparente de la photo dans l'espace composite", () => {
    const transform = { x: 500, y: 500, scale: 2, rotation: 0 };
    // À scale=1 le bord droit est à x=600 (u=0.6, hors bornes). À scale=2 il est à x=700.
    const insideAt2x = compositeUvToPhotoUv({ u: 0.65, v: 0.5 }, bgSize, transform, photoSize);
    expect(insideAt2x).not.toBeNull();
    const outsideAt2x = compositeUvToPhotoUv({ u: 0.71, v: 0.5 }, bgSize, transform, photoSize);
    expect(outsideAt2x).toBeNull();
  });

  it("une rotation de 90° échange les axes locaux", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: Math.PI / 2 };
    // Après rotation 90°, un point à droite du centre composite tombe dans
    // l'axe Y local de la photo (200x100 -> bornes locales x in [-100,100], y in [-50,50]).
    // Un point à distance 40px "au-dessus" du centre composite (v plus petit) doit
    // tomber à l'intérieur des bornes après rotation, un point à distance 120 doit tomber dehors.
    const inside = compositeUvToPhotoUv({ u: 0.5, v: 0.496 }, bgSize, transform, photoSize);
    expect(inside).not.toBeNull();
    const outside = compositeUvToPhotoUv({ u: 0.5, v: 0.35 }, bgSize, transform, photoSize);
    expect(outside).toBeNull();
  });
});

describe("computeHandleGeometry", () => {
  it("place les 4 coins symétriquement autour du centre à scale=1, rotation=0", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const photoSize = { width: 200, height: 100 };
    const { corners } = computeHandleGeometry(transform, photoSize);
    expect(corners[0]).toEqual({ x: 400, y: 450 }); // TL
    expect(corners[2]).toEqual({ x: 600, y: 550 }); // BR
  });

  it("la poignée de rotation est au-dessus du centre de la box, hors de la box elle-même", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const photoSize = { width: 200, height: 100 };
    const { rotationHandle, corners } = computeHandleGeometry(transform, photoSize);
    expect(rotationHandle.x).toBeCloseTo(500);
    expect(rotationHandle.y).toBeLessThan(corners[0].y);
  });
});

describe("scaleFromCornerDrag / rotationFromPointer", () => {
  const photoSize = { width: 200, height: 100 };

  it("scaleFromCornerDrag retourne 1 quand le pointeur est exactement au coin de scale=1", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const scale = scaleFromCornerDrag(transform, photoSize, { x: 600, y: 550 });
    expect(scale).toBeCloseTo(1, 5);
  });

  it("scaleFromCornerDrag est clampé par MIN_TRANSFORM_SCALE quand le pointeur est sur le centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    const scale = scaleFromCornerDrag(transform, photoSize, { x: 500, y: 500 });
    expect(scale).toBe(MIN_TRANSFORM_SCALE);
  });

  it("rotationFromPointer retourne 0 quand le pointeur est directement au-dessus du centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(rotationFromPointer(transform, { x: 500, y: 300 })).toBeCloseTo(0, 5);
  });

  it("rotationFromPointer retourne PI/2 quand le pointeur est directement à droite du centre", () => {
    const transform = { x: 500, y: 500, scale: 1, rotation: 0 };
    expect(rotationFromPointer(transform, { x: 700, y: 500 })).toBeCloseTo(Math.PI / 2, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/ui/transform.test.ts`
Expected: FAIL — le module `src/ui/transform.ts` n'existe pas.

- [ ] **Step 3: Implémenter `src/ui/transform.ts`**

```ts
import type { LayerTransform } from "../layers/types";

export interface PixelSize {
  width: number;
  height: number;
}

export interface UvPoint {
  u: number;
  v: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface TransformHandleGeometry {
  /** Coins de la box englobante, coordonnées PIXELS du fond, ordre TL, TR, BR, BL. */
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  rotationHandle: PixelPoint;
}

/** Échelle minimale non nulle — empêche une box de collapser à zéro ou de
 *  s'inverser (division par une échelle nulle dans `compositeUvToPhotoUv`). */
export const MIN_TRANSFORM_SCALE = 0.02;

const ROTATION_HANDLE_OFFSET_PX = 32;

export function clampTransformScale(scale: number): number {
  return scale > MIN_TRANSFORM_SCALE ? scale : MIN_TRANSFORM_SCALE;
}

/**
 * Convertit une UV composite (0..1 sur la photo de fond) en UV dans la
 * photo A elle-même (0..1), par la transform INVERSE de son placement
 * (translation `(transform.x, transform.y)`, échelle uniforme
 * `transform.scale`, rotation `transform.rotation` radians autour de son
 * propre centre). Retourne `null` quand le point composite tombe HORS des
 * bornes de la photo A — le renderer traite `null`/hors-bornes comme
 * transparent, jamais un repeat/clamp de bord visible (design doc, PRD).
 */
export function compositeUvToPhotoUv(
  compositeUv: UvPoint,
  bgSize: PixelSize,
  transform: LayerTransform,
  photoSize: PixelSize,
): UvPoint | null {
  const px = compositeUv.u * bgSize.width;
  const py = compositeUv.v * bgSize.height;
  const dx = px - transform.x;
  const dy = py - transform.y;
  const cos = Math.cos(-transform.rotation);
  const sin = Math.sin(-transform.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const scale = clampTransformScale(transform.scale);
  const lx = rx / scale;
  const ly = ry / scale;
  const photoPx = lx + photoSize.width / 2;
  const photoPy = ly + photoSize.height / 2;
  if (photoPx < 0 || photoPx >= photoSize.width || photoPy < 0 || photoPy >= photoSize.height) {
    return null;
  }
  return { u: photoPx / photoSize.width, v: photoPy / photoSize.height };
}

function rotatePoint(local: PixelPoint, transform: LayerTransform): PixelPoint {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: transform.x + local.x * cos - local.y * sin,
    y: transform.y + local.x * sin + local.y * cos,
  };
}

/** Géométrie écran (coordonnées pixels du fond) des poignées de
 *  `TransformHandles` : 4 coins pour l'échelle uniforme, 1 poignée dédiée
 *  au-dessus de la box pour la rotation — jamais de déformation
 *  non-uniforme (hors-scope v1, design doc). */
export function computeHandleGeometry(transform: LayerTransform, photoSize: PixelSize): TransformHandleGeometry {
  const halfW = (photoSize.width * transform.scale) / 2;
  const halfH = (photoSize.height * transform.scale) / 2;
  const localCorners: PixelPoint[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  const corners = localCorners.map((p) => rotatePoint(p, transform)) as TransformHandleGeometry["corners"];
  const rotationHandle = rotatePoint({ x: 0, y: -halfH - ROTATION_HANDLE_OFFSET_PX }, transform);
  return { corners, rotationHandle };
}

/**
 * Nouvelle échelle uniforme telle que le point sous le pointeur se trouve à
 * la même distance du centre que le coin de la box à cette échelle — basé
 * sur le RATIO des distances au centre (pas la direction), pour ne jamais
 * produire de saut brusque si le pointeur traverse le centre pendant le
 * drag. Clampée par `clampTransformScale`.
 */
export function scaleFromCornerDrag(transform: LayerTransform, photoSize: PixelSize, pointer: PixelPoint): number {
  const dx = pointer.x - transform.x;
  const dy = pointer.y - transform.y;
  const pointerDistance = Math.hypot(dx, dy);
  const baseHalfDiagonal = Math.hypot(photoSize.width / 2, photoSize.height / 2);
  if (baseHalfDiagonal === 0) return clampTransformScale(transform.scale);
  return clampTransformScale(pointerDistance / baseHalfDiagonal);
}

/**
 * Nouvel angle de rotation (radians) tel que la poignée de rotation pointe
 * vers `pointer` — mesuré depuis le HAUT de la box (angle 0 = poignée
 * directement au-dessus du centre), pour matcher l'orientation visuelle de
 * la poignée dédiée plutôt que l'axe X mathématique standard.
 */
export function rotationFromPointer(transform: LayerTransform, pointer: PixelPoint): number {
  const dx = pointer.x - transform.x;
  const dy = pointer.y - transform.y;
  return Math.atan2(dx, -dy);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/ui/transform.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check et suite complète**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/ui/transform.ts test/ui/transform.test.ts
git commit -m "feat(ui): add pure transform geometry for the photo-layer handles"
```

---

### Task 4: `TransformHandles` overlay + câblage import 2e photo

**Files:**
- Create: `src/components/TransformHandles.tsx`
- Create: `src/components/TransformHandles.css`
- Modify: `src/App.tsx` (import 2e photo, `photoSourceStoreRef`, sélection, câblage overlay, handlers transform live+commit)
- Modify: `src/components/Toolbar.tsx` (bouton "Importer une 2e photo")
- Test: aucun nouveau fichier de test (composant React, convention projet : pas de rendu de composant testé) — la démonstration est visuelle (Step final, CDP).

**Interfaces:**
- Consumes: `computeHandleGeometry`, `scaleFromCornerDrag`, `rotationFromPointer`, `clampTransformScale` (`src/ui/transform.ts`, Task 3) ; `LayerTransform` (Task 1) ; `pickImageFile`/`readImageFile` (`src/launch.ts`, existants) ; `canAddPhotoLayer` (`src/layers/photoLayer.ts`, Task 1).
- Produces:
  ```ts
  interface TransformHandlesProps {
    transform: LayerTransform;
    photoSize: { width: number; height: number };
    bgSize: { width: number; height: number };
    canvasRef: React.RefObject<HTMLCanvasElement>;
    onTransformChange: (transform: LayerTransform) => void;
    onTransformCommit: () => void;
  }
  function TransformHandles(props: TransformHandlesProps): JSX.Element;
  ```

**Note d'implémentation** : ce composant est un overlay canvas/SVG positionné en absolu par-dessus `<canvas>`, exactement comme le curseur pinceau custom de `Canvas.tsx` (`updateCursorGeometry`, manipulation DOM directe pour rester fluide, pas de state React par frame de drag). À ce stade (avant Task 5), le renderer GPU ignore encore `imageSource` — le canvas WebGPU ne montre donc PAS encore la photo A composée. Ce qui est démontrable ICI est la box de poignées elle-même : visible, positionnée, et déplaçable par-dessus le canvas existant.

- [ ] **Step 1: Créer `TransformHandles.css`**

Create `src/components/TransformHandles.css`:

```css
.transform-handles {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.transform-handles__box {
  position: absolute;
  border: 1px solid var(--outline-contrast, #fff);
  pointer-events: none;
}

.transform-handles__corner {
  position: absolute;
  width: 10px;
  height: 10px;
  margin: -5px;
  border-radius: 50%;
  background: var(--surface-canvas, #fff);
  border: 1px solid var(--outline-contrast, #000);
  pointer-events: auto;
  cursor: nwse-resize;
}

.transform-handles__rotation {
  position: absolute;
  width: 12px;
  height: 12px;
  margin: -6px;
  border-radius: 50%;
  background: var(--accent, #4a9eff);
  border: 1px solid var(--outline-contrast, #000);
  pointer-events: auto;
  cursor: grab;
}
```

(Si `--outline-contrast`/`--surface-canvas`/`--accent` n'existent pas dans `src/design/semantic.css`, réutiliser les tokens équivalents réels — vérifier `src/design/semantic.css`/`src/design/primitives.css` avant de committer, conformément au § Wireframe & tokens du `CLAUDE.md` : ne jamais introduire une couleur en dur qui contourne un token existant.)

- [ ] **Step 2: Créer `TransformHandles.tsx`**

```tsx
import { useCallback, useRef } from "react";
import type { LayerTransform } from "../layers/types";
import { computeHandleGeometry, scaleFromCornerDrag, rotationFromPointer } from "../ui/transform";
import "./TransformHandles.css";

interface Props {
  transform: LayerTransform;
  photoSize: { width: number; height: number };
  bgSize: { width: number; height: number };
  canvasRef: React.RefObject<HTMLCanvasElement>;
  onTransformChange: (transform: LayerTransform) => void;
  onTransformCommit: () => void;
}

type DragKind = { kind: "corner" } | { kind: "rotate" } | { kind: "move"; startX: number; startY: number; originTransform: LayerTransform };

/**
 * Overlay de poignées type Photoshop pour un calque de photo (double
 * exposure) : 4 coins pour l'échelle uniforme, 1 poignée dédiée pour la
 * rotation, corps de la box pour déplacer. Même famille de gestion pointer
 * que `MaskPainter`/le pan-zoom existants (`pointerdown`/`pointermove`/
 * `pointerup` + `setPointerCapture`) — toute la géométrie vit dans
 * `ui/transform.ts`, ce composant ne fait que traduire écran<->pixels du
 * fond et déléguer.
 */
export function TransformHandles({ transform, photoSize, bgSize, canvasRef, onTransformChange, onTransformCommit }: Props) {
  const dragRef = useRef<DragKind | null>(null);

  const screenToImagePixels = useCallback(
    (clientX: number, clientY: number): { x: number; y: number } | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return { x: (clientX - rect.left) * scaleX, y: (clientY - rect.top) * scaleY };
    },
    [canvasRef],
  );

  const { corners, rotationHandle } = computeHandleGeometry(transform, photoSize);
  const minX = Math.min(...corners.map((c) => c.x));
  const minY = Math.min(...corners.map((c) => c.y));
  const maxX = Math.max(...corners.map((c) => c.x));
  const maxY = Math.max(...corners.map((c) => c.y));

  function toScreenStyle(point: { x: number; y: number }): React.CSSProperties {
    // Positionnement en % du canvas (le canvas est affiché réduit via
    // max-width/height 100%, même principe que le curseur pinceau) — évite
    // de recalculer un pixel-ratio à chaque render, se redimensionne seul
    // avec le canvas.
    return {
      left: `${(point.x / bgSize.width) * 100}%`,
      top: `${(point.y / bgSize.height) * 100}%`,
    };
  }

  function handlePointerDown(e: React.PointerEvent, kind: DragKind) {
    e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    dragRef.current = kind;
  }

  function handlePointerMove(e: React.PointerEvent) {
    const drag = dragRef.current;
    if (!drag) return;
    const pointer = screenToImagePixels(e.clientX, e.clientY);
    if (!pointer) return;
    if (drag.kind === "corner") {
      const scale = scaleFromCornerDrag(transform, photoSize, pointer);
      onTransformChange({ ...transform, scale });
    } else if (drag.kind === "rotate") {
      const rotation = rotationFromPointer(transform, pointer);
      onTransformChange({ ...transform, rotation });
    } else {
      const dx = pointer.x - drag.startX;
      const dy = pointer.y - drag.startY;
      onTransformChange({ ...drag.originTransform, x: drag.originTransform.x + dx, y: drag.originTransform.y + dy });
    }
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!dragRef.current) return;
    if ((e.currentTarget as Element).hasPointerCapture(e.pointerId)) {
      (e.currentTarget as Element).releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
    onTransformCommit();
  }

  return (
    <div className="transform-handles">
      <div
        className="transform-handles__box"
        style={{
          left: `${(minX / bgSize.width) * 100}%`,
          top: `${(minY / bgSize.height) * 100}%`,
          width: `${((maxX - minX) / bgSize.width) * 100}%`,
          height: `${((maxY - minY) / bgSize.height) * 100}%`,
          pointerEvents: "auto",
          cursor: "move",
        }}
        onPointerDown={(e) => handlePointerDown(e, { kind: "move", startX: screenToImagePixels(e.clientX, e.clientY)?.x ?? 0, startY: screenToImagePixels(e.clientX, e.clientY)?.y ?? 0, originTransform: transform })}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
      {corners.map((corner, i) => (
        <div
          key={i}
          className="transform-handles__corner"
          style={toScreenStyle(corner)}
          onPointerDown={(e) => handlePointerDown(e, { kind: "corner" })}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
        />
      ))}
      <div
        className="transform-handles__rotation"
        style={toScreenStyle(rotationHandle)}
        onPointerDown={(e) => handlePointerDown(e, { kind: "rotate" })}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      />
    </div>
  );
}
```

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS (aucun test dédié — composant React, convention projet).

- [ ] **Step 4: Commit**

```bash
git add src/components/TransformHandles.tsx src/components/TransformHandles.css
git commit -m "feat(ui): add TransformHandles overlay (corner scale + rotation handle)"
```

- [ ] **Step 5: Ajouter le bouton "Importer une 2e photo" à `Toolbar`**

`src/components/Toolbar.tsx`, ajouter aux `Props` :

```ts
  onImportPhotoLayer: () => void;
  canImportPhotoLayer: boolean;
```

et un `DropdownMenuItem` sous celui d'"Ouvrir" :

```tsx
import { Download, FolderOpen, ImagePlus, Menu, Redo2, Undo2 } from "lucide-react";
```

```tsx
          <DropdownMenuItem onClick={onImportPhotoLayer} disabled={!hasImage || !canImportPhotoLayer}>
            <ImagePlus className="icon-md icon-stroke" aria-hidden="true" />
            Importer une 2e photo (double exposure)
          </DropdownMenuItem>
```

(placé juste après le `DropdownMenuItem` "Ouvrir", avant "Exporter" — `hasImage` requis puisqu'une photo de fond doit déjà être chargée).

- [ ] **Step 6: Câbler l'import dans `App.tsx`**

`src/App.tsx`, ajouter les imports :

```ts
import { TransformHandles } from "./components/TransformHandles";
import { PhotoSourceStore } from "./render/photoSourceStore";
import { canAddPhotoLayer } from "./layers/photoLayer";
import type { LayerTransform } from "./layers/types";
```

Ajouter un ref à côté de `rendererRef` :

```ts
  const photoSourceStoreRef = useRef<PhotoSourceStore | null>(null);
```

Dans `openFile`, juste après `rendererRef.current = candidate;` (avant `setImageSize(...)`), (re)créer le store pour le nouveau document — même cycle de vie que `rendererRef` :

```ts
      photoSourceStoreRef.current?.dispose();
      photoSourceStoreRef.current = new PhotoSourceStore(gpuRef.current.device, gpuRef.current.srgbFormat, gpuRef.current.device.limits.maxTextureDimension2D);
```

Ajouter le handler d'import (à côté de `handleOpenFile`) :

```ts
  const handleImportPhotoLayer = useCallback(async () => {
    if (!photoSourceStoreRef.current) return;
    if (!canAddPhotoLayer(sessionRef.current.layers())) {
      setError("Limite atteinte : au plus une photo importée (double exposure) par document.");
      return;
    }
    try {
      const path = await pickImageFile();
      if (!path) return;
      const bytes = await readImageFile(path);
      const blob = new Blob([bytes.buffer as ArrayBuffer], { type: "image/jpeg" });
      const bitmap = await createImageBitmap(blob);
      const sourceId = photoSourceStoreRef.current.register(bitmap);
      const transform: LayerTransform = { x: imageSize.width / 2, y: imageSize.height / 2, scale: 1, rotation: 0 };
      const stack = currentStack();
      const id = stack.addPhotoLayer(sourceId, transform);
      commit(stack);
      selectLayer(id);
      setError(null);
    } catch (e) {
      setError(messageFromUnknown(e));
    }
  }, [commit, currentStack, imageSize.width, imageSize.height, selectLayer]);
```

Ajouter les handlers de transform live+commit (même pattern que `handleParamChange`/`handleParamCommit`) :

```ts
  const handleTransformChange = useCallback(
    (id: string, transform: LayerTransform) => {
      const previous = sessionRef.current.layers().find((l) => l.id === id);
      if (previous?.transform && (previous.transform.x !== transform.x || previous.transform.y !== transform.y || previous.transform.scale !== transform.scale || previous.transform.rotation !== transform.rotation)) {
        paramDirtyRef.current = true;
      }
      const full = sessionRef.current.layers().map((l) => (l.id === id ? { ...l, transform } : l));
      sessionRef.current.replaceLiveLayers(full);
      syncSession();
      rendererRef.current?.requestRender(full);
    },
    [syncSession],
  );

  const handleTransformCommit = useCallback(() => {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }, [commit, currentStack]);
```

Dans le JSX du `<Toolbar>`, ajouter les deux nouvelles props :

```tsx
        onImportPhotoLayer={handleImportPhotoLayer}
        canImportPhotoLayer={canAddPhotoLayer(layers)}
```

Dans le JSX, à l'intérieur de `<main className="workspace" ...>`, juste après `<Canvas ... />`, ajouter l'overlay conditionnel (calque photo sélectionné uniquement, même condition que l'affichage des contrôles de `ParamPanel`) :

```tsx
        {selectedLayer?.imageSource && selectedLayer.transform && (
          <TransformHandles
            transform={selectedLayer.transform}
            photoSize={photoSourceStoreRef.current?.dimensions(selectedLayer.imageSource.sourceId) ?? { width: 1, height: 1 }}
            bgSize={imageSize}
            canvasRef={canvasRef}
            onTransformChange={(t) => handleTransformChange(selectedLayer.id, t)}
            onTransformCommit={handleTransformCommit}
          />
        )}
```

- [ ] **Step 7: Type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 8: Vérification visuelle CDP — box de poignées visible et déplaçable**

Suivre `CLAUDE.md` § Méthode ("Debug console/DOM sans computer-use") : lancer `npm run dev:debug`, se connecter via CDP, ouvrir une image de fond, cliquer "Importer une 2e photo (double exposure)", sélectionner un fichier JPEG réel. Vérifier via `Runtime.evaluate`/`document.querySelector(".transform-handles__box")` que la box existe et a des dimensions non nulles ; simuler un drag d'un coin (`Input.dispatchMouseEvent` — suffisant ici, ce n'est PAS un drag HTML5 natif, juste des événements pointer synthétiques que le composant gère lui-même) et confirmer que `layer.transform.scale` change dans l'état React (lisible via un point d'inspection temporaire ou le futur ParamPanel). Checkpoint humain final sur la fenêtre réelle avant de passer à la Task 5 (le rendu GPU de la photo n'est PAS encore attendu ici — seule la box compte).

- [ ] **Step 9: Commit**

```bash
git add src/App.tsx src/components/Toolbar.tsx
git commit -m "feat(app): wire second-photo import and draggable transform handles"
```

---

### Task 5: Rendu — pré-passe C2, `hasImageSource`, compositing correct

**Files:**
- Create: `src/render/photoLayerInput.ts`
- Test: `test/render/photoLayerInput.test.ts`
- Modify: `src/render/shaderCompose.ts` (`ComposeOptions.hasImageSource`, binding 6, `effectInput`/`coverage`)
- Test: `test/render/shaderCompose.test.ts` (étendu)
- Modify: `src/render/effectPassRunner.ts` (`runEffectPass` accepte `imageSourceView`)
- Test: `test/render/effectPassRunner.test.ts` (étendu — vérifié à l'étape 1 du fichier existant)
- Modify: `src/render/framePipelineExecutor.ts` (nouveau port `PhotoLayerInputPort`, choix de `sourceView` par calque)
- Test: `test/render/framePipelineExecutor.test.ts` (étendu)
- Modify: `src/render/renderer.ts` (instancie `PhotoSourceStore`/`PhotoLayerInputResolver`, adapter du port)

**Interfaces:**
- Consumes: `FULLSCREEN_VERTEX_WGSL` (`shaderCompose.ts:8`) ; `LayerTransform` (Task 1) ; `PhotoSourceStore` (Task 2).
- Produces:
  ```ts
  class PhotoLayerInputResolver {
    constructor(device: GPUDevice, srgbFormat: GPUTextureFormat, sampler: GPUSampler);
    resolve(
      encoder: GPUCommandEncoder,
      photoTexture: GPUTexture,
      photoWidth: number,
      photoHeight: number,
      bgWidth: number,
      bgHeight: number,
      transform: LayerTransform,
      pendingDestroy: (GPUTexture | GPUBuffer)[],
    ): GPUTexture;
    dispose(): void;
  }

  interface PhotoLayerInputPort {
    resolve(
      encoder: GPUCommandEncoder,
      layer: LayerState,               // layer.imageSource/.transform garantis non-null par l'appelant
      bgWidth: number,
      bgHeight: number,
      pendingDestroy: FrameResource[],
    ): GPUTexture;                      // lève si layer.imageSource.sourceId est introuvable (fail-fast)
  }
  ```
  `ComposeOptions` gagne `hasImageSource: boolean`. `EffectPassRunner.runEffectPass`'s `options` gagne `imageSourceView?: GPUTextureView | null`.

- [ ] **Step 1: Write the failing test — `PhotoLayerInputResolver`**

Create `test/render/photoLayerInput.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoLayerInputResolver } from "../../src/render/photoLayerInput";

vi.stubGlobal("GPUShaderStage", { FRAGMENT: 2 });
vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, COPY_DST: 8 });
vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 4 });

function texture() {
  return { createView: vi.fn(() => ({})), destroy: vi.fn() };
}

function createDevice() {
  const created: ReturnType<typeof texture>[] = [];
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(() => {
      const t = texture();
      created.push(t);
      return t;
    }),
    createBuffer: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
  };
  return { device, encoder, pass, created };
}

describe("PhotoLayerInputResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a target texture sized to the background and writes the transform uniform", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
    const photoTexture = texture() as unknown as GPUTexture;
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    const target = resolver.resolve(
      encoder as unknown as GPUCommandEncoder,
      photoTexture,
      200,
      100,
      1000,
      800,
      { x: 500, y: 400, scale: 1, rotation: 0 },
      pendingDestroy,
    );

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ size: [1000, 800] }),
    );
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      new Float32Array([500, 400, 1, 0, 1000, 800, 200, 100]),
    );
    expect(target).toBeDefined();
  });

  it("pushes the transient uniform buffer into pendingDestroy but not the target texture (frame pipeline owns it)", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, pendingDestroy);

    expect(pendingDestroy).toHaveLength(1); // le paramBuffer, pas la texture cible
  });

  it("reuses the same pipeline across multiple resolve() calls", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);

    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);
    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);

    expect(device.createRenderPipeline).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/render/photoLayerInput.test.ts`
Expected: FAIL — `src/render/photoLayerInput.ts` n'existe pas.

- [ ] **Step 3: Implémenter `PhotoLayerInputResolver`**

Create `src/render/photoLayerInput.ts`:

```ts
import { FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import type { LayerTransform } from "../layers/types";

/**
 * WGSL de la pré-passe de résolution d'entrée d'un calque de photo
 * (ARCHITECTURE.md §4.3, approche C2). Rend photo A transformée dans une
 * texture pleine taille alignée sur le fond : RGB = échantillon de photo A
 * à l'UV inverse-transformée, alpha = couverture (1 dans les bornes de la
 * photo avec un feather ~1px en espace photo, 0 hors bornes — jamais de
 * répétition/clamp de bord visible, barre de qualité : pas de cutoff
 * jaggy). La chaîne existante (passes internes, composite, masque, blend)
 * consomme le résultat comme n'importe quelle texture d'entrée normale, via
 * le binding conditionnel `hasImageSource` de `shaderCompose.ts`.
 */
export const PHOTO_LAYER_INPUT_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var photoTexture: texture_2d<f32>;
@group(0) @binding(1) var photoSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 8>;

@fragment
fn fs_photo_input(in: VertexOut) -> @location(0) vec4<f32> {
  let x = params[0];
  let y = params[1];
  let scale = params[2];
  let rotation = params[3];
  let bgWidth = params[4];
  let bgHeight = params[5];
  let photoWidth = params[6];
  let photoHeight = params[7];

  let px = in.uv.x * bgWidth;
  let py = in.uv.y * bgHeight;
  let dx = px - x;
  let dy = py - y;
  let c = cos(-rotation);
  let s = sin(-rotation);
  let rx = dx * c - dy * s;
  let ry = dx * s + dy * c;
  let lx = rx / scale;
  let ly = ry / scale;
  let photoPx = lx + photoWidth * 0.5;
  let photoPy = ly + photoHeight * 0.5;
  let photoUv = vec2<f32>(photoPx / photoWidth, photoPy / photoHeight);

  let edgeDistPx = min(min(photoPx, photoWidth - photoPx), min(photoPy, photoHeight - photoPy));
  let coverage = clamp(edgeDistPx, 0.0, 1.0);

  let sample = textureSample(photoTexture, photoSampler, photoUv);
  return vec4<f32>(sample.rgb, coverage);
}
`;

export class PhotoLayerInputResolver {
  private pipeline: GPURenderPipeline | null = null;
  private bindGroupLayout: GPUBindGroupLayout | null = null;

  constructor(
    private readonly device: GPUDevice,
    private readonly srgbFormat: GPUTextureFormat,
    private readonly sampler: GPUSampler,
  ) {}

  private ensurePipeline(): { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout } {
    if (this.pipeline && this.bindGroupLayout) return { pipeline: this.pipeline, bindGroupLayout: this.bindGroupLayout };
    const module = this.device.createShaderModule({ code: PHOTO_LAYER_INPUT_WGSL });
    const bindGroupLayout = this.device.createBindGroupLayout({
      entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ],
    });
    const pipeline = this.device.createRenderPipeline({
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_photo_input", targets: [{ format: this.srgbFormat }] },
    });
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    return { pipeline, bindGroupLayout };
  }

  /** Rend photo A transformée dans une texture transitoire bgWidth×bgHeight.
   *  La texture cible N'EST PAS poussée dans `pendingDestroy` par cette
   *  méthode — c'est l'appelant (`FramePipelineExecutor`, qui connaît la
   *  durée de vie réelle du reste de la frame) qui décide quand la
   *  détruire, exactement comme pour les textures transitoires des passes
   *  internes d'effet (`runInternalPasses`). Seul le buffer d'uniform
   *  transitoire de CETTE passe est poussé ici. */
  resolve(
    encoder: GPUCommandEncoder,
    photoTexture: GPUTexture,
    photoWidth: number,
    photoHeight: number,
    bgWidth: number,
    bgHeight: number,
    transform: LayerTransform,
    pendingDestroy: (GPUTexture | GPUBuffer)[],
  ): GPUTexture {
    const { pipeline, bindGroupLayout } = this.ensurePipeline();
    const target = this.device.createTexture({
      size: [bgWidth, bgHeight],
      format: this.srgbFormat,
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
    });
    const paramValues = new Float32Array([
      transform.x, transform.y, transform.scale, transform.rotation,
      bgWidth, bgHeight, photoWidth, photoHeight,
    ]);
    const paramBuffer = this.device.createBuffer({ size: paramValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuffer, 0, paramValues);
    pendingDestroy.push(paramBuffer);

    const bindGroup = this.device.createBindGroup({
      layout: bindGroupLayout,
      entries: [
        { binding: 0, resource: photoTexture.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 0 } }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
    return target;
  }

  dispose(): void {
    this.pipeline = null;
    this.bindGroupLayout = null;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/render/photoLayerInput.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render/photoLayerInput.ts test/render/photoLayerInput.test.ts
git commit -m "feat(render): add PhotoLayerInputResolver (C2 pre-pass, coverage in alpha)"
```

- [ ] **Step 6: Write the failing test — `composeShader` avec `hasImageSource`**

`test/render/shaderCompose.test.ts`, ajouter à la fin du fichier :

```ts
describe("composeShader hasImageSource", () => {
  it("declares the imageSource binding only when hasImageSource is true", () => {
    const withSource = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    const without = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: false, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    expect(withSource).toContain("@group(0) @binding(6) var imageSourceTexture");
    expect(without).not.toContain("imageSourceTexture");
  });

  it("fs_main reçoit l'échantillon imageSource comme entrée quand hasImageSource est vrai, color sinon", () => {
    const withSource = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    const without = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: false, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    expect(withSource).toContain("let effectInput = textureSample(imageSourceTexture, srcSampler, in.uv);");
    expect(without).toContain("let effectInput = color;");
  });

  it("le poids du mix inclut la couverture (alpha imageSource) uniquement quand hasImageSource est vrai", () => {
    const withSource = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    const without = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: false, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    expect(withSource).toContain("compositing.x * maskValue * effectInput.a");
    expect(without).not.toContain("effectInput.a");
    expect(without).toContain("compositing.x * maskValue);");
  });

  it("hasImageSource=true SANS applyMask ne déclare pas le binding (les passes internes n'en ont pas besoin)", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false, hasImageSource: true });
    expect(code).not.toContain("imageSourceTexture");
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `npx vitest run test/render/shaderCompose.test.ts`
Expected: FAIL — `ComposeOptions` n'a pas encore `hasImageSource` (erreur de type à la compilation du test, ou binding absent selon l'ordre de fix).

- [ ] **Step 8: Étendre `composeShader`**

`src/render/shaderCompose.ts`, remplacer `ComposeOptions` et `composeShader` :

```ts
export interface ComposeOptions {
  applyMask: boolean;
  hasPrevPass: boolean;
  /** Double exposure (ARCHITECTURE.md §4.3, approche C2) : ce calque porte
   *  un `imageSource` déjà résolu par `PhotoLayerInputResolver` en une
   *  texture pleine taille (RGB=photo A transformée, alpha=couverture).
   *  Ignoré quand `applyMask` est faux (les passes internes d'effet
   *  reçoivent directement cette texture comme `srcTexture` — pas besoin
   *  d'un second binding, voir `framePipelineExecutor.ts`). */
  hasImageSource: boolean;
  /** Corps `fn blend(base, top)` du mode de fusion du calque. Requis quand
   *  applyMask=true. Ignoré sinon (les passes internes ne compositent pas). */
  blendWgsl?: string;
}
```

```ts
export function composeShader(effectWgsl: string, opts: ComposeOptions): string {
  const maskBinding = opts.applyMask
    ? "@group(0) @binding(3) var maskTexture: texture_2d<f32>;"
    : "";
  const prevPassBinding = opts.hasPrevPass
    ? "@group(0) @binding(4) var prevPass: texture_2d<f32>;"
    : "";
  const compositingBinding = opts.applyMask
    ? "@group(0) @binding(5) var<uniform> compositing: vec4<f32>;"
    : "";
  // Le binding imageSource n'a de sens QUE sur le chemin de compositing
  // (applyMask) — les passes internes d'effet reçoivent directement la
  // texture résolue comme srcTexture (binding 0), voir framePipelineExecutor.ts.
  const hasImageSource = opts.applyMask && opts.hasImageSource;
  const imageSourceBinding = hasImageSource
    ? "@group(0) @binding(6) var imageSourceTexture: texture_2d<f32>;"
    : "";
  const blendBlock = opts.applyMask ? SRGB_HELPERS_WGSL + "\n" + (opts.blendWgsl ?? "") : "";
  const effectInputExpr = hasImageSource
    ? "textureSample(imageSourceTexture, srcSampler, in.uv);"
    : "color;";
  const coverageMixWeight = hasImageSource
    ? "compositing.x * maskValue * effectInput.a"
    : "compositing.x * maskValue";
  const fsBody = opts.applyMask
    ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  let blended = blend(color.rgb, effected.rgb);
  // Passe color.a tel quel (ne le mélange plus avec effected.a) : hypothèse
  // sûre tant que tout effet préserve l'alpha (source JPEG opaque, α≡1
  // partout — vérifié pour glow/chromaticBleed/grain/warp). Si un futur
  // effet produit un alpha ≠ color.a, ce court-circuit le perdrait
  // silencieusement — revoir alors ce mix si un effet à alpha variable arrive.
  // Pour un calque photo (hasImageSource), effectInput.a porte la
  // COUVERTURE de la pré-passe (ARCHITECTURE.md §4.3) : hors des bornes de
  // la photo A, effectInput.a=0 -> poids nul -> color.rgb (le fond)
  // reste inchangé, jamais un bord répété/clampé visible.
  return vec4<f32>(mix(color.rgb, blended, ${coverageMixWeight}), color.a);`
    : "return effected;";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, ${MAX_EFFECT_PARAMS}>;
${maskBinding}
${prevPassBinding}
${compositingBinding}
${imageSourceBinding}

${blendBlock}
${effectWgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effectInput = ${effectInputExpr}
  let effected = fs_main(in.uv, effectInput);
  ${fsBody}
}
`;
}
```

- [ ] **Step 9: Mettre à jour les appels existants à `composeShader`**

`src/render/effectPassRunner.ts`, les deux appels à `composeShader(...)` (dans `runInternalPasses` via `runEffectPass({applyMask:false})` et dans `runEffectPass` lui-même) doivent passer `hasImageSource`. Voir Step 12 ci-dessous pour le second (celui de `runEffectPass`) — traité ensemble puisque c'est le même fichier/la même étape logique de câblage. Ne PAS modifier cette étape isolément : passer directement à Step 10.

- [ ] **Step 10: Run test to verify it passes (composeShader seul)**

Run: `npx vitest run test/render/shaderCompose.test.ts`
Expected: PASS pour les nouveaux tests `composeShader hasImageSource`. Les appelants (`effectPassRunner.ts`) ne compilent pas encore (`hasImageSource` manquant dans l'appel) — normal, corrigé à l'étape suivante ; `npx tsc --noEmit` échouera jusque-là, c'est attendu à ce stade intermédiaire.

- [ ] **Step 11: Write the failing test — `runEffectPass` avec `imageSourceView`**

`test/render/effectPassRunner.test.ts` — d'abord le lire en entier pour respecter son style exact de mocks GPU (device/pipeline/bindGroup) :

Run: `cat test/render/effectPassRunner.test.ts` (PowerShell : `Get-Content test/render/effectPassRunner.test.ts`)

Ajouter, à la fin du fichier, un test suivant EXACTEMENT le même style de mock déjà utilisé dans ce fichier (créer `device`/`sampler`/`resolveMask` comme les tests existants du fichier le font — reprendre leur factory plutôt que d'en écrire une nouvelle) :

```ts
  it("binds imageSourceTexture at binding 6 and composes hasImageSource=true only when options.imageSourceView is set", () => {
    const { runner, device } = createRunner(); // réutiliser la factory déjà présente dans ce fichier
    const imageSourceView = {} as GPUTextureView;
    const encoder = { beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() })) } as unknown as GPUCommandEncoder;

    runner.runEffectPass(
      encoder,
      { id: "passthrough", name: "Passthrough", params: [], wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }" },
      layer(), // réutiliser le helper `layer()` déjà présent dans ce fichier
      {} as GPUTextureView,
      {} as GPUTextureView,
      { applyMask: true, imageSourceView },
      [],
    );

    const bindGroupCall = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(bindGroupCall.entries).toContainEqual({ binding: 6, resource: imageSourceView });
  });

  it("omits binding 6 when options.imageSourceView is absent", () => {
    const { runner, device } = createRunner();
    const encoder = { beginRenderPass: vi.fn(() => ({ setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() })) } as unknown as GPUCommandEncoder;

    runner.runEffectPass(
      encoder,
      { id: "passthrough", name: "Passthrough", params: [], wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }" },
      layer(),
      {} as GPUTextureView,
      {} as GPUTextureView,
      { applyMask: true },
      [],
    );

    const bindGroupCall = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(bindGroupCall.entries.some((e: { binding: number }) => e.binding === 6)).toBe(false);
  });
```

Note pour l'implémenteur : si `createRunner`/`layer()` n'existent pas exactement sous ces noms dans le fichier lu à l'étape précédente, adapter les deux tests ci-dessus aux noms réels des helpers déjà présents — ne PAS dupliquer une nouvelle factory, réutiliser celle du fichier (DRY, cohérence de style déjà établie dans ce fichier).

- [ ] **Step 12: Run test to verify it fails**

Run: `npx vitest run test/render/effectPassRunner.test.ts`
Expected: FAIL — `runEffectPass`'s options n'accepte pas encore `imageSourceView`, binding 6 jamais ajouté.

- [ ] **Step 13: Étendre `EffectPassRunner.runEffectPass`**

`src/render/effectPassRunner.ts`, modifier la signature et le corps de `runEffectPass` :

```ts
  runEffectPass(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; guideEpoch?: number; imageSourceView?: GPUTextureView | null } = {},
    pendingDestroy: PendingDestroy = []
  ): void {
    const { applyMask = true, prevPassView = null, guideEpoch = 0, imageSourceView = null } = options;
    const paramValues = new Float32Array(MAX_EFFECT_PARAMS);
    effect.params.forEach((p, idx) => { paramValues[idx] = layer.params[p.name] ?? p.default; });
    const paramBuffer = this.device.createBuffer({ size: paramValues.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(paramBuffer, 0, paramValues);
    pendingDestroy.push(paramBuffer);

    const blendMode = getBlendMode(layer.blendMode ?? "normal");
    const hasImageSource = imageSourceView !== null;
    const shaderCode = composeShader(effect.wgsl, { applyMask, hasPrevPass: prevPassView !== null, hasImageSource, blendWgsl: applyMask ? blendMode.wgsl : undefined });
    let compositingBuffer: GPUBuffer | null = null;
    if (applyMask) {
      const compositing = new Float32Array([layer.opacity ?? 1, 0, 0, 0]);
      compositingBuffer = this.device.createBuffer({ size: compositing.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      this.device.queue.writeBuffer(compositingBuffer, 0, compositing);
      pendingDestroy.push(compositingBuffer);
    }

    let cached = this.pipelineCache.get(shaderCode);
    if (!cached) {
      const module = this.device.createShaderModule({ code: shaderCode });
      const layoutEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ];
      if (applyMask) layoutEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (prevPassView) layoutEntries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      if (applyMask) layoutEntries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      if (applyMask && hasImageSource) layoutEntries.push({ binding: 6, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      const bindGroupLayout = this.device.createBindGroupLayout({ entries: layoutEntries });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(shaderCode, cached);
    }

    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sourceView },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: paramBuffer } },
    ];
    if (applyMask) entries.push({ binding: 3, resource: this.resolveMask(layer, encoder, sourceView, pendingDestroy, guideEpoch).createView() });
    if (prevPassView) entries.push({ binding: 4, resource: prevPassView });
    if (applyMask && compositingBuffer) entries.push({ binding: 5, resource: { buffer: compositingBuffer } });
    if (applyMask && hasImageSource) entries.push({ binding: 6, resource: imageSourceView! });
    const bindGroup = this.device.createBindGroup({ layout: cached.bindGroupLayout, entries });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
```

`runInternalPasses` (même fichier) appelle `this.runEffectPass(encoder, ..., { applyMask: false }, pendingDestroy)` — `hasImageSource` y sera `false` (`imageSourceView` absent des options), cohérent avec la Step 8 (le binding est ignoré hors `applyMask` de toute façon). Aucun changement requis à `runInternalPasses` lui-même.

- [ ] **Step 14: Run test to verify it passes**

Run: `npx vitest run test/render/effectPassRunner.test.ts test/render/shaderCompose.test.ts && npx tsc --noEmit`
Expected: PASS (tous les fichiers touchés compilent maintenant).

- [ ] **Step 15: Commit**

```bash
git add src/render/shaderCompose.ts src/render/effectPassRunner.ts test/render/shaderCompose.test.ts test/render/effectPassRunner.test.ts
git commit -m "feat(render): add hasImageSource binding, fold coverage into the compositing weight"
```

- [ ] **Step 16: Write the failing test — `FramePipelineExecutor` avec `PhotoLayerInputPort`**

`test/render/framePipelineExecutor.test.ts`, modifier `createExecutor()` pour accepter/injecter un port `photoInputs` (5e argument du constructeur) :

```ts
import {
  FramePipelineExecutor,
  type EffectPassesPort,
  type MaskTexturesPort,
  type PhotoLayerInputPort,
} from "../../src/render/framePipelineExecutor";
```

Dans `createExecutor()`, ajouter :

```ts
  const photoInputs: PhotoLayerInputPort = {
    resolve: vi.fn(() => texture() as unknown as GPUTexture),
  };
```

et passer `photoInputs` en 5e argument à `new FramePipelineExecutor(device, {...}, effects, masks, photoInputs)`. Exposer `photoInputs` dans l'objet retourné par `createExecutor()` (à côté de `effects`, `masks`, etc.).

Ajouter, à la fin du fichier :

```ts
  it("resolves a photo layer's input via PhotoLayerInputPort and passes it as runInternalPasses' sourceView", () => {
    const { executor, effects, photoInputs } = createExecutor();
    const resolvedTexture = texture() as unknown as GPUTexture;
    (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(resolvedTexture);
    const photoLayer = layer({
      id: "L1",
      effectId: "grain",
      imageSource: { sourceId: "photo-1" },
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    });

    executor.run([photoLayer], {} as GPUTextureView, null);

    expect(photoInputs.resolve).toHaveBeenCalledOnce();
    expect(effects.runEffectPass).toHaveBeenCalledOnce();
    const [, , , , , options] = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(options.imageSourceView).toBe(resolvedTexture.createView.mock.results.at(-1)!.value);
  });

  it("does not call PhotoLayerInputPort for a layer without imageSource", () => {
    const { executor, photoInputs } = createExecutor();

    executor.run([layer({ id: "L1" })], {} as GPUTextureView, null);

    expect(photoInputs.resolve).not.toHaveBeenCalled();
  });

  it("feeds runInternalPasses the resolved photo texture, not the composite-below, for a photo layer with a multi-pass effect", () => {
    const { executor, effects, photoInputs, source } = createExecutor();
    const resolvedTexture = texture() as unknown as GPUTexture;
    (photoInputs.resolve as ReturnType<typeof vi.fn>).mockReturnValue(resolvedTexture);
    effects.runInternalPasses = vi.fn(() => ({ view: {} as GPUTextureView, texture: texture() as unknown as GPUTexture }));
    const photoLayer = layer({
      id: "L1",
      effectId: "glow", // effet réel avec effect.passes — voir getEffect("glow") importé au besoin
      imageSource: { sourceId: "photo-1" },
      transform: { x: 0, y: 0, scale: 1, rotation: 0 },
    });

    executor.run([photoLayer], {} as GPUTextureView, null);

    const [, , , internalSourceView] = (effects.runInternalPasses as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(internalSourceView).toBe(resolvedTexture.createView.mock.results.at(-1)!.value);
    expect(internalSourceView).not.toBe(source.createView.mock.results[0]?.value);
  });
```

Note : le test ci-dessus utilise `effectId: "glow"` uniquement pour déclencher `effect.passes?.length` truthy dans `FramePipelineExecutor` — comme le test mocke `EffectPassesPort` entièrement, il n'exécute JAMAIS le vrai WGSL de `glow`, seul `getEffect("glow").passes.length > 0` (fait réel du registry, vérifié Task 1) importe pour que la branche soit prise. Importer `getEffect` de `../../src/render/effects/registry` si le fichier ne l'importe pas déjà, et utiliser `getEffect("glow")` au lieu de coder `effectId: "glow"` en dur dans le mock si le helper `layer()` ne résout pas `effectId` vers un `EffectModule` réel (`FramePipelineExecutor.runFrame` appelle `getEffect(layer.effectId)` en interne, donc `effectId: "glow"` suffit tel quel).

- [ ] **Step 17: Run test to verify it fails**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts`
Expected: FAIL — `PhotoLayerInputPort` n'existe pas, le constructeur n'accepte pas de 5e argument.

- [ ] **Step 18: Étendre `FramePipelineExecutor`**

`src/render/framePipelineExecutor.ts`, ajouter l'interface après `MaskTexturesPort` :

```ts
/** Résout l'entrée d'un calque de photo (double exposure, ARCHITECTURE.md
 *  §4.3) en une texture pleine taille, couverture dans le canal alpha —
 *  jamais appelé pour un calque sans `imageSource`. Lève si
 *  `layer.imageSource.sourceId` est introuvable dans `PhotoSourceStore`
 *  (fail-fast, pas de calque photo silencieusement vide). */
export interface PhotoLayerInputPort {
  resolve(
    encoder: GPUCommandEncoder,
    layer: LayerState,
    bgWidth: number,
    bgHeight: number,
    pendingDestroy: FrameResource[],
  ): GPUTexture;
}
```

Modifier le constructeur :

```ts
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: FrameResourcesPort,
    private readonly effects: EffectPassesPort,
    private readonly masks: MaskTexturesPort,
    private readonly photoInputs: PhotoLayerInputPort,
  ) {}
```

Dans `runFrame`, à l'intérieur de la boucle principale (celle qui itère `enabledLayers`), juste avant `if (effect.passes?.length) {`, ajouter la résolution :

```ts
      let effectInputSourceView = readTexture.createView();
      let imageSourceView: GPUTextureView | null = null;
      if (layer.imageSource) {
        const resolved = this.photoInputs.resolve(encoder, layer, sourceTexture.width, sourceTexture.height, pendingDestroy);
        pendingDestroy.push(resolved);
        effectInputSourceView = resolved.createView();
        imageSourceView = resolved.createView();
      }
```

Modifier l'appel à `runInternalPasses` pour utiliser `effectInputSourceView` au lieu de `readTexture.createView()` :

```ts
      if (effect.passes?.length) {
        previousPass = this.effects.runInternalPasses(
          encoder,
          effect,
          layer,
          effectInputSourceView,
          pendingDestroy,
        );
      }
```

Modifier l'appel à `runEffectPass` (juste après) pour transmettre `imageSourceView` — `sourceView` (1er positionnel, = `readTexture.createView()`) reste INCHANGÉ (c'est le `color`/base du mix, qui doit toujours rester le composite-en-dessous, jamais la photo) :

```ts
      this.effects.runEffectPass(
        encoder,
        effect,
        layer,
        readTexture.createView(),
        targetView,
        {
          applyMask: true,
          prevPassView: previousPass?.view,
          imageSourceView,
          guideEpoch: index === 0 ? 0 : this.runGeneration,
        },
        pendingDestroy,
      );
```

- [ ] **Step 19: Mettre à jour `Renderer` (le seul appelant réel de `new FramePipelineExecutor`)**

`src/render/renderer.ts` — construit actuellement `new FramePipelineExecutor(device, this.imageResources, this.effectPassRunner, this.maskTextureResolver)` dans `loadImage()`. Ce câblage réel (avec un vrai `PhotoLayerInputResolver`/`PhotoSourceStore`) est traité à la Step 20 ci-dessous, dans le même commit — `tsc` échouera entre les deux si on les sépare, donc ne PAS committer entre Step 18 et Step 20.

- [ ] **Step 20: Câbler `PhotoSourceStore`/`PhotoLayerInputResolver` dans `Renderer`**

`src/render/renderer.ts`, ajouter les imports :

```ts
import { PhotoSourceStore } from "./photoSourceStore";
import { PhotoLayerInputResolver } from "./photoLayerInput";
import type { PhotoLayerInputPort } from "./framePipelineExecutor";
```

Ajouter un champ, à côté de `effectPassRunner`/`maskTextureResolver` :

```ts
  private photoSourceStore: PhotoSourceStore | null = null;
  private photoLayerInputResolver: PhotoLayerInputResolver | null = null;
```

Dans `loadImage()`, après la construction de `this.maskTextureResolver` et AVANT `this.framePipelineExecutor = new FramePipelineExecutor(...)`, ajouter :

```ts
    this.photoSourceStore?.dispose();
    this.photoSourceStore = new PhotoSourceStore(device, srgbFormat, device.limits.maxTextureDimension2D);
    this.photoLayerInputResolver?.dispose();
    this.photoLayerInputResolver = new PhotoLayerInputResolver(device, srgbFormat, this.sampler);
    const photoInputsAdapter: PhotoLayerInputPort = {
      resolve: (encoder, layer, bgWidth, bgHeight, pendingDestroy) => {
        if (!layer.imageSource || !layer.transform) {
          throw new Error(`Calque "${layer.id}" sans imageSource/transform passé au port photo — invariant violé.`);
        }
        const photoTexture = this.photoSourceStore!.get(layer.imageSource.sourceId);
        if (!photoTexture) {
          throw new Error(`Source de photo introuvable: ${layer.imageSource.sourceId} (calque "${layer.id}").`);
        }
        const dims = this.photoSourceStore!.dimensions(layer.imageSource.sourceId)!;
        return this.photoLayerInputResolver!.resolve(
          encoder, photoTexture, dims.width, dims.height, bgWidth, bgHeight, layer.transform, pendingDestroy,
        );
      },
    };
```

et modifier la construction de `this.framePipelineExecutor` pour passer `photoInputsAdapter` en 5e argument :

```ts
    this.framePipelineExecutor = new FramePipelineExecutor(
      device,
      this.imageResources,
      this.effectPassRunner,
      this.maskTextureResolver,
      photoInputsAdapter,
    );
```

Exposer `PhotoSourceStore` à `App.tsx` (Task 4 y avait créé son PROPRE `photoSourceStoreRef` indépendant du renderer — corriger cette duplication maintenant que le renderer possède la référence faisant autorité) : ajouter un accesseur public sur `Renderer` :

```ts
  /** Le `Renderer` est le propriétaire GPU réel (créé/vidé avec `loadImage`)
   *  — `App.tsx` s'en sert pour enregistrer/dimensionner les photos
   *  importées sans dupliquer un second store parallèle. */
  get photoSources(): PhotoSourceStore | null {
    return this.photoSourceStore;
  }
```

Dans `dispose()`, ajouter :

```ts
    this.photoSourceStore?.dispose();
    this.photoSourceStore = null;
    this.photoLayerInputResolver?.dispose();
    this.photoLayerInputResolver = null;
```

`src/App.tsx` (correction Task 4) : supprimer `photoSourceStoreRef` et son instanciation dans `openFile` ; remplacer chaque usage de `photoSourceStoreRef.current` par `rendererRef.current?.photoSources` :
- `handleImportPhotoLayer` : `if (!rendererRef.current?.photoSources) return;` puis `rendererRef.current.photoSources.register(bitmap)`.
- Le JSX de `TransformHandles` : `photoSourceStoreRef.current?.dimensions(...)` devient `rendererRef.current?.photoSources?.dimensions(...)`.

- [ ] **Step 21: Run test to verify it passes**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts && npx tsc --noEmit && npm run test`
Expected: PASS — suite complète verte, zéro régression sur les calques sans `imageSource` (le chemin `layer.imageSource` absent ne modifie ni `effectInputSourceView` ni `imageSourceView`, donc `runEffectPass`/`runInternalPasses` reçoivent exactement les mêmes arguments qu'avant cette tâche pour un calque d'effet ordinaire).

- [ ] **Step 22: Commit**

```bash
git add src/render/framePipelineExecutor.ts src/render/renderer.ts src/App.tsx test/render/framePipelineExecutor.test.ts
git commit -m "feat(render): wire the C2 photo-layer pre-pass into the frame pipeline"
```

- [ ] **Step 23: Vérification visuelle CDP — composite réel photo A sur photo B**

`npm run dev:debug` puis CDP (`CLAUDE.md` § Méthode) : ouvrir une photo de fond, importer une 2e photo via le bouton Toolbar, positionner/redimensionner via `TransformHandles` (Task 4, maintenant avec rendu correct), vérifier VISUELLEMENT sur la fenêtre réelle que :
1. la silhouette apparaît composée sur le fond, à l'intérieur de la box de poignées ;
2. l'extérieur de la box laisse voir le fond, sans bord répété/clampé visible ;
3. changer l'effet du calque photo (ex. passer de "passthrough" à "glow" via `ParamPanel`/le sélecteur d'effet — nécessite de rendre le sélecteur d'effet accessible pour un calque photo, déjà le cas puisque `LayerPanel`'s `addEffectOptions` liste les effets du registry indépendamment du type de calque ; changer l'`effectId` d'un calque existant n'a PAS de handler dédié dans `App.tsx` — si aucun n'existe, le documenter comme limitation connue plutôt que l'ajouter ici, hors scope de cette tâche) produit un flou/bloom visible SUR LA SILHOUETTE, pas sur le fond.
Checkpoint humain requis avant Task 6 (rendu GPU, pas vérifiable par un sous-agent headless — `CLAUDE.md` § Méthode).

---

### Task 6: Isolation du sujet — câblage, aucun changement à `MaskPainter`

**Files:**
- Test: `test/mask/photoLayerMask.test.ts` (nouveau, intégration légère)
- Modify: aucun fichier de production (le pinceau/le modèle de masque traitent déjà un calque photo comme n'importe quel calque — cette tâche PROUVE ce fait, elle ne code rien de neuf)

**Interfaces:**
- Consumes: `LayerStack.updateBrushMask` (`src/layers/layerStack.ts:103`), `defaultLayerMask` (`src/mask/types.ts:84`).
- Produces: rien de nouveau — cette tâche est une preuve, pas une extension.

- [ ] **Step 1: Write the failing test — un calque photo accepte un trait de pinceau comme n'importe quel calque**

Create `test/mask/photoLayerMask.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { MaskPainter } from "../../src/mask/maskPainter";

describe("Photo layer + MaskPainter integration", () => {
  it("updateBrushMask accepte un raster peint sur un calque portant imageSource, exactement comme un calque d'effet", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("photo-1", { x: 50, y: 50, scale: 1, rotation: 0 });

    const painter = new MaskPainter(100, 100);
    painter.paintStroke(50, 50, 20, 0.5, false);
    const changed = stack.updateBrushMask(id, painter.getMaskData());

    expect(changed).toBe(true);
    const layer = stack.layers.find((l) => l.id === id)!;
    const brush = layer.mask.sources.find((s) => s.type === "brush");
    expect(brush).toBeDefined();
    expect(brush!.type === "brush" && brush.raster.some((v) => v > 0)).toBe(true);
    // Le calque reste un calque photo à part entière : imageSource/transform
    // ne sont ni effacés ni altérés par une opération de masque.
    expect(layer.imageSource).toEqual({ sourceId: "photo-1" });
    expect(layer.transform).toEqual({ x: 50, y: 50, scale: 1, rotation: 0 });
  });

  it("le masque d'un calque photo est dimensionné à la photo de FOND, pas à la photo importée (ARCHITECTURE.md §4.5)", () => {
    // MaskPainter est TOUJOURS construit avec les dimensions de la photo de
    // fond (voir App.tsx: getSyncedMaskPainter(..., imageSize.width,
    // imageSize.height) — imageSize suit rendererRef/le document, jamais la
    // taille d'une photo importée). Ce test documente l'invariant au niveau
    // du modèle : rien dans updateBrushMask/MaskPainter ne consulte
    // layer.transform ou la taille de la photo importée.
    const stack = new LayerStack();
    const bgWidth = 300;
    const bgHeight = 200;
    const id = stack.addPhotoLayer("photo-1", { x: 10, y: 10, scale: 1, rotation: 0 });
    const painter = new MaskPainter(bgWidth, bgHeight);
    stack.updateBrushMask(id, painter.getMaskData());
    const layer = stack.layers.find((l) => l.id === id)!;
    const brush = layer.mask.sources.find((s) => s.type === "brush");
    expect(brush!.type === "brush" && brush.raster.length).toBe(bgWidth * bgHeight);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/mask/photoLayerMask.test.ts`
Expected: FAIL uniquement si `addPhotoLayer` n'existe pas (déjà fait en Task 1) — en réalité, PASS immédiat attendu puisqu'aucune tâche précédente n'a modifié `MaskPainter`/`updateBrushMask`. Documenter ce résultat comme preuve de non-régression (même remarque que Task 1 Step 9) plutôt que forcer un échec artificiel.

- [ ] **Step 3: Run test to verify it passes (confirmation)**

Run: `npx vitest run test/mask/photoLayerMask.test.ts`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add test/mask/photoLayerMask.test.ts
git commit -m "test(mask): prove MaskPainter/LayerStack treat a photo layer like any layer"
```

- [ ] **Step 5: Vérification visuelle CDP — isolation réelle**

`npm run dev:debug` + CDP : sur le document composé en Task 5, activer le mode pinceau (`maskPaintMode`), peindre sur le calque photo sélectionné pour isoler le sujet (effacer les bords indésirables de la silhouette). Confirmer visuellement que peindre RÉVÈLE le fond aux endroits masqués (mask=0 -> fond visible, cf. formule de mix Task 5) et que déplacer ENSUITE le calque via `TransformHandles` NE fait PAS suivre le masque peint (comportement assumé, `ARCHITECTURE.md` §4.5 — vérifier qu'il est bien reproductible, pas un bug caché ailleurs). Si le masque suit ou si le fond ne se révèle pas correctement, retourner en `systematic-debugging` sur Task 5 avant de continuer — ne pas avancer sur un rendu visuellement faux.

- [ ] **Step 6: Documenter le comportement assumé dans `CONTEXT.md`**

`CONTEXT.md`, dans l'entrée **Double exposure** existante, ajouter une phrase après "Isolation du sujet en v1 = pinceau manuel..." :

```
 Le masque peint sur un calque de photo vit dans l'espace de coordonnées de
 la photo de FOND, pas de la photo importée elle-même — déplacer le calque
 après avoir peint ne fait PAS suivre le masque (comportement assumé v1, pas
 un bug ; poser le transform avant de peindre). Source : ARCHITECTURE.md §4.5.
```

- [ ] **Step 7: Commit**

```bash
git add CONTEXT.md
git commit -m "docs(context): document photo-layer mask coordinate space (v1 assumed behavior)"
```

---

### Task 7: Limite 2 photos + bascule round-trip Lightroom

**Files:**
- Modify: `src/App.tsx` (message d'erreur déjà posé en Task 4 pour la limite — vérifier/consolider ; bascule round-trip)
- Test: `test/layers/photoLayer.test.ts` (déjà couvre `canAddPhotoLayer`/`hasPhotoLayer`, Task 1) — pas de nouveau test pur ; le câblage App.tsx n'est pas testé (composant React, convention projet), preuve = CDP.

Note : `src/components/Toolbar.tsx` n'est PAS modifié dans cette tâche — sa prop `hasLaunchFile: boolean` existe déjà (Toolbar.tsx:15) et son SENS se déplace de "isLaunchFile brut" à "round-trip réellement actif" uniquement via la valeur que `App.tsx` lui passe (Step 2 ci-dessous). Aucun diff de fichier Toolbar.tsx requis.

**Interfaces:**
- Consumes: `hasPhotoLayer` (`src/layers/photoLayer.ts`, Task 1), `resolveExportTargetAsync`/`resolveDefaultExportTarget` (`src/export/exportImage.ts`, existants, inchangés).
- Produces: rien de nouveau côté module pur — cette tâche est du câblage App.tsx + Toolbar.

- [ ] **Step 1: Confirmer la limite d'import (déjà codée Task 4)**

Relire `handleImportPhotoLayer` (Task 4, Step 6) : le garde `if (!canAddPhotoLayer(sessionRef.current.layers()))` est déjà en place et pose `setError(...)`. Aucun changement de code requis ici — vérifier par lecture que le message est bien visible (`<ErrorBanner>` déjà monté dans le JSX de `App.tsx`).

Run: `npx tsc --noEmit` (contrôle de non-régression avant de continuer)
Expected: PASS.

- [ ] **Step 2: Câbler la bascule round-trip dans `App.tsx`**

`src/App.tsx`, ajouter l'import :

```ts
import { hasPhotoLayer } from "./layers/photoLayer";
```

Juste avant le `return (` du composant, ajouter :

```ts
  // Round-trip Lightroom désactivé dès qu'un calque photo (double exposure)
  // existe dans le document — même si isLaunchFile est vrai. `roundTripActive`
  // gouverne à la fois l'état du bouton "Exporter sous..." (Toolbar) et le
  // comportement RÉEL du bouton "Exporter" (performExport ci-dessous) — un
  // seul point de vérité, comme l'exige ARCHITECTURE.md §4.6 ("ET logique
  // au même endroit, pas une nouvelle branche disséminée").
  const roundTripActive = isLaunchFile && !hasPhotoLayer(layers);
```

Modifier `performExport` : remplacer la condition `if (isLaunchFile) {` par `if (roundTripActive) {` (le corps reste identique).

Modifier `handleExport` :

```ts
  // Bouton "Exporter" : dossier fixe Images/shaderlab-export, nom nu tant
  // qu'il n'y a pas de collision réelle (resolveDefaultExportTarget) —
  // SAUF si le round-trip est bloqué par un calque photo malgré
  // isLaunchFile vrai : bascule alors explicitement vers le comportement
  // "Exporter sous..." (PRD : jamais un silence qui laisse croire que le
  // round-trip a eu lieu).
  async function handleExport() {
    if (isLaunchFile && !roundTripActive) {
      setError(
        "Round-trip Lightroom désactivé : ce document contient un calque de double exposure. Choisis un dossier d'export ci-dessous."
      );
      await handleExportAs();
      return;
    }
    await performExport(defaultExportDir, true);
  }
```

Passer `hasLaunchFile={roundTripActive}` (au lieu de `hasLaunchFile={isLaunchFile}`) au `<Toolbar>`.

- [ ] **Step 3: Run type-check**

Run: `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "feat(app): disable Lightroom round-trip and redirect to Export-as when a photo layer is present"
```

- [ ] **Step 5: Vérification visuelle CDP — limite + bascule round-trip**

`npm run dev:debug` + CDP : (a) tenter d'importer une 2e photo alors qu'un calque photo existe déjà → bandeau d'erreur visible, aucun second calque créé (`sessionRef.current.layers()` inchangé, vérifiable via `Runtime.evaluate`) ; (b) lancer l'app avec un chemin de lancement (simuler `getLaunchPath()` — ou, plus simple, lire le code pour confirmer que `isLaunchFile=true` déclenche bien la branche `handleExport` modifiée sans avoir besoin d'un vrai lancement Lightroom, PUIS valider en conditions réelles si un lancement Lightroom est disponible) + un calque photo présent → cliquer "Exporter" affiche le bandeau explicatif ET ouvre le flux "Exporter sous..." (dialogue de dossier), n'écrase JAMAIS le fichier de lancement.

- [ ] **Step 6: Commit final de la tâche (si des ajustements ont été faits pendant la vérification)**

```bash
git status
# committer tout ajustement résiduel avec un message décrivant le fix exact trouvé au checkpoint visuel
```

---

### Task 8: Mesure VRAM réelle + vérification bout-en-bout

**Files:**
- Aucun fichier de production modifié — tâche de mesure/vérification uniquement, gate finale "terminé = démontrable" (PRD).

**Interfaces:**
- Consumes: l'app complète (Tasks 1-7).
- Produces: un constat écrit (pas de code) — consigné dans le ledger de session (`learning-log.md`/mémoire projet, hors scope de ce plan qui s'arrête à l'implémentation) plutôt que dans un nouveau fichier de doc permanent (politique doc-rot, `~/.claude/rules/workflow.md`).

- [ ] **Step 1: Préparer un cas réel 24MP + 24MP**

Réunir deux photos JPEG réelles ≥ 24MP (silhouette + fond) — mêmes conditions que le risque R1 documenté dans `ARCHITECTURE.md` ("un document tient déjà 4 textures pleine taille persistantes... plus les textures de masque résidentes"). Si aucune photo 24MP n'est disponible localement, un JPEG généré synthétiquement à la bonne résolution (ex. via un script Node `sharp`/`canvas`, ou toute image existante upscalée) est acceptable — seule la RÉSOLUTION compte pour cette mesure, pas le contenu visuel.

- [ ] **Step 2: Lancer l'app en mode debug avec monitoring**

Run: `npm run dev:debug` puis `npm run dev:monitor` (voir `CLAUDE.md` § Commandes/Méthode).

- [ ] **Step 3: Ouvrir le fond, importer la silhouette, composer**

Via la fenêtre réelle (ou CDP) : ouvrir la photo de fond 24MP, importer la 2e photo 24MP, positionner via `TransformHandles`, peindre un masque d'isolation, appliquer un effet sur le calque photo (ex. glow, pour exercer le pré-passe + les passes internes ensemble — le pire cas VRAM du risque R1).

- [ ] **Step 4: Mesurer la VRAM réelle**

Utiliser le Gestionnaire des tâches Windows (onglet Performance > GPU > "Mémoire GPU dédiée utilisée") pendant que `shaderlab.exe` est au premier plan avec le document composé chargé, OU `chrome://gpu`/les stats WebGPU si exposées par WebView2 en mode debug. Noter la valeur observée. Comparer au budget théorique implicite de `ARCHITECTURE.md` R1 (~96 Mo/texture 24MP × [source + ping-pong×2 + export + photo importée + texture transitoire de pré-passe] + masques résidents) — confirmer qu'aucun crash/OOM ne survient (invariant `e3c7584` : c'est le state React qui avait crashé, pas la VRAM en soi — cette mesure vérifie le NOUVEAU risque, une vraie pression VRAM GPU).

- [ ] **Step 5: Décision — garde-fou nécessaire ou non**

Si la mesure montre une marge confortable (pas de device.lost, pas de ralentissement visible) : consigner "aucun garde-fou nécessaire en v1" (déjà la décision PRD par défaut). Si un `device.lost`/OOM survient : ouvrir un `systematic-debugging` séparé — hors scope de ce plan (le PRD n'exige PAS de garde-fou numérique en dur en v1, seulement la mesure) ; documenter le trigger de réouverture nommé dans la mémoire projet plutôt que bloquer cette feature dessus.

- [ ] **Step 6: Vérification visuelle bout-en-bout finale (CDP + checkpoint humain)**

Confirmer, sur ce même document composé, TOUS les critères "terminé = démontrable" du PRD pour Double exposure :
- import d'une 2e photo ✓ (Task 4/6)
- transform manuel fonctionnel ✓ (Task 3/4)
- masque peint isolant le sujet ✓ (Task 6)
- effets/blend applicables sur le calque de photo ✓ (Task 5)
- limite 2 photos respectée ✓ (Task 7)
- absence de round-trip Lightroom confirmée en présence de la feature ✓ (Task 7)

- [ ] **Step 7: Consigner le résultat**

Ajouter une entrée dans `.claude/learning-log.md` (projet) résumant : valeur VRAM mesurée, présence/absence de garde-fou, confirmation des 6 critères ci-dessus, date. Ne PAS créer de nouveau document `docs/` permanent pour ce constat ponctuel (politique doc-rot).

```bash
git add .claude/learning-log.md
git commit -m "docs(learning-log): double exposure VRAM measurement + end-to-end verification"
```
