import { describe, it, expect } from "vitest";
import { getSyncedMaskPainter, type MaskPainterEntry } from "../../src/mask/maskPainterSync";
import { getBrushRaster } from "../../src/mask/brushSource";
import { defaultLayerMask, createBrushSource } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

describe("getSyncedMaskPainter", () => {
  it("creates a fresh painter seeded from currentMaskData on first stroke", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const seed = new Uint8Array(4 * 4).fill(100);
    const entry = getSyncedMaskPainter(entries, "layer-1", seed, 4, 4);
    expect(entry.painter.getMaskData()[0]).toBe(100);
    expect(entry.syncedFrom).toBe(seed);
    expect(entries.get("layer-1")).toBe(entry);
  });

  it("creates a cleared painter when currentMaskData is null on first stroke", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const entry = getSyncedMaskPainter(entries, "layer-1", null, 4, 4);
    expect(entry.painter.getMaskData().every((v) => v === 0)).toBe(true);
    expect(entry.syncedFrom).toBeNull();
  });

  it("reuses the same painter across strokes when the raster reference is unchanged", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const seed = new Uint8Array(4 * 4);
    const first = getSyncedMaskPainter(entries, "layer-1", seed, 4, 4);
    first.painter.paintStroke(2, 2, { radius: 1, hardness: 1, erase: false, opacity: 1, flow: 1 });
    const second = getSyncedMaskPainter(entries, "layer-1", seed, 4, 4);
    expect(second).toBe(first);
    expect(second.painter.getMaskData()[2 * 4 + 2]).toBeGreaterThan(0);
  });

  it("re-seeds the cached painter when the raster reference changes (undo/redo between strokes)", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const before = getSyncedMaskPainter(entries, "layer-1", new Uint8Array(4 * 4), 4, 4);
    before.painter.paintStroke(2, 2, { radius: 1, hardness: 1, erase: false, opacity: 1, flow: 1 });
    expect(before.painter.getMaskData()[2 * 4 + 2]).toBeGreaterThan(0);

    // Simulates an undo/redo restoring a different mask snapshot for the
    // same layer id between two strokes: a NEW raster reference arrives.
    const restored = new Uint8Array(4 * 4).fill(50);
    const after = getSyncedMaskPainter(entries, "layer-1", restored, 4, 4);
    expect(after).toBe(before); // same cached painter instance, re-seeded
    expect(after.painter.getMaskData()[2 * 4 + 2]).toBe(50); // stale paint wiped, not layered on top
    expect(after.syncedFrom).toBe(restored);
  });

  it("clears the cached painter when the raster reference changes to null (undo to no-mask state)", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const before = getSyncedMaskPainter(entries, "layer-1", new Uint8Array(4 * 4).fill(200), 4, 4);
    const after = getSyncedMaskPainter(entries, "layer-1", null, 4, 4);
    expect(after).toBe(before);
    expect(after.painter.getMaskData().every((v) => v === 0)).toBe(true);
  });

  it("tracks separate painters per layer id", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const a = getSyncedMaskPainter(entries, "layer-a", null, 4, 4);
    const b = getSyncedMaskPainter(entries, "layer-b", null, 4, 4);
    expect(a).not.toBe(b);
    expect(entries.size).toBe(2);
  });

  it("starts with lastPoint null (no interpolation context yet)", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const entry = getSyncedMaskPainter(entries, "layer-1", null, 4, 4);
    expect(entry.lastPoint).toBeNull();
  });

  it("re-seeding (undo/redo between strokes) resets lastPoint, discarding a stale interpolation anchor", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const before = getSyncedMaskPainter(entries, "layer-1", new Uint8Array(4 * 4), 4, 4);
    before.lastPoint = { x: 2, y: 2 };
    const after = getSyncedMaskPainter(entries, "layer-1", new Uint8Array(4 * 4).fill(50), 4, 4);
    expect(after.lastPoint).toBeNull();
  });
});

describe("getSyncedMaskPainter — ancrage du plafond d'opacité", () => {
  /** Rejoue le cycle réel d'App.tsx : un appel par échantillon, `lastPoint`
   *  posé après chaque échantillon et remis à `null` en fin de trait. */
  function stroke(entries: Map<string, MaskPainterEntry>, samples: number): void {
    for (let i = 0; i < samples; i++) {
      const entry = getSyncedMaskPainter(entries, "layer-1", null, 20, 20);
      entry.painter.paintStroke(10, 10, { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 1 });
      entry.lastPoint = { x: 10, y: 10 };
    }
    entries.get("layer-1")!.lastPoint = null; // fin de trait (handleMaskStrokeEnd)
  }

  it("réancre le plafond à CHAQUE trait, sans que l'appelant ait à signaler le début du trait", () => {
    const entries = new Map<string, MaskPainterEntry>();
    stroke(entries, 5);
    const painter = entries.get("layer-1")!.painter;
    expect(painter.getMaskData()[10 * 20 + 10]).toBe(127); // plafond du 1er trait

    stroke(entries, 5);
    // Sans réancrage, le 2e trait resterait bloqué à 127 — le symptôme exact
    // de « l'opacité ne remonte plus ».
    expect(painter.getMaskData()[10 * 20 + 10]).toBe(191);
  });

  it("ne réancre PAS entre deux échantillons du même trait (sinon l'opacité ne plafonne plus)", () => {
    const entries = new Map<string, MaskPainterEntry>();
    for (let i = 0; i < 10; i++) {
      const entry = getSyncedMaskPainter(entries, "layer-1", null, 20, 20);
      entry.painter.paintStroke(10, 10, { radius: 5, hardness: 1, erase: false, opacity: 0.5, flow: 1 });
      entry.lastPoint = { x: 10, y: 10 };
    }
    expect(entries.get("layer-1")!.painter.getMaskData()[10 * 20 + 10]).toBe(127);
  });
});

describe("getSyncedMaskPainter fed from getBrushRaster (Tranche 2 wiring)", () => {
  it("seeds the painter from the layer's brush raster when one exists", () => {
    const raster = new Uint8Array(4).fill(200);
    const mask = defaultLayerMask();
    mask.sources.push(createBrushSource("l-brush", raster));
    const layer: LayerState = { id: "l", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask };

    const entries = new Map<string, MaskPainterEntry>();
    const entry = getSyncedMaskPainter(entries, "l", getBrushRaster(layer), 2, 2);
    expect(entry.painter.getMaskData()).toEqual(raster);
  });

  it("seeds an empty painter when the layer has never been painted", () => {
    const layer: LayerState = { id: "l", effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() };
    const entries = new Map<string, MaskPainterEntry>();
    const entry = getSyncedMaskPainter(entries, "l", getBrushRaster(layer), 2, 2);
    expect(entry.painter.getMaskData()).toEqual(new Uint8Array(4));
  });
});
