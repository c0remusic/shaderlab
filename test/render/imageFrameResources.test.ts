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
  const canvas = texture();
  const firstTarget = texture();
  const secondTarget = texture();
  const exportTarget = texture();
  const beginRenderPass = vi.fn(() => ({ end: vi.fn() }));
  const submit = vi.fn();
  const device = {
    createTexture: vi.fn()
      .mockReturnValueOnce(canvas)
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
    canvas,
    firstTarget,
    secondTarget,
    exportTarget,
  };
}

describe("ImageFrameResources", () => {
  beforeEach(() => vi.clearAllMocks());

  it("alloue la toile aux dimensions demandées et la paire de ping-pong", () => {
    const { resources, canvas, firstTarget, secondTarget } = createResources();

    resources.allocateCanvas(20, 10);

    expect(resources.width).toBe(20);
    expect(resources.height).toBe(10);
    expect(resources.canvasTexture).toBe(canvas);
    expect(resources.pingPong).toEqual([firstTarget, secondTarget]);
  });

  // LE POINT DE BASCULE DE LA TRANCHE T1 (design 2026-07-28 §1.2). La toile
  // n'est plus la photo : elle est allouée, effacée en transparent, et PLUS
  // JAMAIS uploadée — la photo d'ouverture vit dans `PhotoSourceStore` comme
  // toute autre photo. Un upload qui reviendrait ici rendrait la toile opaque
  // partout, et le damier ne pourrait plus jamais apparaître : c'est
  // exactement ce que cette assertion garde.
  it("n'uploade JAMAIS de pixels dans la toile", () => {
    const { resources, device } = createResources();

    resources.allocateCanvas(20, 10);

    expect(device.queue.copyExternalImageToTexture).not.toHaveBeenCalled();
  });

  // Tranche T0 (design 2026-07-28) : la toile s'efface en TRANSPARENT, jamais
  // en noir opaque. Le §1.2 du design imposait `alpha = 1` ; cette contrainte
  // n'était dictée QUE par l'export, et l'aplatissement explicite de
  // `presentPass.ts` la remplace. Depuis T1 cet effacement est le contenu
  // DÉFINITIF de la toile : plus aucun upload ne le recouvre.
  it("efface la toile en alpha 0", () => {
    const { resources, beginRenderPass, canvas } = createResources();

    resources.allocateCanvas(20, 10);

    expect(beginRenderPass).toHaveBeenCalledOnce();
    const attachment = beginRenderPass.mock.calls[0][0].colorAttachments[0];
    expect(attachment.loadOp).toBe("clear");
    expect(attachment.clearValue).toEqual({ r: 0, g: 0, b: 0, a: 0 });
    expect(attachment.view).toBe(canvas.createView.mock.results[0]!.value);
  });

  it("creates one export target lazily and reuses it", () => {
    const { resources, device, exportTarget } = createResources();
    resources.allocateCanvas(20, 10);

    expect(resources.getExportTexture()).toBe(exportTarget);
    expect(resources.getExportTexture()).toBe(exportTarget);
    expect(device.createTexture).toHaveBeenCalledTimes(4);
  });

  it("destroys every persistent texture and resets dimensions", () => {
    const { resources, canvas, firstTarget, secondTarget, exportTarget } = createResources();
    resources.allocateCanvas(20, 10);
    resources.getExportTexture();

    resources.dispose();

    expect(canvas.destroy).toHaveBeenCalledOnce();
    expect(firstTarget.destroy).toHaveBeenCalledOnce();
    expect(secondTarget.destroy).toHaveBeenCalledOnce();
    expect(exportTarget.destroy).toHaveBeenCalledOnce();
    expect(resources.width).toBe(0);
    expect(resources.height).toBe(0);
    expect(resources.canvasTexture).toBeNull();
    expect(resources.pingPong).toBeNull();
  });

  it("fails before allocating an image beyond the device limit", () => {
    const { resources, device } = createResources();

    expect(() => resources.allocateCanvas(101, 10)).toThrow("trop grande");
    expect(device.createTexture).not.toHaveBeenCalled();
  });
});
