# Remédiation architecture — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rendre le chemin chaud du rendu compatible avec les cibles de perf de la spec v1, borner l'historique à 512 Mo, et fiabiliser la couche fichier/IPC (écriture atomique, IPC binaire, CSP), sans changer aucun comportement visible hors performance et robustesse.

**Architecture:** La composition WGSL devient une fonction pure servant de clé à un cache de pipelines ; les masques deviennent des textures GPU résidentes réuploadées sur changement de référence seulement ; les rendus sont coalescés par rAF via un scheduler pur injectable. Les masques CPU deviennent immuables-partagés dans `clone()`, ce qui rend l'historique refcountable et bornable en octets. Côté Rust : écriture atomique tmp+rename, garde d'extension, IPC binaire Tauri v2 (Response/InvokeBody::Raw).

**Tech Stack:** TypeScript strict, Vitest (env Node, aucun rendu React en test), WebGPU/WGSL brut, Rust (Tauri 2.0, rfd 0.15, percent-encoding 2), cargo test.

## Global Constraints

- **Séquencement : exécuter APRÈS la fin du plan design system** (`docs/superpowers/plans/2026-07-13-shaderlab-design-system.md`), sur une branche `feature/archi-remediation` créée depuis l'état mergé. Aucune tâche de ce plan ne tourne en parallèle du plan design system.
- Cibles spec v1 (référence RTX 2060, JPEG 6240×4160, 4 calques) : slider < 100 ms, pinceau < 50 ms, export < 3 s ; historique plafonné à 512 Mo par document, éviction des plus anciennes, état courant toujours conservé, une entrée par interaction.
- Conventions verrouillées à préserver : formats `-srgb` partout, bind group layout EXPLICITE (jamais `layout: "auto"`), pas de gamma manuel en WGSL, pas de `@tauri-apps/plugin-dialog`.
- Tests : Vitest env Node ; aucun test ne rend de composant React ; le rendu GPU se vérifie par build + checkpoint humain ou monitoring CDP (`npm run dev:debug` + `npm run dev:monitor`).
- `cargo test`/`cargo check` exigent que `../dist` existe (`tauri::generate_context!`) — lancer `npm run build` d'abord si `dist/` manque.
- Messages d'erreur utilisateur en français (convention existante du repo).

## File Structure

- `src/render/shaderCompose.ts` (nouveau) — composition WGSL pure + `MAX_EFFECT_PARAMS`
- `src/render/frameScheduler.ts` (nouveau) — coalescing rAF générique, rAF injectable
- `src/render/limits.ts` (nouveau) — garde-fou dimensions GPU (pur)
- `src/render/maskResidency.ts` (nouveau) — réconciliation du cache de masques (pur)
- `src/render/effects/validate.ts` (nouveau) — validation fail-fast des `EffectModule`
- `src/render/renderer.ts`, `src/render/gpuContext.ts` — modifiés
- `src/layers/layerStack.ts` (clone partageur), `src/layers/history.ts` (réécrit), `src/layers/types.ts` (doc immutabilité)
- `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json` — modifiés
- `src/launch.ts`, `src/App.tsx`, `src/components/ParamPanel.tsx` — modifiés

---

### Task 1: Composition WGSL pure + cache de pipelines

**Files:**
- Create: `src/render/shaderCompose.ts`
- Test: `test/render/shaderCompose.test.ts`
- Modify: `src/render/renderer.ts`

**Interfaces:**
- Consumes: rien (fonction pure).
- Produces: `composeShader(effectWgsl: string, opts: { applyMask: boolean; hasPrevPass: boolean }): string` ; `MAX_EFFECT_PARAMS = 8` ; `FULLSCREEN_VERTEX_WGSL` (déplacé depuis renderer.ts). Le Renderer gagne un champ privé `pipelineCache: Map<string, { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }>` keyé par la chaîne retournée par `composeShader`.

- [ ] **Step 1: Écrire le test rouge**

Créer `test/render/shaderCompose.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { composeShader, MAX_EFFECT_PARAMS } from "../../src/render/shaderCompose";

const FS = "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }";

describe("composeShader", () => {
  it("is deterministic: same inputs produce the identical string (cache key stability)", () => {
    const a = composeShader(FS, { applyMask: true, hasPrevPass: false });
    const b = composeShader(FS, { applyMask: true, hasPrevPass: false });
    expect(a).toBe(b);
  });

  it("includes the fullscreen vertex stage and the effect body", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(code).toContain("fn vs_main");
    expect(code).toContain(FS);
    expect(code).toContain(`array<f32, ${MAX_EFFECT_PARAMS}>`);
  });

  it("declares the mask binding and mix() only when applyMask is true", () => {
    const masked = composeShader(FS, { applyMask: true, hasPrevPass: false });
    const unmasked = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(masked).toContain("@binding(3) var maskTexture");
    expect(masked).toContain("mix(color, effected, maskValue)");
    expect(unmasked).not.toContain("maskTexture");
    expect(unmasked).toContain("return effected;");
  });

  it("declares the prevPass binding only when hasPrevPass is true", () => {
    const withPrev = composeShader(FS, { applyMask: false, hasPrevPass: true });
    const without = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(withPrev).toContain("@binding(4) var prevPass");
    expect(without).not.toContain("prevPass");
  });

  it("produces distinct strings for distinct variants (no cache collisions)", () => {
    const variants = [
      composeShader(FS, { applyMask: false, hasPrevPass: false }),
      composeShader(FS, { applyMask: true, hasPrevPass: false }),
      composeShader(FS, { applyMask: false, hasPrevPass: true }),
      composeShader(FS, { applyMask: true, hasPrevPass: true }),
    ];
    expect(new Set(variants).size).toBe(4);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/render/shaderCompose.test.ts`
Expected: FAIL (module `src/render/shaderCompose` introuvable).

- [ ] **Step 3: Implémenter `src/render/shaderCompose.ts`**

Contenu complet — c'est un DÉPLACEMENT à l'identique de la logique de composition actuellement inline dans `runEffectPass` (renderer.ts:316-344) plus le vertex WGSL (renderer.ts:7-23). Ne pas reformuler le WGSL :

