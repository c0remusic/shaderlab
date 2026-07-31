import { describe, it, expect } from "vitest";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { glow } from "../../../src/render/effects/glow";
import { PASSTHROUGH_EFFECT } from "../../../src/render/effectPassRunner";

describe("effectRegistry", () => {
  it("contains the glow effect", () => {
    expect(effectRegistry).toContainEqual(glow);
  });

  it("getEffect resolves a known id", () => {
    expect(getEffect("glow")).toBe(glow);
  });

  it("getEffect throws on an unknown id", () => {
    expect(() => getEffect("nonexistent")).toThrow(/Effet inconnu/);
  });

  it("getEffect resolves \"passthrough\" to PASSTHROUGH_EFFECT without adding it to effectRegistry", () => {
    expect(getEffect("passthrough")).toBe(PASSTHROUGH_EFFECT);
    expect(effectRegistry.some((e) => e.id === "passthrough")).toBe(false);
  });

  it("exposes French display metadata for chromatic bleed parameters", () => {
    const chromaticBleed = getEffect("chromaticBleed");

    expect(chromaticBleed.params).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "amount",
          label: "Décalage chromatique",
          unit: "percent",
        }),
        expect.objectContaining({
          name: "centerFalloff",
          label: "Atténuation centrale",
          unit: "none",
        }),
      ]),
    );
  });
});

describe("glow effect module", () => {
  it("defines threshold and intensity params with sane defaults", () => {
    const threshold = glow.params.find((p) => p.name === "threshold");
    const intensity = glow.params.find((p) => p.name === "intensity");
    expect(threshold).toMatchObject({ min: 0, max: 1, default: 0.55, step: 0.01 });
    // Plafond d'intensité monté de 3 à 6 et défaut de 1.0 à 1.6 : le halo
    // plafonnait bien avant que le curseur ne bute, faute de course.
    expect(intensity).toMatchObject({ min: 0, max: 6, default: 1.6, step: 0.05 });
  });

  it("declares an fs_main entry point in its WGSL", () => {
    expect(glow.wgsl).toMatch(/fn fs_main\(/);
  });
});
