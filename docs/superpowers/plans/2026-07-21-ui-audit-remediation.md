# UI Audit Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the image editor readable and predictable at desktop scale: human-facing effect controls, a clear empty workspace, visible image bounds, a geometrically correct dock, and consistent interaction feedback.

**Architecture:** Keep rendering and layer state untouched except for the existing mask-source `enabled` flag. Consolidate control presentation around the existing native `src/ui/Slider`, move popup positioning into reusable pure helpers, and make `App.tsx` publish the dock's measured reserved width to both the dock and canvas. The pre-existing dock reorder and dock width plans remain prerequisites; this plan integrates their final interfaces instead of overwriting their uncommitted work.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, CSS custom properties, Base UI/shadcn only where already used, Tauri/WebView2 for the final live checkpoint.

## Global Constraints

- Start execution only after checking `git worktree list`, `git status --short`, `.superpowers/sdd/progress.md`, and the real completion state of `2026-07-21-shaderlab-dock-reorder-and-theme-polish.md` plus `2026-07-21-shaderlab-dock-width-resize.md`.
- Preserve all unrelated dirty files. Every commit uses an explicit pathspec.
- No React component rendering tests: test pure functions with Vitest; validate UI through the real WebView2 window and a human checkpoint, never Playwright headless.
- Keep color, spacing, z-index, radius, shadow and typography values in `src/design/*.css`; `npm run lint:tokens` must remain clean.
- Keep the large mask raster outside React state. This UI work must not pass `maskData` through props or new React state.
- Text visible to the user is French; implementation identifiers and WGSL parameter keys remain stable English identifiers.
- The custom drag handle and resize handle must not capture clicks from collapse, delete, select, slider, checkbox, or menu controls.

---

## File structure

**Create**

- `src/ui/sliderMath.ts` — pure progress and display helpers for the calibrated native slider.
- `src/components/dockedPanel/dockMetrics.ts` — pure reserved-width calculation for a multi-column dock.
- `src/components/EmptyWorkspace.tsx` — accessible empty workspace call-to-action.
- `test/ui/sliderMath.test.ts` — slider arithmetic coverage.
- `test/components/dockedPanel/dockMetrics.test.ts` — dock geometry coverage.
- `test/layers/layerStack.maskSourceEnabled.test.ts` — per-source mask enablement coverage.

**Modify**

- `src/render/effects/types.ts` and each module in `src/render/effects/` — stable parameter key plus French UI label, unit and optional explanatory hint.
- `src/ui/Slider.tsx`, `src/ui/controls.css`, `src/components/BrushToolbar.tsx` — one slider primitive, filled track and readable values.
- `src/components/Canvas.tsx`, `src/components/Canvas.css`, `src/App.tsx`, `src/App.css` — empty state, drag-over feedback, canvas mat and shared dock reservation.
- `src/components/dockedPanel/{PanelColumn,DockedPanelCard}.{tsx,css}`, `src/ui/dragReorder.css` — dock geometry, movement threshold, explicit grip, visible insertion target and one scroll owner.
- `src/ui/{Menu,overlays}.tsx` and `.css` — portalled, viewport-safe action menu with the shared popover elevation.
- `src/layers/{types,layerStack}.ts`, `src/components/ParamPanel.tsx`, `src/components/ParamPanel.css`, `src/components/LayerPanel.tsx`, `src/components/LayerPanel.css` — per-source mask enablement, human hierarchy and compact layer metadata.
- `src/components/Toolbar.tsx`, `src/design/reset.css`, `src/components/ErrorBanner.tsx`, stale CSS/TS comments — first-run command hierarchy, valid global type declaration and system cleanup.
- `docs/INDEX.json` — register this plan.

### Task 1: Effect metadata and human-readable parameter controls

