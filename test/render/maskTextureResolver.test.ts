import { describe, expect, it, vi } from "vitest";
import { MaskTextureResolver } from "../../src/render/maskTextureResolver";
import { LayerStack } from "../../src/layers/layerStack";
import type { GpuContext } from "../../src/render/gpuContext";
import type { LayerState } from "../../src/layers/types";

// Node has no WebGPU globals (same constraint as imageFrameResources.test.ts) —
// MaskTextureResolver reads these bitflags directly when building texture/bind
// group descriptors, so they must exist even though the fake device below
// never actually validates them.
vi.stubGlobal("GPUTextureUsage", {
  TEXTURE_BINDING: 1,
  COPY_DST: 2,
  RENDER_ATTACHMENT: 4,
  COPY_SRC: 8,
});
vi.stubGlobal("GPUBufferUsage", {
  UNIFORM: 1,
  COPY_DST: 2,
});
vi.stubGlobal("GPUShaderStage", {
  FRAGMENT: 2,
});

/**
 * Fake GPU device sufficient to exercise MaskTextureResolver.resolve() without
 * a real GPU (Vitest Node env — same constraint as effectPassRunner.test.ts).
 * Textures/buffers/pipelines are plain stand-ins; the seam under test is
 * WHETHER an encode happens at all (copyTextureToTexture/beginRenderPass call
 * counts), not the pixels produced, matching the plan's "resolver seam tests
 * with a fake GPU device asserting cache reuse only for equal snapshots and a
 * fold re-encode after a changed parametric source".
 */
function createFakeTexture() {
  return {
    format: "r8unorm",
    destroy() {},
    createView() {
      return {};
    },
  } as unknown as GPUTexture;
}

function createFakeContext(encodeCounts: { copies: number; passes: number }): GpuContext {
  const device = {
    createTexture: () => createFakeTexture(),
    createBuffer: () => ({}) as unknown as GPUBuffer,
    createBindGroupLayout: () => ({}) as unknown as GPUBindGroupLayout,
    createPipelineLayout: () => ({}) as unknown as GPUPipelineLayout,
    createShaderModule: () => ({}) as unknown as GPUShaderModule,
    createRenderPipeline: () => ({}) as unknown as GPURenderPipeline,
    createBindGroup: () => ({}) as unknown as GPUBindGroup,
    queue: {
      writeTexture: () => {},
      writeBuffer: () => {},
    },
  } as unknown as GPUDevice;
  return { device, context: {} as GPUCanvasContext, canvasFormat: "bgra8unorm", srgbFormat: "bgra8unorm-srgb" };
}

function createFakeEncoder(encodeCounts: { copies: number; passes: number }): GPUCommandEncoder {
  return {
    copyTextureToTexture: () => {
      encodeCounts.copies += 1;
    },
    beginRenderPass: () => {
      encodeCounts.passes += 1;
      return {
        setPipeline() {},
        setBindGroup() {},
        draw() {},
        end() {},
      };
    },
  } as unknown as GPUCommandEncoder;
}

function makeResolver(encodeCounts: { copies: number; passes: number }) {
  const ctx = createFakeContext(encodeCounts);
  const colorTexture = createFakeTexture();
  return new MaskTextureResolver(
    ctx,
    4,
    4,
    {} as unknown as GPUSampler,
    {} as unknown as GPUSampler,
    () => colorTexture
  );
}

function twoSourceLayer(): LayerState {
  const stack = new LayerStack();
  const id = stack.addLayer("glow");
  stack.updateBrushMask(id, new Uint8Array(16).fill(255));
  stack.addMaskSource(id, "gradient");
  return stack.layers.find((l) => l.id === id)!;
}

