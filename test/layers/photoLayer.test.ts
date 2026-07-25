import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { MAX_PHOTO_LAYERS, countPhotoLayers, canAddPhotoLayer, hasPhotoLayer } from "../../src/layers/photoLayer";

describe("photoLayer guards", () => {
  it("MAX_PHOTO_LAYERS vaut 1 (la photo de fond n'est pas un LayerState)", () => {
    expect(MAX_PHOTO_LAYERS).toBe(1);
  });

  it("countPhotoLayers compte les calques avec imageSource, ignore les calques d'effet", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(countPhotoLayers(stack.layers)).toBe(0);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(countPhotoLayers(stack.layers)).toBe(1);
  });

  it("canAddPhotoLayer refuse un second calque photo", () => {
    const stack = new LayerStack();
    expect(canAddPhotoLayer(stack.layers)).toBe(true);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(canAddPhotoLayer(stack.layers)).toBe(false);
  });

  it("hasPhotoLayer est false sur un document sans calque photo, true sinon", () => {
    const stack = new LayerStack();
    stack.addLayer("glow");
    expect(hasPhotoLayer(stack.layers)).toBe(false);
    stack.addPhotoLayer("photo-1", { x: 0, y: 0, scale: 1, rotation: 0 });
    expect(hasPhotoLayer(stack.layers)).toBe(true);
  });
});
