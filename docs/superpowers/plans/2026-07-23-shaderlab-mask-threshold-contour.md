# Contour de seuil animé sur l'overlay de masque — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ajouter un contour animé (pointillés) au seuil 50 % de l'overlay de masque existant, visible dès qu'un calque sélectionné a un masque actif — pas seulement en mode peinture — sans changer le modèle de masquage continu.

**Architecture:** Le pass d'overlay existant (`fs_overlay`) gagne un uniform `time` et un test de dérivée d'écran (`fwidth`) pour tracer le contour. Une boucle rAF légère et indépendante (`OverlayAnimationLoop`) ré-exécute UNIQUEMENT ce pass sur la dernière texture composée (exposée par `FramePipelineExecutor.run()`), sans jamais retoucher le fold du masque ni les effets — la texture de masque déjà résolue est capturée une seule fois par rendu complet, jamais recalculée par la boucle d'animation.

**Tech Stack:** TypeScript, WebGPU/WGSL, React 19, Vitest.

## Global Constraints

- Aucune régression du modèle de masquage : reste continu, jamais binaire (contrainte PRD, `docs/superpowers/specs/2026-07-18-shaderlab-layers-masking-prd.md:79-81`).
- La boucle d'animation ne rappelle **jamais** `MaskTexturesPort.resolve()` — coûteux (edge-aware/refine-edge non mis en cache, voir spec).
- `npx tsc --noEmit` et `npm run test` verts après chaque tâche.
- Rendu GPU réel non testable en unitaire (pas de WebGPU en Node) — preuve finale = checkpoint visuel humain CDP (Task 6), pas de Playwright (canvas WebGPU rend noir en headless, voir `CLAUDE.md` § Moyen de preuve UI).
- Commits avec pathspec explicite (`git commit -m "..." -- <fichiers>`), jamais nu.

---

### Task 1: `FramePipelineExecutor` expose la texture composée et la texture de masque de l'overlay

**Files:**
- Modify: `src/render/framePipelineExecutor.ts`
- Test: `test/render/framePipelineExecutor.test.ts`

**Interfaces:**
- Consumes: rien de nouveau (types/API GPU déjà en place).
- Produces: `FramePipelineResult` gagne `composedTexture: GPUTexture | null` et `overlayMaskTexture: GPUTexture | null` — consommés par Task 4 (`Renderer`).

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer le contenu de `test/render/framePipelineExecutor.test.ts` par :

```ts
import { describe, expect, it, vi } from "vitest";
import {
  FramePipelineExecutor,
  type EffectPassesPort,
  type MaskTexturesPort,
} from "../../src/render/framePipelineExecutor";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function texture() {
  return { createView: vi.fn(() => ({})), destroy: vi.fn() };
}

function layer(overrides: Partial<LayerState> = {}): LayerState {
  return {
    id: "L1",
    effectId: "grain",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

function createExecutor() {
  const source = texture();
  const firstTarget = texture();
  const secondTarget = texture();
  const finish = vi.fn(() => ({}));
  const submit = vi.fn();
  const device = {
    createCommandEncoder: vi.fn(() => ({ finish })),
    queue: { submit },
  } as unknown as GPUDevice;
  const transient = texture();
  const effects: EffectPassesPort = {
    runEffectPass: vi.fn((_encoder, _effect, _layer, _source, _target, _options, pending) => {
      pending.push(transient as unknown as GPUTexture);
    }),
    runInternalPasses: vi.fn(),
    runOverlayPass: vi.fn(),
  };
  const masks: MaskTexturesPort = {
    sweep: vi.fn(),
    resolve: vi.fn(() => texture() as unknown as GPUTexture),
  };
  return {
    executor: new FramePipelineExecutor(
      device,
      { sourceTexture: source as unknown as GPUTexture, pingPong: [firstTarget, secondTarget] as unknown as [GPUTexture, GPUTexture] },
      effects,
      masks,
    ),
    effects,
    masks,
    submit,
    transient,
    firstTarget,
    secondTarget,
  };
}

describe("FramePipelineExecutor", () => {
  it("sweeps masks, submits the empty-stack blit, then destroys frame resources", () => {
    const { executor, effects, masks, submit, transient } = createExecutor();

    const result = executor.run([], {} as GPUTextureView, null);

    expect(masks.sweep).toHaveBeenCalledWith(new Set());
    expect(effects.runEffectPass).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(transient.destroy).toHaveBeenCalledOnce();
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(
      transient.destroy.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      enabledLayerCount: 0,
      churnedResourceCount: 1,
      composedTexture: null,
      overlayMaskTexture: null,
    });
  });

  it("returns null composedTexture/overlayMaskTexture when the overlay id matches no layer", () => {
    const { executor } = createExecutor();

    const result = executor.run([layer({ enabled: false })], {} as GPUTextureView, "no-such-id");

    expect(result.composedTexture).toBeNull();
    expect(result.overlayMaskTexture).toBeNull();
  });

  it("captures composedTexture/overlayMaskTexture on the empty-stack path when the overlay layer is disabled", () => {
    const { executor, effects, masks, firstTarget } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    const result = executor.run([layer({ enabled: false })], {} as GPUTextureView, "L1");

    expect(effects.runOverlayPass).toHaveBeenCalledOnce();
    expect(result.composedTexture).toBe(firstTarget);
    expect(result.overlayMaskTexture).toBe(resolved);
  });

  it("captures composedTexture/overlayMaskTexture from the ping-pong buffer when the overlay layer is enabled", () => {
    const { executor, effects, masks } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    const result = executor.run([layer({ enabled: true })], {} as GPUTextureView, "L1");

    expect(effects.runOverlayPass).toHaveBeenCalledOnce();
    const [, overlaySource, overlayMask] = (effects.runOverlayPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(result.composedTexture).toBe(overlaySource);
    expect(result.overlayMaskTexture).toBe(overlayMask);
    expect(result.overlayMaskTexture).toBe(resolved);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts`
