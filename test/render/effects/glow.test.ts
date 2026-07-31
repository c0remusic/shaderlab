import { describe, it, expect } from "vitest";
import { glow } from "../../../src/render/effects/glow";
import { srgbToLinear } from "../../../src/render/effects/srgbTransfer";

const brightPass = glow.passes?.[0];

describe("glow — seuil de bright-pass décodé vers le linéaire", () => {
  it("décode params[0] avant de le comparer à la luminance", () => {
    expect(brightPass).toBeDefined();
    expect(brightPass!.wgsl).toContain("let threshold = srgb_to_linear(params[0]);");
    expect(brightPass!.wgsl).toMatch(/fn srgb_to_linear\(c: f32\)/);
  });

  it("ne convertit pas l'échantillon d'image (pas de double gamma)", () => {
    // brightness sort de color.rgb, déjà linéaire via le format -srgb.
    expect(brightPass!.wgsl).toContain(
      "let brightness = max(color.r, max(color.g, color.b));",
    );
    expect(brightPass!.wgsl).not.toMatch(/srgb_to_linear\(\s*(color|brightness)/);
  });

  it("place le milieu de course du slider à ~0.214 linéaire, pas 0.5", () => {
    // Avant correction : 0.5 était comparé tel quel à une luminance linéaire,
    // soit ~0.735 en perceptuel — le bloom ne mordait que sur le cramé.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);
    expect(srgbToLinear(0.5)).toBeLessThan(0.5);
  });

  it("ramène le seuil par défaut sous la moitié de l'échelle linéaire", () => {
    const threshold = glow.params.find((p) => p.name === "threshold");
    // Défaut redescendu de 0.7 à 0.55 : à 0.7 le bright-pass ne laissait
    // entrer qu'une fraction du pixel (26 % à sRGB 0.80), et le halo par
    // défaut était invisible sur une photo qui n'a pas de zone cramée.
    expect(threshold?.default).toBe(0.55);
    // Le seuil reste décodé vers le LINÉAIRE : l'ancien comportement plaçait
    // la bascule à la valeur perceptuelle prise telle quelle, soit ~0.87
    // perceptuel, inerte sur 85 % de la course.
    expect(srgbToLinear(0.55)).toBeLessThan(0.5);
    expect(srgbToLinear(0.7)).toBeCloseTo(0.4480, 4);
  });
});
