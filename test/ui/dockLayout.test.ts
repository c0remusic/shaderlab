import { describe, expect, it } from "vitest";
import { getDockDropTarget, movePanelInDock, resolveDockDragCommit, type DockLayout } from "../../src/ui/dockLayout";

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

  it("keeps a single-card column unchanged when dropped on itself", () => {
    const singleCards: DockLayout = [["layers"], ["params"]];
    expect(movePanelInDock(singleCards, "layers", { kind: "vertical", columnIndex: 0, rowIndex: 0, position: "before" }))
      .toBe(singleCards);
    expect(movePanelInDock(singleCards, "layers", { kind: "horizontal", columnIndex: 0, position: "right" }))
      .toBe(singleCards);
  });

  it("keeps adjacent vertical drops unchanged", () => {
    const stack: DockLayout = [["layers", "params"]];
    expect(movePanelInDock(stack, "layers", { kind: "vertical", columnIndex: 0, rowIndex: 1, position: "before" })).toBe(stack);
    expect(movePanelInDock(stack, "params", { kind: "vertical", columnIndex: 0, rowIndex: 0, position: "after" })).toBe(stack);
  });

  it("returns the original layout when the panel id is absent", () => {
    expect(movePanelInDock(layout, "missing", { kind: "horizontal", columnIndex: 0, position: "left" })).toBe(layout);
  });
});

describe("getDockDropTarget", () => {
  it("reserves the left edge and inner right edges for horizontal docking", () => {
    expect(getDockDropTarget(1, 0, 0.14, 0.5)).toEqual({ kind: "horizontal", columnIndex: 1, position: "left" });
    expect(getDockDropTarget(1, 0, 0.86, 0.5)).toEqual({ kind: "horizontal", columnIndex: 1, position: "right" });
  });

  it("does not offer a new column beyond the rightmost dock column", () => {
    expect(getDockDropTarget(1, 0, 0.86, 0.25, true)).toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" });
  });

  it("gives vertical reordering the majority of the card width", () => {
    expect(getDockDropTarget(1, 0, 0.2, 0.25)).toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" });
  });
});

describe("resolveDockDragCommit", () => {
  const target = { kind: "vertical", columnIndex: 0, rowIndex: 1, position: "before" } as const;
  const earlierTarget = { kind: "horizontal", columnIndex: 0, position: "left" } as const;

  it("commits the LATEST target recorded before release, not an earlier one", () => {
    // Simule le pattern ref-sync : le ref est mis à jour à chaque pointermove
    // (dernier appel = earlierTarget puis target), le release doit prendre
    // le dernier état lu, pas un état capturé plus tôt dans le geste.
    const dragAfterFirstMove = { draggedId: "layers", pointerId: 7, target: earlierTarget };
    const dragAfterLatestMove = { draggedId: "layers", pointerId: 7, target };
    // Un ancien snapshot ne doit jamais être ce qui est commité.
    expect(resolveDockDragCommit(dragAfterFirstMove, 7, true)).not.toEqual(
      resolveDockDragCommit(dragAfterLatestMove, 7, true)
    );
    expect(resolveDockDragCommit(dragAfterLatestMove, 7, true)).toEqual({ draggedId: "layers", target });
  });

  it("returns null when releasing a pointer id that does not match the drag", () => {
    expect(resolveDockDragCommit({ draggedId: "layers", pointerId: 7, target }, 9, true)).toBeNull();
  });

  it("returns null on cancel (commit=false) even with a valid target", () => {
    expect(resolveDockDragCommit({ draggedId: "layers", pointerId: 7, target }, 7, false)).toBeNull();
  });

  it("returns null when there is no drop target yet", () => {
    expect(resolveDockDragCommit({ draggedId: "layers", pointerId: 7, target: null }, 7, true)).toBeNull();
  });

  it("returns null when there is no drag in progress", () => {
    expect(resolveDockDragCommit(null, 7, true)).toBeNull();
  });
});
