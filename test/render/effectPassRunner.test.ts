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

function layer(): import("../../src/layers/types").LayerState {
  return {
    id: "L1",
    effectId: "passthrough",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMaskForTest(),
  };
}

function defaultLayerMaskForTest(): import("../../src/mask/types").LayerMask {
  return { sources: [], invert: false, enabled: true, refineEdge: { feather: 0, contract: 0, smooth: 0, edgeAware: false, edgeRadius: 10, edgeStrength: 1 } };
}

function createRunnerWithMaskResolver() {
  const pipeline = { id: "pipeline" };
  const bindGroupLayout = { id: "bgl" };
  const passObj = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => bindGroupLayout),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => pipeline),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  const maskTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  const runner = new EffectPassRunner(
    device,
    "bgra8unorm-srgb",
    4,
    4,
    {} as GPUSampler,
    () => maskTexture,
  );
  const encoder = { beginRenderPass: vi.fn(() => passObj) } as unknown as GPUCommandEncoder;
  const src = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  return { runner, device, encoder, src };
}

describe("EffectPassRunner.runEffectPass imageSourceView (binding 6)", () => {
  it("binds coverageTexture at binding 6 and composes hasImageSource=true only when options.imageSourceView is set", () => {
    const { runner, device, encoder, src } = createRunnerWithMaskResolver();
    const imageSourceView = {} as GPUTextureView;

    runner.runEffectPass(
      encoder,
      { id: "passthrough", name: "Passthrough", params: [], wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }" },
      layer(),
      src.createView() as unknown as GPUTextureView,
      {} as GPUTextureView,
      { applyMask: true, imageSourceView },
      [],
    );

    const bindGroupCall = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(bindGroupCall.entries).toContainEqual({ binding: 6, resource: imageSourceView });
  });

  it("omits binding 6 when options.imageSourceView is absent", () => {
    const { runner, device, encoder, src } = createRunnerWithMaskResolver();

    runner.runEffectPass(
      encoder,
      { id: "passthrough", name: "Passthrough", params: [], wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }" },
      layer(),
      src.createView() as unknown as GPUTextureView,
      {} as GPUTextureView,
      { applyMask: true },
      [],
    );

    const bindGroupCall = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(bindGroupCall.entries.some((e: { binding: number }) => e.binding === 6)).toBe(false);
  });

  it("binde la vue d'écrêtage au MÊME binding 6 (couverture de la photo du dessous)", () => {
    const { runner, device, encoder, src } = createRunnerWithMaskResolver();
    const clipCoverageView = {} as GPUTextureView;

    runner.runEffectPass(
      encoder,
      { id: "passthrough", name: "Passthrough", params: [], wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }" },
      layer(),
      src.createView() as unknown as GPUTextureView,
      {} as GPUTextureView,
      { applyMask: true, clipCoverageView },
      [],
    );

    const bindGroupCall = (device.createBindGroup as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(bindGroupCall.entries).toContainEqual({ binding: 6, resource: clipCoverageView });
    const layoutCall = (device.createBindGroupLayout as ReturnType<typeof vi.fn>).mock.calls.at(-1)![0];
    expect(layoutCall.entries.some((e: { binding: number }) => e.binding === 6)).toBe(true);
  });
});

/** Variante de `createRunnerWithMaskResolver` qui ESPIONNE le résolveur de
 *  masque : son 3e argument (`colorView`) EST l'image de guide du filtre
 *  edge-aware, et cette méthode-ci est le seul endroit du code où elle se
 *  décide. Rien d'autre ne le vérifiait — d'où le défaut ci-dessous. */
function createRunnerSpyingGuide() {
  const passObj = { setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn() };
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({ id: "bgl" })),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({ id: "pipeline" })),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  const maskTexture = { createView: vi.fn(() => ({})) } as unknown as GPUTexture;
  const resolveMask = vi.fn(() => maskTexture);
  const runner = new EffectPassRunner(device, "bgra8unorm-srgb", 4, 4, {} as GPUSampler, resolveMask);
  const encoder = { beginRenderPass: vi.fn(() => passObj) } as unknown as GPUCommandEncoder;
  return { runner, encoder, resolveMask };
}

const PASSTHROUGH_MODULE = {
  id: "passthrough",
  name: "Passthrough",
  params: [],
  wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
};

describe("EffectPassRunner — image de guide du masque edge-aware", () => {
  it("guide = le composite EN DESSOUS pour un calque ordinaire", () => {
    const { runner, encoder, resolveMask } = createRunnerSpyingGuide();
    const compositeEnDessous = { nom: "composite" } as unknown as GPUTextureView;

    runner.runEffectPass(encoder, PASSTHROUGH_MODULE, layer(), compositeEnDessous, {} as GPUTextureView, { applyMask: true }, []);

    expect(resolveMask.mock.calls[0][2]).toBe(compositeEnDessous);
  });

  it("guide = SA PROPRE photo pour un calque photo, jamais le composite en dessous", () => {
    // LE DÉFAUT QUE CE TEST FERME. Pour le calque le PLUS BAS, le composite en
    // dessous est la TOILE — allouée, effacée une fois en alpha 0 et jamais
    // uploadée depuis la tranche T1 (`imageFrameResources.ts`). Un masque
    // edge-aware posé sur le calque photo de fond travaillait donc sur du vide :
    // plus une seule arête à suivre, en silence. Mesuré sur GPU réel le
    // 2026-07-29 : le guide du calque du bas ÉTAIT la texture de toile.
    const { runner, encoder, resolveMask } = createRunnerSpyingGuide();
    const toileVide = { nom: "toile" } as unknown as GPUTextureView;
    const saPhoto = { nom: "photo" } as unknown as GPUTextureView;

    runner.runEffectPass(encoder, PASSTHROUGH_MODULE, layer(), toileVide, {} as GPUTextureView, { applyMask: true, imageSourceView: saPhoto }, []);

    expect(resolveMask.mock.calls[0][2]).toBe(saPhoto);
  });

  it("guide = le composite en dessous pour un calque ÉCRÊTÉ sur une photo (il ne porte pas d'image)", () => {
    // L'écrêtage borne le POIDS de compositing, il ne change pas ce que le
    // calque dessine : son entrée reste le composite en dessous, qui contient
    // déjà la photo de base composée. Le guide le suit — donc rien à changer.
    const { runner, encoder, resolveMask } = createRunnerSpyingGuide();
    const compositeEnDessous = { nom: "composite" } as unknown as GPUTextureView;
    const couverture = { nom: "couverture" } as unknown as GPUTextureView;

    runner.runEffectPass(encoder, PASSTHROUGH_MODULE, layer(), compositeEnDessous, {} as GPUTextureView, { applyMask: true, clipCoverageView: couverture }, []);

    expect(resolveMask.mock.calls[0][2]).toBe(compositeEnDessous);
  });
});
