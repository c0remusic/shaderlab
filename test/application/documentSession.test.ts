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
    // Union discriminée: "brush" garde raster non-null par construction ; le
    // strip de données pour le state React produit un Uint8Array VIDE.
    expect(session.displayLayers()[0].mask.sources[0].raster!.length).toBe(0);
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

describe("DocumentSession — l'étage de développement (ticket 03)", () => {
  it("part vide et se règle par `reglerDeveloppement` + commit", () => {
    const session = new DocumentSession();
    expect(session.developpement()).toEqual({});
    session.reglerDeveloppement("etalonnage", { blueHue: -60, blueSaturation: 40 });
    session.commit(session.currentStack());
    expect(session.developpement()).toEqual({ etalonnage: { blueHue: -60, blueSaturation: 40 } });
  });

  it("est annulé/rétabli par le MÊME History que les calques, sans second canal", () => {
    const session = new DocumentSession();
    session.reglerDeveloppement("etalonnage", { blueHue: -60 });
    session.commit(session.currentStack());
    expect(session.developpement()).toEqual({ etalonnage: { blueHue: -60 } });

    expect(session.undo()).toBe(true);
    expect(session.developpement()).toEqual({});
    expect(session.redo()).toBe(true);
    expect(session.developpement()).toEqual({ etalonnage: { blueHue: -60 } });
  });

  it("`replaceLiveDevelop` NE pousse PAS d'entrée d'historique ; le commit suivant, oui", () => {
    const session = new DocumentSession();
    // Pose un premier état engagé, pour avoir un « avant » à retrouver.
    session.reglerDeveloppement("etalonnage", { blueHue: 10 });
    session.commit(session.currentStack());

    // Geste vivant : plusieurs `replaceLiveDevelop` sans commit.
    session.replaceLiveDevelop({ etalonnage: { blueHue: 20 } });
    session.replaceLiveDevelop({ etalonnage: { blueHue: 30 } });
    expect(session.developpement()).toEqual({ etalonnage: { blueHue: 30 } });

    // Le commit de fin de geste capture l'état vivant courant (une seule entrée).
    session.commit(session.currentStack());
    expect(session.undo()).toBe(true);
    // Un seul undo ramène à l'état ENGAGÉ d'avant le geste, pas à une frame
    // intermédiaire du glissement.
    expect(session.developpement()).toEqual({ etalonnage: { blueHue: 10 } });
  });

  it("`currentStack()` clone l'étage — muter le clone ne touche pas la session", () => {
    const session = new DocumentSession();
    session.reglerDeveloppement("etalonnage", { blueHue: -60 });
    session.commit(session.currentStack());
    const clone = session.currentStack();
    clone.develop.etalonnage.blueHue = 999;
    expect(session.developpement().etalonnage.blueHue).toBe(-60);
  });
});
