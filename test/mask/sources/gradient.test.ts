import { describe, it, expect } from "vitest";
import { gradientSource, angleToEndpoints } from "../../../src/mask/sources/gradient";

describe("gradient source module", () => {
  it("id = gradient, defaultParams inclut angle/startX/startY/endX/endY/feather/invert", () => {
    expect(gradientSource.id).toBe("gradient");
    for (const key of ["angle", "startX", "startY", "endX", "endY", "feather", "invert"]) {
      expect(gradientSource.defaultParams).toHaveProperty(key);
    }
  });

  it("le wgsl calcule une projection linéaire le long du gradient", () => {
    expect(gradientSource.wgsl).toContain("fn fs_generate(");
    expect(gradientSource.wgsl).toContain("dot(");
  });
});

describe("angleToEndpoints", () => {
  it("reproduit start/end par défaut à angle=0 (défaut = horizontal, centre (0.5,0.5), longueur 0.4)", () => {
    const params = { startX: 0.3, startY: 0.5, endX: 0.7, endY: 0.5 };
    const result = angleToEndpoints(params, 0);
    expect(result.startX).toBeCloseTo(0.3, 5);
    expect(result.startY).toBeCloseTo(0.5, 5);
    expect(result.endX).toBeCloseTo(0.7, 5);
    expect(result.endY).toBeCloseTo(0.5, 5);
  });

  it("tourne autour du même centre en préservant la longueur", () => {
    const params = { startX: 0.3, startY: 0.5, endX: 0.7, endY: 0.5 };
    const result = angleToEndpoints(params, 90);
    expect(result.startX).toBeCloseTo(0.5, 5);
    expect(result.startY).toBeCloseTo(0.3, 5);
    expect(result.endX).toBeCloseTo(0.5, 5);
    expect(result.endY).toBeCloseTo(0.7, 5);
  });

  it("garde un centre et une longueur stables quel que soit l'angle de départ", () => {
    const params = { startX: 0.2, startY: 0.2, endX: 0.6, endY: 0.6 };
    const centerX = (params.startX + params.endX) / 2;
    const centerY = (params.startY + params.endY) / 2;
    const length = Math.hypot(params.endX - params.startX, params.endY - params.startY);
    const result = angleToEndpoints(params, 45);
    const newCenterX = (result.startX + result.endX) / 2;
    const newCenterY = (result.startY + result.endY) / 2;
    const newLength = Math.hypot(result.endX - result.startX, result.endY - result.startY);
    expect(newCenterX).toBeCloseTo(centerX, 5);
    expect(newCenterY).toBeCloseTo(centerY, 5);
    expect(newLength).toBeCloseTo(length, 5);
  });

  it("retombe sur une longueur par défaut de 0.4 si start === end (longueur nulle)", () => {
    const params = { startX: 0.5, startY: 0.5, endX: 0.5, endY: 0.5 };
    const result = angleToEndpoints(params, 0);
    const length = Math.hypot(result.endX - result.startX, result.endY - result.startY);
    expect(length).toBeCloseTo(0.4, 5);
  });
});
