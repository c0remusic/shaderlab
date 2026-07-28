import { describe, it, expect } from "vitest";
import {
  buildMorphologyWgsl,
  MORPHOLOGY_PASS_AXES,
} from "../../src/mask/refineEdgeWgsl";

// L'équivalence de la séparation H/V avec la fenêtre carrée est prouvée
// séparément dans morphologySeparable.test.ts ; ici on ne verrouille que le
// contrat de génération (opérateur, uniform, points d'entrée).

describe("refine edge WGSL passes", () => {
  for (const axis of MORPHOLOGY_PASS_AXES) {
    it(`buildMorphologyWgsl('dilate', '${axis}') prend le max du voisinage`, () => {
      const wgsl = buildMorphologyWgsl("dilate", axis);
      expect(wgsl).toContain(`fn fs_morphology${axis}(`);
      expect(wgsl).toContain("max(");
    });

    it(`buildMorphologyWgsl('erode', '${axis}') prend le min du voisinage`, () => {
      const wgsl = buildMorphologyWgsl("erode", axis);
      expect(wgsl).toContain(`fn fs_morphology${axis}(`);
      expect(wgsl).toContain("min(");
    });
  }

  it("buildMorphologyWgsl expose un radius en uniform (px signé -> passes converties par l'appelant)", () => {
    expect(buildMorphologyWgsl("dilate", "H")).toContain(
      "var<uniform> radius: f32",
    );
  });
});
