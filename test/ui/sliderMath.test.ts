import { describe, expect, it } from "vitest";
import { sliderProgress } from "../../src/ui/sliderMath";

describe("sliderProgress", () => {
  it("convertit une valeur en progression de piste et borne les dépassements", () => {
    expect([0, 0.5, 1, -1, 2].map((value) => sliderProgress(value, 0, 1))).toEqual([
      0,
      50,
      100,
      0,
      100,
    ]);
  });

  it("retourne zéro quand la plage est invalide", () => {
    expect(sliderProgress(3, 3, 3)).toBe(0);
  });
});