describe("MaskTextureResolver — fold cache seam", () => {
  it("re-encodes on the first resolve of a multi-source mask", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = twoSourceLayer();
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, []);
    expect(counts.copies).toBeGreaterThan(0);
    expect(counts.passes).toBeGreaterThan(0);
  });

  it("reuses the folded texture (no re-encode) when the snapshot is unchanged", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = twoSourceLayer();
    const pending: (GPUTexture | GPUBuffer)[] = [];
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    // Same layer object (same source array/params references) — cache must
    // hit, no additional encoder work.
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("re-encodes after the parametric source's params reference changes", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = twoSourceLayer();
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };

    const gradientSource = layer.mask.sources.find((s) => s.type === "gradient")!;
    const changedLayer: LayerState = {
      ...layer,
      mask: {
        ...layer.mask,
        sources: layer.mask.sources.map((s) =>
          s.id === gradientSource.id && s.type !== "brush" ? { ...s, params: { ...s.params, angle: 180 } } : s
        ),
      },
    };
    resolver.resolve(changedLayer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(counts.copies).toBeGreaterThan(afterFirst.copies);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("resolves a lone parametric source without ever touching the fold cache path", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.addMaskSource(id, "luminosity");
    const layer = stack.layers.find((l) => l.id === id)!;
    const texture = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, []);
    expect(texture).toBeDefined();
    // Single-source path never runs the copy+combine fold sequence.
    expect(counts.copies).toBe(0);
  });
});

describe("MaskTextureResolver — edge-aware/refine result cache", () => {
  function oneSourceLayerWithRefineEdge(refineEdge: Partial<import("../../src/mask/types").RefineEdgeParams>): LayerState {
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.addMaskSource(id, "luminosity");
    const layer = stack.layers.find((l) => l.id === id)!;
    return { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, ...refineEdge } } };
  }

  it("reuses the edge-aware guided-filter result (no re-encode) when its inputs are unchanged", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    expect(afterFirst.passes).toBeGreaterThan(0);
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("re-encodes the edge-aware guided filter when edgeRadius changes", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 20 } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("re-encodes the edge-aware guided filter when the source's own params change, even though edgeRadius/edgeStrength stay the same (regression: resident()/parametric() reuse the same GPUTexture object and re-render its content, so texture identity alone cannot detect a content change)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    const luminositySource = layer.mask.sources.find((s) => s.type === "luminosity")!;
    const changed: LayerState = {
      ...layer,
      mask: {
        ...layer.mask,
        sources: layer.mask.sources.map((s) =>
          s.id === luminositySource.id && s.type !== "brush" ? { ...s, params: { ...s.params, shadowsMin: 0.9 } } : s
        ),
      },
    };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending);
    // >=10, pas juste >0 : le module luminosity ne prend qu'1 passe pour se
    // regénérer lui-même — un simple ">0" passerait même si le filtre guidé
    // (11 passes) restait à tort en cache, masquant la régression.
    expect(counts.passes - afterFirst.passes).toBeGreaterThanOrEqual(10);
  });

  it("reuses the refine (feather/contract/smooth) result when its inputs are unchanged", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    expect(afterFirst.passes).toBeGreaterThan(0);
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("re-encodes refine when feather changes", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, feather: 10 } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("re-encodes refine when the source's own params change, even though feather/contract/smooth stay the same", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    const luminositySource = layer.mask.sources.find((s) => s.type === "luminosity")!;
    const changed: LayerState = {
      ...layer,
      mask: {
        ...layer.mask,
        sources: layer.mask.sources.map((s) =>
          s.id === luminositySource.id && s.type !== "brush" ? { ...s, params: { ...s.params, shadowsMin: 0.9 } } : s
        ),
      },
    };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending);
    // >=2, pas juste >0 : le module luminosity ne prend qu'1 passe pour se
    // regénérer lui-même — refine() (feather=4 seul) en prend 2 de plus
    // (boxH+boxV) s'il recalcule vraiment, contre 1 seul si son cache
    // restait à tort valide.
    expect(counts.passes - afterFirst.passes).toBeGreaterThanOrEqual(2);
  });

  it("re-encodes edge-aware/refine when layer.mask.invert toggles without touching resident source content", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    const inverted = { ...layer, mask: { ...layer.mask, invert: true } };
    resolver.resolve(inverted, createFakeEncoder(counts), {} as GPUTextureView, pending);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("re-encodes refine (not just edge-aware) when edgeRadius changes, with both edgeAware and feather active", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5, feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 20 } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending);
    // edgePipeline seul = 11 passes (déjà couvert par un autre test). Si
    // refine() reste à tort en cache (son input, la sortie d'edge(), a
    // pourtant changé), le delta plafonne à 11 — >=12 exige que refine()
    // ait AUSSI rejoué ses 2 passes (boxH+boxV, feather seul).
    expect(counts.passes - afterFirst.passes).toBeGreaterThanOrEqual(12);
  });
});
