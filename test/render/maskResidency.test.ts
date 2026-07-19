import { describe, it, expect } from "vitest";
import { staleMaskIds } from "../../src/render/maskResidency";
import type { LayerState } from "../../src/layers/types";
import { defaultLayerMask } from "../../src/mask/types";

function layer(id: string): LayerState {
  return { id, effectId: "glow", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() };
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

describe("composite source-texture cache keys (layerId:sourceId)", () => {
  it("the layerId prefix of a composite key round-trips through split(':')[0]", () => {
    const key = `${"layer-3"}:${"layer-3-brush"}`;
    expect(key.split(":")[0]).toBe("layer-3");
  });

  it("a layer id containing no colon never collides with the composite-key separator", () => {
    // LayerStack.freshId() produces "layer-<n>" — never contains ":" — so
    // split(":")[0] always isolates the layer id correctly, even if a future
    // source id itself contains extra text after further ":" characters.
    const layers = [layer("layer-1"), layer("layer-2")];
    const cachedCompositeKeys = ["layer-1:layer-1-brush", "layer-2:layer-2-brush", "layer-9:layer-9-brush"];
    const alive = new Set(layers.map((l) => l.id));
    const stale = cachedCompositeKeys.filter((k) => !alive.has(k.split(":")[0]));
    expect(stale).toEqual(["layer-9:layer-9-brush"]);
  });
});