Expected: FAIL — `result` n'a pas les champs `composedTexture`/`overlayMaskTexture` (le premier test échoue sur `toEqual`).

- [ ] **Step 3: Implémenter — `FramePipelineResult` gagne les deux champs**

Dans `src/render/framePipelineExecutor.ts`, remplacer :

```ts
export type FramePipelineResult = {
  enabledLayerCount: number;
  churnedResourceCount: number;
};
```

par :

```ts
export type FramePipelineResult = {
  enabledLayerCount: number;
  churnedResourceCount: number;
  /** Texture composée AVANT overlay (le frame réel, sans le rouge/contour de
   *  masque) — null si aucun overlayLayer n'était actif ce rendu. Capturée
   *  ici plutôt que recalculée : c'est la seule source de vérité pour
   *  `Renderer.tickOverlayAnimation`, qui ne doit jamais deviner quel buffer
   *  ping-pong contient le bon frame. */
  composedTexture: GPUTexture | null;
  /** Texture de masque déjà résolue par `MaskTexturesPort.resolve()` pour
   *  l'overlay de ce rendu, ou null si aucun overlayLayer. `resolve()` n'est
   *  PAS un cache de résultat pour edge-aware/refine-edge (seul le fold est
   *  mis en cache, voir `maskTextureResolver.ts`) — la rappeler à chaque
   *  frame d'animation regénérerait ce travail coûteux. La capturer ici
   *  évite tout nouvel appel à `resolve()` hors d'un vrai rendu complet. */
  overlayMaskTexture: GPUTexture | null;
};
```

- [ ] **Step 4: Implémenter — capturer les textures dans `run()`**

Remplacer le bloc `if (enabledLayers.length === 0) { ... }` par :

```ts
    if (enabledLayers.length === 0) {
      const blitTarget = overlayLayer ? pingPong[0] : null;
      this.effects.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        {
          id: "",
          effectId: "",
          params: {},
          enabled: true,
          opacity: 1,
          blendMode: "normal",
          mask: defaultLayerMask(),
        },
        sourceTexture.createView(),
        blitTarget ? blitTarget.createView() : finalTargetView,
        {},
        pendingDestroy,
      );
      let overlayMaskTexture: GPUTexture | null = null;
      if (overlayLayer && blitTarget) {
        overlayMaskTexture = this.masks.resolve(
          overlayLayer,
          encoder,
          sourceTexture.createView(),
          pendingDestroy,
        );
        this.effects.runOverlayPass(
          encoder,
          blitTarget,
          overlayMaskTexture,
          finalTargetView,
        );
      }
      return this.submitAndDestroy(encoder, pendingDestroy, 0, blitTarget, overlayMaskTexture);
    }
```

Et remplacer le bloc final de `run()` (à partir de `if (overlayLayer) {`) par :

```ts
    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        composedTexture.createView(),
        pendingDestroy,
      );
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        finalTargetView,
      );
    }
    return this.submitAndDestroy(encoder, pendingDestroy, enabledLayers.length, composedTexture, overlayMaskTexture);
```

Et remplacer `submitAndDestroy` par :

