import { describe, it, expect } from "vitest";
import { validateEffect } from "../../../src/render/effects/validate";
import { effectRegistry } from "../../../src/render/effects/registry";
import { MAX_EFFECT_PARAMS } from "../../../src/render/shaderCompose";
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
  // Bornes dérivées de la constante et non recopiées : le plafond a déjà été
  // relevé deux fois (8 -> 11 pour le duotone, 11 -> 16 pour les paramètres
  // étendus), et chaque fois ces deux tests tombaient au rouge sans qu'aucune
  // régression ne les motive.
  it("accepts an effect at exactly the param limit", () => {
    expect(() => validateEffect(effectWithParams(MAX_EFFECT_PARAMS))).not.toThrow();
  });

  it("rejects an effect over the limit with the effect id in the message", () => {
    const over = MAX_EFFECT_PARAMS + 1;
    expect(() => validateEffect(effectWithParams(over))).toThrow(
      new RegExp(`test-effect.*${over}.*${MAX_EFFECT_PARAMS}`),
    );
  });

  it("every registered effect is valid", () => {
    for (const effect of effectRegistry) {
      expect(() => validateEffect(effect)).not.toThrow();
    }
  });
});
