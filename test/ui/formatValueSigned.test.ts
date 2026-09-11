import { describe, it, expect } from "vitest";
import { formatSignedValue, parseSignedValue } from "../../src/ui/formatValue";

describe("valeur signée à la Lightroom (ticket 07)", () => {
  it("formate le signe explicite avec espace fine, minus typographique, et 0 nu", () => {
    expect(formatSignedValue(100, 1)).toBe("+ 100");
    expect(formatSignedValue(-100, 1)).toBe("− 100");
    expect(formatSignedValue(0, 1)).toBe("0");
    // Décimales dérivées du pas, comme le reste de l'app.
    expect(formatSignedValue(-0.46, 0.05)).toBe("− 0.46");
    expect(formatSignedValue(1, 0.05)).toBe("+ 1.00");
  });

  it("relit le signe même derrière l'espace et le minus typographique", () => {
    expect(parseSignedValue("+ 100", -100, 100, 1)).toBe(100);
    // Sans normalisation, le − U+2212 et l'espace feraient lire un POSITIF. La
    // valeur est calée sur le pas (0.05) comme tout champ : −0.45 est sur la
    // grille.
    expect(parseSignedValue("− 0.45", -5, 5, 0.05)).toBe(-0.45);
    // Virgule décimale tolérée aussi.
    expect(parseSignedValue("−0,45", -5, 5, 0.05)).toBe(-0.45);
    expect(parseSignedValue("- 60", -100, 100, 1)).toBe(-60);
    // Une valeur hors grille (stockée par un preset) se cale au pas le plus
    // proche à la relecture — même contrat que les autres champs.
    expect(parseSignedValue("− 0.46", -5, 5, 0.05)).toBe(-0.45);
  });

  it("borne et cale sur le pas comme les autres champs", () => {
    expect(parseSignedValue("+ 999", -100, 100, 1)).toBe(100);
    expect(parseSignedValue("abc", -100, 100, 1)).toBeNull();
  });
});
