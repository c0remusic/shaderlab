import { describe, expect, it, vi } from "vitest";
import { Renderer } from "../../src/render/renderer";
import type { GpuContext } from "../../src/render/gpuContext";

// Renderer's actual multi-pass pipeline is verified visually, not unitarily
// (project convention — CLAUDE.md "le rendu GPU se vérifie visuellement, pas
// unitairement"). This test targets the one piece of Renderer.createLoaded
// that IS pure logic worth locking down: a failed loadImage() must not leave
// a half-built candidate behind for the caller to accidentally keep using.
function fakeCtx(maxTextureDimension2D: number): GpuContext {
  const device = {
    createSampler: vi.fn(() => ({})),
    createTexture: vi.fn(),
    limits: { maxTextureDimension2D },
    queue: { copyExternalImageToTexture: vi.fn() },
  };
  return {
    device: device as unknown as GPUDevice,
    context: {} as GPUCanvasContext,
    canvasFormat: "bgra8unorm",
    srgbFormat: "bgra8unorm-srgb",
  };
}

describe("Renderer.createLoaded", () => {
  it("rejects and never allocates a GPU texture when the image exceeds the device's size limit", async () => {
    const ctx = fakeCtx(100);
    const bitmap = { width: 999, height: 999 } as ImageBitmap;

    await expect(Renderer.createLoaded(ctx, bitmap)).rejects.toThrow(/trop grande/);
    expect((ctx.device as unknown as { createTexture: ReturnType<typeof vi.fn> }).createTexture).not.toHaveBeenCalled();
  });

  it("disposes the failed candidate's render scheduler so no stray requestAnimationFrame survives it", async () => {
    const ctx = fakeCtx(100);
    const bitmap = { width: 999, height: 999 } as ImageBitmap;
    const cancelSpy = vi.spyOn(Renderer.prototype as unknown as { dispose(): void }, "dispose");

    await expect(Renderer.createLoaded(ctx, bitmap)).rejects.toThrow();
    expect(cancelSpy).toHaveBeenCalledOnce();

    cancelSpy.mockRestore();
  });
});

function createRenderer() {
  const ctx = {
    device: { createSampler: vi.fn(() => ({})), limits: { maxTextureDimension2D: 8192 } },
    context: { getCurrentTexture: vi.fn(() => ({ createView: vi.fn(() => ({})) })) },
    canvasFormat: "bgra8unorm",
    srgbFormat: "bgra8unorm-srgb",
  } as unknown as GpuContext;
  return new Renderer(ctx);
}

describe("Renderer.render live-preview lifetime", () => {
  it("clears the live-preview override even when the pipeline run throws", () => {
    const renderer = createRenderer();
    const setLivePreview = vi.fn();
    // Court-circuite loadImage() (nécessite un vrai ImageBitmap/WebGPU) : on
    // injecte directement un maskTextureResolver et un framePipelineExecutor
    // fictifs pour isoler le contrat try/finally de render() lui-même.
    (renderer as unknown as { maskTextureResolver: unknown }).maskTextureResolver = { setLivePreview };
    (renderer as unknown as { framePipelineExecutor: unknown }).framePipelineExecutor = {
      run: vi.fn(() => {
        throw new Error("pipeline GPU failure");
      }),
    };

    const preview = { layerId: "L1", raster: new Uint8Array(0), scope: { kind: "full" as const } };
    expect(() => renderer.render([], preview)).toThrow("pipeline GPU failure");

    expect(setLivePreview).toHaveBeenNthCalledWith(1, preview);
    // Sans try/finally, cet appel n'aurait jamais lieu : le prochain rendu
    // (sans preview) réutiliserait alors par erreur la texture de preview du
    // trait précédent, périmée.
    expect(setLivePreview).toHaveBeenNthCalledWith(2, null);
    expect(setLivePreview).toHaveBeenCalledTimes(2);
  });
});
