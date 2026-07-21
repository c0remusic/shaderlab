# Dock Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the existing Calques and Réglages cards be rearranged vertically or side-by-side in a fixed Photoshop-style dock.

**Architecture:** Replace the single `string[]` ordering with a pure two-dimensional layout (`string[][]`): columns run from left to right and each column contains cards from top to bottom. A pure layout helper owns all move semantics and is unit-tested; `PanelColumn` renders the grid and translates pointer hit zones into those semantics. The dock remains right-anchored, content-sized, and uses the existing insertion chip and drag ghost.

**Tech Stack:** React 19, TypeScript, CSS, Vitest pointer-event-independent unit tests.

## Global Constraints

- Do not add a fake Historique card: the repository only exposes the `History` undo/redo model, not a History UI panel.
- Preserve the content-sized card model; do not reintroduce the vertical `react-resizable-panels` splitter.
- Keep all colors and spacing tokenized with existing design tokens.
- Keep the existing shared `.drag-reorder__insert-chip` primitive for all vertical and horizontal insert affordances.
- Keep the dock right-anchored and preserve the Canvas compensation until the separate dock-width plan is explicitly resumed.
- No React rendering tests: test pure layout functions with Vitest.
- A task may only proceed after `npx tsc --noEmit` and `npm run test` pass.
- Commit each task with an explicit pathspec.

---

## File Structure

- `src/ui/dockLayout.ts`: pure immutable grid layout types and move operations.
- `test/ui/dockLayout.test.ts`: exhaustive placement behavior for the pure layout functions.
- `src/components/dockedPanel/PanelColumn.tsx`: grid rendering, pointer hit zones, ghost, and drop indicator.
- `src/components/dockedPanel/PanelColumn.css`: grid column geometry and horizontal indicator placement.
- `src/App.tsx`: replaces `panelOrder` with `dockLayout` and supplies cards in grid order.

### Task 1: Define and test immutable dock-grid moves

**Files:**
- Create: `src/ui/dockLayout.ts`
- Create: `test/ui/dockLayout.test.ts`

**Interfaces:**
- Produces `DockLayout = string[][]`, `DockDropTarget`, `movePanelInDock(layout, id, target)`.
- `DockDropTarget` is `{ kind: "vertical"; columnIndex: number; rowIndex: number; position: "before" | "after" } | { kind: "horizontal"; columnIndex: number; position: "left" | "right" }`.
- A horizontal drop creates one new single-card column. Empty source columns are removed.

- [ ] **Step 1: Write the failing tests**

Create `test/ui/dockLayout.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { movePanelInDock, type DockLayout } from "../../src/ui/dockLayout";

const layout: DockLayout = [["history"], ["layers", "params"]];

describe("movePanelInDock", () => {
  it("moves a card above another card in its column", () => {
    expect(movePanelInDock(layout, "params", { kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" }))
      .toEqual([["history"], ["params", "layers"]]);
  });

  it("moves a card into a new column on the left", () => {
    expect(movePanelInDock(layout, "params", { kind: "horizontal", columnIndex: 1, position: "left" }))
      .toEqual([["history"], ["params"], ["layers"]]);
  });

  it("moves a card into a new column on the right", () => {
    expect(movePanelInDock(layout, "layers", { kind: "horizontal", columnIndex: 0, position: "right" }))
      .toEqual([["history"], ["layers"], ["params"]]);
  });

  it("removes an empty source column after a horizontal move", () => {
    expect(movePanelInDock([["layers"], ["params"]], "layers", { kind: "horizontal", columnIndex: 1, position: "right" }))
      .toEqual([["params"], ["layers"]]);
  });

  it("returns the original layout when the panel id is absent", () => {
    expect(movePanelInDock(layout, "missing", { kind: "horizontal", columnIndex: 0, position: "left" })).toBe(layout);
  });
});
```

- [ ] **Step 2: Verify the tests fail**

Run: `npm run test -- test/ui/dockLayout.test.ts`

Expected: FAIL because `../../src/ui/dockLayout` does not exist.

- [ ] **Step 3: Implement the layout helper**

Create `src/ui/dockLayout.ts`:

