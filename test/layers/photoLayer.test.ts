import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { MAX_PHOTO_LAYERS, countPhotoLayers, canAddPhotoLayer, hasPhotoLayer } from "../../src/layers/photoLayer";

describe("photoLayer guards", () => {
  it("MAX_PHOTO_LAYERS vaut 4 (la photo de fond n'est pas un LayerState)", () => {
    expect(MAX_PHOTO_LAYERS).toBe(4);
  });

  it("countPhotoLayers compte les calques avec imageSource, ignore les calques d'effet", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(countPhotoLayers(stack.layers)).toBe(0);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(countPhotoLayers(stack.layers)).toBe(1);
  });

  it("canAddPhotoLayer accepte jusqu'à MAX_PHOTO_LAYERS puis refuse", () => {
    const stack = new LayerStack();
    for (let i = 0; i < MAX_PHOTO_LAYERS; i++) {
      expect(canAddPhotoLayer(stack.layers)).toBe(true);
      stack.addPhotoLayer(`photo-${i + 1}`, { x: 0, y: 0, scale: 1, rotation: 0 });
    }
    expect(countPhotoLayers(stack.layers)).toBe(MAX_PHOTO_LAYERS);
    expect(canAddPhotoLayer(stack.layers)).toBe(false);
  });

  it("countPhotoLayers ignore les calques d'effet intercalés entre les calques photo", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    stack.addLayer("glow");
    stack.addPhotoLayer("photo-2", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(stack.layers).toHaveLength(3);
    expect(countPhotoLayers(stack.layers)).toBe(2);
  });

  it("hasPhotoLayer reste un prédicat « au moins 1 » avec N calques photo (round-trip Lightroom inchangé)", () => {
    const stack = new LayerStack();
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasPhotoLayer(stack.layers)).toBe(true);
    stack.addPhotoLayer("photo-2", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasPhotoLayer(stack.layers)).toBe(true);
  });

  it("hasPhotoLayer est false sur un document sans calque photo, true sinon", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(hasPhotoLayer(stack.layers)).toBe(false);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasPhotoLayer(stack.layers)).toBe(true);
  });
});
