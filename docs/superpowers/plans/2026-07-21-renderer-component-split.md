# Renderer Component Split Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the WebGPU renderer by stable resource ownership without changing `Renderer`’s public API or GPU lifetime behavior.

**Architecture:** `EffectPassRunner` owns stateless per-frame colour-pass encoding and its pipeline cache. A later `MaskTextureResolver` owns every persistent mask texture/cache and exposes one `resolve` boundary to `Renderer`. `Renderer` remains the frame orchestrator: it creates encoders, submits work, and destroys the caller-owned per-frame resources only after submit.

**Tech Stack:** TypeScript, WebGPU/WGSL, Vitest.

## Global Constraints

- `Renderer` public methods remain unchanged.
- No extracted component may call `queue.submit()` or destroy the caller’s `pendingDestroy` resources.
- Persistent mask textures remain owned and disposed by one component only.
- Preserve existing pipeline-cache keys and explicit WebGPU bind-group layouts.
- Run `npx tsc --noEmit`, `npm run test`, `npm run lint:tokens`, and `npm run build` after each task.

---

### Task 1: Extract colour-effect pass encoding

**Files:**
- Create: `src/render/effectPassRunner.ts`
- Modify: `src/render/renderer.ts`
- Test: `test/render/effectPassRunner.test.ts`

**Interfaces:** `EffectPassRunner` receives `GPUDevice`, sRGB format, dimensions, sampler, and a callback `(layer, encoder, sourceView, pendingDestroy) => GPUTexture`. It exposes `runEffectPass`, `runInternalPasses`, `runOverlayPass`, `pipelineCount`, and `clearPipelines`.

- [ ] Move the passthrough shader, overlay WGSL, effect-pipeline cache, and the three colour-pass methods into the runner.
- [ ] Keep mask resolution as a callback into `Renderer`; do not move any mask texture map or submit/destroy call.
- [ ] Add pure constructor/cache lifecycle coverage and verify the public `Renderer` behavior stays type-compatible.
- [ ] Verify and commit only task files with explicit pathspecs.

### Task 2: Extract mask texture resolution as one ownership unit

**Files:**
- Create: `src/render/maskTextureResolver.ts`
- Modify: `src/render/renderer.ts`
- Test: `test/render/maskTextureResolver.test.ts`

**Interfaces:** the resolver owns raster/parametric source residency, folded masks, fold/refine/edge-aware work textures, their pipeline caches, white/live masks, and exposes `resolve`, `sweep`, `setLivePreview`, `dispose`.

- [ ] Move all mask maps together; keep per-layer sweep and disposal in the resolver.
- [ ] Preserve the partial-upload, post-submit destruction, and per-layer ping-pong invariants.
- [ ] Replace `Renderer.getMaskTexture` calls with the resolver boundary and retain frame submission in `Renderer`.
- [ ] Verify and commit only task files with explicit pathspecs.

### Task 3: Final dependency audit

- [ ] Confirm colour effects do not import mask implementation modules and `Renderer` does not own mask caches.
- [ ] Run full test, token lint, production build, and inspect the active WebView2 console without restarting its existing process.
