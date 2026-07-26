import { describe, it, expect } from "vitest";
import { grain } from "../../../src/render/effects/grain";
import { linearToSrgb, srgbToLinear } from "../../../src/render/effects/srgbTransfer";

/** Courbe de réponse du shader, transcrite à l'identique : l'entrée est la
 *  luma LINÉAIRE (ce que rend textureSample sur une texture -srgb). */
function response(lumaLinear: number): number {
  const tone = linearToSrgb(lumaLinear);
  return 4 * tone * (1 - tone);
}

/** Ancienne courbe (avant correction), gardée pour prouver le déplacement. */
function responseAvant(lumaLinear: number): number {
  return 4 * lumaLinear * (1 - lumaLinear);
}

function argmaxPerceptuel(f: (luma: number) => number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i <= 10000; i++) {
    const luma = i / 10000;
    const v = f(luma);
    if (v > bestValue) {
      bestValue = v;
      best = luma;
    }
  }
  return linearToSrgb(best);
}

describe("grain — courbe de réponse posée sur la luminance perceptuelle", () => {
  it("atteint son maximum dans les DEMI-TONS perceptuels (0.5)", () => {
    expect(argmaxPerceptuel(response)).toBeCloseTo(0.5, 3);
  });

  it("prouve le déplacement : l'ancienne courbe culminait à ~0.735 perceptuel", () => {
    // Pic dans les hautes lumières au lieu des demi-tons — le bug corrigé.
    expect(argmaxPerceptuel(responseAvant)).toBeCloseTo(0.7354, 3);
  });

  it("s'annule aux deux extrémités et reste bornée à 1", () => {
    expect(response(0)).toBeCloseTo(0, 12);
    expect(response(1)).toBeCloseTo(0, 12);
    expect(response(srgbToLinear(0.5))).toBeCloseTo(1, 6);
  });

  it("évalue la courbe sur linear_to_srgb(luma) dans le WGSL", () => {
    expect(grain.wgsl).toContain("let tone = linear_to_srgb(luma);");
    expect(grain.wgsl).toContain("let response = 4.0 * tone * (1.0 - tone);");
    expect(grain.wgsl).toMatch(/fn linear_to_srgb\(c: f32\)/);
  });

  it("laisse la couleur de sortie en linéaire (pas de double gamma)", () => {
    // response n'est qu'un scalaire de pondération : le bruit s'ajoute
    // toujours à color.rgb tel quel, jamais à une version ré-encodée.
    expect(grain.wgsl).toContain(
      "return vec4<f32>(color.rgb + vec3<f32>(noise) * intensity * response, color.a);",
    );
    expect(grain.wgsl).not.toMatch(/linear_to_srgb\(\s*color/);
  });
});
