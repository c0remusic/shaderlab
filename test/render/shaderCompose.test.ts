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

describe("composeShader hasImageSource", () => {
  it("declares the coverage binding only when hasImageSource is true", () => {
    const withSource = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    const without = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: false, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    expect(withSource).toContain("@group(0) @binding(6) var coverageTexture");
    expect(without).not.toContain("coverageTexture");
  });

  it("fs_main reçoit l'échantillon imageSource comme entrée quand hasImageSource est vrai, color sinon", () => {
    const withSource = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    const without = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: false, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    expect(withSource).toContain("let effectInput = textureSample(coverageTexture, srcSampler, in.uv);");
    expect(without).toContain("let effectInput = color;");
  });

  it("le poids du mix inclut la couverture (alpha imageSource) uniquement quand hasImageSource est vrai", () => {
    const withSource = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    const without = composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: false, blendWgsl: "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }" });
    expect(withSource).toContain("compositing.x * maskValue * effectInput.a");
    expect(without).not.toContain("effectInput.a");
    // NB : le brief attendait littéralement "compositing.x * maskValue);" —
    // divergence avec le code réel, qui enveloppe toujours le mix dans
    // `vec4<f32>(mix(...), color.a)` (voir shaderCompose.ts, préservé
    // depuis avant cette tâche). Assertion adaptée à la structure réelle.
    expect(without).toContain("compositing.x * maskValue),");
  });

  it("hasImageSource=true SANS applyMask ne déclare pas le binding (les passes internes n'en ont pas besoin)", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false, hasImageSource: true });
    expect(code).not.toContain("coverageTexture");
  });
});

const BLEND = "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }";

describe("composeShader clipToCoverage (écrêtage, 2026-07-27)", () => {
  it("déclare le binding de couverture quand clipToCoverage est vrai", () => {
    const clipped = composeShader(FS, { applyMask: true, hasPrevPass: false, clipToCoverage: true, blendWgsl: BLEND });
    const plain = composeShader(FS, { applyMask: true, hasPrevPass: false, blendWgsl: BLEND });
    expect(clipped).toContain("@group(0) @binding(6) var coverageTexture");
    expect(plain).not.toContain("coverageTexture");
  });

  it("garde `color` comme entrée d'effet — l'effet doit voir les pixels qu'il traite", () => {
    const clipped = composeShader(FS, { applyMask: true, hasPrevPass: false, clipToCoverage: true, blendWgsl: BLEND });
    expect(clipped).toContain("let effectInput = color;");
  });

  it("borne le POIDS du mix par l'alpha de la couverture (le défaut le plus probable est de l'oublier)", () => {
    const clipped = composeShader(FS, { applyMask: true, hasPrevPass: false, clipToCoverage: true, blendWgsl: BLEND });
    expect(clipped).toContain(
      "mix(color.rgb, blended, compositing.x * maskValue * textureSample(coverageTexture, srcSampler, in.uv).a)",
    );
  });

  it("clipToCoverage=true SANS applyMask ne déclare pas le binding (passes internes)", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false, clipToCoverage: true });
    expect(code).not.toContain("coverageTexture");
  });

  it("lève quand hasImageSource et clipToCoverage sont tous deux vrais (assert inatteignable)", () => {
    expect(() =>
      composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, clipToCoverage: true, blendWgsl: BLEND }),
    ).toThrow(/mutuellement exclusifs/);
    // Lève même hors chemin de compositing : la garde porte sur les drapeaux
    // bruts, pas sur leur version filtrée par applyMask.
    expect(() =>
      composeShader(FS, { applyMask: false, hasPrevPass: false, hasImageSource: true, clipToCoverage: true }),
    ).toThrow(/mutuellement exclusifs/);
  });

  it("produit une variante de pipeline distincte (pas de collision de clé de cache)", () => {
    const variants = [
      composeShader(FS, { applyMask: true, hasPrevPass: false, blendWgsl: BLEND }),
      composeShader(FS, { applyMask: true, hasPrevPass: false, clipToCoverage: true, blendWgsl: BLEND }),
      composeShader(FS, { applyMask: true, hasPrevPass: false, hasImageSource: true, blendWgsl: BLEND }),
    ];
    expect(new Set(variants).size).toBe(3);
  });
});
