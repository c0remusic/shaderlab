import { describe, it, expect } from "vitest";
import { wheelTickValue } from "../../src/ui/activeControl";

describe("wheelTickValue", () => {
  it("molette vers le haut (deltaY négatif) augmente la valeur", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, -1);
    expect(next).toBeGreaterThan(50);
  });

  it("molette vers le bas (deltaY positif) diminue la valeur", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, 1);
    expect(next).toBeLessThan(50);
  });

  it("un cran = 1% de la plage (max-min), indépendant du step déclaré", () => {
    const next = wheelTickValue({ value: 50, min: 0, max: 100 }, -1);
    expect(next).toBeCloseTo(51, 6); // 1% de 100 = 1
  });

  it("s'adapte à la plage : 1% de 2..200 ≈ 2 par cran", () => {
    const next = wheelTickValue({ value: 30, min: 2, max: 200 }, -1);
    expect(next).toBeCloseTo(31.98, 2);
  });

  it("clampe au maximum", () => {
    const next = wheelTickValue({ value: 99.8, min: 0, max: 100 }, -1);
    expect(next).toBe(100);
  });

  it("clampe au minimum", () => {
    const next = wheelTickValue({ value: 0.5, min: 0, max: 100 }, 1);
    expect(next).toBe(0);
  });

  it("ne produit pas d'artefact flottant (arrondi propre)", () => {
    const next = wheelTickValue({ value: 0.5, min: 0, max: 1 }, -1);
    // 1% de (1-0) = 0.01 -> 0.51 exact, pas 0.51000000000000001
    expect(next.toString().length).toBeLessThanOrEqual(4);
  });
});
