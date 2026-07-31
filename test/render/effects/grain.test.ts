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
    // L'invariant tenu ici n'est PAS la forme littérale de la ligne de sortie,
    // c'est que `color.rgb` n'est jamais ré-encodé : on lui ajoute un delta
    // LINÉAIRE, et rien d'autre. Le delta est désormais calculé en repassant
    // par la fonction de transfert partagée — voir le test d'amplitude
    // ci-dessous pour ce que ça change réellement.
    expect(grain.wgsl).toContain("return vec4<f32>(color.rgb + vec3<f32>(perturbe - srgb_to_linear(tone)), color.a);");
    expect(grain.wgsl).not.toMatch(/linear_to_srgb\(\s*color/);
    expect(grain.wgsl).not.toMatch(/srgb_to_linear\(\s*color/);
  });
});

/** Amplitude PERCEPTUELLE réellement délivrée pour un bruit à pleine échelle
 *  (±0.5), à l'intensité par défaut du paramètre. C'est ce que l'œil voit —
 *  distinct de `response`, qui n'est que le scalaire de pondération. */
const INTENSITE_DEFAUT = 0.12;
const clamp01 = (x: number) => Math.min(Math.max(x, 0), 1);

function amplitudeDelivree(tonePerceptuel: number): number {
  const luma = srgbToLinear(tonePerceptuel);
  const demiAmplitude = 0.5 * INTENSITE_DEFAUT * response(luma);
  // Décalage posé sur le ton perceptuel, ramené en linéaire : en perceptuel,
  // l'écart délivré vaut exactement le décalage demandé.
  return clamp01(tonePerceptuel + demiAmplitude) - clamp01(tonePerceptuel - demiAmplitude);
}

/** Ce que délivrait l'ADDITION LINÉAIRE d'avant : la même demi-amplitude, mais
 *  ajoutée à la luma linéaire, donc dilatée par la compression sRGB. */
function amplitudeDelivreeAvant(tonePerceptuel: number): number {
  const luma = srgbToLinear(tonePerceptuel);
  const demiAmplitude = 0.5 * INTENSITE_DEFAUT * response(luma);
  return linearToSrgb(clamp01(luma + demiAmplitude)) - linearToSrgb(clamp01(luma - demiAmplitude));
}

function argmaxSurTonePerceptuel(f: (tone: number) => number): number {
  let best = 0;
  let bestValue = -Infinity;
  for (let i = 0; i <= 10000; i++) {
    const tone = i / 10000;
    const v = f(tone);
    if (v > bestValue) {
      bestValue = v;
      best = tone;
    }
  }
  return best;
}

describe("grain — amplitude réellement délivrée, pas seulement la pondération", () => {
  // Ce bloc existe parce que les tests de pondération ci-dessus étaient VERTS
  // pendant que le défaut existait : ils vérifiaient que la COURBE culmine au
  // demi-ton, jamais que le grain délivré le fasse. Une pondération
  // perceptuelle ajoutée linéairement ne produit pas un écart perceptuel
  // constant — la compression sRGB l'amplifie dans les ombres.
  //
  // LIMITE À CONNAÎTRE : ce bloc MODÉLISE le shader, il ne le lit pas. Il
  // verrouille la physique visée, pas le WGSL livré — une réécriture du shader
  // le laisserait vert. Ce qui relie les deux est le `toContain` verbatim du
  // bloc précédent, et c'est bien lui qui a rougi quand la ligne de sortie a
  // changé. Les deux gardes sont nécessaires ; aucune ne remplace l'autre.
  it("culmine au demi-ton perceptuel (0.50)", () => {
    expect(argmaxSurTonePerceptuel(amplitudeDelivree)).toBeCloseTo(0.5, 3);
  });

  it("prouve le déplacement : l'addition linéaire culminait à ~0.2268, dans les ombres", () => {
    expect(argmaxSurTonePerceptuel(amplitudeDelivreeAvant)).toBeCloseTo(0.2268, 3);
  });

  it("n'écrête plus le noir dans les ombres profondes", () => {
    // Au ton 0.10, l'addition linéaire poussait la borne basse sous zéro.
    const luma = srgbToLinear(0.1);
    const demiAmplitude = 0.5 * INTENSITE_DEFAUT * response(luma);
    expect(luma - demiAmplitude).toBeLessThan(0);
    expect(0.1 - demiAmplitude).toBeGreaterThan(0);
  });
});
