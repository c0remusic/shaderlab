import { describe, expect, it, vi } from "vitest";
import { Renderer } from "../../src/render/renderer";
import type { GpuContext } from "../../src/render/gpuContext";

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
