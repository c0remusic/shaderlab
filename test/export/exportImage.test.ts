import { vi, describe, it, expect } from "vitest";
import { buildCopyPath, resolveExportTarget, exportImage } from "../../src/export/exportImage";

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

describe("exportImage", () => {
  it("writes the encoded frame through its output port", async () => {
    // exportImage's internal encodeJpeg() uses OffscreenCanvas/ImageData, which
    // don't exist in vitest's "node" environment (see vitest.config.ts) — stub
    // minimal versions so encodeJpeg succeeds and the only failure exercised is
    // writeImageFile's rejection, per this test's actual intent.
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(_width: number, _height: number) {}
        getContext() {
          return { putImageData() {} };
        }
        convertToBlob() {
          return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob);
        }
      }
    );
    vi.stubGlobal(
      "ImageData",
      class {
        data: Uint8ClampedArray;
        width: number;
        height: number;
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          this.data = data;
          this.width = width;
          this.height = height;
        }
      }
    );

    const fakeRenderer = {
      exportFrame: vi.fn().mockResolvedValue(new Uint8Array(4)),
    };
    const writer = { write: vi.fn().mockResolvedValue(undefined) };

    await exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg", 1, 1);

    expect(writer.write).toHaveBeenCalledWith("C:\\fake\\path.jpg", new Uint8Array(4));
    vi.unstubAllGlobals();
  });

  it("propagates writer failures", async () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(_width: number, _height: number) {}
        getContext() { return { putImageData() {} }; }
        convertToBlob() { return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob); }
      }
    );
    vi.stubGlobal("ImageData", class { constructor(_data: Uint8ClampedArray, _width: number, _height: number) {} });
    const fakeRenderer = { exportFrame: vi.fn().mockResolvedValue(new Uint8Array(4)) };
    const writer = { write: vi.fn().mockRejectedValue(new Error("disque plein")) };

    await expect(
      exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg", 1, 1)
    ).rejects.toThrow("disque plein");

    vi.unstubAllGlobals();
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