```ts
  private submitAndDestroy(
    encoder: GPUCommandEncoder,
    pendingDestroy: FrameResource[],
    enabledLayerCount: number,
    composedTexture: GPUTexture | null,
    overlayMaskTexture: GPUTexture | null,
  ): FramePipelineResult {
    this.device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    return {
      enabledLayerCount,
      churnedResourceCount: pendingDestroy.length,
      composedTexture,
      overlayMaskTexture,
    };
  }
```

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npx vitest run test/render/framePipelineExecutor.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Vérification statique globale**

Run: `npx tsc --noEmit`
Expected: aucune erreur (le seul autre consommateur de `FramePipelineExecutor.run()` est `Renderer.runPipeline`, modifié en Task 4 — d'ici là `tsc` reste vert car les champs ajoutés sont juste ignorés par l'appelant existant).

- [ ] **Step 7: Commit**

```bash
git add src/render/framePipelineExecutor.ts test/render/framePipelineExecutor.test.ts
git commit -m "feat(render): expose composed frame and mask texture from FramePipelineExecutor" -- src/render/framePipelineExecutor.ts test/render/framePipelineExecutor.test.ts
```

---

### Task 2: `EffectPassRunner.runOverlayPass` trace un contour animé au seuil 50 %

**Files:**
- Modify: `src/render/effectPassRunner.ts`
- Modify: `src/render/framePipelineExecutor.ts` (signature `EffectPassesPort.runOverlayPass` + les deux sites d'appel)
- Test: `test/render/effectPassRunner.test.ts`

**Interfaces:**
- Consumes: rien de Task 1.
- Produces: `EffectPassRunner.runOverlayPass(encoder, src, mask, targetView, time: number): void` — le paramètre `time` (secondes) est consommé par Task 4 (`Renderer.tickOverlayAnimation`).

- [ ] **Step 1: Écrire les tests qui échouent**

Remplacer le contenu de `test/render/effectPassRunner.test.ts` par :

```ts
import { describe, expect, it, vi } from "vitest";
import { EffectPassRunner, MASK_OVERLAY_WGSL } from "../../src/render/effectPassRunner";

function createRunner(): EffectPassRunner {
  return new EffectPassRunner(
    null as unknown as GPUDevice,
    "bgra8unorm-srgb",
    1,
    1,
    null as unknown as GPUSampler,
    () => null as unknown as GPUTexture
  );
}

describe("EffectPassRunner", () => {
  it("starts with an empty pipeline cache", () => {
    expect(createRunner().pipelineCount).toBe(0);
  });

  it("clears an empty cache without requiring a GPU operation", () => {
    const runner = createRunner();
    runner.clearPipelines();
    expect(runner.pipelineCount).toBe(0);
  });

  it("MASK_OVERLAY_WGSL exposes a time uniform and a screen-derivative contour test", () => {
    expect(MASK_OVERLAY_WGSL).toContain("overlayTime: f32");
    expect(MASK_OVERLAY_WGSL).toContain("fwidth(");
    expect(MASK_OVERLAY_WGSL).toContain("fs_overlay");
  });
});

function createRunnerWithFakeDevice() {
  const pipeline = { id: "overlay-pipeline" };
  const bindGroupLayout = { id: "overlay-bgl" };
  const writeBuffer = vi.fn();
  const passObj = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const createBindGroupLayout = vi.fn(() => bindGroupLayout);
  const createBuffer = vi.fn(() => ({}));
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout,
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => pipeline),
    createBindGroup: vi.fn(() => ({})),
    createBuffer,
    queue: { writeBuffer },
  } as unknown as GPUDevice;
  const runner = new EffectPassRunner(
    device,
    "bgra8unorm-srgb",
    4,
    4,
    {} as GPUSampler,
    () => null as unknown as GPUTexture,
  );
  const encoder = { beginRenderPass: vi.fn(() => passObj) } as unknown as GPUCommandEncoder;
  const src = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  const mask = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  return { runner, device, encoder, src, mask, passObj, writeBuffer, createBindGroupLayout, createBuffer };
}

describe("EffectPassRunner.runOverlayPass", () => {
  it("declares a 4th uniform-buffer binding for time", () => {
    const { runner, encoder, src, mask, createBindGroupLayout } = createRunnerWithFakeDevice();
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 1.5);
    const entries = createBindGroupLayout.mock.calls[0][0].entries;
    expect(entries).toHaveLength(4);
    expect(entries[3]).toMatchObject({ binding: 3, buffer: { type: "uniform" } });
  });

  it("writes the time value into a persistent buffer, reused across calls", () => {
    const { runner, encoder, src, mask, writeBuffer, createBuffer } = createRunnerWithFakeDevice();
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 1.5);
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 2.25);
    expect(createBuffer).toHaveBeenCalledOnce();
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer.mock.calls[1][2]).toEqual(new Float32Array([2.25, 0, 0, 0]));
  });

  it("clearPipelines() destroys the time buffer so the next call recreates it", () => {
    const { runner, encoder, src, mask, createBuffer } = createRunnerWithFakeDevice();
    const destroy = vi.fn();
    (createBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ destroy });
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 1);
    runner.clearPipelines();
    expect(destroy).toHaveBeenCalledOnce();
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 2);
    expect(createBuffer).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/render/effectPassRunner.test.ts`
Expected: FAIL — `MASK_OVERLAY_WGSL` n'est pas exporté, `runOverlayPass` n'accepte pas de 5ᵉ argument.

- [ ] **Step 3: Implémenter — WGSL + signature + buffer persistant**

Dans `src/render/effectPassRunner.ts`, remplacer :

```ts
const MASK_OVERLAY_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var overlaySrc: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
@group(0) @binding(2) var overlayMask: texture_2d<f32>;

@fragment
fn fs_overlay(in: VertexOut) -> @location(0) vec4<f32> {
  let img = textureSample(overlaySrc, overlaySampler, in.uv);
  let m = textureSample(overlayMask, overlaySampler, in.uv).r;
  let tint = vec3<f32>(0.791, 0.045, 0.061);
  return vec4<f32>(mix(img.rgb, tint, m * 0.28), img.a);
}
`;
```

par :

```ts
export const MASK_OVERLAY_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var overlaySrc: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
@group(0) @binding(2) var overlayMask: texture_2d<f32>;
@group(0) @binding(3) var<uniform> overlayTime: f32;

@fragment
fn fs_overlay(in: VertexOut) -> @location(0) vec4<f32> {
  let img = textureSample(overlaySrc, overlaySampler, in.uv);
  let m = textureSample(overlayMask, overlaySampler, in.uv).r;
  let tint = vec3<f32>(0.791, 0.045, 0.061);
  var rgb = mix(img.rgb, tint, m * 0.28);

  // Contour au seuil 0.5 : bande de ~1.5px via dérivée d'écran, jamais de
  // tracé d'isoligne CPU (design.md, "Contour, pas seuil binaire caché").
  // Pointillés : phase animée le long de la diagonale écran, indépendante
  // du contenu du masque.
  let edgeWidth = fwidth(m) * 1.5 + 0.0001;
  let onContour = 1.0 - smoothstep(0.0, edgeWidth, abs(m - 0.5));
  let dashPhase = fract((in.position.x + in.position.y) * 0.12 - overlayTime * 1.5);
  let dashColor = select(vec3<f32>(0.0), vec3<f32>(1.0), dashPhase > 0.5);
  rgb = mix(rgb, dashColor, onContour);

  return vec4<f32>(rgb, img.a);
}
`;
```

Ajouter le champ de buffer persistant juste après `pipelineCache` :

```ts
  private readonly pipelineCache = new Map<
    string,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
  /** Buffer d'uniform réutilisé pour `overlayTime` — créé une fois, mis à
   *  jour par `writeBuffer` à chaque tick (animation OU rendu normal),
   *  jamais recréé/détruit par frame (évite la pression allocateur d'un
   *  buffer jetable à 60fps). Détruit dans `clearPipelines()`. */
  private timeBuffer: GPUBuffer | null = null;
```

Remplacer `runOverlayPass` par :

```ts
  runOverlayPass(encoder: GPUCommandEncoder, src: GPUTexture, mask: GPUTexture, targetView: GPUTextureView, time: number): void {
    let cached = this.pipelineCache.get(MASK_OVERLAY_WGSL);
    if (!cached) {
      const module = this.device.createShaderModule({ code: MASK_OVERLAY_WGSL });
      const bindGroupLayout = this.device.createBindGroupLayout({ entries: [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 3, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ] });
      const pipeline = this.device.createRenderPipeline({
        layout: this.device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] }),
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_overlay", targets: [{ format: this.srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(MASK_OVERLAY_WGSL, cached);
    }
    if (!this.timeBuffer) {
      this.timeBuffer = this.device.createBuffer({
        size: 16,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
    }
    this.device.queue.writeBuffer(this.timeBuffer, 0, new Float32Array([time, 0, 0, 0]));
    const bindGroup = this.device.createBindGroup({ layout: cached.bindGroupLayout, entries: [
      { binding: 0, resource: src.createView() },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: mask.createView() },
      { binding: 3, resource: { buffer: this.timeBuffer } },
    ] });
    const pass = encoder.beginRenderPass({ colorAttachments: [{ view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }
```

Remplacer `clearPipelines` par :

```ts
  clearPipelines(): void {
    this.pipelineCache.clear();
    this.timeBuffer?.destroy();
    this.timeBuffer = null;
  }
```

- [ ] **Step 4: Propager le paramètre `time` dans `framePipelineExecutor.ts`**

Dans `src/render/framePipelineExecutor.ts`, remplacer la signature dans `EffectPassesPort` :

```ts
  runOverlayPass(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    mask: GPUTexture,
    targetView: GPUTextureView,
  ): void;
```

par :

```ts
  runOverlayPass(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    mask: GPUTexture,
    targetView: GPUTextureView,
    time: number,
  ): void;
```

Dans `run()`, juste après `const encoder = this.device.createCommandEncoder();`, ajouter :

```ts
    const overlayTimeSeconds = performance.now() / 1000;
```

Puis, dans les deux appels à `this.effects.runOverlayPass(...)` (empty-stack et fin de boucle), ajouter `overlayTimeSeconds` comme 5ᵉ argument — les deux appels passent de 4 à 5 arguments, dernière ligne `finalTargetView,` devient `finalTargetView,\n          overlayTimeSeconds,`.

- [ ] **Step 5: Lancer les tests, vérifier le succès**

Run: `npx vitest run test/render/effectPassRunner.test.ts test/render/framePipelineExecutor.test.ts`
Expected: PASS (tous les tests des deux fichiers).

- [ ] **Step 6: Vérification statique globale**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 7: Commit**

```bash
git add src/render/effectPassRunner.ts src/render/framePipelineExecutor.ts test/render/effectPassRunner.test.ts
git commit -m "feat(render): animate a threshold contour on the mask overlay pass" -- src/render/effectPassRunner.ts src/render/framePipelineExecutor.ts test/render/effectPassRunner.test.ts
```

---

### Task 3: `OverlayAnimationLoop` — boucle rAF continue et indépendante

**Files:**
- Create: `src/render/overlayAnimationLoop.ts`
- Test: `test/render/overlayAnimationLoop.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces: `class OverlayAnimationLoop { start(cb: (timeMs: number) => void): void; stop(): void; get running(): boolean }`, rAF/cancelAnimationFrame injectables au constructeur — consommé par Task 5 (`App.tsx`).

- [ ] **Step 1: Écrire les tests qui échouent**

Créer `test/render/overlayAnimationLoop.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { OverlayAnimationLoop } from "../../src/render/overlayAnimationLoop";

/** Faux rAF manuel : capture les callbacks (qui reçoivent un timestamp),
 *  `flush(t)` simule une frame à l'instant t. Même pattern que
 *  frameScheduler.test.ts. */
function fakeRaf() {
  const queue = new Map<number, (t: number) => void>();
  let nextId = 1;
  return {
    raf: (cb: (t: number) => void) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    caf: (id: number) => {
      queue.delete(id);
    },
    flush: (t: number) => {
      const cbs = [...queue.values()];
      queue.clear();
      cbs.forEach((cb) => cb(t));
    },
    pending: () => queue.size,
  };
}

describe("OverlayAnimationLoop", () => {
  it("does not schedule a frame before start()", () => {
    const { pending } = fakeRaf();
    expect(pending()).toBe(0);
  });

  it("schedules a frame on start() and re-arms itself after each tick", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    expect(pending()).toBe(1);
    flush(16);
    expect(ticks).toEqual([16]);
    expect(pending()).toBe(1);
  });

  it("keeps ticking across multiple frames", () => {
    const { raf, caf, flush } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    flush(16);
    flush(32);
    flush(48);
    expect(ticks).toEqual([16, 32, 48]);
  });

  it("start() is a no-op while already running", () => {
    const { raf, caf, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    loop.start(() => {});
    loop.start(() => {});
    expect(pending()).toBe(1);
  });

  it("stop() cancels the pending frame and halts ticking", () => {
    const { raf, caf, flush, pending } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    const ticks: number[] = [];
    loop.start((t) => ticks.push(t));
    loop.stop();
    expect(pending()).toBe(0);
    flush(16);
    expect(ticks).toEqual([]);
  });

  it("running reflects the current state", () => {
    const { raf, caf } = fakeRaf();
    const loop = new OverlayAnimationLoop(raf, caf);
    expect(loop.running).toBe(false);
    loop.start(() => {});
    expect(loop.running).toBe(true);
    loop.stop();
    expect(loop.running).toBe(false);
  });
});
```

- [ ] **Step 2: Lancer les tests, vérifier l'échec**

Run: `npx vitest run test/render/overlayAnimationLoop.test.ts`
Expected: FAIL — `src/render/overlayAnimationLoop.ts` n'existe pas.

- [ ] **Step 3: Implémenter**

Créer `src/render/overlayAnimationLoop.ts` :

```ts
/**
 * Boucle rAF continue et autonome — contrairement à `FrameScheduler`, qui
 * coalesce N requêtes en UNE frame puis s'arrête, celle-ci appelle `cb`
 * à CHAQUE frame tant qu'elle est démarrée. Sert uniquement à faire avancer
 * la phase des pointillés de l'overlay de masque (voir
 * `Renderer.tickOverlayAnimation`) — jamais à déclencher un rendu complet.
 * rAF/cancelAnimationFrame injectables au constructeur : testable en env
 * Node (pas de rAF global), même pattern que `frameScheduler.ts`.
 */
export class OverlayAnimationLoop {
  private rafId: number | null = null;

  constructor(
    private readonly raf: (cb: (timeMs: number) => void) => number = (cb) =>
      requestAnimationFrame(cb),
    private readonly caf: (id: number) => void = (id) => cancelAnimationFrame(id),
  ) {}

  get running(): boolean {
    return this.rafId !== null;
  }

  start(cb: (timeMs: number) => void): void {
    if (this.rafId !== null) return;
    const tick = (timeMs: number) => {
      cb(timeMs);
      this.rafId = this.raf(tick);
    };
    this.rafId = this.raf(tick);
  }

  stop(): void {
    if (this.rafId === null) return;
    this.caf(this.rafId);
    this.rafId = null;
  }
}
```

- [ ] **Step 4: Lancer les tests, vérifier le succès**

Run: `npx vitest run test/render/overlayAnimationLoop.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Vérification statique globale**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Commit**

```bash
git add src/render/overlayAnimationLoop.ts test/render/overlayAnimationLoop.test.ts
git commit -m "feat(render): add a standalone rAF loop for the mask overlay animation" -- src/render/overlayAnimationLoop.ts test/render/overlayAnimationLoop.test.ts
```

---

### Task 4: `Renderer` capture le dernier frame d'overlay et l'anime sans relancer le pipeline

**Files:**
- Modify: `src/render/renderer.ts`

**Interfaces:**
- Consumes: `FramePipelineResult.composedTexture`/`overlayMaskTexture` (Task 1), `EffectPassRunner.runOverlayPass(..., time)` (Task 2).
- Produces: `Renderer.tickOverlayAnimation(timeMs: number): void` — consommé par Task 5 (`App.tsx`).

Aucun test unitaire dédié : `Renderer` n'a pas de fichier de test dans ce projet (orchestrateur GPU de haut niveau, déjà le cas avant cette tâche — `test/render/` ne contient aucun `renderer.test.ts`). La preuve reste `tsc` + le checkpoint visuel de Task 6.

- [ ] **Step 1: Ajouter le champ de stockage du dernier frame d'overlay**

Dans `src/render/renderer.ts`, juste après le champ `maskOverlayLayerId` :

```ts
  private maskOverlayLayerId: string | null = null;
  /** Dernier frame d'overlay capturé par un rendu complet (`runPipeline`) —
   *  null si aucun overlay actif. Seule source lue par
   *  `tickOverlayAnimation` : jamais recalculée, jamais un nouvel appel à
   *  `MaskTexturesPort.resolve()` depuis la boucle d'animation (coûteux,
   *  voir `docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md`). */
  private lastOverlayFrame: { composedTexture: GPUTexture; overlayMaskTexture: GPUTexture } | null = null;
```

- [ ] **Step 2: Capturer le frame dans `runPipeline`**

Remplacer :

```ts
  private runPipeline(
    layers: LayerState[],
    finalTargetView: GPUTextureView,
  ): void {
    if (!this.framePipelineExecutor) throw new Error("Aucune image chargée.");
    const diagStart = performance.now();
    const result = this.framePipelineExecutor.run(
      layers,
      finalTargetView,
      this.maskOverlayLayerId,
    );
    this.frameDiagnostics.record(diagStart, result, {
      pipelineCacheSize: this.effectPassRunner?.pipelineCount ?? 0,
      imageWidth: this.imageResources.width,
      imageHeight: this.imageResources.height,
    });
  }
```

par :

```ts
  private runPipeline(
    layers: LayerState[],
    finalTargetView: GPUTextureView,
  ): void {
    if (!this.framePipelineExecutor) throw new Error("Aucune image chargée.");
    const diagStart = performance.now();
    const result = this.framePipelineExecutor.run(
      layers,
      finalTargetView,
      this.maskOverlayLayerId,
    );
    this.lastOverlayFrame =
      result.composedTexture && result.overlayMaskTexture
        ? { composedTexture: result.composedTexture, overlayMaskTexture: result.overlayMaskTexture }
        : null;
    this.frameDiagnostics.record(diagStart, result, {
      pipelineCacheSize: this.effectPassRunner?.pipelineCount ?? 0,
      imageWidth: this.imageResources.width,
      imageHeight: this.imageResources.height,
    });
  }
```

- [ ] **Step 3: Ajouter `tickOverlayAnimation`**

Juste après la méthode `requestRender`, ajouter :

```ts
  /** Ré-exécute UNIQUEMENT le pass d'overlay (contour + pointillés) sur le
   *  dernier frame composé — jamais le fold du masque ni les effets. No-op
   *  si aucun overlay n'est actif (`lastOverlayFrame` null). Appelée en
   *  boucle par `OverlayAnimationLoop` depuis `App.tsx`, jamais par un
   *  rendu normal. `timeMs` vient directement du timestamp rAF. */
  tickOverlayAnimation(timeMs: number): void {
    if (!this.lastOverlayFrame || !this.effectPassRunner) return;
    const { composedTexture, overlayMaskTexture } = this.lastOverlayFrame;
    const encoder = this.ctx.device.createCommandEncoder();
    this.effectPassRunner.runOverlayPass(
      encoder,
      composedTexture,
      overlayMaskTexture,
      getSrgbCanvasView(this.ctx),
      timeMs / 1000,
    );
    this.ctx.device.queue.submit([encoder.finish()]);
  }
```

- [ ] **Step 4: Réinitialiser `lastOverlayFrame` dans `dispose()`**

Dans `dispose()`, ajouter `this.lastOverlayFrame = null;` juste après `this.framePipelineExecutor = null;` — évite qu'une future instance de `Renderer` (nouvelle image chargée) hérite d'une référence de texture détruite si `tickOverlayAnimation` était encore appelé entre deux frames pendant un remplacement d'instance.

- [ ] **Step 5: Vérification statique**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Lancer la suite complète**

Run: `npm run test`
Expected: tous les tests passent (aucune régression — `Renderer` n'a pas de test direct, mais ce changement ne modifie le comportement d'aucun module testé).

- [ ] **Step 7: Commit**

```bash
git add src/render/renderer.ts
git commit -m "feat(render): tick the mask overlay animation without re-running the pipeline" -- src/render/renderer.ts
```

---

### Task 5: `App.tsx` — déclencheur élargi et câblage de la boucle d'animation

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `planFold` (déjà exporté par `src/mask/foldPlan.ts`), `OverlayAnimationLoop` (Task 3), `Renderer.tickOverlayAnimation` (Task 4).

Aucun test unitaire : ce projet ne rend aucun composant React en test (convention existante, voir `CLAUDE.md`). Preuve = `tsc` + Task 6.

- [ ] **Step 1: Ajouter les imports**

Dans `src/App.tsx`, après :

```ts
import { MAX_COLOR_RANGE_SAMPLES } from "./mask/sources/colorRange";
```

ajouter :

```ts
import { planFold } from "./mask/foldPlan";
import { OverlayAnimationLoop } from "./render/overlayAnimationLoop";
```

- [ ] **Step 2: Ajouter la ref de la boucle d'animation**

Remplacer :

```ts
  const rendererRef = useRef<Renderer | null>(null);
```

par :

```ts
  const rendererRef = useRef<Renderer | null>(null);
  const overlayAnimationLoopRef = useRef(new OverlayAnimationLoop());
```

- [ ] **Step 3: Supprimer l'ancien effet d'overlay**

Supprimer entièrement ce bloc (son remplaçant est ajouté au Step 4, à un autre endroit du fichier) :

```ts
  // Overlay du masque : montrer le masque du calque sélectionné en rouge
  // safelight dès qu'on entre en mode peinture (pour VOIR ce qu'on masque),
  // l'éteindre sinon. Piloté comme un état du renderer + un re-rendu.
  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMaskOverlay(maskPaintMode && selectedId ? selectedId : null);
    r.requestRender(sessionRef.current.layers());
  }, [maskPaintMode, selectedId]);
```

- [ ] **Step 4: Ajouter le nouvel effet, après le calcul de `selectedLayer`**

Trouver :

```ts
  const selectedLayer = layers.find((l) => l.id === selectedId) ?? null;
  const paramsPanelTitle = selectedLayer ? `Réglages · ${getEffect(selectedLayer.effectId).name}` : "Réglages";
```

Insérer juste après (avant le `return (` qui suit) :

```ts
  // Overlay du masque (rouge + contour animé) : visible dès qu'un calque
  // sélectionné a un masque actif (mode peinture OU au moins une source
  // active) — pas seulement en mode peinture comme avant, pour couvrir
  // l'édition des sources dégradé/luminosité/range couleur qui ne passe
  // jamais par le pinceau. Voir
  // docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md.
  // showOverlay est un booléen stable (pas `layers` en dépendance) pour que
  // l'effet ne se redéclenche pas à chaque frame d'un drag de slider — seul
  // un vrai changement "montrer/cacher" redémarre la boucle rAF.
  const hasActiveMask = selectedLayer ? planFold(selectedLayer.mask).length > 0 : false;
  const showOverlay = maskPaintMode || hasActiveMask;

  useEffect(() => {
    const r = rendererRef.current;
    if (!r) return;
    r.setMaskOverlay(showOverlay && selectedId ? selectedId : null);
    r.requestRender(sessionRef.current.layers());

    if (showOverlay && selectedId) {
      overlayAnimationLoopRef.current.start((timeMs) => {
        rendererRef.current?.tickOverlayAnimation(timeMs);
      });
    } else {
      overlayAnimationLoopRef.current.stop();
    }
    return () => overlayAnimationLoopRef.current.stop();
  }, [showOverlay, selectedId]);
```

- [ ] **Step 5: Vérification statique**

Run: `npx tsc --noEmit`
Expected: aucune erreur.

- [ ] **Step 6: Lancer la suite complète**

Run: `npm run test`
Expected: tous les tests passent.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "feat(ui): show the mask overlay whenever the selected layer has an active mask" -- src/App.tsx
```

---

### Task 6: Checkpoint visuel humain (CONDITION DE SORTIE NON NÉGOCIABLE)

**Files:** aucun changement de code — vérification uniquement.

- [ ] **Step 1: Lancer l'app en mode debug**

Run: `npm run dev:debug` puis `npm run dev:monitor` (voir `CLAUDE.md` § Méthode — logs vides tant que le process tourne, vérifier par `Get-Process shaderlab` ou CDP plutôt que par le fichier de log).

- [ ] **Step 2: Vérifier le symptôme d'origine est corrigé**

Charger une photo, ajouter un calque, sélectionner-le, ouvrir le panneau Masque, ajouter une source **Luminosité** — SANS cliquer "Peindre le masque". Vérifier : le rouge + le contour pointillé apparaissent immédiatement sur le canvas (c'est le bug de départ : avant cette tranche, aucun overlay ne s'affichait tant qu'on n'entrait pas en mode peinture).

- [ ] **Step 3: Vérifier le contour au seuil**

Régler `tolérance`/`shadowsMin`/`shadowsMax` de la source Luminosité, observer que le contour pointillé suit précisément la frontière entre zone masquée (rouge) et zone non masquée, et qu'il reste net (pas de bande floue disproportionnée) à différents réglages de dureté/tolérance.

- [ ] **Step 4: Vérifier l'animation**

Confirmer que les pointillés avancent en continu (pas figés), y compris pendant qu'aucun autre réglage ne bouge — preuve que la boucle `OverlayAnimationLoop` tourne indépendamment des rendus normaux.

- [ ] **Step 5: Vérifier l'absence de régression pendant un drag**

Faire glisser un slider (opacité du calque, ou un paramètre de la source) pendant que le contour anime. Vérifier : pas de saccade visible, pas d'erreur console/WebView2, le contour continue d'animer normalement après le drag.

- [ ] **Step 6: Vérifier la désactivation**

Désélectionner le calque (ou désactiver le masque via la checkbox "Masque actif"). Vérifier : le rouge ET le contour disparaissent, et qu'aucune erreur console n'apparaît (la boucle d'animation doit s'arrêter proprement — vérifiable indirectement par l'absence de dérive CPU/GPU visible dans `.dev-diag` après plusieurs secondes).

- [ ] **Step 7: Vérifier l'absence de régression perf à 24MP**

Sur une image ~24MP (zone historiquement sensible, voir bandeau `CLAUDE.md`), activer le contour plusieurs secondes. Vérifier via `.dev-diag` que rien ne dérive vers le comportement du crash historique (`residentMaskTextures` stable, pas de hang).

Ne pas cocher cette tâche sans confirmation visuelle explicite d'Antoine pour CHACUN des points 2 à 7 — les documenter individuellement (accepté/refusé/reporté), pas un seul "OK global".

- [ ] **Step 8: Commit final si des ajustements ont eu lieu pendant le checkpoint**

```bash
git add -A
git status
```

Committer uniquement les fichiers effectivement modifiés pendant le checkpoint (pathspec explicite), s'il y en a.
