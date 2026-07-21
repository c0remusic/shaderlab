# Design System Unification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Base UI/Tailwind primitives the single interactive UI system and remove the legacy UI implementation.

**Architecture:** Add equivalent primitives to `src/components/ui`, migrate the two panel consumers without changing domain callbacks, then remove `src/ui` visual primitives and styles. Keep pure layout/reorder helpers under `src/ui` only when they are not UI components.

**Tech Stack:** React 19, TypeScript, Base UI 1.6, Tailwind v4, Vitest.

## Global Constraints

- Keep `src/design/{primitives,semantic,components}.css` as the source of visual values.
- Keep `src/ui/dockLayout.ts`, `src/ui/dragReorder.ts`, `src/ui/activeControl.ts` and other pure helpers; delete only legacy interactive primitives and their CSS.
- Do not change layer, mask, history or renderer business logic.
- Preserve keyboard operation, disabled states, labels and callbacks of migrated controls.
- Require `npx tsc --noEmit`, `npm run lint:tokens`, `npm run test` and `npm run build` to pass.

---

### Task 1: Commit the audited token baseline and repair the build input

**Files:**
- Create: `src/ui/dragReorder.css`
- Modify: audited files already changed in `src/design/*`, `src/components/ui/*`, `src/ui/{Select,actions,overlays}.tsx|css`

- [ ] Stage the existing token, contrast, control-state and Select token changes.
- [ ] Add `dragReorder.css` with the existing insertion-chip style, replacing its literal opacity with a component token.
- [ ] Run `npx tsc --noEmit`, `npm run lint:tokens`, `npm run test`, and `npm run build`.
- [ ] Commit with `fix(design): repair token system baseline`.

### Task 2: Add missing Base UI primitives

**Files:**
- Create: `src/components/ui/{checkbox,select,collapsible,icon-button,tooltip}.tsx`
- Modify: `src/design/{components,tailwind-theme}.css`

- [ ] Define controlled checkbox, labeled select, disclosure, icon button and tooltip APIs that cover the current `src/ui/*` consumer props.
- [ ] Use the installed Base UI modules (`checkbox`, `select`, `collapsible`, `tooltip`) and token-backed Tailwind classes.
- [ ] Add icon utility classes backed by `--icon-size-sm`, `--icon-size-md`, `--icon-size-lg` and `--icon-stroke`.
- [ ] Add focused unit tests for pure adapters only; preserve the project convention of no React rendering tests unless an adapter needs one.
- [ ] Run TypeScript and focused tests; commit with `feat(ui): add shared base primitives`.

### Task 3: Migrate panel consumers and icon sizing

**Files:**
- Modify: `src/components/{LayerPanel,ParamPanel,Toolbar,BrushToolbar,ErrorBanner}.tsx`
- Modify: `src/components/dockedPanel/DockedPanelCard.tsx`
- Modify: `src/ui/{Dialog,Disclosure,Menu,Select,Checkbox,IconButton}.tsx` only if a pure helper must move

- [ ] Replace imports of legacy interactive primitives in LayerPanel and ParamPanel with `src/components/ui/*`.
- [ ] Preserve every existing callback name and commit timing, including slider commit callbacks, mask source menu actions and layer reorder actions.
- [ ] Replace every Lucide numeric size/stroke prop with the new token-backed icon classes.
- [ ] Run TypeScript and the existing LayerPanel, ParamPanel, select-navigation and dock-layout tests.
- [ ] Commit with `refactor(ui): migrate panel controls to base primitives`.

### Task 4: Retire the legacy visual system

**Files:**
- Delete: `src/ui/{Button,Checkbox,Dialog,Disclosure,IconButton,Menu,Progress,Select,Slider,Tooltip}.tsx`
- Delete: `src/ui/{actions,controls,dialog,overlays}.css`
- Modify: `src/design/index.css`
- Modify: remaining imports and stories affected by deleted files

- [ ] Confirm with `rg` that no consumer imports a deleted legacy primitive.
- [ ] Remove legacy CSS imports from `src/design/index.css`.
- [ ] Delete only visual primitives; retain pure state/layout/reorder helpers under `src/ui`.
- [ ] Run full TypeScript, token lint, test suite and production build.
- [ ] Commit with `refactor(ui): remove legacy control system`.

### Task 5: Final design-system audit

**Files:**
- Modify only if audit reveals a concrete defect.

- [ ] Check CSS custom-property references, raw visual literals, icon props, stale FloatingPanel source comments and imports of deleted legacy primitives.
- [ ] Fix every concrete finding within this plan’s scope.
- [ ] Run `npx tsc --noEmit`, `npm run lint:tokens`, `npm run test`, `npm run build` and `git diff --check`.
- [ ] Commit any audit correction with `fix(ui): complete design system migration`.
