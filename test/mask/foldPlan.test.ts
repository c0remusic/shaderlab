import { describe, it, expect } from "vitest";
import { planFold, snapshotFoldInputs, foldInputsEqual } from "../../src/mask/foldPlan";
import { defaultLayerMask, createBrushSource, type MaskSource } from "../../src/mask/types";

function brush(id: string, combineMode: MaskSource["combineMode"] = "add", enabled = true, raster: Uint8Array | null = new Uint8Array([1])): MaskSource {
  return { ...createBrushSource(id, raster ?? new Uint8Array(0)), combineMode, enabled, raster };
}

describe("planFold", () => {
  it("returns [] when the mask itself is disabled, regardless of sources", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a")];
    mask.enabled = false;
    expect(planFold(mask)).toEqual([]);
  });

  it("returns [] when no source is enabled with a raster (never a silent null mask)", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a", "add", false), brush("b", "add", true, null)];
    expect(planFold(mask)).toEqual([]);
  });

  it("filters out disabled sources and sources without a raster, keeps order", () => {
    const a = brush("a");
    const b = brush("b", "add", false); // disabled -> excluded
    const c = brush("c");
    const mask = defaultLayerMask();
    mask.sources = [a, b, c];
    expect(planFold(mask)).toEqual([a, c]);
  });

  it("a first source in subtract/intersect is still planned as seed (planFold does not special-case combineMode; the caller ignores index-0's combineMode)", () => {
    const a = brush("a", "subtract");
    const mask = defaultLayerMask();
    mask.sources = [a];
    expect(planFold(mask)).toEqual([a]);
  });
});

describe("snapshotFoldInputs / foldInputsEqual", () => {
  it("two snapshots of the same unchanged mask are equal", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a"), brush("b", "subtract")];
    const s1 = snapshotFoldInputs(mask);
    const s2 = snapshotFoldInputs(mask);
    expect(foldInputsEqual(s1, s2)).toBe(true);
  });

  it("detects a raster reference change (e.g. a new paint stroke committed)", () => {
    const mask = defaultLayerMask();
    const source = brush("a");
    mask.sources = [source];
    const before = snapshotFoldInputs(mask);
    mask.sources = [{ ...source, raster: new Uint8Array([2]) }]; // fresh reference
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(false);
  });

  it("detects a combineMode change", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a"), brush("b", "add")];
    const before = snapshotFoldInputs(mask);
    mask.sources = [mask.sources[0], { ...mask.sources[1], combineMode: "intersect" }];
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(false);
  });

  it("detects a source count change (source added/removed)", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a")];
    const before = snapshotFoldInputs(mask);
    mask.sources = [...mask.sources, brush("b")];
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(false);
  });

  it("ignores a disabled/raster-less source consistently on both sides", () => {
    const mask = defaultLayerMask();
    mask.sources = [brush("a"), brush("b", "add", false)];
    const before = snapshotFoldInputs(mask);
    mask.sources[1] = { ...mask.sources[1], combineMode: "subtract" }; // still disabled, irrelevant
    const after = snapshotFoldInputs(mask);
    expect(foldInputsEqual(before, after)).toBe(true);
  });
});