```ts
/** Taille du uniform `params: array<f32, N>` du header WGSL partagé.
 *  Un effet déclarant plus de paramètres est rejeté au chargement du
 *  registry (voir effects/validate.ts) — élargir cette constante et le
 *  header ensemble si le besoin apparaît. */
export const MAX_EFFECT_PARAMS = 8;

export const FULLSCREEN_VERTEX_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(pos[i], 0.0, 1.0);
  out.uv = pos[i] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

export interface ComposeOptions {
  applyMask: boolean;
  hasPrevPass: boolean;
}

/**
 * Composition pure du shader complet d'une passe. La chaîne retournée est
 * déterministe pour des entrées identiques : elle sert de CLÉ au cache de
 * pipelines du Renderer — toute variation d'entrée (corps d'effet, masque,
 * prevPass) produit une chaîne différente, donc un pipeline distinct.
 */
export function composeShader(effectWgsl: string, opts: ComposeOptions): string {
  const maskBinding = opts.applyMask
    ? "@group(0) @binding(3) var maskTexture: texture_2d<f32>;"
    : "";
  const prevPassBinding = opts.hasPrevPass
    ? "@group(0) @binding(4) var prevPass: texture_2d<f32>;"
    : "";
  const fsBody = opts.applyMask
    ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  return mix(color, effected, maskValue);`
    : "return effected;";

  return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, ${MAX_EFFECT_PARAMS}>;
${maskBinding}
${prevPassBinding}

${effectWgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effected = fs_main(in.uv, color);
  ${fsBody}
}
`;
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm run test -- test/render/shaderCompose.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Brancher le cache dans le Renderer**

Dans `src/render/renderer.ts` :

1. Supprimer la constante locale `FULLSCREEN_VERTEX_WGSL` (lignes 7-23) et importer :

```ts
import { composeShader, MAX_EFFECT_PARAMS } from "./shaderCompose";
```

2. Ajouter le champ privé :

```ts
  private pipelineCache = new Map<
    string,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
```

3. Dans `runEffectPass`, remplacer la construction inline de `shaderCode` (l'actuel bloc `const maskBinding = ...` jusqu'à `const module = device.createShaderModule(...)` inclus, ainsi que la création de `bindGroupLayout`/`pipelineLayout`/`pipeline`) par :

```ts
    const shaderCode = composeShader(effect.wgsl, {
      applyMask,
      hasPrevPass: prevPassView !== null,
    });

    // Le pipeline (et son layout explicite) ne dépend que du code shader —
    // même code, même variante de bindings. Compilé UNE fois par variante,
    // réutilisé à chaque frame : c'était le poste n°1 du coût par frame
    // (createShaderModule + createRenderPipeline par passe par frame).
    let cached = this.pipelineCache.get(shaderCode);
    if (!cached) {
      const module = device.createShaderModule({ code: shaderCode });
      // Layout explicite, jamais `layout: "auto"` — voir le commentaire
      // historique du bug de pruning naga/Dawn (canvas noir silencieux).
      const layoutEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ];
      if (applyMask) {
        layoutEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      }
      if (prevPassView) {
        layoutEntries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      }
      const bindGroupLayout = device.createBindGroupLayout({ entries: layoutEntries });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(shaderCode, cached);
    }
```

Puis utiliser `cached.bindGroupLayout` pour `createBindGroup` et `cached.pipeline` pour `pass.setPipeline`. Remplacer aussi `new Float32Array(8)` par `new Float32Array(MAX_EFFECT_PARAMS)`.

4. Dans `dispose()`, ajouter `this.pipelineCache.clear();` (les pipelines n'ont pas de `destroy()` — le clear libère les références JS).

- [ ] **Step 6: Vérifier build + tests complets**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS, aucun type error.

- [ ] **Step 7: Commit**

```bash
git add src/render/shaderCompose.ts test/render/shaderCompose.test.ts src/render/renderer.ts
git commit -m "perf: cache render pipelines keyed by composed shader code"
```

---

### Task 2: Masques GPU résidents + texture blanche 1×1 partagée

**Files:**
- Create: `src/render/maskResidency.ts`
- Test: `test/render/maskResidency.test.ts`
- Modify: `src/render/renderer.ts`

**Interfaces:**
- Consumes: `LayerState` (`src/layers/types.ts`).
- Produces: `staleMaskIds(cachedIds: Iterable<string>, layers: LayerState[]): string[]`. Le Renderer remplace `uploadMask()` par `getMaskTexture(layer)` (privé) et un cache `maskTextures: Map<string, { texture: GPUTexture; syncedFrom: Uint8Array }>`.

- [ ] **Step 1: Écrire le test rouge**

Créer `test/render/maskResidency.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { staleMaskIds } from "../../src/render/maskResidency";
import type { LayerState } from "../../src/layers/types";

function layer(id: string): LayerState {
  return { id, effectId: "glow", params: {}, enabled: true, maskData: null };
}

