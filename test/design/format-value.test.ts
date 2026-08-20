import { describe, expect, it } from "vitest";
import { formatControlValue, parseControlValue, parsePercentValue } from "../../src/ui/formatValue";

describe("formatControlValue", () => {
  it("keeps compact integers", () => expect(formatControlValue(42, 1)).toBe("42"));
  it("uses the precision implied by step", () => expect(formatControlValue(0.5, 0.05)).toBe("0.50"));
  it("uses three decimals for millisteps", () => expect(formatControlValue(0.125, 0.001)).toBe("0.125"));
});

describe("parseControlValue", () => {
  it("accepts a displayed unit and snaps the value to the control step", () => {
    expect(parseControlValue("506 px", 2, 800, 1)).toBe(506);
    expect(parseControlValue("0,52", 0, 1, 0.05)).toBe(0.5);
  });

  it("clamps values to the declared slider range", () => {
    expect(parseControlValue("-20", 0, 100, 1)).toBe(0);
    expect(parseControlValue("150", 0, 100, 1)).toBe(100);
  });

  it("rejects text that does not contain a numeric value", () => {
    expect(parseControlValue("aucune valeur", 0, 100, 1)).toBeNull();
  });
});

// Champ qui AFFICHE des pourcents pendant que son curseur reste en fraction :
// la saisie se lit en pourcents, se divise par 100, puis se borne et se cale
// en espace FRACTION. Le bug d'origine (ROADMAP 2026-08-20) : sans ce parse,
// « 60 » tapé dans un champ montrant « 50 % » passait par les bornes fraction
// et s'écrêtait à 1 (= 100 %).
describe("parsePercentValue", () => {
  it("reads the typed number as a percentage of the fraction range", () => {
    expect(parsePercentValue("60", 0, 1, 0.001)).toBe(0.6);
    expect(parsePercentValue("60 %", 0, 1, 0.001)).toBe(0.6);
    expect(parsePercentValue("12,5", 0, 1, 0.001)).toBe(0.125);
  });

  it("round-trips the displayed value exactly, so blur without typing changes nothing", () => {
    expect(parsePercentValue("50 %", 0, 1, 0.001)).toBe(0.5);
  });

  it("clamps and snaps in fraction space, on the slider's own bounds", () => {
    expect(parsePercentValue("150", 0, 1, 0.01)).toBe(1);
    expect(parsePercentValue("-20", 0, 1, 0.01)).toBe(0);
    expect(parsePercentValue("52", 0, 1, 0.05)).toBe(0.5);
  });

  it("rejects text that does not contain a numeric value", () => {
    expect(parsePercentValue("aucune valeur", 0, 1, 0.01)).toBeNull();
  });
});
