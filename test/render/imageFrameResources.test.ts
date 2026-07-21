import { beforeEach, describe, expect, it, vi } from "vitest";
import { ImageFrameResources } from "../../src/render/imageFrameResources";

vi.stubGlobal("GPUTextureUsage", {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
  COPY_SRC: 8,
});

function texture() {
  return { destroy: vi.fn() };
}

function createResources() {
  const source = texture();
  const firstTarget = texture();
  const secondTarget = texture();
  const exportTarget = texture();
  const device = {
    createTexture: vi.fn()
      .mockReturnValueOnce(source)
      .mockReturnValueOnce(firstTarget)
      .mockReturnValueOnce(secondTarget)
      .mockReturnValueOnce(exportTarget),
    queue: { copyExternalImageToTexture: vi.fn() },
  };
  return {
    resources: new ImageFrameResources(
      device as unknown as GPUDevice,
      "bgra8unorm-srgb",
      100,
    ),
    device,
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
