import { describe, expect, it } from "vitest";
import { moveColorRampHandle, nudgeColorRampHandle, type ColorRampPositions } from "../../src/ui/colorRamp";

const identity: ColorRampPositions = { midPosition: 0.5, blackPoint: 0, whitePoint: 1 };

describe("colorRamp", () => {
  it("borne le ton moyen entre 5 % et 95 %", () => {
    expect(moveColorRampHandle(identity, "midPosition", -1).midPosition).toBe(0.05);
    expect(moveColorRampHandle(identity, "midPosition", 2).midPosition).toBe(0.95);
  });

  it("empêche les points noir et blanc de se croiser", () => {
    expect(moveColorRampHandle(identity, "blackPoint", 2)).toEqual({ ...identity, blackPoint: 0.95 });
    expect(moveColorRampHandle(identity, "whitePoint", -1)).toEqual({ ...identity, whitePoint: 0.05 });
    expect(moveColorRampHandle({ ...identity, whitePoint: 0.4 }, "blackPoint", 0.8).blackPoint).toBeCloseTo(0.35);
  });

  it("utilise un pas fin ou large au clavier", () => {
    expect(nudgeColorRampHandle(identity, "midPosition", 1, false).midPosition).toBeCloseTo(0.51);
    expect(nudgeColorRampHandle(identity, "midPosition", -1, true).midPosition).toBeCloseTo(0.4);
  });
});