describe("staleMaskIds", () => {
  it("returns cached ids whose layer no longer exists", () => {
    expect(staleMaskIds(["a", "b"], [layer("b")])).toEqual(["a"]);
  });

  it("returns nothing when every cached id is still present", () => {
    expect(staleMaskIds(["a"], [layer("a"), layer("b")])).toEqual([]);
  });

  it("handles an empty cache", () => {
    expect(staleMaskIds([], [layer("a")])).toEqual([]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/render/maskResidency.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `src/render/maskResidency.ts`**

```ts
import type { LayerState } from "../layers/types";

/**
 * Ids du cache de textures de masque dont le calque n'existe plus dans la
 * pile courante — leurs textures GPU doivent être détruites (sinon fuite
 * VRAM à chaque suppression de calque, ~24 Mo par masque 24MP).
 */
export function staleMaskIds(cachedIds: Iterable<string>, layers: LayerState[]): string[] {
  const alive = new Set(layers.map((l) => l.id));
  return [...cachedIds].filter((id) => !alive.has(id));
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm run test -- test/render/maskResidency.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Rendre les masques résidents dans le Renderer**

Dans `src/render/renderer.ts` :

1. Importer `staleMaskIds` et ajouter les champs :

```ts
  private maskTextures = new Map<string, { texture: GPUTexture; syncedFrom: Uint8Array }>();
  private whiteMask: GPUTexture | null = null;
```

2. Supprimer `uploadMask()` et le remplacer par :

```ts
  /** Masque absent : texture 1×1 opaque partagée. Le sampler linéaire
   *  échantillonne 1.0 partout — comportement identique à l'ancien buffer
   *  plein-résolution rempli à 255, sans l'allocation de 24 Mo par passe. */
  private getWhiteMask(): GPUTexture {
    if (!this.whiteMask) {
      this.whiteMask = this.ctx.device.createTexture({
        size: [1, 1],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.ctx.device.queue.writeTexture({ texture: this.whiteMask }, new Uint8Array([255]), {}, [1, 1]);
    }
    return this.whiteMask;
  }

  /** Texture de masque RÉSIDENTE par calque : créée une fois à la taille de
   *  l'image, réuploadée uniquement quand la référence `maskData` du calque
   *  change (les masques sont immuables par convention — updateMask remplace
   *  la référence, jamais le contenu). Auparavant : création + upload 24MP à
   *  CHAQUE frame pour chaque calque masqué. */
  private getMaskTexture(layer: LayerState): GPUTexture {
    if (!layer.maskData) return this.getWhiteMask();
    const entry = this.maskTextures.get(layer.id);
    if (entry && entry.syncedFrom === layer.maskData) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    this.ctx.device.queue.writeTexture(
      { texture },
      layer.maskData as BufferSource,
      { bytesPerRow: this.width },
      [this.width, this.height]
    );
    this.maskTextures.set(layer.id, { texture, syncedFrom: layer.maskData });
    return texture;
  }
```

3. Dans `runEffectPass`, remplacer le bloc `applyMask` actuel (`const maskTexture = this.uploadMask(...)` + `pendingDestroy.push(maskTexture)`) par :

```ts
    if (applyMask) {
      // Résidente — ne PAS la mettre dans pendingDestroy.
      entries.push({ binding: 3, resource: this.getMaskTexture(layer).createView() });
    }
```

4. Au début de `runPipeline` (après le check `sourceTexture`), réconcilier le cache :

```ts
    for (const id of staleMaskIds(this.maskTextures.keys(), layers)) {
      this.maskTextures.get(id)!.texture.destroy();
      this.maskTextures.delete(id);
    }
```

5. Dans `dispose()`, ajouter :

```ts
    for (const { texture } of this.maskTextures.values()) texture.destroy();
    this.maskTextures.clear();
    this.whiteMask?.destroy();
    this.whiteMask = null;
```

- [ ] **Step 6: Vérifier build + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS.

- [ ] **Step 7: Checkpoint fonctionnel réel**

Run: `npm run dev:debug` puis `npm run dev:monitor`.
Vérifier via monitoring (pas de conclusion sur la seule présence du process) : ouvrir une image, peindre un masque, undo/redo du masque, supprimer le calque — aucune erreur de validation WebGPU dans la console, rendu masqué visible. En cas d'erreur, citer le log, corriger, relancer.

- [ ] **Step 8: Commit**

```bash
git add src/render/maskResidency.ts test/render/maskResidency.test.ts src/render/renderer.ts
git commit -m "perf: resident per-layer GPU mask textures, shared 1x1 white fallback"
```

---

### Task 3: Coalescing rAF des rendus

**Files:**
- Create: `src/render/frameScheduler.ts`
- Test: `test/render/frameScheduler.test.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: rien.
- Produces: `class FrameScheduler<T>` avec `request(payload: T): void` et `cancel(): void` (rAF/cancel injectables pour les tests Node). Le Renderer gagne `requestRender(layers: LayerState[]): void` ; `dispose()` annule tout rendu en attente.

- [ ] **Step 1: Écrire le test rouge**

Créer `test/render/frameScheduler.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { FrameScheduler } from "../../src/render/frameScheduler";

/** Faux rAF manuel : capture les callbacks, `flush()` simule la frame. */
function fakeRaf() {
  const queue = new Map<number, () => void>();
  let nextId = 1;
  return {
    raf: (cb: () => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    flush: () => {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb());
    },
    pending: () => queue.size,
  };
}

describe("FrameScheduler", () => {
  it("coalesces multiple requests within one frame into a single run with the last payload", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.request(2);
    scheduler.request(3);
    flush();
    expect(runs).toEqual([3]);
  });

  it("schedules at most one rAF at a time", () => {
    const { raf, caf, pending } = fakeRaf();
    const scheduler = new FrameScheduler<number>(() => {}, raf, caf);
    scheduler.request(1);
    scheduler.request(2);
    expect(pending()).toBe(1);
  });

  it("accepts new requests after a flush", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    flush();
    scheduler.request(2);
    flush();
    expect(runs).toEqual([1, 2]);
  });

  it("cancel() drops the pending run", () => {
    const runs: number[] = [];
    const { raf, caf, flush } = fakeRaf();
    const scheduler = new FrameScheduler<number>((n) => runs.push(n), raf, caf);
    scheduler.request(1);
    scheduler.cancel();
    flush();
    expect(runs).toEqual([]);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/render/frameScheduler.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `src/render/frameScheduler.ts`**

```ts
/**
 * Coalesce N demandes par frame en UNE exécution au prochain
 * requestAnimationFrame, avec le dernier payload demandé. Les drags de
 * slider et les samples de pinceau émettent un événement par pointer-move
 * (souvent 2-4x plus fréquents que les frames affichables) — sans
 * coalescing, chaque événement paie un pipeline complet full-res.
 * rAF/cancel injectables : testable en env Node (pas de rAF global).
 */
export class FrameScheduler<T> {
  private rafId: number | null = null;
  private pending: T | null = null;

  constructor(
    private readonly run: (payload: T) => void,
    private readonly raf: (cb: () => void) => number = (cb) => requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id)
  ) {}

  request(payload: T): void {
    this.pending = payload;
    if (this.rafId !== null) return;
    this.rafId = this.raf(() => {
      this.rafId = null;
      const latest = this.pending as T;
      this.pending = null;
      this.run(latest);
    });
  }

  cancel(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
    this.pending = null;
  }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm run test -- test/render/frameScheduler.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Brancher dans Renderer et App**

Dans `src/render/renderer.ts` :

```ts
import { FrameScheduler } from "./frameScheduler";
```

Champ + méthode :

```ts
  private renderScheduler = new FrameScheduler<LayerState[]>((layers) => this.render(layers));

  /** Rendu coalescé : à privilégier pour tout ce qui peut tirer plus vite
   *  que la frame (drag de slider, pinceau). `render()` reste disponible
   *  pour un rendu immédiat déterministe (premier affichage). */
  requestRender(layers: LayerState[]): void {
    this.renderScheduler.request(layers);
  }
```

Dans `dispose()`, en tête : `this.renderScheduler.cancel();`

Dans `src/App.tsx`, remplacer les appels de rendu des chemins chauds et des restaurations d'état — `commit` (ligne 40), `handleMaskStroke` (ligne 172), `handleUndo` (ligne 200), `handleRedo` (ligne 208) :

```ts
rendererRef.current?.requestRender(stack.layers);   // dans commit
rendererRef.current?.requestRender(stack.layers);   // dans handleMaskStroke
rendererRef.current?.requestRender(previous.layers); // dans handleUndo
rendererRef.current?.requestRender(next.layers);     // dans handleRedo
```

Laisser `rendererRef.current.render(stack.layers)` tel quel dans `openFile` (premier affichage déterministe, hors chemin chaud).

- [ ] **Step 6: Vérifier build + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/frameScheduler.ts test/render/frameScheduler.test.ts src/render/renderer.ts src/App.tsx
git commit -m "perf: coalesce hot-path renders through a rAF FrameScheduler"
```

---

### Task 4: Libération du buffer de readback + limites GPU explicites

**Files:**
- Create: `src/render/limits.ts`
- Test: `test/render/limits.test.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/render/gpuContext.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `assertImageFitsGpu(width: number, height: number, maxDimension: number): void` (throw avec message français explicite). `initGpu` demande `requiredLimits.maxTextureDimension2D` au niveau de l'adapter.

- [ ] **Step 1: Écrire le test rouge**

Créer `test/render/limits.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { assertImageFitsGpu } from "../../src/render/limits";

describe("assertImageFitsGpu", () => {
  it("accepts dimensions within the limit", () => {
    expect(() => assertImageFitsGpu(6240, 4160, 16384)).not.toThrow();
  });

  it("rejects a width over the limit with an explicit message", () => {
    expect(() => assertImageFitsGpu(20000, 4000, 16384)).toThrow(/20000.*16384/);
  });

  it("rejects a height over the limit", () => {
    expect(() => assertImageFitsGpu(4000, 20000, 16384)).toThrow();
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/render/limits.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `src/render/limits.ts`**

```ts
/**
 * Fail-fast AVANT createTexture : dépasser maxTextureDimension2D ferait
 * échouer la création avec une erreur de validation WebGPU générique
 * (souvent invisible côté JS). Un panorama > limite doit produire un
 * message clair, pas un canvas noir.
 */
export function assertImageFitsGpu(width: number, height: number, maxDimension: number): void {
  if (width > maxDimension || height > maxDimension) {
    throw new Error(
      `Image ${width}×${height} px trop grande pour ce GPU (limite ${maxDimension}×${maxDimension} px).`
    );
  }
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `npm run test -- test/render/limits.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Brancher garde + limites + destroy**

Dans `src/render/gpuContext.ts`, remplacer `const device = await adapter.requestDevice();` par :

```ts
  // Sans requiredLimits, le device retombe aux limites par défaut de la spec
  // (maxTextureDimension2D = 8192) même si le matériel fait mieux — un JPEG
  // panoramique > 8192 px échouerait à createTexture. On demande le maximum
  // que l'adapter supporte réellement.
  const device = await adapter.requestDevice({
    requiredLimits: { maxTextureDimension2D: adapter.limits.maxTextureDimension2D },
  });
```

Dans `src/render/renderer.ts` :

1. Importer et garder en tête de `loadImage` :

```ts
import { assertImageFitsGpu } from "./limits";
```

```ts
  async loadImage(bitmap: ImageBitmap): Promise<void> {
    assertImageFitsGpu(bitmap.width, bitmap.height, this.ctx.device.limits.maxTextureDimension2D);
    // ... reste inchangé
```

2. Dans `readTextureBytes`, libérer le buffer de readback (~96 Mo à 24MP — actuellement laissé au GC, non déterministe, même classe que la fuite GPU déjà corrigée une fois) :

```ts
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    buffer.destroy();
    return data;
```

- [ ] **Step 6: Vérifier build + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/render/limits.ts test/render/limits.test.ts src/render/renderer.ts src/render/gpuContext.ts
git commit -m "fix: destroy readback buffer, request real GPU limits, guard oversized images"
```

---

### Task 5: Validation fail-fast des effets au chargement du registry

**Files:**
- Create: `src/render/effects/validate.ts`
- Test: `test/render/effects/validate.test.ts`
- Modify: `src/render/effects/registry.ts`

**Interfaces:**
- Consumes: `MAX_EFFECT_PARAMS` (Task 1), `EffectModule` (`effects/types.ts`).
- Produces: `validateEffect(effect: EffectModule): void` (throw si `params.length > MAX_EFFECT_PARAMS`). Le registry valide chaque effet à l'init du module.

- [ ] **Step 1: Écrire le test rouge**

Créer `test/render/effects/validate.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { validateEffect } from "../../../src/render/effects/validate";
import { effectRegistry } from "../../../src/render/effects/registry";
import type { EffectModule } from "../../../src/render/effects/types";

function effectWithParams(count: number): EffectModule {
  return {
    id: "test-effect",
    name: "Test",
    params: Array.from({ length: count }, (_, i) => ({
      name: `p${i}`,
      min: 0,
      max: 1,
      default: 0,
      step: 0.1,
    })),
    wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
  };
}

describe("validateEffect", () => {
  it("accepts an effect at exactly the param limit", () => {
    expect(() => validateEffect(effectWithParams(8))).not.toThrow();
  });

  it("rejects an effect over the limit with the effect id in the message", () => {
    expect(() => validateEffect(effectWithParams(9))).toThrow(/test-effect.*9.*8/);
  });

  it("every registered effect is valid", () => {
    for (const effect of effectRegistry) {
      expect(() => validateEffect(effect)).not.toThrow();
    }
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/render/effects/validate.test.ts`
Expected: FAIL (module introuvable).

- [ ] **Step 3: Implémenter `src/render/effects/validate.ts`**

```ts
import type { EffectModule } from "./types";
import { MAX_EFFECT_PARAMS } from "../shaderCompose";

/**
 * Fail-fast au chargement du registry. Sans cette validation, un effet
 * déclarant plus de MAX_EFFECT_PARAMS paramètres était TRONQUÉ en silence :
 * l'écriture hors-borne d'un Float32Array est un no-op, le shader lisait 0
 * pour les paramètres excédentaires — contraire au principe fail-fast du
 * projet.
 */
export function validateEffect(effect: EffectModule): void {
  if (effect.params.length > MAX_EFFECT_PARAMS) {
    throw new Error(
      `Effet "${effect.id}" : ${effect.params.length} paramètres déclarés, ` +
        `maximum ${MAX_EFFECT_PARAMS} (taille du uniform array<f32, ${MAX_EFFECT_PARAMS}> du shader). ` +
        `Élargir MAX_EFFECT_PARAMS et le header WGSL ensemble si nécessaire.`
    );
  }
}
```

- [ ] **Step 4: Brancher dans le registry**

Dans `src/render/effects/registry.ts` :

```ts
import type { EffectModule } from "./types";
import { validateEffect } from "./validate";
import { glow } from "./glow";
import { chromaticBleed } from "./chromaticBleed";
import { warp } from "./warp";
import { grain } from "./grain";

export const effectRegistry: EffectModule[] = [glow, chromaticBleed, warp, grain];
effectRegistry.forEach(validateEffect);

export function getEffect(id: string): EffectModule {
  const effect = effectRegistry.find((e) => e.id === id);
  if (!effect) throw new Error(`Effet inconnu: ${id}`);
  return effect;
}
```

- [ ] **Step 5: Vérifier tests + build**

Run: `npm run test -- test/render/effects && npx tsc --noEmit`
Expected: PASS (y compris les tests registry existants).

- [ ] **Step 6: Commit**

```bash
git add src/render/effects/validate.ts test/render/effects/validate.test.ts src/render/effects/registry.ts
git commit -m "fix: fail fast on effects declaring more params than the shader uniform holds"
```

---

### Task 6: Écriture atomique + garde d'extension (Rust)

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: rien.
- Produces: `is_jpeg_path(path: &str) -> bool` et `write_atomic(path: &str, bytes: &[u8]) -> Result<(), String>` (privées, testées) ; `write_image_file` conserve sa signature IPC actuelle (`path: String, bytes: Vec<u8>`) — le passage au binaire est la Task 8.

- [ ] **Step 1: Écrire les tests rouges**

Dans `src-tauri/src/lib.rs`, ajouter en fin de fichier :

```rust
#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn jpeg_paths_are_accepted_case_insensitively() {
    assert!(is_jpeg_path("C:\\photos\\IMG_0001.JPG"));
    assert!(is_jpeg_path("C:\\photos\\été.jpeg"));
  }

  #[test]
  fn non_jpeg_paths_are_rejected() {
    assert!(!is_jpeg_path("C:\\photos\\image.png"));
    assert!(!is_jpeg_path("C:\\photos\\piege.jpg.exe"));
    assert!(!is_jpeg_path("C:\\Users\\x\\master.db"));
    assert!(!is_jpeg_path("sans-extension"));
  }

  #[test]
  fn write_atomic_creates_then_overwrites() {
    let path = std::env::temp_dir().join("shaderlab-test-atomic.jpg");
    let path_str = path.to_str().unwrap();
    let _ = std::fs::remove_file(&path);

    write_atomic(path_str, b"first").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"first");

    // Cas round-trip Lightroom : la cible EXISTE et doit être remplacée
    // sans jamais être visible dans un état tronqué.
    write_atomic(path_str, b"second").unwrap();
    assert_eq!(std::fs::read(&path).unwrap(), b"second");

    let _ = std::fs::remove_file(&path);
  }
}
```

- [ ] **Step 2: Vérifier l'échec**

Run (depuis `src-tauri/`, `dist/` doit exister — sinon `npm run build` d'abord) : `cargo test`
Expected: FAIL à la compilation (`is_jpeg_path`/`write_atomic` inexistantes).

- [ ] **Step 3: Implémenter**

Dans `src-tauri/src/lib.rs`, ajouter au-dessus des commandes :

```rust
fn is_jpeg_path(path: &str) -> bool {
  let lower = path.to_ascii_lowercase();
  lower.ends_with(".jpg") || lower.ends_with(".jpeg")
}

/// Écriture atomique : tout dans un fichier temporaire À CÔTÉ de la cible
/// (même volume garanti), puis rename — sous Windows, std::fs::rename
/// remplace une cible existante (MoveFileExW + MOVEFILE_REPLACE_EXISTING).
/// Sans ça, un crash mi-écriture sur le chemin round-trip Lightroom laissait
/// un JPEG tronqué à la place de la seule copie du travail.
fn write_atomic(path: &str, bytes: &[u8]) -> Result<(), String> {
  let tmp = format!("{path}.tmp-write");
  fs::write(&tmp, bytes).map_err(|e| format!("Écriture échouée sur {tmp}: {e}"))?;
  fs::rename(&tmp, path).map_err(|e| {
    let _ = fs::remove_file(&tmp);
    format!("Renommage échoué de {tmp} vers {path}: {e}")
  })
}
```

Et remplacer `write_image_file` :

```rust
#[tauri::command]
fn write_image_file(path: String, bytes: Vec<u8>) -> Result<(), String> {
  if !is_jpeg_path(&path) {
    return Err(format!(
      "Refus d'écrire {path} : seuls les fichiers .jpg/.jpeg sont autorisés."
    ));
  }
  write_atomic(&path, &bytes)
}
```

- [ ] **Step 4: Vérifier que les tests passent**

Run: `cargo test`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "fix: atomic tmp+rename image writes, restrict writes to .jpg/.jpeg"
```

---

### Task 7: Launch path robuste, CSP, identifier

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/tauri.conf.json`

**Interfaces:**
- Consumes: rien.
- Produces: `get_launch_path` insensible aux arguments non-UTF16 ; `tauri.conf.json` avec CSP active et identifier définitif. Aucun changement d'API côté TS.

- [ ] **Step 1: Rendre `get_launch_path` incassable**

Dans `src-tauri/src/lib.rs` :

```rust
#[tauri::command]
fn get_launch_path() -> Option<String> {
  // args[0] est l'exécutable ; le chemin de lancement (External Editing de
  // Lightroom, ou "Ouvrir avec" Windows) est args[1] s'il existe.
  // args_os + to_string_lossy : std::env::args() PANIQUE sur un argument
  // Windows non-UTF16 valide — args_os ne panique jamais.
  std::env::args_os()
    .nth(1)
    .map(|arg| arg.to_string_lossy().into_owned())
}
```

- [ ] **Step 2: CSP + identifier**

Dans `src-tauri/tauri.conf.json` :

- Ligne 4 : `"identifier": "com.c0remusic.shaderlab",` (l'identifier par défaut `com.tauri.*` émet un warning au bundle et collisionne entre projets).
- Bloc security :

```json
    "security": {
      "csp": "default-src 'self'; connect-src ipc: http://ipc.localhost; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'"
    }
```

(`connect-src ipc: http://ipc.localhost` est requis par l'IPC Tauri v2 ; `style-src 'unsafe-inline'` couvre les attributs `style` inline React ; Tauri injecte automatiquement ses nonces/hashes de script au build — doc officielle v2.tauri.app/security/csp.)

- [ ] **Step 3: Vérification réelle**

Run: `cargo test` (depuis `src-tauri/`) puis `npm run dev:debug` et `npm run dev:monitor`.
Expected: tests PASS ; au lancement, AUCUNE erreur `Content-Security-Policy` dans la console WebView2, ouverture d'image + rendu + export fonctionnels (une CSP trop stricte casse silencieusement — c'est précisément ce que le monitoring doit attraper). En cas de violation CSP dans les logs, citer la directive fautive, l'ajuster, relancer.

- [ ] **Step 4: Commit**

```bash
git add src-tauri/src/lib.rs src-tauri/tauri.conf.json
git commit -m "fix: non-panicking launch path, enable CSP, set real bundle identifier"
```

---

### Task 8: IPC binaire pour les images

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/launch.ts`

**Interfaces:**
- Consumes: `is_jpeg_path`/`write_atomic` (Task 6).
- Produces: `readImageFile(path): Promise<Uint8Array>` et `writeImageFile(path, bytes): Promise<void>` — signatures TS INCHANGÉES (les appelants App.tsx/exportImage.ts ne bougent pas), transport en bytes bruts au lieu de JSON `number[]` (~4-6x d'inflation et copies CPU bloquantes sur des JPEG de 10-20 Mo, dans les deux sens).

- [ ] **Step 1: Test rouge du décodage de chemin**

Dans le mod `tests` de `src-tauri/src/lib.rs`, ajouter :

```rust
  #[test]
  fn decode_target_path_handles_percent_encoded_windows_paths() {
    // encodeURIComponent("C:\\photos\\été.jpg") côté TS
    let decoded = decode_target_path("C%3A%5Cphotos%5C%C3%A9t%C3%A9.jpg").unwrap();
    assert_eq!(decoded, "C:\\photos\\été.jpg");
  }

  #[test]
  fn decode_target_path_rejects_invalid_utf8() {
    assert!(decode_target_path("%FF%FE").is_err());
  }
```

- [ ] **Step 2: Vérifier l'échec**

Run: `cargo test`
Expected: FAIL à la compilation (`decode_target_path` inexistante).

- [ ] **Step 3: Implémenter côté Rust**

Dans `src-tauri/Cargo.toml`, ajouter aux `[dependencies]` :

```toml
percent-encoding = "2"
```

Dans `src-tauri/src/lib.rs` :

```rust
use percent_encoding::percent_decode_str;
use tauri::ipc::{InvokeBody, Request, Response};
```

```rust
/// Les headers IPC sont ASCII-only : le chemin cible (chemins Windows
/// accentués inclus) transite percent-encodé (encodeURIComponent côté TS).
fn decode_target_path(encoded: &str) -> Result<String, String> {
  percent_decode_str(encoded)
    .decode_utf8()
    .map(|s| s.into_owned())
    .map_err(|_| "Chemin cible invalide (UTF-8 attendu après décodage).".to_string())
}
```

Remplacer les deux commandes :

```rust
#[tauri::command]
fn read_image_file(path: String) -> Result<Response, String> {
  // Response::new(bytes) = corps binaire brut côté WebView (ArrayBuffer),
  // au lieu d'un Vec<u8> sérialisé en tableau JSON de millions de nombres.
  fs::read(&path)
    .map(Response::new)
    .map_err(|e| format!("Lecture échouée sur {path}: {e}"))
}

#[tauri::command]
fn write_image_file(request: Request) -> Result<(), String> {
  let InvokeBody::Raw(bytes) = request.body() else {
    return Err("write_image_file attend un corps binaire brut.".into());
  };
  let Some(header) = request.headers().get("x-target-path") else {
    return Err("Header x-target-path manquant.".into());
  };
  let encoded = header
    .to_str()
    .map_err(|_| "Header x-target-path illisible.".to_string())?;
  let path = decode_target_path(encoded)?;
  if !is_jpeg_path(&path) {
    return Err(format!(
      "Refus d'écrire {path} : seuls les fichiers .jpg/.jpeg sont autorisés."
    ));
  }
  write_atomic(&path, bytes)
}
```

- [ ] **Step 4: Vérifier les tests Rust**

Run: `cargo test`
Expected: PASS (tests Tasks 6 + 8).

- [ ] **Step 5: Adapter `src/launch.ts`**

```ts
export async function writeImageFile(path: string, bytes: Uint8Array): Promise<void> {
  // Corps binaire brut (InvokeBody::Raw côté Rust) ; le chemin passe en
  // header percent-encodé — les headers IPC sont ASCII-only et les chemins
  // Windows peuvent contenir des accents.
  await invoke("write_image_file", bytes, {
    headers: { "x-target-path": encodeURIComponent(path) },
  });
}

export async function readImageFile(path: string): Promise<Uint8Array> {
  // tauri::ipc::Response::new(bytes) arrive ici en ArrayBuffer, pas en
  // number[] JSON.
  const data = await invoke<ArrayBuffer>("read_image_file", { path });
  return new Uint8Array(data);
}
```

- [ ] **Step 6: Vérification réelle de bout en bout**

Run: `npx tsc --noEmit && npm run test`, puis `npm run dev:debug` + `npm run dev:monitor`.
Expected: build vert ; dans l'app réelle, ouvrir une image via le bouton Ouvrir ET via lancement avec chemin en argument, exporter, vérifier que le fichier exporté s'ouvre (visionneuse Windows) et qu'aucune erreur IPC n'apparaît dans la console. C'est le seul test possible du transport binaire — il n'y a pas de harnais IPC en Node.

- [ ] **Step 7: Commit**

```bash
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/lib.rs src/launch.ts
git commit -m "perf: raw binary IPC for image reads and writes"
```

---

### Task 9: `clone()` partage les masques (immuables par convention)

**Files:**
- Modify: `src/layers/layerStack.ts`
- Modify: `src/layers/types.ts`
- Modify: `src/App.tsx` (commentaire de `handleMaskStrokeEnd` uniquement)
- Test: `test/layers/layerStack.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `LayerStack.clone()` en O(métadonnées) — les références `maskData` sont partagées entre clones. Contrat : `maskData` est IMMUABLE (remplacé par `updateMask`, jamais muté en place). C'est le prérequis du refcount de la Task 10 et ça supprime le memcpy de tous les masques à chaque `currentStack()` (appelé par sample de pinceau).

- [ ] **Step 1: Écrire le test rouge**

Dans `test/layers/layerStack.test.ts`, ajouter :

```ts
  it("clone() shares maskData references (masks are immutable snapshots)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateMask(id, new Uint8Array([1, 2, 3]));
    const copy = stack.clone();
    // Partage volontaire : updateMask remplace toujours la référence par une
    // copie fraîche, donc partager le buffer entre clones est sûr et rend
    // clone() indépendant de la taille des masques.
    expect(copy.layers[0].maskData).toBe(stack.layers[0].maskData);
  });

  it("updateMask on a clone does not affect the original (replace, never mutate)", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.updateMask(id, new Uint8Array([1, 2, 3]));
    const copy = stack.clone();
    copy.updateMask(id, new Uint8Array([9, 9, 9]));
    expect(stack.layers[0].maskData![0]).toBe(1);
  });
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/layers/layerStack.test.ts`
Expected: FAIL sur le premier nouveau test (`toBe` : les références diffèrent actuellement).

- [ ] **Step 3: Implémenter le partage**

Dans `src/layers/layerStack.ts`, remplacer `clone()` :

```ts
  clone(): LayerStack {
    const copy = new LayerStack();
    copy.layers = this.layers.map((l) => ({
      ...l,
      params: { ...l.params },
      // maskData est immuable par convention (updateMask remplace toujours
      // la référence par une copie fraîche, jamais de mutation in place) —
      // le partager rend clone() O(métadonnées) au lieu de O(pixels). Le
      // coût du pinceau (currentStack() par sample) et le comptage mémoire
      // de l'historique (refcount de buffers partagés) en dépendent.
      maskData: l.maskData,
    }));
    return copy;
  }
```

Dans `src/layers/types.ts`, documenter le contrat sur le champ `maskData` de `LayerState` :

```ts
  /** Masque du calque (r8, 1 octet/pixel, taille de l'image), ou null.
   *  IMMUABLE par convention : toujours REMPLACÉ (updateMask stocke une
   *  copie fraîche), jamais muté en place — clone() et l'historique
   *  partagent ces références. */
  maskData: Uint8Array | null;
```

(Adapter à la forme exacte de la déclaration existante — seul le commentaire et rien d'autre ne doit changer si le champ est déjà déclaré ainsi.)

- [ ] **Step 4: Mettre à jour le commentaire périmé d'App.tsx**

Dans `src/App.tsx`, `handleMaskStrokeEnd` : le commentaire actuel affirme que `commit` → `clone` produit « a brand-new maskData reference for every layer » — c'est faux après ce changement. Le remplacer par :

```ts
    // Depuis le partage structurel des masques dans clone(), le commit ne
    // change plus les références maskData — cette resynchronisation est un
    // no-op sûr, conservée pour rester correcte si un futur clone()
    // redevenait copiant. Un vrai undo/redo restaure une référence PLUS
    // ANCIENNE, donc différente de syncedFrom, et déclenche bien le re-seed
    // du painter dans handleMaskStroke.
```

La logique (les 4 lignes de code) ne change pas.

- [ ] **Step 5: Vérifier la suite complète**

Run: `npm run test && npx tsc --noEmit`
Expected: PASS — en particulier les tests existants de History (le clonage défensif des MÉTADONNÉES reste entier) et le test `updateMask replaces a layer's maskData with a copy` (updateMask copie toujours).

- [ ] **Step 6: Commit**

```bash
git add src/layers/layerStack.ts src/layers/types.ts src/App.tsx test/layers/layerStack.test.ts
git commit -m "perf: share immutable mask buffers across stack clones"
```

---

### Task 10: Historique borné à 512 Mo (refcount des masques partagés)

**Files:**
- Modify: `src/layers/history.ts` (réécriture)
- Test: `test/layers/history.test.ts`

**Interfaces:**
- Consumes: `LayerStack.clone()` partageur (Task 9).
- Produces: `new History(initial: LayerStack, budgetBytes = 512 * 1024 * 1024)` ; API existante inchangée (`push/undo/redo/canUndo/canRedo`) + `bytesUsed(): number`. Sémantique spec : éviction des entrées les plus anciennes quand le budget est dépassé, état courant jamais évincé.

- [ ] **Step 1: Écrire les tests rouges**

Dans `test/layers/history.test.ts`, ajouter (les 7 tests existants restent inchangés et doivent continuer de passer) :

```ts
describe("History byte budget", () => {
  function stackWithMask(bytes: number): LayerStack {
    const s = new LayerStack();
    const id = s.addLayer("glow");
    s.updateMask(id, new Uint8Array(bytes));
    return s;
  }

  it("counts unique mask buffers once even when shared across entries", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithMask(100);
    history.push(a);
    // clone() partage le buffer (Task 9) : pousser un clone modifié sur un
    // AUTRE champ ne doit pas recompter les 100 octets du masque.
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b);
    expect(history.bytesUsed()).toBe(100);
  });

  it("evicts oldest past entries first when over budget", () => {
    const history = new History(new LayerStack(), 250);
    history.push(stackWithMask(100)); // A
    history.push(stackWithMask(100)); // B
    history.push(stackWithMask(100)); // C -> 300 octets retenus > 250
    // Éviction en partant du plus ancien : l'état initial (0 octet) puis A
    // (100). Restent B (past) + C (courant) = 200 octets <= 250.
    expect(history.bytesUsed()).toBeLessThanOrEqual(250);
    // Un seul pas d'undo possible : B. L'initial et A sont partis.
    expect(history.undo()?.layers[0].maskData?.byteLength).toBe(100); // -> B
    expect(history.undo()).toBeNull();
  });

  it("never evicts the current state even if it alone exceeds the budget", () => {
    const history = new History(new LayerStack(), 10);
    history.push(stackWithMask(100));
    expect(history.bytesUsed()).toBe(100);
    expect(history.canUndo()).toBe(false); // le past a été vidé, pas le courant
  });

  it("releases bytes when the redo branch is discarded by a new push", () => {
    const history = new History(new LayerStack(), 10_000);
    history.push(stackWithMask(100));
    history.undo(); // la branche redo retient les 100 octets
    expect(history.bytesUsed()).toBe(100);
    history.push(stackWithMask(30)); // redo jetée
    expect(history.bytesUsed()).toBe(30);
  });

  it("undo/redo keep working normally under the default budget", () => {
    const history = new History(new LayerStack());
    history.push(stackWithMask(100));
    history.undo();
    const redone = history.redo();
    expect(redone?.layers[0].maskData?.byteLength).toBe(100);
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

Run: `npm run test -- test/layers/history.test.ts`
Expected: FAIL (constructeur à 2 arguments et `bytesUsed` inexistants).

- [ ] **Step 3: Réécrire `src/layers/history.ts`**

Contenu complet :

```ts
import { LayerStack } from "./layerStack";

const DEFAULT_BUDGET_BYTES = 512 * 1024 * 1024;

/**
 * Historique undo/redo borné en OCTETS RÉELLEMENT RETENUS (spec standalone
 * v1 : plafond 512 Mo par document, éviction des entrées les plus anciennes,
 * état courant toujours conservé).
 *
 * Le coût mémoire est dominé par les buffers de masque (≈ 1 octet/pixel,
 * ~26 Mo à 26MP). Depuis que clone() PARTAGE les références maskData
 * (immuables par convention), plusieurs entrées d'historique pointent vers
 * les mêmes buffers : compter octets-par-entrée surestimerait massivement.
 * On refcount donc chaque buffer unique — un buffer n'est compté qu'une
 * fois tant qu'au moins une entrée (past, current ou future) le retient,
 * et n'est décompté que quand plus aucune ne le retient.
 */
export class History {
  private past: LayerStack[] = [];
  private future: LayerStack[] = [];
  private current: LayerStack;
  private readonly budgetBytes: number;
  private refCounts = new Map<Uint8Array, number>();
  private totalBytes = 0;

  constructor(initial: LayerStack, budgetBytes: number = DEFAULT_BUDGET_BYTES) {
    this.current = initial;
    this.budgetBytes = budgetBytes;
    this.retain(initial);
  }

  private retain(stack: LayerStack): void {
    for (const layer of stack.layers) {
      if (!layer.maskData) continue;
      const count = this.refCounts.get(layer.maskData) ?? 0;
      if (count === 0) this.totalBytes += layer.maskData.byteLength;
      this.refCounts.set(layer.maskData, count + 1);
    }
  }

  private release(stack: LayerStack): void {
    for (const layer of stack.layers) {
      if (!layer.maskData) continue;
      const count = this.refCounts.get(layer.maskData);
      if (count === undefined) continue;
      if (count <= 1) {
        this.refCounts.delete(layer.maskData);
        this.totalBytes -= layer.maskData.byteLength;
      } else {
        this.refCounts.set(layer.maskData, count - 1);
      }
    }
  }

  push(state: LayerStack): void {
    this.past.push(this.current);
    // Clone défensif (partage les masques, copie les métadonnées) : une
    // mutation ultérieure de `state` par l'appelant ne corrompt pas
    // l'entrée stockée — même garantie qu'avant.
    const next = state.clone();
    this.current = next;
    this.retain(next);
    for (const dropped of this.future) this.release(dropped);
    this.future = [];
    // Éviction spec : les plus anciennes d'abord, jamais l'état courant.
    while (this.totalBytes > this.budgetBytes && this.past.length > 0) {
      this.release(this.past.shift()!);
    }
  }

  undo(): LayerStack | null {
    const previous = this.past.pop();
    if (!previous) return null;
    // Déplacements internes past<->current<->future : l'ensemble retenu ne
    // change pas, aucun retain/release nécessaire.
    this.future.push(this.current);
    this.current = previous;
    return this.current.clone();
  }

  redo(): LayerStack | null {
    const next = this.future.pop();
    if (!next) return null;
    this.past.push(this.current);
    this.current = next;
    return this.current.clone();
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }

  canRedo(): boolean {
    return this.future.length > 0;
  }

  /** Octets de masque uniques actuellement retenus (pour tests et futur
   *  indicateur UI). */
  bytesUsed(): number {
    return this.totalBytes;
  }
}
```

- [ ] **Step 4: Vérifier la suite complète**

Run: `npm run test -- test/layers/history.test.ts && npx tsc --noEmit`
Expected: PASS — les 7 tests historiques ET les 5 nouveaux. (Les clones retournés par undo/redo partagent les buffers avec l'historique : c'est voulu, ils sont immuables ; le test défensif existant porte sur les métadonnées et reste vert.)

- [ ] **Step 5: Commit**

```bash
git add src/layers/history.ts test/layers/history.test.ts
git commit -m "feat: byte-budgeted history (512 MB cap, oldest-first eviction, refcounted masks)"
```

---

### Task 11: Une entrée d'historique par interaction de slider

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/ParamPanel.tsx` (ou la primitive Slider du design system — voir note d'adaptation)

**Interfaces:**
- Consumes: `requestRender` (Task 3), `commit`/`currentStack` existants d'App.tsx.
- Produces: `handleParamChange(id, params)` = mise à jour vivante SANS commit ; nouveau `handleParamCommit(): void` = une entrée d'historique en fin d'interaction. Nouvelle prop `onParamCommit: () => void` sur le panneau de paramètres.

> **Note d'adaptation** : ce plan est écrit contre le ParamPanel pré-design-system (`<input type="range">`). Si, à l'exécution, le panneau utilise la primitive Slider du design system, brancher `onParamCommit` sur son événement de fin d'interaction (pointer-up et relâchement clavier) — le contrat côté App.tsx ci-dessous ne change pas.

- [ ] **Step 1: Découpler live-update et commit dans App.tsx**

Remplacer `handleParamChange` et ajouter `handleParamCommit` :

```ts
  // Vrai pendant un drag de slider dont la valeur a bougé : le commit de fin
  // d'interaction ne pousse une entrée d'historique que si quelque chose a
  // réellement changé (un simple clic sans mouvement ne crée pas d'entrée).
  const paramDirtyRef = useRef(false);

  function handleParamChange(id: string, params: Record<string, number>) {
    // Mise à jour vivante pendant le drag : état + rendu coalescé, PAS
    // d'entrée d'historique — la spec v1 exige UNE entrée par interaction,
    // pas une par frame de drag.
    paramDirtyRef.current = true;
    const stack = currentStack();
    stack.updateParams(id, params);
    setLayers(stack.layers);
    rendererRef.current?.requestRender(stack.layers);
  }

  function handleParamCommit() {
    if (!paramDirtyRef.current) return;
    paramDirtyRef.current = false;
    commit(currentStack());
  }
```

- [ ] **Step 2: Câbler la fin d'interaction dans le panneau de paramètres**

Dans `src/components/ParamPanel.tsx` (forme pré-design-system) :

1. Ajouter la prop :

```ts
  onParamCommit: () => void;
```

(et la déstructurer dans la signature du composant, et l'ajouter à l'appel dans App.tsx : `onParamCommit={handleParamCommit}`.)

2. Sur chaque `<input type="range">` des paramètres d'effet (PAS ceux du pinceau Taille/Dureté — ils ne touchent pas la pile de calques) :

```tsx
            onChange={(e) => onParamChange(layer.id, { [p.name]: parseFloat(e.target.value) })}
            onPointerUp={onParamCommit}
            onKeyUp={(e) => {
              if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(e.key)) {
                onParamCommit();
              }
            }}
```

(Au clavier, chaque relâchement de touche est une interaction discrète : une entrée par pression est le comportement voulu.)

- [ ] **Step 3: Vérifier build + tests**

Run: `npx tsc --noEmit && npm run test`
Expected: PASS (logique UI non testée unitairement — convention repo : pas de rendu React en test).

- [ ] **Step 4: Checkpoint humain**

Lancer `npm run dev:debug`, ouvrir une image, ajouter un Glow, dragger `intensity` de bout en bout, relâcher, puis UN SEUL Ctrl+Z : la valeur doit revenir à celle d'AVANT le drag (pas un cran intermédiaire). Vérifier aussi : clic sur le slider sans mouvement → pas d'entrée d'historique (canUndo inchangé) ; flèches clavier → une entrée par pression.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx src/components/ParamPanel.tsx
git commit -m "feat: one history entry per slider interaction (live render, commit on release)"
```

---

## Self-Review (exécutée à l'écriture du plan)

1. **Couverture des findings de l'audit** : finding 1 (chemin chaud) → Tasks 1-3 ; finding 2 (historique) → Tasks 9-11 ; finding 3 (App.tsx god object) → DIFFÉRÉ documenté dans design.md (trigger : chantier workspace multi-photo) ; finding 4 (mono-image/limites) → Task 4 (limites) + différé pellicule ; finding 5 (atomicité/CSP/gardes) → Tasks 6-7 ; finding 6 (IPC JSON) → Task 8 ; mineurs (troncature 8 params, buffer readback, identifier, launch path) → Tasks 4, 5, 7.
2. **Placeholders** : aucun — chaque étape de code montre le code, chaque commande son résultat attendu.
3. **Cohérence des types** : `composeShader`/`MAX_EFFECT_PARAMS` (Task 1) consommés par Tasks 5 ; `is_jpeg_path`/`write_atomic` (Task 6) consommés par Task 8 ; `clone()` partageur (Task 9) prérequis du refcount (Task 10) ; `requestRender` (Task 3) consommé par Task 11 — signatures identiques partout.
