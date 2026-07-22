import { describe, expect, it, vi, beforeAll } from "vitest";
import { EffectPassRunner, MASK_OVERLAY_WGSL } from "../../src/render/effectPassRunner";

// Mock WebGPU constants for test environment
beforeAll(() => {
  if (typeof (globalThis as any).GPUShaderStage === "undefined") {
    (globalThis as any).GPUShaderStage = {
      VERTEX: 1,
      FRAGMENT: 2,
      COMPUTE: 4,
    };
  }
  if (typeof (globalThis as any).GPUBufferUsage === "undefined") {
    (globalThis as any).GPUBufferUsage = {
      MAP_READ: 1,
      MAP_WRITE: 2,
      COPY_SRC: 4,
      COPY_DST: 8,
      UNIFORM: 16,
      STORAGE: 32,
      INDIRECT: 64,
      QUERY_RESOLVE: 128,
    };
  }
});

function createRunner(): EffectPassRunner {
  return new EffectPassRunner(
    null as unknown as GPUDevice,
    "bgra8unorm-srgb",
    1,
    1,
    null as unknown as GPUSampler,
    () => null as unknown as GPUTexture
  );
}

describe("EffectPassRunner", () => {
  it("starts with an empty pipeline cache", () => {
    expect(createRunner().pipelineCount).toBe(0);
  });

  it("clears an empty cache without requiring a GPU operation", () => {
    const runner = createRunner();
    runner.clearPipelines();
    expect(runner.pipelineCount).toBe(0);
  });

  it("MASK_OVERLAY_WGSL exposes a time uniform and a screen-derivative contour test", () => {
    expect(MASK_OVERLAY_WGSL).toContain("overlayTime: f32");
    expect(MASK_OVERLAY_WGSL).toContain("fwidth(");
    expect(MASK_OVERLAY_WGSL).toContain("fs_overlay");
  });
});

function createRunnerWithFakeDevice() {
  const pipeline = { id: "overlay-pipeline" };
  const bindGroupLayout = { id: "overlay-bgl" };
  const writeBuffer = vi.fn();
  const passObj = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const createBindGroupLayout = vi.fn(() => bindGroupLayout);
  const createBuffer = vi.fn(() => ({}));
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout,
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => pipeline),
    createBindGroup: vi.fn(() => ({})),
    createBuffer,
    queue: { writeBuffer },
  } as unknown as GPUDevice;
  const runner = new EffectPassRunner(
    device,
    "bgra8unorm-srgb",
    4,
    4,
    {} as GPUSampler,
    () => null as unknown as GPUTexture,
  );
  const encoder = { beginRenderPass: vi.fn(() => passObj) } as unknown as GPUCommandEncoder;
  const src = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  const mask = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  return { runner, device, encoder, src, mask, passObj, writeBuffer, createBindGroupLayout, createBuffer };
}

describe("EffectPassRunner.runOverlayPass", () => {
  it("declares a 4th uniform-buffer binding for time", () => {
    const { runner, encoder, src, mask, createBindGroupLayout } = createRunnerWithFakeDevice();
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 1.5);
    const entries = createBindGroupLayout.mock.calls[0][0].entries;
    expect(entries).toHaveLength(4);
    expect(entries[3]).toMatchObject({ binding: 3, buffer: { type: "uniform" } });
  });

  it("writes the time value into a persistent buffer, reused across calls", () => {
    const { runner, encoder, src, mask, writeBuffer, createBuffer } = createRunnerWithFakeDevice();
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 1.5);
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 2.25);
    expect(createBuffer).toHaveBeenCalledOnce();
    expect(writeBuffer).toHaveBeenCalledTimes(2);
    expect(writeBuffer.mock.calls[1][2]).toEqual(new Float32Array([2.25, 0, 0, 0]));
  });

  it("clearPipelines() destroys the time buffer so the next call recreates it", () => {
    const { runner, encoder, src, mask, createBuffer } = createRunnerWithFakeDevice();
    const destroy = vi.fn();
    (createBuffer as ReturnType<typeof vi.fn>).mockReturnValue({ destroy });
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 1);
    runner.clearPipelines();
    expect(destroy).toHaveBeenCalledOnce();
    runner.runOverlayPass(encoder, src, mask, {} as GPUTextureView, 2);
    expect(createBuffer).toHaveBeenCalledTimes(2);
  });
});
