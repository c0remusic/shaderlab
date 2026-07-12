import { describe, it, expect } from "vitest";
import { MaskPainter } from "../../src/mask/maskPainter";

describe("MaskPainter", () => {
  it("starts fully transparent (all zero) by default", () => {
    const painter = new MaskPainter(4, 4);
    const data = painter.getMaskData();
    expect(data.every((v) => v === 0)).toBe(true);
  });

  it("clear(255) fills the mask fully opaque", () => {
    const painter = new MaskPainter(4, 4);
    painter.clear(255);
    expect(painter.getMaskData().every((v) => v === 255)).toBe(true);
  });

  it("paintStroke raises values at the brush center, tapering at the edge", () => {
    const painter = new MaskPainter(20, 20);
    painter.paintStroke(10, 10, 5, 1.0, false);
    const data = painter.getMaskData();
    const center = data[10 * 20 + 10];
    const edge = data[10 * 20 + 19]; // far from the brush
    expect(center).toBeGreaterThan(200);
    expect(edge).toBe(0);
  });

  it("erase mode lowers values instead of raising them", () => {
    const painter = new MaskPainter(20, 20);
    painter.clear(255);
    painter.paintStroke(10, 10, 5, 1.0, true);
    const data = painter.getMaskData();
    expect(data[10 * 20 + 10]).toBeLessThan(50);
  });

  it("loadFrom replaces the internal buffer so subsequent strokes build on top of it, not a fresh zero buffer", () => {
    const painter = new MaskPainter(20, 20);
    const seeded = new Uint8Array(20 * 20).fill(100);
    painter.loadFrom(seeded);
    expect(painter.getMaskData()[10 * 20 + 10]).toBe(100);
    painter.paintStroke(10, 10, 5, 1.0, false);
    const data = painter.getMaskData();
    expect(data[10 * 20 + 10]).toBeGreaterThan(100);
    // unaffected area still reflects the loaded seed, not a zero-fill
    expect(data[0]).toBe(100);
  });
});