```ts
export type DockLayout = string[][];

export type DockDropTarget =
  | { kind: "vertical"; columnIndex: number; rowIndex: number; position: "before" | "after" }
  | { kind: "horizontal"; columnIndex: number; position: "left" | "right" };

function findPanel(layout: DockLayout, id: string): { columnIndex: number; rowIndex: number } | null {
  for (let columnIndex = 0; columnIndex < layout.length; columnIndex += 1) {
    const rowIndex = layout[columnIndex].indexOf(id);
    if (rowIndex !== -1) return { columnIndex, rowIndex };
  }
  return null;
}

function removePanel(layout: DockLayout, id: string): DockLayout {
  return layout
    .map((column) => column.filter((panelId) => panelId !== id))
    .filter((column) => column.length > 0);
}

export function movePanelInDock(layout: DockLayout, id: string, target: DockDropTarget): DockLayout {
  if (!findPanel(layout, id)) return layout;
  const withoutPanel = removePanel(layout, id);
  const source = findPanel(layout, id)!;
  const removedColumnBeforeTarget = source.columnIndex < target.columnIndex && layout[source.columnIndex].length === 1;
  const columnIndex = target.columnIndex - (removedColumnBeforeTarget ? 1 : 0);

  if (target.kind === "horizontal") {
    const insertionIndex = columnIndex + (target.position === "right" ? 1 : 0);
    return [...withoutPanel.slice(0, insertionIndex), [id], ...withoutPanel.slice(insertionIndex)];
  }

  const column = withoutPanel[columnIndex];
  if (!column) return layout;
  const targetRow = target.rowIndex - (source.columnIndex === target.columnIndex && source.rowIndex < target.rowIndex ? 1 : 0);
  const insertionIndex = targetRow + (target.position === "after" ? 1 : 0);
  return [...withoutPanel.slice(0, columnIndex), [...column.slice(0, insertionIndex), id, ...column.slice(insertionIndex)], ...withoutPanel.slice(columnIndex + 1)];
}
```

- [ ] **Step 4: Verify the helper**

Run: `npm run test -- test/ui/dockLayout.test.ts && npx tsc --noEmit && npm run test`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git commit -m "feat: add pure dock grid layout operations" -- src/ui/dockLayout.ts test/ui/dockLayout.test.ts
```

### Task 2: Render a right-anchored multi-column dock

**Files:**
- Modify: `src/components/dockedPanel/PanelColumn.tsx`
- Modify: `src/components/dockedPanel/PanelColumn.css`

**Interfaces:**
- Consumes `DockLayout` and `DockDropTarget` from `src/ui/dockLayout.ts`.
- Changes `PanelColumnProps` to `{ panels: DockedPanelSpec[]; layout: DockLayout; onMove: (id: string, target: DockDropTarget) => void; }`.
- Produces pointer drops based on card hit zones: middle 50% X uses vertical before/after; outer 25% X uses horizontal left/right.

- [ ] **Step 1: Replace the list props and render columns**

In `PanelColumn.tsx`, import `DockDropTarget` and `DockLayout`, replace `onReorder` with `layout` plus `onMove`, and derive every displayed card from the layout rather than a flat array. Render this skeleton (preserving the existing `DockedPanelCard` content and ghost):

```tsx
<div className="panel-column" ...>
  <div className="panel-column__grid">
    {layout.map((column, columnIndex) => (
      <div className="panel-column__stack" key={column.join("-")}>
        {column.map((id, rowIndex) => {
          const panel = panels.find((candidate) => candidate.id === id);
          if (!panel) return null;
          return <DockedPanelCard key={panel.id} ...>{panel.content}</DockedPanelCard>;
        })}
      </div>
    ))}
  </div>
</div>
```

Set `data-dock-column` and `data-dock-row` on each card wrapper so the pointer hit-test can identify the target card and column.

- [ ] **Step 2: Add two-axis pointer target selection**

Keep pointer capture, ghost state, and the shared chip. On pointer move, use `document.elementFromPoint`, locate `[data-dock-column]`, measure its rectangle, then compute:

```ts
const x = (event.clientX - rect.left) / rect.width;
const target: DockDropTarget = x < .25
  ? { kind: "horizontal", columnIndex, position: "left" }
  : x > .75
    ? { kind: "horizontal", columnIndex, position: "right" }
    : { kind: "vertical", columnIndex, rowIndex, position: event.clientY - rect.top < rect.height / 2 ? "before" : "after" };
