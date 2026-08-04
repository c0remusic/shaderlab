import { describe, expect, it } from "vitest";
import { axisFromOverlay, axisToOverlay, diskToOverlay, normalizeDegrees, pointFromOverlay, pointFromOverlayWithinRanges, pointToOverlay } from "../../src/ui/canvasControls";
import { regionToOverlay } from "../../src/ui/regionHandles";

const landscape = { width: 6000, height: 4000 };
const rect = { left: 20, top: 30, width: 900, height: 600 };

describe("canvas controls geometry", () => {
  it("round-trips points including centers outside the frame", () => {
    const point = { x: -0.25, y: 1.25 };
    const overlay = pointToOverlay(point, rect);
    expect(pointFromOverlay(overlay.x, overlay.y, rect)).toEqual(point);
  });

  it("clamps a point to the ranges declared by its parameters", () => {
    expect(pointFromOverlayWithinRanges(-1000, 900, rect, { min: -0.25, max: 1.25 }, { min: 0, max: 1 }))
      .toEqual({ x: -0.25, y: 1 });
  });

  it("keeps the historical disk geometry unchanged", () => {
    const center = { x: 0.35, y: 0.7 };
    expect(diskToOverlay(center, 1.5, landscape, rect)).toEqual(regionToOverlay(center, 1.5, landscape, rect));
  });

  it.each([[0, 0], [360, 0], [-1, 359], [721, 1]])("normalizes %s degrees to %s", (input, output) => {
    expect(normalizeDegrees(input)).toBe(output);
  });

  it("round-trips a directional axis on landscape and portrait canvases", () => {
    for (const [image, display] of [
      [landscape, rect],
      [{ width: 3000, height: 5000 }, { left: 10, top: 15, width: 360, height: 600 }],
    ] as const) {
      const axis = axisToOverlay(315, 800, image, display);
      const values = axisFromOverlay(axis.x, axis.y, image, display, 0, 2000);
      expect(values.angle).toBeCloseTo(315, 8);
      expect(values.length).toBeCloseTo(800, 8);
    }
  });

  it("uses zero angle for a zero-length axis and clamps its length", () => {
    const center = pointToOverlay({ x: 0.5, y: 0.5 }, rect);
    expect(axisFromOverlay(center.x, center.y, landscape, rect, 20, 2000)).toEqual({ angle: 0, length: 20 });
    expect(axisFromOverlay(center.x + 9999, center.y, landscape, rect, 0, 2000).length).toBe(2000);
  });
});
