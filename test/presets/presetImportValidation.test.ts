import { describe, expect, it } from "vitest";
import { validatePresetDocument } from "../../src/presets/presetImportValidation";
import { PRESET_SCHEMA_VERSION } from "../../src/presets/presetTypes";

const valid = {
  schemaVersion: PRESET_SCHEMA_VERSION,
  id: "p1",
  name: "Valide",
  createdAt: "2026-07-26T00:00:00.000Z",
  updatedAt: "2026-07-26T00:00:00.000Z",
  layers: [{ effectId: "glow", params: { intensity: 0.5 }, enabled: true, opacity: 1, blendMode: "normal" }],
};

describe("validatePresetDocument", () => {
  it("accepts a well-formed document", () => {
    const result = validatePresetDocument(valid);
    expect(result.valid).toBe(true);
  });

  it("rejects non-object input", () => {
    expect(validatePresetDocument("not json").valid).toBe(false);
    expect(validatePresetDocument(null).valid).toBe(false);
    expect(validatePresetDocument(42).valid).toBe(false);
  });

  it("rejects a missing schemaVersion", () => {
    const { schemaVersion, ...rest } = valid;
    expect(validatePresetDocument(rest).valid).toBe(false);
  });

  it("rejects a schemaVersion newer than PRESET_SCHEMA_VERSION", () => {
    const result = validatePresetDocument({ ...valid, schemaVersion: PRESET_SCHEMA_VERSION + 1 });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.error).toMatch(/schemaVersion/);
  });

  it("rejects a malformed layers entry (missing effectId)", () => {
    const bad = { ...valid, layers: [{ params: {}, enabled: true, opacity: 1, blendMode: "normal" }] };
    expect(validatePresetDocument(bad).valid).toBe(false);
  });

  it("rejects layers that isn't an array", () => {
    expect(validatePresetDocument({ ...valid, layers: "oops" }).valid).toBe(false);
  });
});