**Files:**
- Modify: `src/render/effects/types.ts`, `src/render/effects/chromaticBleed.ts`, `src/render/effects/glow.ts`, `src/render/effects/warp.ts`, `src/render/effects/grain.ts`, `src/components/ParamPanel.tsx`, `src/ui/Slider.tsx`
- Test: `test/render/effects/registry.test.ts`

**Interfaces:**
- Produces `EffectParam` fields `label: string`, `unit?: "percent" | "pixels" | "degrees" | "none"`, and `hint?: string`; `name` remains the renderer key.
- `ParamPanel` consumes `label`, `unit`, and `hint` without changing `layer.params` keys.

- [ ] **Step 1: Add failing registry expectations**

```ts
it("exposes French UI metadata without changing shader parameter keys", () => {
  const effect = getEffect("chromaticBleed");
  expect(effect.params).toEqual(expect.arrayContaining([
    expect.objectContaining({ name: "amount", label: "Décalage chromatique", unit: "percent" }),
    expect.objectContaining({ name: "centerFalloff", label: "Atténuation centrale", unit: "none" }),
  ]));
});
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- registry`

Expected: FAIL because `label` and `unit` do not yet exist.

- [ ] **Step 3: Add metadata and pass it to controls**

```ts
export interface EffectParam {
  name: string;
  label: string;
  unit?: "percent" | "pixels" | "degrees" | "none";
  hint?: string;
  min: number;
  max: number;
  default: number;
  step: number;
}

// ParamPanel.tsx
<Slider
  label={p.label}
  displayValue={formatEffectParamValue(layer.params[p.name] ?? p.default, p)}
  title={p.hint}
  min={p.min}
  max={p.max}
  step={p.step}
  onChange={(value) => onParamChange(layer.id, { [p.name]: value })}
  onCommit={onParamCommit}
/>
```

Define `formatEffectParamValue(value, param)` next to `paramRange`: percent units render `Math.round(value * 100) + " %"`; pixels render the calibrated number plus ` px`; degrees render `Math.round(value) + "°"`; `none` uses `formatControlValue(value, param.step)`.

- [ ] **Step 4: Fill every existing effect module with deliberate copy**

Use these labels: Glow: `Seuil`, `Intensité`; Chromatic bleed: `Décalage chromatique`, `Atténuation centrale`; Warp: `Échelle`, `Amplitude`, `Détails`, `Graine`; Grain: `Intensité`, `Taille`, `Graine`. Set units respectively to percent/none, percent/none, none/percent/none/none, percent/pixels/none. Keep each original `name` unchanged.

- [ ] **Step 5: Run verification**

Run: `npm run test -- registry; npx tsc --noEmit`

Expected: focused registry tests and TypeScript pass.

- [ ] **Step 6: Commit**

```powershell
git commit -m "feat(ui): add human-readable effect parameter metadata" -- src/render/effects/types.ts src/render/effects/chromaticBleed.ts src/render/effects/glow.ts src/render/effects/warp.ts src/render/effects/grain.ts src/components/ParamPanel.tsx src/ui/Slider.tsx test/render/effects/registry.test.ts
```

### Task 2: One readable slider system

**Files:**
- Create: `src/ui/sliderMath.ts`
- Modify: `src/ui/Slider.tsx`, `src/ui/controls.css`, `src/components/BrushToolbar.tsx`
- Test: `test/ui/sliderMath.test.ts`

**Interfaces:**
- Produces `sliderProgress(value: number, min: number, max: number): number`, always clamped to `[0, 100]`.
- `Slider` publishes `--slider-progress` on its native input and accepts `label`, `displayValue`, and existing callbacks.

- [ ] **Step 1: Write the failing pure tests**

```ts
import { expect, describe, it } from "vitest";
import { sliderProgress } from "../../src/ui/sliderMath";

describe("sliderProgress", () => {
  it.each([[0, 0], [0.5, 50], [1, 100], [-1, 0], [2, 100]])("maps %s to %s%%", (value, expected) => {
    expect(sliderProgress(value, 0, 1)).toBe(expected);
  });
  it("returns zero for a degenerate range", () => {
    expect(sliderProgress(3, 3, 3)).toBe(0);
  });
});
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- sliderMath`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement slider arithmetic and CSS progress**

