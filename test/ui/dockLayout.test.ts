import { describe, expect, it } from "vitest";
import { getDockDropTarget, movePanelInDock, type DockLayout } from "../../src/ui/dockLayout";

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
  it("activates horizontal docking before the card edge", () => {
    expect(getDockDropTarget(1, 0, 0.39, 0.5)).toEqual({ kind: "horizontal", columnIndex: 1, position: "left" });
    expect(getDockDropTarget(1, 0, 0.61, 0.5)).toEqual({ kind: "horizontal", columnIndex: 1, position: "right" });
  });

  it("keeps the center of the card for vertical reordering", () => {
    expect(getDockDropTarget(1, 0, 0.5, 0.25)).toEqual({ kind: "vertical", columnIndex: 1, rowIndex: 0, position: "before" });
  });
});
