import { describe, it, expect } from "vitest";
import { LayerStack } from "../../src/layers/layerStack";
import { MaskPainter } from "../../src/mask/maskPainter";

describe("Photo layer + MaskPainter integration", () => {
  it("updateBrushMask accepte un raster peint sur un calque portant imageSource, exactement comme un calque d'effet", () => {
    const stack = new LayerStack();
    const id = stack.addPhotoLayer("photo-1", { x: 50, y: 50, scale: 1, rotation: 0 });

    const painter = new MaskPainter(100, 100);
    painter.paintStroke(50, 50, 20, 0.5, false);
    const changed = stack.updateBrushMask(id, painter.getMaskData());

    expect(changed).toBe(true);
    const layer = stack.layers.find((l) => l.id === id)!;
    const brush = layer.mask.sources.find((s) => s.type === "brush");
    expect(brush).toBeDefined();
    expect(brush!.type === "brush" && brush.raster.some((v) => v > 0)).toBe(true);
    // Le calque reste un calque photo à part entière : imageSource/transform
    // ne sont ni effacés ni altérés par une opération de masque.
    expect(layer.imageSource).toEqual({ sourceId: "photo-1" });
    expect(layer.transform).toEqual({ x: 50, y: 50, scale: 1, rotation: 0 });
  });

  it("le masque d'un calque photo est dimensionné à la photo de FOND, pas à la photo importée (ARCHITECTURE.md §4.5)", () => {
    // MaskPainter est TOUJOURS construit avec les dimensions de la photo de
    // fond (voir App.tsx: getSyncedMaskPainter(..., imageSize.width,
    // imageSize.height) — imageSize suit rendererRef/le document, jamais la
    // taille d'une photo importée). Ce test documente l'invariant au niveau
    // du modèle : rien dans updateBrushMask/MaskPainter ne consulte
    // layer.transform ou la taille de la photo importée.
    const stack = new LayerStack();
    const bgWidth = 300;
    const bgHeight = 200;
    const id = stack.addPhotoLayer("photo-1", { x: 10, y: 10, scale: 1, rotation: 0 });
    const painter = new MaskPainter(bgWidth, bgHeight);
    stack.updateBrushMask(id, painter.getMaskData());
    const layer = stack.layers.find((l) => l.id === id)!;
    const brush = layer.mask.sources.find((s) => s.type === "brush");
    expect(brush!.type === "brush" && brush.raster.length).toBe(bgWidth * bgHeight);
  });
});
