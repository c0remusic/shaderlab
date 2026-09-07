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
    expect(masked).toContain("let srcAlpha = compositing.x * maskValue;");
    expect(masked).toContain("mix(color.rgb, blended, srcAlpha / outAlpha)");
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
    expect(withSource).toContain("let srcAlpha = compositing.x * maskValue * effectInput.a;");
    expect(without).not.toContain("effectInput.a");
    expect(without).toContain("let srcAlpha = compositing.x * maskValue;");
  });

  it("hasImageSource=true SANS applyMask ne déclare pas le binding (les passes internes n'en ont pas besoin)", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false, hasImageSource: true });
    expect(code).not.toContain("coverageTexture");
  });
});

// ÉTIREMENT DU RENDU (ticket 24, voie B). Le gate discriminant est l'IDENTITÉ
// byte-identique : la chaîne composée EST la clé du cache de pipelines, donc
// sans transform actif elle ne doit pas changer d'un octet.
describe("composeShader hasEffectTransform", () => {
  const BLEND = "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }";

  it("CHEMIN IDENTITÉ byte-identique : hasEffectTransform:false === option absente", () => {
    const sansOption = composeShader(FS, { applyMask: true, hasPrevPass: false, blendWgsl: BLEND });
    const optionFausse = composeShader(FS, { applyMask: true, hasPrevPass: false, hasEffectTransform: false, blendWgsl: BLEND });
    expect(optionFausse).toBe(sansOption);
    // Et rien du bloc transform ne fuit dans le chemin identité.
    expect(sansOption).not.toContain("effectTransform");
    expect(sansOption).not.toContain("uvT");
    expect(sansOption).toContain("let effected = fs_main(in.uv, effectInput);");
  });

  it("variante transform : déclare le binding 8 et déforme l'UV de fs_main, pas effectInput", () => {
    const avec = composeShader(FS, { applyMask: true, hasPrevPass: false, hasEffectTransform: true, blendWgsl: BLEND });
    expect(avec).toContain("@group(0) @binding(8) var<uniform> effectTransform: vec4<f32>;");
    expect(avec).toContain("let uvT = (in.uv - effectTransform.zw) * effectTransform.xy + effectTransform.zw;");
    expect(avec).toContain("let effected = fs_main(uvT, effectInput);");
    // effectInput reste échantillonné à l'UV identité (le fond ne bouge pas).
    expect(avec).toContain("let effectInput = color;");
    // La chaîne DIFFÈRE de l'identité — sinon même pipeline, effet nul.
    const identite = composeShader(FS, { applyMask: true, hasPrevPass: false, blendWgsl: BLEND });
    expect(avec).not.toBe(identite);
  });

  it("hasEffectTransform=true SANS applyMask n'émet rien (passes internes au repère identité)", () => {
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false, hasEffectTransform: true });
    expect(code).not.toContain("effectTransform");
    expect(code).not.toContain("uvT");
    // Byte-identique au chemin sans masque ordinaire.
    expect(code).toBe(composeShader(FS, { applyMask: false, hasPrevPass: false }));
  });
});

// Tranche T0 (design 2026-07-28 « le fond devient un calque ») : l'alpha est
// COMPOSÉ, plus hérité du bas de chaîne. Ces tests verrouillent le texte du
// WGSL, pas son exécution — la compilation réelle est le rôle de
// `npm run test:gpu-shaders`, le rendu celui du checkpoint visuel.
describe("composeShader — composition de l'alpha (T0)", () => {
  const BLEND_T0 = "fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }";
  const masked = () =>
    composeShader(FS, { applyMask: true, hasPrevPass: false, blendWgsl: BLEND_T0 });

  it("ne renvoie plus color.a tel quel : l'alpha de sortie est composé", () => {
    const code = masked();
    // Le court-circuit d'avant T0. Sa disparition est LE changement : tant
    // qu'il est là, une toile transparente ressort opaque et le damier ne peut
    // pas exister.
    expect(code).not.toContain(", color.a);");
    expect(code).toContain("let outAlpha = srcAlpha + backdropAlpha * (1.0 - srcAlpha);");
    expect(code).toContain("return vec4<f32>(outRgb, outAlpha);");
  });

  it("le mode de fusion n'agit que sur la part couverte du backdrop", () => {
    // Sans ce mix, un calque posé là où rien ne couvre fusionnerait avec du
    // vide (color.rgb = 0) au lieu de ressortir tel quel — un `multiply` en bas
    // de pile donnerait du noir sur toute la zone transparente.
    expect(masked()).toContain(
      "let blended = mix(effected.rgb, blend(color.rgb, effected.rgb), backdropAlpha);",
    );
  });

  it("protège la division par l'alpha de sortie (zone totalement transparente)", () => {
    // `srcAlpha / outAlpha` vaut NaN quand rien ne couvre. `select` choisit une
    // valeur, il ne calcule pas : la branche NaN est évaluée puis jetée.
    expect(masked()).toContain(
      "let outRgb = select(vec3<f32>(0.0), mix(color.rgb, blended, srcAlpha / outAlpha), outAlpha > 0.0);",
    );
  });

  it("le chemin SANS masque reste une copie verbatim (alpha inclus)", () => {
    // C'est ce chemin qu'emprunte la passe neutre `passthrough` depuis T0 :
    // le court-circuit « 0 calque activé ». Le chemin de compositing forcerait
    // son alpha de sortie à 1.
    const code = composeShader(FS, { applyMask: false, hasPrevPass: false });
    expect(code).toContain("return effected;");
    expect(code).not.toContain("outAlpha");
  });
});
