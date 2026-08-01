import { describe, it, expect } from "vitest";
import { motionBlur } from "../../../src/render/effects/motionBlur";
import { lensBlur } from "../../../src/render/effects/lensBlur";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";

const gather = motionBlur.passes?.[0];

describe("motionBlur — la trajectoire", () => {
  it("expose trois trajectoires, directionnelle par défaut", () => {
    const traj = motionBlur.params.find((p) => p.name === "trajectory");
    expect(traj?.choices).toEqual(["Directionnel", "Rotation", "Zoom"]);
    expect(traj?.default).toBe(0);
  });

  it("fait croître la traînée avec le RAYON en rotation et en zoom", () => {
    // C'est la propriété qui laisse le centre net sans qu'aucun réglage ne le
    // demande, et c'est elle que le témoin de rendu vérifie à l'œil. Le
    // déplacement est proportionnel à `d`, l'écart au centre.
    expect(gather?.wgsl).toContain("let tangent = vec2<f32>(-d.y, d.x);");
    expect(gather?.wgsl).toContain("return tangent * (amount * 0.017453292519943295) / ar;");
    expect(gather?.wgsl).toContain("return d * amount / ar;");
  });

  it("corrige l'aspect sur les deux trajectoires centrées", () => {
    // Sans `aspectScale`, un « flou de rotation » sur une photo 3:2 décrirait
    // une ellipse et le curseur d'amplitude mentirait selon l'orientation.
    expect(gather?.wgsl).toContain("let d = (uv - center) * ar;");
  });

  it("partage UNE seule définition de traînée entre les deux passes", () => {
    // La collecte s'en sert pour savoir combien d'échantillons prendre, la
    // passe finale pour savoir où reprendre le net. Deux définitions
    // divergentes se verraient comme une frange au raccord.
    expect(gather?.wgsl).toContain("fn motion_trail(uv: vec2<f32>, dims: vec2<f32>) -> vec2<f32> {");
    expect(motionBlur.wgsl).toContain("fn motion_trail(uv: vec2<f32>, dims: vec2<f32>) -> vec2<f32> {");
  });
});

describe("motionBlur — ce qui empêche les copies fantômes", () => {
  it("fait suivre le nombre d'échantillons à la LONGUEUR de la traînée", () => {
    // À nombre fixe, une traînée longue se décompose en copies espacées — le
    // défaut le plus reconnaissable d'un motion blur raté, et exactement celui
    // que `lensBlur` a montré avant correction.
    expect(gather?.wgsl).toContain("let n = clamp(i32(lenTexels), 4, 192);");
    expect(gather?.wgsl).toContain("for (var i = 0; i < n; i = i + 1) {");
  });

  it("tire le départ de l'échantillonnage PAR PIXEL", () => {
    expect(gather?.wgsl).toContain("let jitter = hash(uv * dims);");
    expect(gather?.wgsl).toContain("let t = (f32(i) + jitter) / nf - 0.5 + bias * 0.5;");
  });

  it("échantillonne en textureSampleLevel, pas en textureSample", () => {
    // Le court-circuit de traînée courte rend le flux de contrôle NON UNIFORME,
    // et `textureSample` calcule des dérivées implicites. Une régression ici ne
    // casserait AUCUN test Node — seulement la compilation sur GPU réel.
    expect(gather?.wgsl).toContain("textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv + trail * t), 0.0)");
    expect(gather?.wgsl).not.toMatch(/textureSample\(srcTexture/);
  });

  it("divise par la somme des poids APPLIQUÉS, jamais par le nombre d'échantillons", () => {
    // Avec une pondération en cloche, diviser par `n` assombrirait toute la
    // traînée — même piège que la moyenne de Karis du glow.
    expect(gather?.wgsl).toContain("return sum / max(wsum, 0.0001);");
    expect(gather?.wgsl).not.toMatch(/sum\s*\/\s*nf/);
  });
});

describe("motionBlur — l'obturateur", () => {
  it("est centré par défaut et décentrable des deux côtés", () => {
    const bias = motionBlur.params.find((p) => p.name === "bias");
    expect(bias).toMatchObject({ min: -1, max: 1, default: 0 });
  });

  it("pondère plat à extinction nulle, en cloche à un", () => {
    // La cloche n'est pas « plus correcte » — un obturateur mécanique EST franc
    // — mais elle donne la traînée qui s'éteint, qu'on attend d'un filé.
    expect(gather?.wgsl).toContain("let w = mix(1.0, 1.0 - abs(t) * 2.0, falloff);");
  });
});

describe("motionBlur — le raccord net/flou", () => {
  it("reprend la couleur PLEINE DÉFINITION sous le pixel", () => {
    // Visible au CENTRE d'une rotation ou d'un zoom, précisément l'endroit que
    // ces trajectoires sont censées laisser intact.
    expect(motionBlur.passes?.[0].scale).toBe(0.5);
    expect(motionBlur.wgsl).toContain("let sharpness = smoothstep(1.0, 2.0, lenPx);");
    expect(motionBlur.wgsl).toContain("mix(color.rgb, blurred.rgb, sharpness)");
  });

  it("fait coïncider ce seuil avec le court-circuit de la collecte", () => {
    // 0.5 texel de demi-résolution = 1 px pleine définition : les deux chemins
    // coïncident, donc le raccord est invisible par construction.
    expect(gather?.wgsl).toContain("if (lenTexels < 0.5) {");
  });
});

describe("motionBlur — registre", () => {
  it("est enregistré juste après lensBlur, sans partager son noyau", () => {
    expect(getEffect("motionBlur")).toBe(motionBlur);
    const i = effectRegistry.indexOf(motionBlur);
    expect(effectRegistry[i - 1]).toBe(lensBlur);
    // Une intégration sur une SURFACE et une intégration le long d'une COURBE :
    // un disque de bokeh n'a rien à faire dans une traînée.
    expect(motionBlur.wgsl).not.toContain("aperture_radius");
    expect(gather?.wgsl).not.toContain("aperture_radius");
  });

  it("lit ses paramètres dans l'ordre exact où il les déclare", () => {
    expect(motionBlur.params.map((p) => p.name)).toEqual([
      "trajectory", "amount", "angle", "centerX", "centerY", "bias", "falloff",
    ]);
    expect(gather?.wgsl).toContain("let mode = i32(params[0] + 0.5);");
    expect(gather?.wgsl).toContain("let falloff = clamp(params[6], 0.0, 1.0);");
  });
});
