import { describe, it, expect } from "vitest";
import { validateEffect } from "../../../src/render/effects/validate";
import { effectRegistry } from "../../../src/render/effects/registry";
import type { EffectModule } from "../../../src/render/effects/types";

function effectWithParams(count: number): EffectModule {
  return {
    id: "test-effect",
    name: "Test",
    params: Array.from({ length: count }, (_, i) => ({
      name: `p${i}`,
      min: 0,
      max: 1,
      default: 0,
      step: 0.1,
    })),
    wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
  };
}

describe("validateEffect", () => {
  it("accepts an effect at exactly the param limit", () => {
    expect(() => validateEffect(effectWithParams(8))).not.toThrow();
  });

  it("rejects an effect over the limit with the effect id in the message", () => {
    expect(() => validateEffect(effectWithParams(9))).toThrow(/test-effect.*9.*8/);
  });

  it("every registered effect is valid", () => {
    for (const effect of effectRegistry) {
      expect(() => validateEffect(effect)).not.toThrow();
    }
  });
});
