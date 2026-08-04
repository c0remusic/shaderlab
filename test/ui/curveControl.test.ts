import { describe, expect, it } from "vitest";
import { constrainCurvePoint, evaluateMonotoneCurve, identityCurve, insertCurvePoint, MAX_CURVE_POINTS, removeCurvePoint } from "../../src/ui/curveControl";

describe("curve control model", () => {
  it("keeps the identity curve neutral", () => {
    for (let index = 0; index <= 100; index += 1) {
      const value = index / 100;
      expect(evaluateMonotoneCurve(identityCurve(), value)).toBeCloseTo(value, 12);
    }
  });

  it("inserts points in x order and refuses a sixth point", () => {
    let points = identityCurve();
    points = insertCurvePoint(points, { x: 0.75, y: 0.8 });
    points = insertCurvePoint(points, { x: 0.25, y: 0.2 });
    points = insertCurvePoint(points, { x: 0.5, y: 0.5 });
    expect(points.map((point) => point.x)).toEqual([0, 0.25, 0.5, 0.75, 1]);
    expect(insertCurvePoint(points, { x: 0.6, y: 0.6 })).toEqual(points);
    expect(points).toHaveLength(MAX_CURVE_POINTS);
  });

  it("clamps a moved point between both neighbours on x and y", () => {
    const points = [{ x: 0, y: 0 }, { x: 0.3, y: 0.2 }, { x: 0.7, y: 0.8 }, { x: 1, y: 1 }];
    expect(constrainCurvePoint(points, 1, { x: 0.9, y: 0.95 })[1]).toEqual({ x: 0.699, y: 0.8 });
  });

  it("keeps endpoint x fixed and endpoints removable only in y", () => {
    const points = identityCurve();
    expect(constrainCurvePoint(points, 0, { x: 0.5, y: 0.2 })[0]).toEqual({ x: 0, y: 0.2 });
    expect(removeCurvePoint(points, 0)).toEqual(points);
    expect(removeCurvePoint(points, 1)).toEqual(points);
  });

  it("removes an interior point", () => {
    expect(removeCurvePoint([{ x: 0, y: 0 }, { x: 0.5, y: 0.4 }, { x: 1, y: 1 }], 1)).toEqual(identityCurve());
  });

  it("never overshoots a monotone S curve", () => {
    const points = [{ x: 0, y: 0 }, { x: 0.2, y: 0.05 }, { x: 0.8, y: 0.95 }, { x: 1, y: 1 }];
    const values = Array.from({ length: 1001 }, (_, index) => evaluateMonotoneCurve(points, index / 1000));
    expect(values.every((value) => value >= 0 && value <= 1)).toBe(true);
    expect(values.every((value, index) => index === 0 || value >= values[index - 1])).toBe(true);
  });

  it("clamps evaluation outside the input domain", () => {
    expect(evaluateMonotoneCurve(identityCurve(), -2)).toBe(0);
    expect(evaluateMonotoneCurve(identityCurve(), 3)).toBe(1);
  });
});
