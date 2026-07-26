import { describe, expect, it } from "vitest";
import { resolveImportName } from "../../src/presets/presetImportNaming";

describe("resolveImportName", () => {
  it("returns the name unchanged when there is no collision", () => {
    expect(resolveImportName(["Autre preset"], "Mon preset")).toBe("Mon preset");
    expect(resolveImportName([], "Mon preset")).toBe("Mon preset");
  });

  it("appends ' (copie)' on a single collision", () => {
    expect(resolveImportName(["Mon preset"], "Mon preset")).toBe("Mon preset (copie)");
  });

  it("appends ' (copie 2)' when '(copie)' is also already taken", () => {
    expect(resolveImportName(["Mon preset", "Mon preset (copie)"], "Mon preset")).toBe("Mon preset (copie 2)");
  });

  it("keeps incrementing across further successive collisions", () => {
    const existing = ["Mon preset", "Mon preset (copie)", "Mon preset (copie 2)", "Mon preset (copie 3)"];
    expect(resolveImportName(existing, "Mon preset")).toBe("Mon preset (copie 4)");
  });

  it("still resolves to a name absent from existingNames when the incoming name already contains '(copie)'", () => {
    const existing = ["Mon preset (copie)"];
    const resolved = resolveImportName(existing, "Mon preset (copie)");
    expect(existing).not.toContain(resolved);
    expect(resolved).not.toBe("Mon preset (copie)");
  });

  it("does not loop forever across many successive collisions (termination guard)", () => {
    const existing = ["N", ...Array.from({ length: 50 }, (_, i) => (i === 0 ? "N (copie)" : `N (copie ${i + 1})`))];
    const resolved = resolveImportName(existing, "N");
    expect(existing).not.toContain(resolved);
  });
});
