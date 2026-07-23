# Mask Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Render, invalidate and edit every active mask source correctly.

**Architecture:** Replace the permissive mask-source shape with a discriminated union. Make fold planning and snapshots cover enabled brush and parametric sources; keep GPU texture generation inside `MaskTextureResolver`.

**Tech Stack:** TypeScript, WebGPU, React 19, Vitest.

## Global Constraints

- Preserve full-resolution raster buffers outside React state.
- Preserve one history entry per completed interaction.
- Do not prove WebGPU output with headless Playwright; finish with the existing human WebView2 checkpoint.

---

### Task 1: Make mask sources valid by construction — DONE (commit 2cd92d3, 2026-07-21)

**Files:** Modify `src/mask/types.ts`, `src/mask/sources/types.ts`, `src/layers/layerStack.ts`, `test/mask/types.test.ts`, `test/layers/layerStack.test.ts`.

**Interfaces:** Export `BrushMaskSource` (`type: "brush"; raster: Uint8Array; params: null`) and `ParametricMaskSource` (`type: Exclude<MaskSourceType,"brush">; raster: null; params: MaskSourceParams`); `MaskSource` is their union. Add `setMaskSourceEnabled(layerId, sourceId, enabled): boolean`.

- [x] Write failing tests proving factories create only their respective variant, source enablement changes only the matching source, and a missing source returns `false` without mutation.
- [x] Run `npm run test -- test/mask/types.test.ts test/layers/layerStack.test.ts`; expect the new tests to fail because the union/setter do not exist.
- [x] Replace the broad interface with the two variants; narrow source-module parameter metadata and update all callers without `as` casts.
- [x] Implement `setMaskSourceEnabled` with an immutable `sources.map`; return `true` only when the requested source existed and its value changed.
- [x] Re-run the focused tests, then `npx tsc --noEmit` and commit the exact task paths.

### Task 2: Plan and invalidate all fold inputs — DONE (commit d69d47c, 2026-07-21)

**Files:** Modify `src/mask/foldPlan.ts`, `test/mask/foldPlan.test.ts`, `src/render/maskTextureResolver.ts`; create `test/render/maskTextureResolver.test.ts`.

**Interfaces:** `planFold(mask)` returns every `source.enabled` source. `FoldSourceSnapshot` contains `id`, `type`, `enabled`, `combineMode`, `raster`, and `params`; `foldInputsEqual` compares each field by value/reference as appropriate.

- [x] Add failing fold-plan tests for a lone parametric source, brush+parametric fold, disabled parametric source, and changed parameter-object reference.
- [x] Add resolver seam tests with a fake GPU device asserting cache reuse only for equal snapshots and a fold re-encode after a changed parametric source.
- [x] Run focused tests; expect parameter sources to be absent from `planFold`.
- [x] Update `planFold` and snapshot comparison; change resolver signatures to accept the narrowed union so `resident()` dispatches exhaustively to brush upload or parametric generation.
- [x] Run `npm run test -- test/mask/foldPlan.test.ts test/render/maskTextureResolver.test.ts`, then full frontend verification and commit task paths.

### Task 3: Expose source activation and validate real rendering — code DONE (commit e53ac65, 2026-07-21), checkpoint OPEN

**Files:** Modify `src/components/ParamPanel.tsx`, `src/App.tsx`, `test/layers/layerStack.test.ts`.

- [x] Add a failing model test for `setMaskSourceEnabled` if not completed in Task 1; run it.
- [x] Add a checkbox per non-brush source, wire a typed `onMaskSourceEnabledChange`, and commit it as a discrete history action only when the setter reports a change.
- [x] Remove residual unsafe source-type casts and run `npx tsc --noEmit`, `npm run test`, `npm run lint:tokens`, `npm run build`. (Re-verified 2026-07-23: tsc clean, 272 tests pass, build ok; `npm run lint:tokens` has 2 pre-existing findings in `EmptyWorkspace.stories.tsx`, unrelated to this plan's files.)
- [ ] Launch only after checking existing `shaderlab` processes; use the real WebView2/CDP and human checkpoint for gradient, luminosity, color range, combine modes, enabled toggle, invert and refine edge. Record result in the plan before committing. **STILL OPEN as of 2026-07-23** — not doable from this headless session; to be done by Antoine.
