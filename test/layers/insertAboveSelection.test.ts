import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import type { LayerTransform } from "../../src/layers/types";

const TRANSFORM: LayerTransform = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

/**
 * Insertion POSITIONNELLE des nouveaux calques (parité Photoshop) : un calque
 * ajouté se place JUSTE AU-DESSUS du calque sélectionné, pas en haut de pile.
 * Rappel du sens : l'indice SUPÉRIEUR du tableau est le calque du DESSUS
 * (`framePipelineExecutor.run` itère du premier au dernier), donc « au-dessus
 * de la sélection » = index de la sélection + 1 — exactement ce que
 * `duplicateLayer` fait déjà (`layerStack.ts`).
 */
describe("insertion au-dessus de la sélection", () => {
  describe("addPhotoLayer", () => {
    it("insère la photo juste au-dessus du calque sélectionné", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const milieu = stack.addLayer("grain");
      const haut = stack.addLayer("blur");
      const photo = stack.addPhotoLayer("photo-1", TRANSFORM, undefined, milieu);
      expect(stack.layers.map((l) => l.id)).toEqual([bas, milieu, photo, haut]);
    });

    it("sélection = calque le plus haut -> équivaut à l'ancien comportement (fin de tableau)", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const haut = stack.addLayer("grain");
      const photo = stack.addPhotoLayer("photo-1", TRANSFORM, undefined, haut);
      expect(stack.layers.map((l) => l.id)).toEqual([bas, haut, photo]);
    });

    it("aucune sélection (null) -> haut de pile", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const photo = stack.addPhotoLayer("photo-1", TRANSFORM, undefined, null);
      expect(stack.layers.map((l) => l.id)).toEqual([bas, photo]);
    });

    it("aucune sélection (paramètre omis) -> haut de pile", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const photo = stack.addPhotoLayer("photo-1", TRANSFORM);
      expect(stack.layers.map((l) => l.id)).toEqual([bas, photo]);
    });

    it("sélection périmée (id absent de la pile) -> haut de pile, sans lever", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const photo = stack.addPhotoLayer("photo-1", TRANSFORM, undefined, "layer-supprime");
      expect(stack.layers.map((l) => l.id)).toEqual([bas, photo]);
    });

    it("pile vide -> la photo est le seul calque, quelle que soit la sélection", () => {
      const vide = new LayerStack();
      const a = vide.addPhotoLayer("photo-1", TRANSFORM, undefined, null);
      expect(vide.layers.map((l) => l.id)).toEqual([a]);

      const videAvecSelectionMorte = new LayerStack();
      const b = videAvecSelectionMorte.addPhotoLayer("photo-2", TRANSFORM, undefined, "layer-fantome");
      expect(videAvecSelectionMorte.layers.map((l) => l.id)).toEqual([b]);
    });

    it("le nom reste posé quand une position d'insertion est fournie", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const photo = stack.addPhotoLayer("photo-1", TRANSFORM, "IMG_1234.jpg", bas);
      expect(stack.layers[1]).toMatchObject({ id: photo, name: "IMG_1234.jpg", effectId: "passthrough" });
    });
  });

  describe("addLayer (calque d'effet)", () => {
    it("insère l'effet juste au-dessus du calque sélectionné", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const haut = stack.addLayer("blur");
      const insere = stack.addLayer("grain", bas);
      expect(stack.layers.map((l) => l.id)).toEqual([bas, insere, haut]);
    });

    it("sélection = calque le plus haut -> fin de tableau", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const haut = stack.addLayer("blur");
      const insere = stack.addLayer("grain", haut);
      expect(stack.layers.map((l) => l.id)).toEqual([bas, haut, insere]);
    });

    it("aucune sélection / sélection périmée / pile vide -> haut de pile", () => {
      const stack = new LayerStack();
      const bas = stack.addLayer("glow");
      const sansSelection = stack.addLayer("grain", null);
      const perimee = stack.addLayer("blur", "layer-supprime");
      expect(stack.layers.map((l) => l.id)).toEqual([bas, sansSelection, perimee]);

      const vide = new LayerStack();
      const seul = vide.addLayer("glow", null);
      expect(vide.layers.map((l) => l.id)).toEqual([seul]);
    });
  });
});
