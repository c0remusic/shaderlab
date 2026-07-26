import { describe, it, expect } from "vitest";
import { duotone } from "../../../src/render/effects/duotone";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";

describe("duotone — couleurs utilisateur décodées vers le linéaire", () => {
  it("décode les TROIS couleurs du tritone avant tout mélange", () => {
    const decoded = duotone.wgsl.match(/srgb_to_linear3\(hsl2rgb\(/g) ?? [];
    expect(decoded).toHaveLength(3);
    // Aucune couleur ne doit rester écrite brute dans la cible -srgb.
    expect(duotone.wgsl).not.toMatch(/=\s*hsl2rgb\(/);
  });

  it("embarque les helpers de décodage", () => {
    expect(duotone.wgsl).toMatch(/fn srgb_to_linear\(c: f32\)/);
    expect(duotone.wgsl).toMatch(/fn srgb_to_linear3\(c: vec3<f32>\)/);
  });

  it("ne convertit jamais l'échantillon d'image (pas de double gamma)", () => {
    // La luma reste calculée sur `color.rgb` tel que rendu par textureSample,
    // qui est DÉJÀ linéaire (format -srgb) : la convertir serait la double
    // correction gamma que le projet n'a pas.
    expect(duotone.wgsl).toContain(
      "let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));",
    );
    expect(duotone.wgsl).not.toMatch(/srgb_to_linear3?\(\s*color/);
  });

  it("assombrit une couleur de luminosité moyenne d'un facteur ~2.3", () => {
    // Le symptôme rapporté : un bordeaux ressortait en gris-rosé délavé,
    // ~2x trop clair. Un gris sRGB 0.5 vaut 0.214 en linéaire.
    const perceptual = 0.5;
    expect(perceptual / srgbToLinear(perceptual)).toBeCloseTo(2.336, 3);
  });

  it("garde le défaut d'ombres (luminosité 0.25) loin du gris moyen", () => {
    const shadowLightness = duotone.params.find((p) => p.name === "shadowLightness");
    expect(shadowLightness?.default).toBe(0.25);
    expect(srgbToLinear(0.25)).toBeCloseTo(0.05088, 5);
  });
});
