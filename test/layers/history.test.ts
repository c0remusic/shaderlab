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
  function stackWithMask(bytes: number): LayerStack {
    const s = new LayerStack();
    const id = s.addLayer("glow");
    s.updateMask(id, new Uint8Array(bytes));
    return s;
  }

  it("counts unique mask buffers once even when shared across entries", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithMask(100);
    history.push(a);
    // clone() partage le buffer (Task 9) : pousser un clone modifié sur un
    // AUTRE champ ne doit pas recompter les 100 octets du masque.
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b);
    expect(history.bytesUsed()).toBe(100);
  });

  it("evicts oldest past entries first when over budget", () => {
    const history = new History(new LayerStack(), 250);
    history.push(stackWithMask(100)); // A
    history.push(stackWithMask(100)); // B
    history.push(stackWithMask(100)); // C -> 300 octets retenus > 250
    // Éviction en partant du plus ancien : l'état initial (0 octet) puis A
    // (100). Restent B (past) + C (courant) = 200 octets <= 250.
    expect(history.bytesUsed()).toBeLessThanOrEqual(250);
    // Un seul pas d'undo possible : B. L'initial et A sont partis.
    expect(history.undo()?.layers[0].maskData?.byteLength).toBe(100); // -> B
    expect(history.undo()).toBeNull();
  });

  it("never evicts the current state even if it alone exceeds the budget", () => {
    const history = new History(new LayerStack(), 10);
    history.push(stackWithMask(100));
    expect(history.bytesUsed()).toBe(100);
    expect(history.canUndo()).toBe(false); // le past a été vidé, pas le courant
  });

  it("releases bytes when the redo branch is discarded by a new push", () => {
    const history = new History(new LayerStack(), 10_000);
    history.push(stackWithMask(100));
    history.undo(); // la branche redo retient les 100 octets
    expect(history.bytesUsed()).toBe(100);
    history.push(stackWithMask(30)); // redo jetée
    expect(history.bytesUsed()).toBe(30);
  });

  it("keeps a shared mask counted when only one of its referencing entries is discarded via future", () => {
    const history = new History(new LayerStack(), 1000);
    const a = stackWithMask(100); // M1 = 100 octets
    history.push(a); // past=[initial], current=A(M1)

    // B partage M1 (seul updateParams est appelé, le masque n'est pas touché).
    const b = a.clone();
    b.updateParams(b.layers[0].id, { intensity: 0.5 });
    history.push(b); // past=[initial, A], current=B(M1) -> M1 refcount=2

    history.undo(); // past=[initial], current=A(M1), future=[B(M1)]

    // C introduit un NOUVEAU buffer M2, distinct de M1.
    history.push(stackWithMask(50)); // future=[B] jetée (release M1: 2->1)
    // past=[initial, A(M1)], current=C(M2)
    // M1 reste retenu via A dans past ; M2 est le nouveau courant.
    expect(history.bytesUsed()).toBe(150);
  });

  it("undo/redo keep working normally under the default budget", () => {
    const history = new History(new LayerStack());
    history.push(stackWithMask(100));
    history.undo();
    const redone = history.redo();
    expect(redone?.layers[0].maskData?.byteLength).toBe(100);
  });
});