```ts
export function sliderProgress(value: number, min: number, max: number): number {
  if (max <= min) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}
```

```tsx
const progress = sliderProgress(value, min, max);
<input
  /* existing range props */
  style={{ "--slider-progress": `${progress}%` } as React.CSSProperties}
/>
```

```css
.ui-slider__input::-webkit-slider-runnable-track {
  background: linear-gradient(to right, var(--action-primary-bg) 0 var(--slider-progress), var(--border-default) var(--slider-progress) 100%);
}
```

Mirror the same gradient on `::-moz-range-track`. Keep the thumb 12px and increase the visual rail to `var(--space-2)` through the existing `--slider-track-height` token.

- [ ] **Step 4: Replace the brush-specific Base UI slider**

Replace both `components/ui/slider` imports with `../ui/Slider`; pass `label="Taille"`, `displayValue={`${Math.round(brushSize)} px`}`, `min={2}`, `max={200}`, `onChange={onBrushSizeChange}` and equivalent hardness props with `displayValue={`${Math.round(brushHardness * 100)} %`}`. Remove the Tailwind `text-xs` labels because `Slider` owns its label/value row.

- [ ] **Step 5: Run verification**

Run: `npm run test -- sliderMath; npx tsc --noEmit; npm run lint:tokens`

Expected: all commands pass and no hardcoded design values are reported.

- [ ] **Step 6: Commit**

```powershell
git commit -m "fix(ui): unify sliders with visible progress and values" -- src/ui/sliderMath.ts src/ui/Slider.tsx src/ui/controls.css src/components/BrushToolbar.tsx test/ui/sliderMath.test.ts
```

### Task 3: Empty workspace, file drop feedback and image mat

**Files:**
- Create: `src/components/EmptyWorkspace.tsx`
- Modify: `src/components/Canvas.tsx`, `src/components/Canvas.css`, `src/App.tsx`

**Interfaces:**
- `Canvas` consumes `hasImage: boolean` and `onOpenFile: () => void`.
- `EmptyWorkspace` consumes `onOpenFile: () => void` and provides the primary opening action; file dropping remains handled by `Canvas`.

- [ ] **Step 1: Add the explicit Canvas props and compile**

```ts
interface Props {
  onFileDropped: (file: File) => void;
  onOpenFile: () => void;
  hasImage: boolean;
  // existing painting props
}
```

Pass `hasImage={imageSize.width > 0 && imageSize.height > 0}` and `onOpenFile={handleOpenFile}` from `App.tsx`.

- [ ] **Step 2: Implement the empty-state component**

```tsx
import { FolderOpen } from "lucide-react";
import { Button } from "../ui/Button";

export function EmptyWorkspace({ onOpenFile }: { onOpenFile: () => void }) {
  return <div className="empty-workspace">
    <h1 className="empty-workspace__title">Ouvrir une photo</h1>
    <p className="empty-workspace__description">Dépose un JPEG ici ou choisis un fichier pour commencer.</p>
    <Button variant="primary" onClick={onOpenFile}><FolderOpen size={16} aria-hidden="true" />Ouvrir une image</Button>
  </div>;
}
```

Render it inside `.canvas-stage` only when `!hasImage`; add `dragActive` state in `Canvas` using `onDragEnter`, `onDragLeave`, and `onDrop`, then apply `.canvas-stage--drag-active` while files are over the stage.

- [ ] **Step 3: Add the workspace geometry CSS**

