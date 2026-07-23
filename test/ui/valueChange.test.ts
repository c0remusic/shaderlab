import { describe, expect, it } from "vitest";
import { hasValueChanged } from "../../src/ui/valueChange";
import { wheelTickValue } from "../../src/ui/activeControl";

describe("hasValueChanged", () => {
  it("returns false for identical numbers", () => {
    expect(hasValueChanged(0.5, 0.5)).toBe(false);
  });

  it("returns true when numbers differ", () => {
    expect(hasValueChanged(0.5, 0.6)).toBe(true);
  });

  it("returns false for identical arrays (colorRange samples)", () => {
    expect(hasValueChanged([0.1, 0.2, 0.3], [0.1, 0.2, 0.3])).toBe(false);
  });

  it("returns true when an array element differs", () => {
    expect(hasValueChanged([0.1, 0.2, 0.3], [0.1, 0.9, 0.3])).toBe(true);
  });

  it("returns true when array lengths differ", () => {
    expect(hasValueChanged([0.1, 0.2], [0.1, 0.2, 0.3])).toBe(true);
  });

  it("a wheel tick clamped at the max bound leaves the value unchanged", () => {
    // Molette vers le haut à la borne max : wheelTickValue clampe déjà au
    // même nombre — hasValueChanged doit le détecter pour éviter une entrée
    // d'historique vide (cas réel : LabeledSlider.handleWheel appelait
    // onChange sans comparer avant ce fix).
    const atMax = wheelTickValue({ value: 100, min: 0, max: 100 }, -120);
    expect(hasValueChanged(100, atMax)).toBe(false);
  });

  it("a wheel tick clamped at the min bound leaves the value unchanged", () => {
    const atMin = wheelTickValue({ value: 0, min: 0, max: 100 }, 120);
    expect(hasValueChanged(0, atMin)).toBe(false);
  });
});
