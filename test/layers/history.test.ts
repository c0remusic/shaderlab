import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { History } from "../../src/layers/history";

describe("History", () => {
  it("undo returns the previous state", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const withLayer = initial.clone();
    withLayer.addLayer("glow");
    history.push(withLayer);

    const undone = history.undo();
    expect(undone?.layers).toHaveLength(0);
  });

  it("redo restores the undone state", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const withLayer = initial.clone();
    withLayer.addLayer("glow");
    history.push(withLayer);

    history.undo();
    const redone = history.redo();
    expect(redone?.layers).toHaveLength(1);
  });

  it("canUndo/canRedo reflect stack position", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    expect(history.canUndo()).toBe(false);
    expect(history.canRedo()).toBe(false);

    const withLayer = initial.clone();
    withLayer.addLayer("glow");
    history.push(withLayer);
    expect(history.canUndo()).toBe(true);

    history.undo();
    expect(history.canRedo()).toBe(true);
  });

  it("pushing after an undo discards the redo branch", () => {
    const initial = new LayerStack();
    const history = new History(initial);
    const a = initial.clone();
    a.addLayer("glow");
    history.push(a);
    history.undo();

    const b = initial.clone();
    b.addLayer("grain");
    history.push(b);
    expect(history.canRedo()).toBe(false);
  });
});