Give `.canvas-stage` `padding: var(--space-6) calc(var(--dock-reserved-width, var(--inspector-width-default)) + var(--space-6)) var(--space-6) var(--space-6);`. Give `.canvas-stage__canvas` `box-shadow: 0 0 0 1px var(--border-default); background: var(--surface-inset);`. Add a subtle `outline` or `box-shadow` on `.canvas-stage--drag-active`, using `--focus-color`; do not use a new literal color.

- [ ] **Step 4: Repair painting cancellation**

Add `onPointerCancel={endStroke}` to the canvas and call `updateCursor` in a `useEffect` when `maskPaintMode` changes from false to true and a prior pointer position exists.

- [ ] **Step 5: Run verification**

Run: `npx tsc --noEmit; npm run build; npm run lint:tokens`

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git commit -m "feat(ui): add guided empty workspace and framed canvas" -- src/components/EmptyWorkspace.tsx src/components/Canvas.tsx src/components/Canvas.css src/App.tsx
```

### Task 4: Dock geometry and scrolling ownership

**Files:**
- Create: `src/components/dockedPanel/dockMetrics.ts`
- Modify: `src/App.tsx`, `src/components/dockedPanel/PanelColumn.tsx`, `src/components/dockedPanel/PanelColumn.css`, `src/components/dockedPanel/DockedPanelCard.css`, `src/components/Canvas.css`
- Test: `test/components/dockedPanel/dockMetrics.test.ts`

**Interfaces:**
- Consumes the final `width` and `onWidthChange` props from the width-resize plan.
- Produces `getDockReservedWidth(columnCount: number, columnWidth: number, columnGap: number): number` and a single CSS property `--dock-reserved-width` on `.workspace`.

- [ ] **Step 1: Write the failing geometry tests**

```ts
import { expect, describe, it } from "vitest";
import { getDockReservedWidth } from "../../../src/components/dockedPanel/dockMetrics";

