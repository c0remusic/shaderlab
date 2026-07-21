# UI Runtime Hygiene Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove stale UI state, delayed callbacks and dead/premature APIs identified by the audit.

**Architecture:** Keep transient pointer state in a ref at commit boundaries, give every timer/rAF an effect cleanup, and extract pure guards for no-op changes.

**Tech Stack:** TypeScript, React 19, Vitest.

## Global Constraints

- Do not add a React DOM test renderer; preserve the repository's pure-logic Vitest convention.
- Keep pointer-event drag rather than HTML5 drag-and-drop.

---

### Task 1: Stabilize drag and interaction commits

**Files:** Modify `src/components/dockedPanel/PanelColumn.tsx`, `src/ui/dragReorder.ts`, `src/ui/Slider.tsx`, `src/App.tsx`; modify `test/ui/dockLayout.test.ts`, `test/ui/dragReorder.test.ts`; create `test/ui/valueChange.test.ts`.

- [ ] Add pure tests for a latest drag target being committed and for clamped wheel values being unchanged.
- [ ] Keep the current drag state in a ref synchronized by the functional setter; read that ref in pointer-up/cancel.
- [ ] Export `hasValueChanged(previous, next)` and only mark parameter history dirty when true; cancel wheel commit timers on unmount.
- [ ] Run frontend checks and commit task paths.

### Task 2: Clean asynchronous UI resources

**Files:** Modify `src/components/Canvas.tsx`, `src/ui/Tooltip.tsx`, `src/ui/Select.tsx`, `src/render/renderer.ts`.

- [ ] Add cleanup effects for pending rAF/timers and use `try/finally` around renderer preview lifetime and per-frame destruction.
- [ ] Verify no callback can commit after its control is unmounted; run TypeScript, tests, lint and build.
- [ ] Commit task paths.

### Task 3: Align affordances and remove stale code

**Files:** Modify `src/App.tsx`, `src/components/Toolbar.tsx`, `src/ui/Progress.tsx`, `src/ui/Select.tsx`, `src/components/Canvas.tsx`; delete `src/render/maskResidency.ts` and `test/render/maskResidency.test.ts`; add `test/ui/progress.test.ts`.

- [ ] Add window keydown handling for Ctrl+Z/Ctrl+Y, excluding editable controls; clear errors after a successful open/export.
- [ ] Validate positive `Progress.max` and add its tests.
- [ ] Remove the unused residency helper and revise obsolete FloatingPanel/pre-clone comments; retain `readPixels`, Dialog and Progress only if a current consumer is added, otherwise remove them with their tests/stories.
- [ ] Run full verification and commit task paths.
