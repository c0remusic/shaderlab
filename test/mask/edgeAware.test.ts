import { describe, it, expect } from "vitest";
import { computeGuidedAB, composeEdgeAware } from "../../src/mask/edgeAware";

describe("computeGuidedAB", () => {
  it("var_I = 0 (image plate) ne produit ni NaN ni Infinity (eps protège)", () => {
    const { a, b } = computeGuidedAB(0.5, 0.5, 0.25, 0.25, 1e-4);
    expect(Number.isFinite(a)).toBe(true);
    expect(Number.isFinite(b)).toBe(true);
  });

  it("guide parfaitement corrélé au masque (I === p partout) => a=1, b=0", () => {
    // meanI=meanP=0.5, corrI=corrIp=0.5 (varI=0.25, grande devant eps=1e-4).
    // L'exemple 0.3/0.3 du plan donne a=0.998 (varI=0.05, hors tolérance
    // toBeCloseTo(1,3) — vérifié en exécutant le test contre la formule).
    const { a, b } = computeGuidedAB(0.5, 0.5, 0.5, 0.5, 1e-4);
    expect(a).toBeCloseTo(1, 3);
    expect(b).toBeCloseTo(0, 3);
  });

  it("a et b peuvent être négatifs ou > 1 (non bornés, cf. design.md §4bis)", () => {
    // meanI=meanP=0.5, corrI=0.3 (varI=0.05>0), corrIp=0.1 => covIp=-0.15 => a<0
    // (l'exemple 0.9/0.1/0.05/-0.02 du plan donne a=+0.145, positif — vérifié
    // en exécutant le test contre la formule qu'il spécifie lui-même).
    const { a } = computeGuidedAB(0.5, 0.5, 0.3, 0.1, 1e-4);
    expect(a).toBeLessThan(0);
  });
});

describe("composeEdgeAware", () => {
  it("edgeStrength = 0 => identique à p (pas de dérive numérique)", () => {
    expect(composeEdgeAware(0.42, 0.9, 0)).toBe(0.42);
  });

  it("edgeStrength = 1 => identique à q", () => {
    expect(composeEdgeAware(0.42, 0.9, 1)).toBe(0.9);
  });

  it("interpole linéairement entre p et q pour 0 < edgeStrength < 1", () => {
    expect(composeEdgeAware(0, 1, 0.3)).toBeCloseTo(0.3, 6);
  });

  it("résultat toujours borné dans [0,1] même si q sort de [0,1]", () => {
    expect(composeEdgeAware(0.5, 1.4, 1)).toBe(1);
    expect(composeEdgeAware(0.5, -0.3, 1)).toBe(0);
  });
});
