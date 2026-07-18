import { describe, it, expect } from "vitest";
import { getSyncedMaskPainter, type MaskPainterEntry } from "../../src/mask/maskPainterSync";

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

  it("reuses the same painter across strokes when maskData reference is unchanged", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const seed = new Uint8Array(4 * 4);
    const first = getSyncedMaskPainter(entries, "layer-1", seed, 4, 4);
    first.painter.paintStroke(2, 2, 1, 1.0, false);
    const second = getSyncedMaskPainter(entries, "layer-1", seed, 4, 4);
    expect(second).toBe(first);
    expect(second.painter.getMaskData()[2 * 4 + 2]).toBeGreaterThan(0);
  });

  it("re-seeds the cached painter when maskData reference changes (undo/redo between strokes)", () => {
    const entries = new Map<string, MaskPainterEntry>();
    const before = getSyncedMaskPainter(entries, "layer-1", new Uint8Array(4 * 4), 4, 4);
    before.painter.paintStroke(2, 2, 1, 1.0, false);
    expect(before.painter.getMaskData()[2 * 4 + 2]).toBeGreaterThan(0);

    // Simulates an undo/redo restoring a different mask snapshot for the
    // same layer id between two strokes: a NEW maskData reference arrives.
    const restored = new Uint8Array(4 * 4).fill(50);
    const after = getSyncedMaskPainter(entries, "layer-1", restored, 4, 4);
    expect(after).toBe(before); // same cached painter instance, re-seeded
    expect(after.painter.getMaskData()[2 * 4 + 2]).toBe(50); // stale paint wiped, not layered on top
    expect(after.syncedFrom).toBe(restored);
  });

  it("clears the cached painter when maskData reference changes to null (undo to no-mask state)", () => {
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
