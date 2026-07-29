import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageFrameResources } from "../../src/render/imageFrameResources";

vi.stubGlobal("GPUTextureUsage", {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
  COPY_SRC: 8,
});

function texture() {
  return { destroy: vi.fn(), createView: vi.fn(() => ({})) };
}

function createResources() {
  const source = texture();
  const firstTarget = texture();
  const secondTarget = texture();
  const exportTarget = texture();
  const beginRenderPass = vi.fn(() => ({ end: vi.fn() }));
  const submit = vi.fn();
  const device = {
    createTexture: vi.fn()
      .mockReturnValueOnce(source)
      .mockReturnValueOnce(firstTarget)
      .mockReturnValueOnce(secondTarget)
      .mockReturnValueOnce(exportTarget),
    createCommandEncoder: vi.fn(() => ({ beginRenderPass, finish: vi.fn(() => ({})) })),
    queue: { copyExternalImageToTexture: vi.fn(), submit },
  };
  return {
    resources: new ImageFrameResources(
      device as unknown as GPUDevice,
      "bgra8unorm-srgb",
      100,
    ),
    device,
    beginRenderPass,
    submit,
    source,
    firstTarget,
    secondTarget,
    exportTarget,
  };
}

describe("ImageFrameResources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uploads the source and allocates the ping-pong pair", () => {
    const { resources, device, source, firstTarget, secondTarget } = createResources();
    const bitmap = { width: 20, height: 10 } as ImageBitmap;

    resources.loadImage(bitmap);

    expect(resources.width).toBe(20);
    expect(resources.height).toBe(10);
    expect(resources.sourceTexture).toBe(source);
    expect(resources.pingPong).toEqual([firstTarget, secondTarget]);
    expect(device.queue.copyExternalImageToTexture).toHaveBeenCalledWith(
      { source: bitmap },
      { texture: source },
      [20, 10],
    );
  });

  // Tranche T0 (design 2026-07-28) : la toile s'efface en TRANSPARENT, jamais
  // en noir opaque. Le §1.2 du design imposait `alpha = 1` ; cette contrainte
  // n'était dictée QUE par l'export, et l'aplatissement explicite de
  // `presentPass.ts` la remplace. Aujourd'hui l'upload recouvre cet
  // effacement — il devient porteur à T1, quand la toile cesse d'être uploadée.
  it("efface la toile en alpha 0 AVANT d'uploader la photo", () => {
    const { resources, beginRenderPass, submit, source, device } = createResources();

    resources.loadImage({ width: 20, height: 10 } as ImageBitmap);

    expect(beginRenderPass).toHaveBeenCalledOnce();
    const attachment = beginRenderPass.mock.calls[0][0].colorAttachments[0];
    expect(attachment.loadOp).toBe("clear");
    expect(attachment.clearValue).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(attachment.view).toBe(source.createView.mock.results[0]!.value);
    // L'ordre compte : effacer APRÈS l'upload effacerait la photo.
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(
      device.queue.copyExternalImageToTexture.mock.invocationCallOrder[0],
    );
  });

  it("creates one export target lazily and reuses it", () => {
    const { resources, device, exportTarget } = createResources();
    resources.loadImage({ width: 20, height: 10 } as ImageBitmap);

    expect(resources.getExportTexture()).toBe(exportTarget);
    expect(resources.getExportTexture()).toBe(exportTarget);
    expect(device.createTexture).toHaveBeenCalledTimes(4);
  });

  it("destroys every persistent texture and resets dimensions", () => {
    const { resources, source, firstTarget, secondTarget, exportTarget } = createResources();
    resources.loadImage({ width: 20, height: 10 } as ImageBitmap);
    resources.getExportTexture();

    resources.dispose();

    expect(source.destroy).toHaveBeenCalledOnce();
    expect(firstTarget.destroy).toHaveBeenCalledOnce();
    expect(secondTarget.destroy).toHaveBeenCalledOnce();
    expect(exportTarget.destroy).toHaveBeenCalledOnce();
    expect(resources.width).toBe(0);
    expect(resources.height).toBe(0);
    expect(resources.sourceTexture).toBeNull();
    expect(resources.pingPong).toBeNull();
  });

  it("fails before allocating an image beyond the device limit", () => {
    const { resources, device } = createResources();

    expect(() => resources.loadImage({ width: 101, height: 10 } as ImageBitmap))
      .toThrow("trop grande");
    expect(device.createTexture).not.toHaveBeenCalled();
  });
});
