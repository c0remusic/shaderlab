import { describe, expect, it } from "vitest";
import { moveColorRampHandle, nudgeColorRampHandle, type ColorRampPositions } from "../../src/ui/colorRamp";

const identity: ColorRampPositions = { shadowPosition: 0, midPosition: 0.5, highPosition: 1, blackPoint: 0, whitePoint: 1 };

describe("colorRamp", () => {
  it("empêche les trois arrêts couleur de se croiser", () => {
    expect(moveColorRampHandle(identity, "shadowPosition", 0.8).shadowPosition).toBe(0.45);
    expect(moveColorRampHandle(identity, "midPosition", -1).midPosition).toBe(0.05);
    expect(moveColorRampHandle(identity, "midPosition", 2).midPosition).toBe(0.95);
    expect(moveColorRampHandle(identity, "highPosition", 0.2).highPosition).toBe(0.55);
    expect(moveColorRampHandle({ ...identity, shadowPosition: 0.3, highPosition: 0.7 }, "midPosition", 0.1).midPosition).toBeCloseTo(0.35);
  });

  it("empêche les points noir et blanc de se croiser", () => {
    expect(moveColorRampHandle(identity, "blackPoint", 2)).toEqual({ ...identity, blackPoint: 0.95 });
    expect(moveColorRampHandle(identity, "whitePoint", -1)).toEqual({ ...identity, whitePoint: 0.05 });
    expect(moveColorRampHandle({ ...identity, whitePoint: 0.4 }, "blackPoint", 0.8).blackPoint).toBeCloseTo(0.35);
  });

  it("utilise un pas fin ou large au clavier", () => {
    expect(nudgeColorRampHandle(identity, "midPosition", 1, false).midPosition).toBeCloseTo(0.51);
    expect(nudgeColorRampHandle(identity, "midPosition", -1, true).midPosition).toBeCloseTo(0.4);
    expect(nudgeColorRampHandle(identity, "shadowPosition", 1, false).shadowPosition).toBeCloseTo(0.01);
  });
});