```

On matching `pointerup`, call `onMove(draggedId, target)` exactly once and clear the drag state. Keep `pointercancel` as an operation-free cancellation.

- [ ] **Step 3: Style columns and both chip axes**

Replace the single-stack styling with:

```css
.panel-column__grid {
  display: flex;
  align-items: flex-start;
  gap: var(--space-4);
  max-height: calc(100vh - (var(--space-6) * 2));
}

.panel-column__stack {
  display: flex;
  flex: 0 0 var(--inspector-width-default);
  flex-direction: column;
  gap: var(--space-4);
  max-height: inherit;
  overflow-y: auto;
}

.panel-column__insert-chip--horizontal {
  width: var(--space-2);
  height: var(--space-5);
  transform: translate(-50%, -50%);
}
```

Position the shared chip at the corresponding card top/bottom for vertical targets and left/right midpoint for horizontal targets. Do not duplicate its color, radius, shadow, or z-index styles.

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit && npm run test && npm run lint:tokens`

Expected: all commands exit 0.

- [ ] **Step 5: Commit**

```powershell
git commit -m "feat: render dock panels in movable columns" -- src/components/dockedPanel/PanelColumn.tsx src/components/dockedPanel/PanelColumn.css
```

### Task 3: Wire the grid layout into the application state

**Files:**
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes `DockLayout` and `movePanelInDock` from `src/ui/dockLayout.ts`.
- Passes `layout={dockLayout}` and `onMove={handlePanelMove}` to `PanelColumn`.

- [ ] **Step 1: Replace flat ordering state**

Replace the current state and callback:

```ts
const [panelOrder, setPanelOrder] = useState<string[]>(["layers", "params"]);
const handlePanelReorder = useCallback((id: string, newIndex: number) => {
  setPanelOrder((prev) => reorderById(prev, (panelId) => panelId, id, newIndex));
}, []);
```

with:

```ts
const [dockLayout, setDockLayout] = useState<DockLayout>([["layers", "params"]]);
const handlePanelMove = useCallback((id: string, target: DockDropTarget) => {
  setDockLayout((previous) => movePanelInDock(previous, id, target));
}, []);
```

Add the type and function imports from `./ui/dockLayout` and remove the unused `reorderById` import.

- [ ] **Step 2: Build a stable panel specification array**

Construct `const dockPanels = [...]` once in the render path, with the current Calques and Réglages specs unchanged. Replace `panelOrder.map(...)` with:

```tsx
<PanelColumn panels={dockPanels} layout={dockLayout} onMove={handlePanelMove} />
```

Do not add a Historique card or change the existing panel contents.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm run test && npm run lint:tokens`

Expected: all commands exit 0.

- [ ] **Step 4: Commit**

```powershell
git commit -m "feat: persist dock panels as a grid layout" -- src/App.tsx
```

### Task 4: Start the real app and hand off visual validation

**Files:**
- Modify: none

- [ ] **Step 1: Start and monitor the development app**

Run: `npm run dev:debug`

Then run: `npm run dev:monitor`

Expected: Vite and the Tauri application start with no error or WebView exception.

- [ ] **Step 2: Human checkpoint**

Stop after monitoring and ask a human to verify these exact interactions in the real WebView2 window:

1. Calques and Réglages still stack vertically on startup.
2. Dragging the title of one card over the left outer quarter of the other creates a left neighbor column.
3. Dragging over the right outer quarter creates a right neighbor column.
4. Dragging through the central upper/lower halves still moves a card above or below in its column.
5. The shared insertion pill appears in the gutter at vertical placement and on the card edge at horizontal placement.
6. The ghost follows the pointer without the canvas or panel controls receiving drag interactions.
7. Collapsed cards remain draggable and retain their collapsed state after moving.
8. No hard-coded color or spacing is visible in the dock UI.

Do not make visual-approval claims from automation or screenshots alone.
