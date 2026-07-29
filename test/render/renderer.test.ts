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

/** Injecte un `framePipelineExecutor` fictif qui ENREGISTRE l'id d'overlay
 *  reçu puis lance : l'encodage réel demanderait un vrai GPU, et tout ce qui
 *  est sous test ici se joue AVANT lui. La sentinelle est attendue par chaque
 *  appelant — jamais avalée. */
function captureOverlayArg(renderer: Renderer): { calls: (string | null)[] } {
  const calls: (string | null)[] = [];
  (renderer as unknown as { framePipelineExecutor: unknown }).framePipelineExecutor = {
    run: (_layers: unknown, maskOverlayLayerId: string | null) => {
      calls.push(maskOverlayLayerId);
      throw new Error("sentinelle: capture faite");
    },
  };
  return { calls };
}

// Défaut mesuré le 2026-07-29 par `scripts/render-check.mjs --diagnostic` :
// `exportFrame` passe par le même `runPipeline` que l'écran, donc par la même
// passe d'overlay — exporter pendant un aperçu de masque écrivait le safelight
// (voile rouge) dans le JPEG, sur 19,6 % des canaux, en silence.
describe("Renderer.exportFrame — l'overlay de masque ne sort jamais dans un fichier", () => {
  it("n'arme aucun overlay, même quand l'aperçu de masque est actif à l'écran", async () => {
    const renderer = createRenderer();
    vi.spyOn(
      (renderer as unknown as { imageResources: { getExportTexture(): unknown } }).imageResources,
      "getExportTexture",
    ).mockReturnValue({ createView: () => ({}) });
    const { calls } = captureOverlayArg(renderer);

    renderer.setMaskOverlay("L0");
    await expect(renderer.exportFrame([])).rejects.toThrow("sentinelle: capture faite");

    // AVANT le correctif : ["L0"] — le voile rouge part dans le fichier.
    expect(calls).toEqual([null]);
  });

  it("l'écran, lui, garde l'overlay — le correctif ne l'éteint pas partout", () => {
    const renderer = createRenderer();
    const { calls } = captureOverlayArg(renderer);

    renderer.setMaskOverlay("L0");
    expect(() => renderer.render([])).toThrow("sentinelle: capture faite");

    expect(calls).toEqual(["L0"]);
  });

  it("un export ne détruit pas le dernier frame d'overlay affiché à l'écran", () => {
    const renderer = createRenderer();
    const texture = { createView: () => ({}) } as unknown as GPUTexture;
    const screenFrame = {
      composedTexture: texture,
      overlayMaskTexture: texture,
      overlayTargetTexture: texture,
    };
    const priv = renderer as unknown as {
      ctx: { device: Record<string, unknown> };
      imageResources: { getExportTexture(): unknown };
      lastOverlayFrame: unknown;
      presentPass: unknown;
      framePipelineExecutor: unknown;
      runPipeline(layers: unknown[], destination: { kind: string }): void;
    };
    vi.spyOn(priv.imageResources, "getExportTexture").mockReturnValue({ createView: () => ({}) });
    // `runPipeline` encode et soumet toujours, même avec une passe de
    // présentation fictive : ce sont les deux seuls appels GPU restants.
    priv.ctx.device.createCommandEncoder = vi.fn(() => ({ finish: () => ({}) }));
    priv.ctx.device.queue = { submit: vi.fn() };
    priv.presentPass = { encode: vi.fn() };
    priv.framePipelineExecutor = {
      // Sur le chemin d'export l'overlay n'est plus armé : le résultat ne porte
      // donc plus de texture d'overlay. Sans le garde `kind === "canvas"`,
      // c'est ce null-là qui écraserait le frame d'écran.
      run: () => ({
        enabledLayerCount: 0,
        churnedResourceCount: 0,
        composedTexture: null,
        overlayMaskTexture: null,
        presentTexture: texture,
      }),
    };
    priv.lastOverlayFrame = screenFrame;

    priv.runPipeline([], { kind: "export" });

    // Sinon `tickOverlayAnimation` deviendrait un no-op après chaque export :
    // le contour animé se figerait jusqu'au rendu d'écran suivant.
    expect(priv.lastOverlayFrame).toBe(screenFrame);
  });
});

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