describe("getDockReservedWidth", () => {
  it("reserves one column", () => expect(getDockReservedWidth(1, 320, 8)).toBe(320));
  it("includes each inter-column gap", () => expect(getDockReservedWidth(3, 320, 8)).toBe(976));
  it("does not return a negative reservation", () => expect(getDockReservedWidth(0, 320, 8)).toBe(0));
});
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- dockMetrics`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement and publish one reservation value**

```ts
export function getDockReservedWidth(columnCount: number, columnWidth: number, columnGap: number): number {
  if (columnCount <= 0) return 0;
  return columnCount * columnWidth + (columnCount - 1) * columnGap;
}
```

In `App.tsx`, calculate from `dockLayout.length`, `dockWidth`, and the numeric 8px value represented by `--space-4`; set `--dock-reserved-width` on `.workspace`. Do not maintain separate canvas and dock width state.

- [ ] **Step 4: Make the dock fit its actual workspace**

Set `.panel-column` `top`, `right`, and `bottom` to `var(--space-6)`; set `.panel-column__grid` to `height: 100%; max-height: none; overflow-x: auto; overflow-y: hidden`; set `.panel-column__stack` to `height: 100%; max-height: none; overflow-y: auto`. Remove `max-height: 42vh` from card content so the stack is the sole vertical scroll owner.

- [ ] **Step 5: Reconcile collapsed panels**

Reserve a column's configured width while any card remains in that column. Do not change the reservation on collapse; this prevents the image from jumping as a panel opens and closes.

- [ ] **Step 6: Run verification**

Run: `npm run test -- dockMetrics; npx tsc --noEmit; npm run build`

Expected: all commands pass.

- [ ] **Step 7: Commit**

```powershell
git commit -m "fix(ui): reserve canvas space for the real dock geometry" -- src/components/dockedPanel/dockMetrics.ts src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css src/components/dockedPanel/DockedPanelCard.css src/components/Canvas.css src/App.tsx test/components/dockedPanel/dockMetrics.test.ts
```

### Task 5: Portalled action menus and consistent elevation

**Files:**
- Modify: `src/ui/Menu.tsx`, `src/ui/overlays.css`
- Test: `test/ui/selectPlacement.test.ts`

**Interfaces:**
- `Menu` consumes the existing `computeListboxPlacement` helper and `LISTBOX_MAX_HEIGHT = 240` convention.
- The menu popup becomes a `createPortal(..., document.body)` fixed popup and never relies on parent overflow.

- [ ] **Step 1: Add placement cases to the existing pure test**

```ts
it("places a popup above when it would exceed the viewport", () => {
  expect(computeListboxPlacement({ top: 740, bottom: 770, left: 10, width: 160 }, 800, 4, 240))
    .toMatchObject({ bottom: 64, left: 10, width: 160 });
});
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- selectPlacement`

Expected: PASS before the menu migration; this protects the existing placement contract.

- [ ] **Step 3: Migrate Menu to the Select positioning pattern**

Add `triggerRef`, `menuRef`, `menuRect`, `createPortal`, open-time measurement, outside-pointer dismissal, resize/scroll dismissal and focus transfer. Render the menu with `position: fixed`, inline `left`, `width`, and `top` or `bottom` from `computeListboxPlacement`.

- [ ] **Step 4: Make popup depth consistent**

Replace `.ui-menu__list` absolute positioning with the fixed popup rules used by `.ui-select__listbox`, retaining role `menu`; add `box-shadow: var(--shadow-popover)` and `max-height` with `overflow-y: auto`.

- [ ] **Step 5: Run verification**

Run: `npm run test -- selectPlacement; npx tsc --noEmit; npm run lint:tokens`

Expected: all commands pass.

- [ ] **Step 6: Commit**

```powershell
git commit -m "fix(ui): portal action menus outside scrollable panels" -- src/ui/Menu.tsx src/ui/overlays.css test/ui/selectPlacement.test.ts
```

### Task 6: Deliberate dock drag interaction

**Files:**
- Create: `src/components/dockedPanel/dockDrag.ts`
- Modify: `src/components/dockedPanel/PanelColumn.tsx`, `src/components/dockedPanel/PanelColumn.css`, `src/components/dockedPanel/DockedPanelCard.tsx`, `src/ui/dragReorder.css`
- Test: `test/components/dockedPanel/dockDrag.test.ts`

**Interfaces:**
- Produces `hasExceededDragThreshold(origin, point, threshold = 4): boolean`.
- `PanelColumn` keeps a pending pointer on down and only creates `DockDragState` after the threshold is exceeded.

- [ ] **Step 1: Write threshold tests**

```ts
expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 13, y: 12 })).toBe(false);
expect(hasExceededDragThreshold({ x: 10, y: 10 }, { x: 15, y: 10 })).toBe(true);
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- dockDrag`

Expected: FAIL because the helper does not exist.

- [ ] **Step 3: Implement thresholded dragging and a real grip**

Use `Math.hypot(point.x - origin.x, point.y - origin.y) >= threshold`. Move `onPointerDown` from the whole titlebar to a button-like grip element with `aria-label="Réorganiser le panneau"`; stop propagation on the collapse control. Give the grip `cursor: grab`, `cursor: grabbing` while active, and replace the ambiguous dotted ellipsis with `GripVertical` from Lucide.

- [ ] **Step 4: Strengthen drop feedback**

Set the horizontal chip to `width: var(--space-3); height: calc(var(--space-8) * 2);`, use `z-index: var(--z-tooltip)` for the chip and `z-index: var(--z-popover)` for the ghost. Keep the existing oval vertical chip.

- [ ] **Step 5: Run verification**

Run: `npm run test -- dockDrag; npx tsc --noEmit`

Expected: tests and type-check pass.

- [ ] **Step 6: Commit**

```powershell
git commit -m "fix(ui): make dock reordering deliberate and legible" -- src/components/dockedPanel/dockDrag.ts src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css src/components/dockedPanel/DockedPanelCard.tsx src/ui/dragReorder.css test/components/dockedPanel/dockDrag.test.ts
```

### Task 7: Mask and layer hierarchy

**Files:**
- Modify: `src/mask/types.ts`, `src/layers/layerStack.ts`, `src/components/ParamPanel.tsx`, `src/components/ParamPanel.css`, `src/components/LayerPanel.tsx`, `src/components/LayerPanel.css`, `src/App.tsx`
- Test: `test/layers/layerStack.maskSourceEnabled.test.ts`

**Interfaces:**
- `MaskSource` has `enabled: boolean` defaulting to `true` for all existing and newly created sources.
- `LayerStack.setMaskSourceEnabled(layerId: string, sourceId: string, enabled: boolean): void` is pure-state compatible with history.
- `ParamPanel` receives `onMaskSourceEnabledChange(layerId, sourceId, enabled)`.

- [ ] **Step 1: Write the failing LayerStack tests**

```ts
it("toggles only the requested mask source", () => {
  const stack = stackWithGradientAndLuminosity();
  const [gradient, luminosity] = stack.layers[0].mask.sources;
  stack.setMaskSourceEnabled(stack.layers[0].id, gradient.id, false);
  expect(stack.layers[0].mask.sources).toEqual([
    expect.objectContaining({ id: gradient.id, enabled: false }),
    expect.objectContaining({ id: luminosity.id, enabled: true }),
  ]);
});
```

- [ ] **Step 2: Run the focused test**

Run: `npm run test -- maskSourceEnabled`

Expected: FAIL because the setter and source field do not exist.

- [ ] **Step 3: Add the state API and propagate it to mask folding**

Set `enabled: true` in every source constructor. `setMaskSourceEnabled` must clone only the requested source. In the existing source-fold plan, skip disabled sources exactly as an absent source; if all sources are disabled, use the neutral no-op mask value. Preserve brush source behavior.

- [ ] **Step 4: Render compact source controls and layer metadata**

Add an individual `Checkbox` labelled `Activer {module.name}` before each source name. Keep source mode and delete in a second row at widths below the dock minimum. In `LayerPanel`, add text badges only when meaningful: `Masque`, blend mode name when not `Normal`, and `{Math.round(opacity * 100)} %` when opacity is not 100. Do not generate texture thumbnails.

- [ ] **Step 5: Remove duplicated hierarchy and promote the mode action**

Remove the duplicate `<h3>` effect name from `ParamPanel`. Make `Peindre le masque` `variant="primary"`; render its active-mode hint with `role="status"`. Give disclosure titles `font-weight: var(--font-weight-semibold)` and use `--text-secondary` for secondary labels.

- [ ] **Step 6: Run verification**

Run: `npm run test -- maskSourceEnabled; npx tsc --noEmit; npm run lint:tokens`

Expected: all commands pass.

- [ ] **Step 7: Commit**

```powershell
git commit -m "feat(ui): make mask sources and layer state legible" -- src/mask/types.ts src/layers/layerStack.ts src/components/ParamPanel.tsx src/components/ParamPanel.css src/components/LayerPanel.tsx src/components/LayerPanel.css src/App.tsx test/layers/layerStack.maskSourceEnabled.test.ts
```

### Task 8: Toolbar, typography, error state and cleanup

**Files:**
- Modify: `src/components/Toolbar.tsx`, `src/design/reset.css`, `src/components/ErrorBanner.tsx`, `src/components/LayerPanel.css`, `src/components/ParamPanel.css`, `src/components/Canvas.css`, `src/ui/Select.tsx`

**Interfaces:**
- Toolbar adds a visible `onOpenFile` command while preserving the existing File dropdown for export.
- No new application state or rendering APIs are introduced.

- [ ] **Step 1: Make the first-run command explicit**

Add a visible secondary toolbar button with `FolderOpen` and label `Ouvrir`; keep Exporter in the Fichier menu. Add a `ChevronDown` next to the Fichier trigger so it reads as a menu. Do not duplicate the opening operation in two hidden paths: both buttons call the existing `onOpenFile` callback.

- [ ] **Step 2: Repair global type inheritance**

Replace the invalid reset declaration with:

```css
body {
  background: var(--surface-workspace);
  color: var(--text-primary);
  font-family: var(--font-ui);
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 3: Align the remaining UI family**

Style `ErrorBanner` using semantic status tokens already present (`--status-danger-bg`, `--status-danger-text`, `--status-danger`) rather than a generic destructive Tailwind foreground. Keep it full-width and borderless. Delete stale `FloatingPanel` / `effectiveViewport` comments in the listed files only after verifying their replacement references point to `PanelColumn` or the shared dock CSS variable.

- [ ] **Step 4: Run verification**

Run: `npx tsc --noEmit; npm run build; npm run lint:tokens`

Expected: all commands pass.

- [ ] **Step 5: Commit**

```powershell
git commit -m "fix(ui): clarify toolbar hierarchy and align shared states" -- src/components/Toolbar.tsx src/design/reset.css src/components/ErrorBanner.tsx src/components/LayerPanel.css src/components/ParamPanel.css src/components/Canvas.css src/ui/Select.tsx
```

### Task 9: Full verification and human visual gate

**Files:**
- Modify: `docs/INDEX.json` only if status text changes after completion.

- [ ] **Step 1: Run the complete automated suite**

Run: `npm run test; npx tsc --noEmit; npm run build; npm run lint:tokens; cd src-tauri; cargo check`

Expected: all commands pass.

- [ ] **Step 2: Start and monitor the real desktop app safely**

Run `Get-Process -Name shaderlab -ErrorAction SilentlyContinue` first. If no other development instance must be preserved, run `npm run dev:debug`, then `npm run dev:monitor` and inspect real output before declaring launch success.

- [ ] **Step 3: Perform the CDP structural check**

With the real WebView2 at port 9222, verify: empty-state CTA exists; drag-over class toggles; loaded image has a visible boundary; dock reservation equals the number of columns; menu opens outside a scrollable panel; one source checkbox exists per source; sliders expose the expected text values; no `Runtime.exceptionThrown` is emitted.

- [ ] **Step 4: Human visual checkpoint**

Ask the user to validate, on a loaded high-contrast JPEG at the target window size: image edge readability; canvas centering with one and two dock columns; slider readability; open/drag/reorder feedback; empty workspace; opened source menu; active mask mode; French labels and values. Record each item as accepted or rejected in the task report before proceeding.

- [ ] **Step 5: Commit documentation index only if it changed**

```powershell
git commit -m "docs: record completed UI remediation plan" -- docs/INDEX.json
```

## Self-review

- Coverage: Tasks 1–2 resolve technical labels, units, values and the two-slider inconsistency. Task 3 resolves empty state, drag-over feedback, image bounds and paint cancellation. Task 4 resolves dock reservation, layout and nested scroll. Tasks 5–6 resolve clipped menus and ambiguous dragging. Task 7 resolves per-source enablement, mask hierarchy, selected-layer scanability and duplicate titles. Task 8 resolves toolbar hierarchy, invalid font inheritance, error-state divergence and stale implementation references. Task 9 is the mandatory live proof.
- Deliberate exclusions: changing the shader algorithms, adding layer texture thumbnails, a document tab/filmstrip/zoom system, keyboard reordering, and Dialog elevation are separate product work, not necessary to correct the audited regressions.
- Placeholder scan: no deferred implementation markers are used; each task names exact interfaces, files, commands and expected outcomes.
- Type consistency: `EffectParam.label`, `sliderProgress`, `getDockReservedWidth`, `setMaskSourceEnabled`, and `onMaskSourceEnabledChange` are introduced once and consumed by the named subsequent tasks.
