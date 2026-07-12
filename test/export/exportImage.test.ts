import { describe, it, expect } from "vitest";
import { buildCopyPath, resolveExportTarget } from "../../src/export/exportImage";

describe("buildCopyPath", () => {
  it("appends -edited before the extension, preserving the original file", () => {
    expect(buildCopyPath("C:\\photos\\sunset.jpg")).toBe("C:\\photos\\sunset-edited.jpg");
  });

  it("handles paths with multiple dots correctly", () => {
    expect(buildCopyPath("C:\\photos\\sunset.v2.jpg")).toBe("C:\\photos\\sunset.v2-edited.jpg");
  });

  it("avoids collisions by suffixing a counter when -edited already exists", () => {
    const existing = new Set(["C:\\photos\\sunset-edited.jpg"]);
    expect(buildCopyPath("C:\\photos\\sunset.jpg", existing)).toBe("C:\\photos\\sunset-edited-2.jpg");
  });
});

describe("resolveExportTarget", () => {
  it("returns a fresh copy path for a manual (non-launch) export, never the original path", () => {
    const target = resolveExportTarget("C:\\photos\\sunset.jpg", false);
    expect(target).toBe("C:\\photos\\sunset-edited.jpg");
    expect(target).not.toBe("C:\\photos\\sunset.jpg");
  });

  it("overwrites the exact launch path for a Lightroom round-trip export", () => {
    const target = resolveExportTarget("C:\\Temp\\lr-abc123.jpg", true);
    expect(target).toBe("C:\\Temp\\lr-abc123.jpg");
  });

  it("still avoids collisions for manual exports via the existing-paths set", () => {
    const existing = new Set(["C:\\photos\\sunset-edited.jpg"]);
    expect(resolveExportTarget("C:\\photos\\sunset.jpg", false, existing)).toBe(
      "C:\\photos\\sunset-edited-2.jpg"
    );
  });

  it("ignores the existing-paths set when overwriting a launch path", () => {
    const existing = new Set(["C:\\Temp\\lr-abc123.jpg"]);
    expect(resolveExportTarget("C:\\Temp\\lr-abc123.jpg", true, existing)).toBe(
      "C:\\Temp\\lr-abc123.jpg"
    );
  });
});
