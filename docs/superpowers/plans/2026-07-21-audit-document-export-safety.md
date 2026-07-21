# Document and Export Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve the active document on failed opens and guarantee manual exports never overwrite prior output.

**Architecture:** Add a Tauri-backed file-existence port for target selection; construct candidate renderers before replacing the active instance; make mutations report whether they changed state.

**Tech Stack:** TypeScript, Rust, Tauri v2, React 19, Vitest.

## Global Constraints

- Lightroom launch exports overwrite only their original launch path.
- Manual exports must select the first path that does not exist at write time.
- Preserve atomic Rust writes and do not stage unrelated working-tree changes.

---

### Task 1: Resolve export paths against disk

**Files:** Modify `src/export/exportImage.ts`, `src/launch.ts`, `src-tauri/src/lib.rs`, `src/App.tsx`, `test/export/exportImage.test.ts`; add Rust test in `src-tauri/src/lib.rs`.

**Interfaces:** Add `PathAvailability = { exists(path: string): Promise<boolean> }` and `resolveExportTargetAsync(sourcePath, isLaunchFile, availability): Promise<string>`; add Tauri command `path_exists(path: String) -> bool`.

- [ ] Write Vitest cases that simulate occupied `-edited.jpg` and `-edited-2.jpg`, expecting `-edited-3.jpg`; add Rust tests for true/false paths.
- [ ] Run focused Vitest and `cargo test`; expect the async resolver and command to be absent.
- [ ] Implement candidate probing in a loop; return launch path immediately for round-trip. Wire `pathExists` through `launch.ts` and App.
- [ ] Verify focused tests, `cargo check`, frontend checks, and commit exact task paths.

### Task 2: Replace renderer transactionally and normalize errors

**Files:** Modify `src/App.tsx`, `src/render/renderer.ts`; create `src/lib/errors.ts`; add `test/lib/errors.test.ts`.

**Interfaces:** Export `messageFromUnknown(error: unknown): string`. Add `Renderer.createLoaded(ctx, bitmap, logger): Promise<Renderer>` or equivalent factory that disposes its partially-created resources on failure.

- [ ] Write failing tests for `messageFromUnknown(new Error("x"))`, string rejection, and unknown rejection.
- [ ] Implement the normalizer and replace all `as Error` UI casts.
- [ ] Refactor `openFile` to await a fully loaded candidate before assigning `rendererRef.current`; dispose only the former renderer after success; ensure failed candidates dispose themselves.
- [ ] Run all frontend verification and manually retry a deliberately unsupported image followed by export of the original document; commit task paths.

### Task 3: Define mutation outcomes

**Files:** Modify `src/layers/layerStack.ts`, `src/App.tsx`, `test/layers/layerStack.test.ts`.

- [ ] Add failing tests that invalid reorder indices and absent IDs return `false`, and no-op setters return `false` without changing layer references.
- [ ] Make mutators return `boolean`; clamp neither invalid reorder indices nor silently create history.
- [ ] Use outcomes in App before `commit()` for discrete changes; run full checks and commit task paths.
