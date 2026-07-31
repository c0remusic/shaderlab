import { describe, it, expect, vi } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { duplicateLayer, photoLayerLimitMessage } from "../../src/layers/duplicateLayer";
import { MAX_PHOTO_LAYERS } from "../../src/layers/photoLayer";

function effects() {
  return {
    clearActivePreset: vi.fn(),
    commit: vi.fn(),
    selectLayer: vi.fn(),
    setError: vi.fn(),
  };
}

const TRANSFORM = { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 };

describe("duplicateLayer", () => {
  it("duplique, sévère le preset actif, pousse une entrée d'historique et sélectionne le duplicata", () => {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    const fx = effects();

    const copy = duplicateLayer(stack, id, fx);

    expect(copy).not.toBeNull();
    expect(stack.layers.map((l) => l.id)).toEqual([id, copy]);
    expect(fx.clearActivePreset).toHaveBeenCalledTimes(1);
    expect(fx.commit).toHaveBeenCalledTimes(1);
    expect(fx.commit).toHaveBeenCalledWith(stack);
    expect(fx.selectLayer).toHaveBeenCalledWith(copy);
    expect(fx.setError).toHaveBeenCalledWith(null);
  });

  it("un id absent ne touche ni la pile, ni le preset actif, ni l'historique", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    const fx = effects();

    expect(duplicateLayer(stack, "no-such-id", fx)).toBeNull();

    expect(stack.layers).toHaveLength(1);
    expect(fx.clearActivePreset).not.toHaveBeenCalled();
    expect(fx.commit).not.toHaveBeenCalled();
    expect(fx.selectLayer).not.toHaveBeenCalled();
    expect(fx.setError).not.toHaveBeenCalled();
  });

  it("dupliquer un calque photo est refusé au plafond MAX_PHOTO_LAYERS, sans muter la pile", () => {
    const stack = new LayerStack();
    let last = "";
    for (let i = 0; i < MAX_PHOTO_LAYERS; i++) last = stack.addPhotoLayer(`photo-${i}`, TRANSFORM);
    const fx = effects();

    expect(duplicateLayer(stack, last, fx)).toBeNull();

    expect(stack.layers).toHaveLength(MAX_PHOTO_LAYERS);
    expect(fx.setError).toHaveBeenCalledWith(photoLayerLimitMessage());
    expect(fx.commit).not.toHaveBeenCalled();
    expect(fx.clearActivePreset).not.toHaveBeenCalled();
  });

  it("dupliquer un calque photo est autorisé sous le plafond, en partageant le sourceId", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("photo-1", TRANSFORM);
    const fx = effects();

    const copy = duplicateLayer(stack, id, fx);

    expect(copy).not.toBeNull();
    expect(stack.layers[1].imageSource).toEqual({ sourceId: "photo-1" });
    expect(fx.commit).toHaveBeenCalledTimes(1);
  });

  // Le plafond porte sur les calques PHOTO : un document saturé en calques
  // photo ne doit pas empêcher de dupliquer un calque d'effet.
  it("dupliquer un calque d'effet reste possible même au plafond photo", () => {
    const stack = new LayerStack();
    for (let i = 0; i < MAX_PHOTO_LAYERS; i++) stack.addPhotoLayer(`photo-${i}`, TRANSFORM);
    const id = stack.addLayer("glow");
    const fx = effects();

    expect(duplicateLayer(stack, id, fx)).not.toBeNull();
    expect(fx.commit).toHaveBeenCalledTimes(1);
    expect(fx.setError).toHaveBeenCalledWith(null);
  });
});
