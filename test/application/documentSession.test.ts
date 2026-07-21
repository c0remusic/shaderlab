import { describe, expect, it } from "vitest";
import { DocumentSession } from "../../src/application/documentSession";

describe("DocumentSession", () => {
  it("keeps full mask rasters outside its display projection", () => {
    const session = new DocumentSession();
    const next = session.currentStack();
    const id = next.addLayer("glow");
    next.updateBrushMask(id, new Uint8Array([1, 2, 3]));
    session.commit(next);

    expect(session.layers()[0].mask.sources[0].raster).toEqual(new Uint8Array([1, 2, 3]));
    expect(session.displayLayers()[0].mask.sources[0].raster).toBeNull();
  });

  it("clears a removed selection and restores committed states through undo and redo", () => {
    const session = new DocumentSession();
    const withLayer = session.currentStack();
    const id = withLayer.addLayer("glow");
    session.commit(withLayer);
    session.select(id);

    const withoutLayer = session.currentStack();
    withoutLayer.removeLayer(id);
    session.commit(withoutLayer);
    expect(session.selectedId()).toBeNull();

    expect(session.undo()).toBe(true);
    expect(session.layers()).toHaveLength(1);
    expect(session.redo()).toBe(true);
    expect(session.layers()).toHaveLength(0);
  });
});
