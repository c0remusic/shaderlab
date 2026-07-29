import { vi, describe, it, expect } from "vitest";
import {
  buildCopyPath,
  resolveExportTargetAsync,
  resolveDefaultExportTarget,
  exportImage,
  assertOpaqueForJpeg,
  type PathAvailability,
} from "../../src/export/exportImage";

/** Un pixel RGBA OPAQUE. Les frames de test ne peuvent plus être des
 *  `new Uint8Array(4)` (alpha 0) : depuis la tranche T0 (2026-07-28) l'encodage
 *  JPEG refuse un pixel non opaque — voir `assertOpaqueForJpeg`. */
const OPAQUE_PIXEL = new Uint8Array([10, 20, 30, 255]);

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
      exportFrame: vi.fn().mockResolvedValue(OPAQUE_PIXEL),
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
    const fakeRenderer = { exportFrame: vi.fn().mockResolvedValue(OPAQUE_PIXEL) };
    const writer = { write: vi.fn().mockRejectedValue(new Error("disque plein")) };

    await expect(
      exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg", 1, 1)
    ).rejects.toThrow("disque plein");

    vi.unstubAllGlobals();
  });

  // Tranche T0 (design 2026-07-28) : la chaîne de compositing produit
  // désormais un vrai alpha. Un JPEG n'a pas de canal alpha — `convertToBlob`
  // compose alors sur du NOIR, en silence. Ce test est le témoin que
  // l'aplatissement en amont n'est pas facultatif.
  it("refuse d'encoder un frame non opaque au lieu d'écrire un JPEG noir en silence", async () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(_width: number, _height: number) {}
        getContext() { return { putImageData() {} }; }
        convertToBlob() { return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob); }
      }
    );
    vi.stubGlobal("ImageData", class { constructor(_data: Uint8ClampedArray, _width: number, _height: number) {} });
    // Alpha 0 : exactement ce que produirait une toile transparente qui
    // traverserait la passe de présentation sans être aplatie.
    const fakeRenderer = { exportFrame: vi.fn().mockResolvedValue(new Uint8Array([0, 0, 0, 0])) };
    const writer = { write: vi.fn().mockResolvedValue(undefined) };

    await expect(
      exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg", 1, 1)
    ).rejects.toThrow(/pixel non opaque/);
    // Rien n'est écrit : pas de fichier noir sur le disque à découvrir plus tard.
    expect(writer.write).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });
});

describe("assertOpaqueForJpeg", () => {
  it("laisse passer un tampon entièrement opaque", () => {
    expect(() => assertOpaqueForJpeg(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]))).not.toThrow();
  });

  it("laisse passer un tampon vide (rien à encoder, rien à garder)", () => {
    expect(() => assertOpaqueForJpeg(new Uint8Array(0))).not.toThrow();
  });

  it("lève sur un alpha 0 — le cas qui produirait un JPEG entièrement noir", () => {
    expect(() => assertOpaqueForJpeg(new Uint8Array([0, 0, 0, 0]))).toThrow(/pixel non opaque/);
  });

  it("lève aussi sur un alpha PARTIEL (le cas discret : une bordure, pas toute l'image)", () => {
    expect(() => assertOpaqueForJpeg(new Uint8Array([9, 9, 9, 128]))).toThrow(/alpha=128/);
  });

  it("désigne le pixel fautif, pas seulement le fait qu'il y en a un", () => {
    const pixels = new Uint8Array([1, 1, 1, 255, 2, 2, 2, 255, 3, 3, 3, 7]);
    expect(() => assertOpaqueForJpeg(pixels)).toThrow(/au pixel 2/);
  });

  it("nomme le remède (la passe de présentation), pas seulement le symptôme", () => {
    expect(() => assertOpaqueForJpeg(new Uint8Array([0, 0, 0, 0]))).toThrow(/presentPass/);
  });
});

// Fake PathAvailability backed by a Set, standing in for the real Tauri
// path_exists command — lets these tests exercise resolveExportTargetAsync's
// actual disk-probing loop without touching the filesystem or Tauri IPC.
function fakeAvailability(existingPaths: Iterable<string>): PathAvailability {
  const existing = new Set(existingPaths);
  return { exists: (path: string) => Promise.resolve(existing.has(path)) };
}

describe("resolveExportTargetAsync", () => {
  it("returns a fresh copy path for a manual (non-launch) export, never the original path", async () => {
    const target = await resolveExportTargetAsync("C:\\photos\\sunset.jpg", false, fakeAvailability([]));
    expect(target).toBe("C:\\photos\\sunset-edited.jpg");
    expect(target).not.toBe("C:\\photos\\sunset.jpg");
  });

  it("overwrites the exact launch path for a Lightroom round-trip export, without probing disk", async () => {
    const availability: PathAvailability = {
      exists: vi.fn().mockResolvedValue(true), // would report "occupied" for anything probed
    };
    const target = await resolveExportTargetAsync("C:\\Temp\\lr-abc123.jpg", true, availability);
    expect(target).toBe("C:\\Temp\\lr-abc123.jpg");
    expect(availability.exists).not.toHaveBeenCalled();
  });

  it("probes disk and skips the first occupied candidate", async () => {
    const target = await resolveExportTargetAsync(
      "C:\\photos\\sunset.jpg",
      false,
      fakeAvailability(["C:\\photos\\sunset-edited.jpg"])
    );
    expect(target).toBe("C:\\photos\\sunset-edited-2.jpg");
  });

  it("skips both -edited.jpg and -edited-2.jpg when both are occupied on disk", async () => {
    const target = await resolveExportTargetAsync(
      "C:\\photos\\sunset.jpg",
      false,
      fakeAvailability(["C:\\photos\\sunset-edited.jpg", "C:\\photos\\sunset-edited-2.jpg"])
    );
    expect(target).toBe("C:\\photos\\sunset-edited-3.jpg");
  });
});

describe("resolveDefaultExportTarget", () => {
  it("returns the bare filename when nothing occupies it", async () => {
    const target = await resolveDefaultExportTarget(
      "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
      fakeAvailability([])
    );
    expect(target).toBe("C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg");
  });

  it("falls back to -edited when the bare name is occupied", async () => {
    const target = await resolveDefaultExportTarget(
      "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
      fakeAvailability(["C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg"])
    );
    expect(target).toBe("C:\\Users\\x\\Pictures\\shaderlab-export\\sunset-edited.jpg");
  });

  it("falls back to -edited-2 when both the bare name and -edited are occupied", async () => {
    const target = await resolveDefaultExportTarget(
      "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
      fakeAvailability([
        "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset.jpg",
        "C:\\Users\\x\\Pictures\\shaderlab-export\\sunset-edited.jpg",
      ])
    );
    expect(target).toBe("C:\\Users\\x\\Pictures\\shaderlab-export\\sunset-edited-2.jpg");
  });
});
