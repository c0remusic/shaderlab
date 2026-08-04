import { describe, expect, it } from "vitest";
import { DocumentSession } from "../../src/application/documentSession";
import { curves } from "../../src/render/effects/curves";

describe("Courbes — historique de document", () => {
  it("annule et rétablit ajout, déplacement, suppression et reset d'un point", () => {
    const session = new DocumentSession();
    const initial = session.currentStack();
    const id = initial.addLayer("curves");
    session.commit(initial);

    const states = [
      { masterPoint1X: 0.4, masterPoint1Y: 0.3 },
      { masterPoint1X: 0.55, masterPoint1Y: 0.7 },
      { masterPoint1X: -1 },
      Object.fromEntries(curves.params.slice(0, 8).map((param) => [param.name, param.default])),
    ];
    for (const patch of states) {
      const stack = session.currentStack();
      expect(stack.updateParams(id, patch)).toBe(true);
      session.commit(stack);
    }

    expect(session.layers()[0].params.masterPoint1X).toBe(-1);
    expect(session.undo()).toBe(true);
    expect(session.layers()[0].params.masterPoint1X).toBe(-1);
    expect(session.undo()).toBe(true);
    expect(session.layers()[0].params.masterPoint1X).toBe(0.55);
    expect(session.undo()).toBe(true);
    expect(session.layers()[0].params.masterPoint1X).toBe(0.4);
    expect(session.redo()).toBe(true);
    expect(session.layers()[0].params.masterPoint1X).toBe(0.55);
  });
});
