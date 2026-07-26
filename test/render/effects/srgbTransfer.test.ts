import { describe, it, expect } from "vitest";
import {
  linearToSrgb,
  srgbToLinear,
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
} from "../../../src/render/effects/srgbTransfer";

describe("srgbTransfer", () => {
  it("décode le milieu de course perceptuel vers ~0.214 linéaire", () => {
    // Le nombre pivot de tout ce chantier : une valeur utilisateur de 0.5
    // (slider ou luminosité de picker) ne vaut PAS 0.5 en linéaire.
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);
  });

  it("garde les bornes 0 et 1 fixes dans les deux sens", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 12);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 12);
  });

  it("est un aller-retour fidèle (les deux fonctions sont bien inverses)", () => {
    // Tolérance 1e-7 : la courbe sRGB standard a une micro-discontinuité au
    // coude (0.04045 / 0.0031308), l'aller-retour n'y est pas exact au bit.
    for (const v of [0.001, 0.01, 0.04045, 0.2, 0.5, 0.7, 0.9]) {
      expect(linearToSrgb(srgbToLinear(v))).toBeCloseTo(v, 6);
      expect(srgbToLinear(linearToSrgb(v))).toBeCloseTo(v, 6);
    }
  });

  it("expose les mêmes constantes de formule côté WGSL", () => {
    // Verrou anti-dérive : si un jour la formule TS et la formule WGSL
    // divergent, les tests numériques ci-dessus ne prouveraient plus rien du
    // shader. On vérifie que les deux branches (segment linéaire + exposant)
    // sont bien celles de la spec sRGB.
    expect(SRGB_TO_LINEAR_WGSL).toContain("pow((x + 0.055) / 1.055, 2.4)");
    expect(SRGB_TO_LINEAR_WGSL).toContain("x / 12.92");
    expect(SRGB_TO_LINEAR_WGSL).toContain("x <= 0.04045");
    expect(LINEAR_TO_SRGB_WGSL).toContain("1.055 * pow(x, 1.0 / 2.4) - 0.055");
    expect(LINEAR_TO_SRGB_WGSL).toContain("x * 12.92");
    expect(LINEAR_TO_SRGB_WGSL).toContain("x <= 0.0031308");
    expect(SRGB_TO_LINEAR_VEC3_WGSL).toContain(
      "vec3<f32>(srgb_to_linear(c.r), srgb_to_linear(c.g), srgb_to_linear(c.b))",
    );
  });
});
