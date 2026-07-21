# Clean Architecture Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep document editing and export policies independent from React, Tauri IPC, and the concrete WebGPU renderer.

**Architecture:** Introduce small ports owned by the application layer: diagnostics for WebGPU, and frame rendering/image writing for export. Extract the document state and history transition policy from `App.tsx` into a framework-free `DocumentSession`; React remains the composition root and translates UI events to this session.

**Tech Stack:** TypeScript, React 19, WebGPU, Tauri v2, Vitest.

## Global Constraints

- Preserve `layersRef` as the sole full-resolution mask source; React receives only `toDisplayLayers()` projections.
- Preserve one history entry per discrete action or completed slider/mask interaction.
- Preserve Lightroom overwrite semantics and manual-export copy semantics.
- Do not alter existing uncommitted UI-polish files outside the files named by a task.
- Each task must pass `npx tsc --noEmit`, `npm run test`, and `npm run lint:tokens`.
- Commit with explicit pathspecs only after the task is verified.

---

### Task 1: Invert diagnostics from WebGPU

**Files:**
- Create: `src/render/diagnostics.ts`
- Modify: `src/render/gpuContext.ts`
- Modify: `src/render/renderer.ts`
- Modify: `src/App.tsx`
- Test: `test/render/diagnostics.test.ts`

**Interfaces:**
- Produces `DiagnosticLogger = (message: string) => void` and `noopDiagnosticLogger`.
- `initGpu(canvas, onFatalError, diagnosticLogger)` and `new Renderer(context, diagnosticLogger)` use the injected logger, defaulting to the no-op implementation.

- [x] Write tests proving the no-op logger is callable and the adapter can be passed as a `DiagnosticLogger`.
- [x] Implement `diagnostics.ts` with the type and no-op function; replace `launch.ts` imports in the render package with the injected dependency.
- [x] At the composition root, pass `logDiagnostic` to `initGpu` and `Renderer`.
- [x] Run the verification commands and commit only the task pathspecs.

### Task 2: Define export ports and isolate the use case

**Files:**
- Modify: `src/export/exportImage.ts`
- Modify: `src/App.tsx`
- Test: `test/export/exportImage.test.ts`

**Interfaces:**
- Produces `FrameRenderer` with `exportFrame(layers): Promise<Uint8Array>` and `ImageWriter` with `write(path, bytes): Promise<void>`.
- `exportImage(frameRenderer, imageWriter, layers, targetPath, width, height)` has no import from `render/` or `launch.ts`.

- [x] Add a test using fake ports that verifies export writes the JPEG bytes to the requested path.
- [x] Replace the concrete renderer and Tauri imports with the port types; keep JPEG encoding and `resolveExportTarget` unchanged.
- [x] Wire `rendererRef.current` and `writeImageFile` in `App.tsx` as outer adapters.
- [x] Run the verification commands and commit only the task pathspecs.

### Task 3: Extract framework-free document session

**Files:**
- Create: `src/application/documentSession.ts`
- Modify: `src/App.tsx`
- Test: `test/application/documentSession.test.ts`

**Interfaces:**
- Produces `DocumentSession` owning `History`, the authoritative `LayerStack`, and selection state.
- Exposes `layers()`, `displayLayers()`, `selectedId`, `replaceDocument()`, `commit(stack)`, `currentStack()`, `select(id)`, and `undo()/redo()`.
- React retains GPU lifetime, display state, pointer coalescing, and native file dialog calls.

- [x] Write tests for session commits, display projections without raster buffers, selection cleanup after deletion, and undo/redo returning display-safe layers.
- [x] Implement the session using existing `History`, `LayerStack`, and `toDisplayLayers`; do not reimplement layer mutation rules.
- [x] Replace App’s parallel `historyRef`, `layersRef`, and selection synchronization primitives with one session ref and a narrow `syncSession()` UI adapter.
- [x] Run the verification commands and commit only the task pathspecs.

### Task 4: Final dependency and regression verification

**Files:**
- Modify: none

- [x] Confirm `src/render/` has no import of `../launch` and `src/export/exportImage.ts` has no import from `render/` or `launch`.
- [x] Run `npx tsc --noEmit`, `npm run test`, `npm run lint:tokens`, and `npm run build`.
- [x] Start the existing development session only if no other Shaderlab process is running; otherwise inspect its console without stopping it.
- [x] Commit the verified remediation files with explicit pathspecs, leaving unrelated UI work untouched.
