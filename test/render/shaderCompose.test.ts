import { describe, it, expect } from "vitest";
import { composeShader, MAX_EFFECT_PARAMS } from "../../src/render/shaderCompose";

const FS = "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }";

describe("composeShader", () => {
  it("is deterministic: same inputs produce the identical string (cache key stability)", () => {
    const a = composeShader(FS, { applyMask: true, hasPrevPass: false });
    const b = composeShader(FS, { applyMask: true, hasPrevPass: false });
    expect(a).toBe(b);
  });

  it("includes the fullscreen vertex stage and the effect body", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(code).toContain("fn vs_main");
    expect(code).toContain(FS);
    expect(code).toContain(`array<f32, ${MAX_EFFECT_PARAMS}>`);
  });

  it("declares the mask binding and mix() only when applyMask is true", () => {
    const masked = composeShader(FS, { applyMask: true, hasPrevPass: false });
    const unmasked = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(masked).toContain("@binding(3) var maskTexture");
    expect(masked).toContain("mix(color, effected, maskValue)");
    expect(unmasked).not.toContain("maskTexture");
    expect(unmasked).toContain("return effected;");
  });

  it("declares the prevPass binding only when hasPrevPass is true", () => {
    const withPrev = composeShader(FS, { applyMask: false, hasPrevPass: true });
    const without = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(withPrev).toContain("@binding(4) var prevPass");
    expect(without).not.toContain("prevPass");
  });

  it("produces distinct strings for distinct variants (no cache collisions)", () => {
    const variants = [
      composeShader(FS, { applyMask: false, hasPrevPass: false }),
      composeShader(FS, { applyMask: true, hasPrevPass: false }),
      composeShader(FS, { applyMask: false, hasPrevPass: true }),
      composeShader(FS, { applyMask: true, hasPrevPass: true }),
    ];
    expect(new Set(variants).size).toBe(4);
  });
});
