import { vi, describe, it, expect } from "vitest";
import {
  buildCopyPath,
  resolveExportTargetAsync,
  resolveDefaultExportTarget,
  exportImage,
  assertOpaqueForJpeg,
  type PathAvailability,
} from "../../src/export/exportImage";

/** Un frame d'UN pixel RGBA OPAQUE. Les frames de test ne peuvent plus être des
 *  `new Uint8Array(4)` (alpha 0) : depuis la tranche T0 (2026-07-28) l'encodage
 *  JPEG refuse un pixel non opaque — voir `assertOpaqueForJpeg`. Et depuis la
 *  tranche T2 un frame PORTE ses dimensions (`ExportedFrame`) : elles ne sont
 *  plus des paramètres d'appel. */
const OPAQUE_FRAME = { pixels: new Uint8Array([10, 20, 30, 255]), width: 1, height: 1 };

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
      exportFrame: vi.fn().mockResolvedValue(OPAQUE_FRAME),
    };
    const writer = { write: vi.fn().mockResolvedValue(undefined) };

    await exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg");

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
    const fakeRenderer = { exportFrame: vi.fn().mockResolvedValue(OPAQUE_FRAME) };
    const writer = { write: vi.fn().mockRejectedValue(new Error("disque plein")) };

    await expect(
      exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg")
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
    const fakeRenderer = {
      exportFrame: vi.fn().mockResolvedValue({ pixels: new Uint8Array([0, 0, 0, 0]), width: 1, height: 1 }),
    };
    const writer = { write: vi.fn().mockResolvedValue(undefined) };

    await expect(
      exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg")
    ).rejects.toThrow(/pixel non opaque/);
    // Rien n'est écrit : pas de fichier noir sur le disque à découvrir plus tard.
    expect(writer.write).not.toHaveBeenCalled();

    vi.unstubAllGlobals();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // TÉMOIN DE LA SOURCE UNIQUE DE DIMENSION (design §4.3, tranche T2).
  //
  // C'est le point le plus dangereux de la tranche, parce qu'il ne se voit pas
  // tant que les deux valeurs coïncident. Avant T2, `exportImage` recevait la
  // largeur et la hauteur en PARAMÈTRES, remplies depuis le state React
  // (`imageSize`), tandis que les octets venaient d'une relecture dimensionnée
  // par `ImageFrameResources`. Un pixel d'écart et le constructeur `ImageData`
  // levait sur une incohérence de longueur — sur une toile de format choisi,
  // c'est-à-dire dès qu'un deuxième site pose une dimension.
  //
  // Ce test verrouille le remède STRUCTUREL : les dimensions arrivent avec les
  // octets. Il rougit si quelqu'un rebranche une autre source (paramètre,
  // constante, état d'interface) sur l'encodage.
  it("encode aux dimensions PORTÉES PAR LE FRAME, jamais à une autre source", async () => {
    const vues: Array<{ width: number; height: number }> = [];
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(width: number, height: number) {
          vues.push({ width, height });
        }
        getContext() { return { putImageData() {} }; }
        convertToBlob() { return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob); }
      }
    );
    const imageDatas: Array<{ width: number; height: number; length: number }> = [];
    vi.stubGlobal(
      "ImageData",
      class {
        constructor(data: Uint8ClampedArray, width: number, height: number) {
          // Le vrai constructeur LÈVE si data.length !== width * height * 4 :
          // c'est exactement la divergence qu'on rend inexprimable.
          if (data.length !== width * height * 4) {
            throw new Error(`ImageData: ${data.length} octets pour ${width}×${height}`);
          }
          imageDatas.push({ width, height, length: data.length });
        }
      }
    );

    // Toile 4×2 (8 pixels) : des dimensions qui ne sont NI carrées ni celles
    // d'un frame 1×1, donc impossibles à obtenir par hasard.
    const frame = { pixels: new Uint8Array(4 * 2 * 4).fill(255), width: 4, height: 2 };
    const fakeRenderer = { exportFrame: vi.fn().mockResolvedValue(frame) };
    const writer = { write: vi.fn().mockResolvedValue(undefined) };

    await exportImage(fakeRenderer, writer, [], "C:\\fake\\path.jpg");

    expect(imageDatas).toEqual([{ width: 4, height: 2, length: 32 }]);
    expect(vues).toEqual([{ width: 4, height: 2 }]);
    vi.unstubAllGlobals();
  });

  it("`exportImage` n'a AUCUN paramètre de dimension — la divergence n'est pas exprimable", () => {
    // Quatre arguments requis : renderer, writer, calques, chemin. Le `cadre`
    // (ticket 32) a un défaut, ne compte donc pas dans `.length`, et n'est PAS
    // une dimension : celles-ci arrivent toujours avec les octets.
    expect(exportImage.length).toBe(4);
  });

  // Ticket 32, tranche B : le cadre courant est TRANSMIS au renderer, qui relit
  // le seul sous-rectangle. `exportImage` ne le lit pas lui-même — il le passe.
  it("transmet le cadre à `exportFrame`", async () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(_width: number, _height: number) {}
        getContext() { return { putImageData() {} }; }
        convertToBlob() { return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob); }
      }
    );
    vi.stubGlobal("ImageData", class { constructor(_data: Uint8ClampedArray, _width: number, _height: number) {} });
    const exportFrame = vi.fn().mockResolvedValue(OPAQUE_FRAME);
    const cadre = { x: 10, y: 20, width: 30, height: 40 };
    await exportImage({ exportFrame }, { write: vi.fn().mockResolvedValue(undefined) }, [], "C:\\fake\\p.jpg", cadre);
    // Le `{}` en 3e argument est l'ÉTAGE de développement (ticket 03) : `exportImage`
    // le transmet à `exportFrame`, défaut vide ici.
    expect(exportFrame).toHaveBeenCalledWith([], cadre, {});
    vi.unstubAllGlobals();
  });

  it("transmet l'étage de développement à `exportFrame` (ticket 03)", async () => {
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(_width: number, _height: number) {}
        getContext() { return { putImageData() {} }; }
        convertToBlob() { return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) } as unknown as Blob); }
      }
    );
    vi.stubGlobal("ImageData", class { constructor(_data: Uint8ClampedArray, _width: number, _height: number) {} });
    const exportFrame = vi.fn().mockResolvedValue(OPAQUE_FRAME);
    const develop = { etalonnage: { blueHue: -60 } };
    await exportImage({ exportFrame }, { write: vi.fn().mockResolvedValue(undefined) }, [], "C:\\fake\\p.jpg", null, develop);
    // L'export porte l'étage : un fichier exporté est l'image DÉVELOPPÉE.
    expect(exportFrame).toHaveBeenCalledWith([], null, develop);
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
  it("returns a fresh copy path, never the original path", async () => {
    const target = await resolveExportTargetAsync("C:\\photos\\sunset.jpg", fakeAvailability([]));
    expect(target).toBe("C:\\photos\\sunset-edited.jpg");
    expect(target).not.toBe("C:\\photos\\sunset.jpg");
  });

  // Remplace « overwrites the exact launch path for a Lightroom round-trip
  // export » : depuis l'ADR-0002, cet écrasement n'existe plus, et le
  // paramètre `isLaunchFile` qui le demandait non plus. Ce test vérifie
  // l'inverse, qui est la garantie qu'on veut désormais tenir — même sur le
  // chemin qui l'obtenait avant, et même à disque saturé.
  it("ne rend JAMAIS le chemin source, même quand tous les candidats sont occupés", async () => {
    const source = "C:\\Temp\\lr-abc123.jpg";
    const target = await resolveExportTargetAsync(
      source,
      fakeAvailability([
        "C:\\Temp\\lr-abc123-edited.jpg",
        "C:\\Temp\\lr-abc123-edited-2.jpg",
        "C:\\Temp\\lr-abc123-edited-3.jpg",
      ])
    );
    expect(target).not.toBe(source);
    expect(target).toBe("C:\\Temp\\lr-abc123-edited-4.jpg");
  });

  it("probes disk and skips the first occupied candidate", async () => {
    const target = await resolveExportTargetAsync(
      "C:\\photos\\sunset.jpg",
      fakeAvailability(["C:\\photos\\sunset-edited.jpg"])
    );
    expect(target).toBe("C:\\photos\\sunset-edited-2.jpg");
  });

  it("skips both -edited.jpg and -edited-2.jpg when both are occupied on disk", async () => {
    const target = await resolveExportTargetAsync(
      "C:\\photos\\sunset.jpg",
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
