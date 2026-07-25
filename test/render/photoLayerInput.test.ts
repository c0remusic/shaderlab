import { beforeEach, describe, expect, it, vi } from "vitest";
import { PhotoLayerInputResolver } from "../../src/render/photoLayerInput";

vi.stubGlobal("GPUShaderStage", { FRAGMENT: 2 });
vi.stubGlobal("GPUBufferUsage", { UNIFORM: 64, COPY_DST: 8 });
vi.stubGlobal("GPUTextureUsage", { TEXTURE_BINDING: 1, RENDER_ATTACHMENT: 4 });

function texture() {
  return { createView: vi.fn(() => ({})), destroy: vi.fn() };
}

function createDevice() {
  const created: ReturnType<typeof texture>[] = [];
  const pass = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const encoder = { beginRenderPass: vi.fn(() => pass) };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createTexture: vi.fn(() => {
      const t = texture();
      created.push(t);
      return t;
    }),
    createBuffer: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
  };
  return { device, encoder, pass, created };
}

describe("PhotoLayerInputResolver", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a target texture sized to the background and writes the transform uniform", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
    const photoTexture = texture() as unknown as GPUTexture;
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    const target = resolver.resolve(
      encoder as unknown as GPUCommandEncoder,
      photoTexture,
      200,
      100,
      1000,
      800,
      { x: 500, y: 400, scale: 1, rotation: 0 },
      pendingDestroy,
    );

    expect(device.createTexture).toHaveBeenCalledWith(
      expect.objectContaining({ size: [1000, 800] }),
    );
    expect(device.queue.writeBuffer).toHaveBeenCalledWith(
      expect.anything(),
      0,
      new Float32Array([500, 400, 1, 0, 1000, 800, 200, 100]),
    );
    expect(target).toBeDefined();
  });

  it("pushes the transient uniform buffer into pendingDestroy but not the target texture (frame pipeline owns it)", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, pendingDestroy);

    expect(pendingDestroy).toHaveLength(1); // le paramBuffer, pas la texture cible
  });

  it("reuses the same pipeline across multiple resolve() calls", () => {
    const { device, encoder } = createDevice();
    const resolver = new PhotoLayerInputResolver(device as unknown as GPUDevice, "bgra8unorm-srgb", {} as GPUSampler);

    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);
    resolver.resolve(encoder as unknown as GPUCommandEncoder, texture() as unknown as GPUTexture, 10, 10, 100, 100, { x: 0, y: 0, scale: 1, rotation: 0 }, []);

    expect(device.createRenderPipeline).toHaveBeenCalledOnce();
  });
});
