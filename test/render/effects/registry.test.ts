import { describe, it, expect } from "vitest";
import { effectRegistry, getEffect } from "../../../src/render/effects/registry";
import { glow } from "../../../src/render/effects/glow";

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
});

describe("glow effect module", () => {
  it("defines threshold and intensity params with sane defaults", () => {
    const threshold = glow.params.find((p) => p.name === "threshold");
    const intensity = glow.params.find((p) => p.name === "intensity");
    expect(threshold).toMatchObject({ min: 0, max: 1, default: 0.7, step: 0.01 });
    expect(intensity).toMatchObject({ min: 0, max: 3, default: 1.0, step: 0.05 });
  });

  it("declares an fs_main entry point in its WGSL", () => {
    expect(glow.wgsl).toMatch(/fn fs_main\(/);
  });
});
