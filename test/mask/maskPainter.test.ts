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

  it("paintStroke returns the touched region's bounding box, clamped to image bounds", () => {
    const painter = new MaskPainter(20, 20);
    const rect = painter.paintStroke(10, 10, 5, 1.0, false);
    expect(rect).toEqual({ x: 5, y: 5, width: 11, height: 11 });
  });

  it("paintStroke clamps the returned rect when the brush extends past the image edge", () => {
    const painter = new MaskPainter(20, 20);
    const rect = painter.paintStroke(0, 0, 5, 1.0, false);
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBeLessThanOrEqual(6);
    expect(rect.height).toBeLessThanOrEqual(6);
  });

  it("paintStroke returns an EMPTY (non-negative) rect when the brush is entirely outside the image — regression: flicker bug (2026-07-18)", () => {
    // The pointer can now travel past the canvas edge while painting
    // (pointer-capture fix) — a point far outside the image, with the
    // brush's footprint not overlapping it at all, must never produce a
    // NEGATIVE width/height: that malformed rect flows straight into a GPU
    // partial-texture-upload copy size (computeR8UploadRegion → writeTexture),
    // which WebGPU rejects — a validation error every such frame, causing
    // the reported flicker.
    const painter = new MaskPainter(100, 100);
    const rect = painter.paintStroke(-500, 50, 10, 1.0, false); // way past the left edge
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
  });

  it("paintLine's union stays non-negative when interpolating through fully-out-of-bounds points", () => {
    const painter = new MaskPainter(100, 100);
    // A drag that starts inside, sweeps far outside the image, and comes back.
    const rect = painter.paintLine(10, 10, -400, 10, 10, 1.0, false);
    expect(rect.width).toBeGreaterThanOrEqual(0);
    expect(rect.height).toBeGreaterThanOrEqual(0);
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

  describe("paintLine", () => {
    it("fills the gap between two far-apart points instead of leaving a hole (regression: dotted-trail bug)", () => {
      const painter = new MaskPainter(100, 20);
      // Small brush, endpoints 40px apart — a single dab at each end would
      // leave a large untouched gap in between (the reported bug).
      painter.paintLine(10, 10, 50, 10, 5, 1.0, false);
      const data = painter.getMaskData();
      const midpoint = data[10 * 100 + 30]; // halfway between 10 and 50
      expect(midpoint).toBeGreaterThan(200);
    });

    it("with zero distance (same point twice) behaves like a single paintStroke dab", () => {
      const a = new MaskPainter(20, 20);
      a.paintStroke(10, 10, 5, 1.0, false);
      const b = new MaskPainter(20, 20);
      b.paintLine(10, 10, 10, 10, 5, 1.0, false);
      expect(b.getMaskData()).toEqual(a.getMaskData());
    });

    it("does not double-stamp the FROM point (already painted by the previous call)", () => {
      const painter = new MaskPainter(30, 20);
      painter.paintStroke(5, 10, 3, 1.0, false); // simulates the previous point already painted
      const afterFirstDab = painter.getMaskData()[10 * 30 + 5];
      painter.paintLine(5, 10, 8, 10, 3, 1.0, false);
      // The FROM point's value shouldn't jump past full saturation from a
      // redundant overlapping dab beyond what erase/paint clamping already allows.
      expect(painter.getMaskData()[10 * 30 + 5]).toBe(Math.min(255, afterFirstDab));
    });

    it("returns a DirtyRect covering the union of the interpolated dabs, up to the TO point's edge", () => {
      const painter = new MaskPainter(100, 100);
      // The exact FROM dab is deliberately excluded (see paintLine's doc
      // comment — the caller already painted it), so the rect starts near
      // fromX+spacing, not fromX itself.
      const rect = painter.paintLine(10, 10, 50, 10, 5, 1.0, false);
      expect(rect.x).toBeLessThanOrEqual(11);
      expect(rect.y).toBeLessThanOrEqual(5);
      expect(rect.x + rect.width).toBeGreaterThanOrEqual(55);
    });

    it("erase mode propagates through interpolated dabs, not just the endpoints", () => {
      const painter = new MaskPainter(100, 20);
      painter.clear(255);
      painter.paintLine(10, 10, 50, 10, 5, 1.0, true);
      const data = painter.getMaskData();
      expect(data[10 * 100 + 30]).toBeLessThan(50);
    });
  });
});
