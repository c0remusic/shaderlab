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

  it("declares the mask binding and compositing mix() only when applyMask is true", () => {
    const masked = composeShader(FS, {
      applyMask: true,
      hasPrevPass: false,
      blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }",
    });
    const unmasked = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(masked).toContain("@binding(3) var maskTexture");
    expect(masked).toContain("mix(color.rgb, blended, compositing.x * maskValue)");
    expect(unmasked).not.toContain("maskTexture");
    expect(unmasked).toContain("return effected;");
  });

  it("chemin applyMask compose blend + opacité (binding 5)", () => {
    const code = composeShader("fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }", {
      applyMask: true,
      hasPrevPass: false,
      blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }",
    });
    expect(code).toContain("@group(0) @binding(5) var<uniform> compositing: vec4<f32>;");
    expect(code).toContain("fn blend(");
    expect(code).toContain("compositing.x");
    expect(code).toContain("srgb2lin");
    expect(code).toContain("lin2srgb");
  });

  it("chemin sans masque inchangé (return effected, ni blend ni compositing)", () => {
    const code = composeShader("fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }", {
      applyMask: false,
      hasPrevPass: false,
    });
    expect(code).toContain("return effected;");
    expect(code).not.toContain("binding(5)");
    expect(code).not.toContain("fn blend(");
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
