import { describe, it, expect } from "vitest";
import { staleMaskIds } from "../../src/render/maskResidency";
import type { LayerState } from "../../src/layers/types";

function layer(id: string): LayerState {
  return { id, effectId: "glow", params: {}, enabled: true, maskData: null };
}

describe("staleMaskIds", () => {
  it("returns cached ids whose layer no longer exists", () => {
    expect(staleMaskIds(["a", "b"], [layer("b")])).toEqual(["a"]);
  });

  it("returns nothing when every cached id is still present", () => {
    expect(staleMaskIds(["a"], [layer("a"), layer("b")])).toEqual([]);
  });

  it("handles an empty cache", () => {
    expect(staleMaskIds([], [layer("a")])).toEqual([]);
  });
});
