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

  it("defensive cloning: mutations to pushed object don't affect stored snapshot", () => {
    const initial = new LayerStack();
    const history = new History(initial);

    // Push state1 with 1 layer
    const state1 = initial.clone();
    state1.addLayer("glow");
    history.push(state1);

    // Mutate the original object AFTER pushing (this would corrupt without defensive cloning)
    state1.addLayer("grain");
    expect(state1.layers).toHaveLength(2); // Original is mutated

    // Push another state to lock in the previous one
    const state2 = state1.clone();
    state2.addLayer("blur");
    history.push(state2);

    // Undo should restore state1 with 1 layer (glow), not the mutated 2 layers (glow + grain)
    const undone = history.undo();
    expect(undone?.layers).toHaveLength(1);
    expect(undone?.layers[0].effectId).toBe("glow");
  });

  it("defensive cloning: redo snapshot is not affected by mutations to the original pushed object", () => {
    const initial = new LayerStack();
    const history = new History(initial);

    // Push a state with 1 layer
    const state = initial.clone();
    state.addLayer("glow");
    history.push(state);

    // Undo to go back to initial
    history.undo();

    // Mutate the original object that was pushed
    state.addLayer("grain");
    expect(state.layers).toHaveLength(2);

    // Redo should restore the stored snapshot with 1 layer (glow), not the mutated 2 layers
    const redone = history.redo();
    expect(redone?.layers).toHaveLength(1);
    expect(redone?.layers[0].effectId).toBe("glow");
  });

  it("defensive cloning: returned state cannot corrupt history if mutated by caller", () => {
    const initial = new LayerStack();
    const history = new History(initial);

    // Set up: initial -> state1 -> state2
    const state1 = initial.clone();
    state1.addLayer("glow");
    history.push(state1);

    const state2 = state1.clone();
    state2.addLayer("grain");
    history.push(state2);

    // Undo to get state1
    const undone = history.undo();
    expect(undone?.layers).toHaveLength(1);

    // Mutate the returned state (caller discipline failure - should not affect history)
    if (undone) {
      undone.addLayer("blur");
      expect(undone.layers).toHaveLength(2);
    }

    // Redo should restore state2 (glow + grain), unaffected by the caller's mutation of undone
    const redone = history.redo();
    expect(redone?.layers).toHaveLength(2);
    expect(redone?.layers[0].effectId).toBe("glow");
    expect(redone?.layers[1].effectId).toBe("grain");
  });
});

describe("History byte budget", () => {
  function stackWithBrushMask(bytes: number): LayerStack {
    const s = new LayerStack();
    const id = s.addLayer("glow");
    s.updateBrushMask(id, new Uint8Array(bytes));
    return s;
  }

  it("counts unique mask rasters once even when shared across entries", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithBrushMask(100);
    history.push(a);
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b);
    expect(history.bytesUsed()).toBe(100);
  });

  it("evicts oldest past entries first when over budget", () => {
    const history = new History(new LayerStack(), 250);
    history.push(stackWithBrushMask(100)); // A
    history.push(stackWithBrushMask(100)); // B
    history.push(stackWithBrushMask(100)); // C -> 300 octets retenus > 250
    expect(history.bytesUsed()).toBeLessThanOrEqual(250);
    const undone = history.undo();
    expect(undone?.layers[0].mask.sources[0].raster?.byteLength).toBe(100); // -> B
    expect(history.undo()).toBeNull();
  });

  it("never evicts the current state even if it alone exceeds the budget", () => {
    const history = new History(new LayerStack(), 10);
    history.push(stackWithBrushMask(100));
    expect(history.bytesUsed()).toBe(100);
    expect(history.canUndo()).toBe(false);
  });

  it("releases bytes when the redo branch is discarded by a new push", () => {
    const history = new History(new LayerStack(), 10_000);
    history.push(stackWithBrushMask(100));
    history.undo();
    expect(history.bytesUsed()).toBe(100);
    history.push(stackWithBrushMask(30));
    expect(history.bytesUsed()).toBe(30);
  });

  it("keeps a shared raster counted when only one of its referencing entries is discarded via future", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithBrushMask(100); // M1 = 100 octets
    history.push(a);
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b); // B partage M1 -> refcount=2
    history.undo(); // future=[B(M1)]
    history.push(stackWithBrushMask(50)); // future jetée (release M1: 2->1), M2 nouveau courant
    expect(history.bytesUsed()).toBe(150);
  });

  it("undo/redo keep working normally under the default budget", () => {
    const history = new History(new LayerStack());
    history.push(stackWithBrushMask(100));
    history.undo();
    const redone = history.redo();
    expect(redone?.layers[0].mask.sources[0].raster?.byteLength).toBe(100);
  });

  it("refcounts MULTIPLE raster sources on the same layer independently (new in Tranche 2)", () => {
    const history = new History(new LayerStack(), 1000);
    const s = new LayerStack();
    const id = s.addLayer("glow");
    s.updateBrushMask(id, new Uint8Array(100));
    // Simulate a 2nd source appended directly (no UI yet, but the model allows it).
    const layer = s.layers.find((l) => l.id === id)!;
    layer.mask = {
      ...layer.mask,
      sources: [...layer.mask.sources, { id: "extra", type: "brush", combineMode: "add", enabled: true, params: null, raster: new Uint8Array(50) }],
    };
    history.push(s);
    expect(history.bytesUsed()).toBe(150); // 100 + 50, both counted
  });
});
