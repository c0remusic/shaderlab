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

function createFakeContext(
  encodeCounts: { copies: number; passes: number },
  writeBufferCalls?: Float32Array[],
): GpuContext {
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
      writeBuffer: (_buffer: unknown, _offset: number, data: Float32Array) => {
        writeBufferCalls?.push(new Float32Array(data));
      },
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

function makeResolver(encodeCounts: { copies: number; passes: number }, writeBufferCalls?: Float32Array[]) {
  const ctx = createFakeContext(encodeCounts, writeBufferCalls);
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
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    expect(counts.copies).toBeGreaterThan(0);
    expect(counts.passes).toBeGreaterThan(0);
  });

  it("reuses the folded texture (no re-encode) when the snapshot is unchanged", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = twoSourceLayer();
    const pending: (GPUTexture | GPUBuffer)[] = [];
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    // Same layer object (same source array/params references) — cache must
    // hit, no additional encoder work.
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("re-encodes after the parametric source's params reference changes", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = twoSourceLayer();
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
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
    resolver.resolve(changedLayer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
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
    const texture = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
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
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    expect(afterFirst.passes).toBeGreaterThan(0);
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("re-encodes the edge-aware guided filter when edgeRadius changes", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 20 } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("re-encodes the edge-aware guided filter when the source's own params change, even though edgeRadius/edgeStrength stay the same (regression: resident()/parametric() reuse the same GPUTexture object and re-render its content, so texture identity alone cannot detect a content change)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
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
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
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
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    expect(afterFirst.passes).toBeGreaterThan(0);
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("re-encodes refine when feather changes", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, feather: 10 } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("re-encodes refine when the source's own params change, even though feather/contract/smooth stay the same", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
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
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
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
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const inverted = { ...layer, mask: { ...layer.mask, invert: true } };
    resolver.resolve(inverted, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("re-encodes refine (not just edge-aware) when edgeRadius changes, with both edgeAware and feather active", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5, feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 20 } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    // edgePipeline seul = 11 passes (déjà couvert par un autre test). Si
    // refine() reste à tort en cache (son input, la sortie d'edge(), a
    // pourtant changé), le delta plafonne à 11 — >=12 exige que refine()
    // ait AUSSI rejoué ses 2 passes (boxH+boxV, feather seul).
    expect(counts.passes - afterFirst.passes).toBeGreaterThanOrEqual(12);
  });

  it("re-encodes refine when edgeAware is turned off, even though feather/contract/smooth stay the same (refine's input switches from the filtered edge-aware output back to the raw resident texture)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5, feather: 4 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const changed = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeAware: false } } };
    resolver.resolve(changed, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    // Sans le fix : edge() renvoie `input` directement (0 passe, chemin
    // court-circuité) et refine() reste à tort en cache (0 passe non plus)
    // => delta 0. Avec le fix : refine() recalcule (2 passes, boxH+boxV).
    expect(counts.passes - afterFirst.passes).toBeGreaterThan(0);
  });

  it("re-encodes edge-aware/refine when guideEpoch changes, even though the mask's own content and params stay identical (regression: an upstream layer changing recomposites the guide image the guided filter reads, which resolve()'s own revision tracking cannot see on its own)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 1);
    const afterFirst = { ...counts };
    // Même calque, mêmes params, même encodeur/vue — seul guideEpoch change
    // (simule un calque en dessous qui vient d'être recomposé).
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 2);
    expect(counts.passes).toBeGreaterThan(afterFirst.passes);
  });

  it("reuses the cached result across resolve() calls sharing the same guideEpoch (no needless re-encode from the guide-tracking alone)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    const t1 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 7);
    const afterFirst = { ...counts };
    const t2 = resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 7);
    expect(t2).toBe(t1);
    expect(counts).toEqual(afterFirst);
  });

  it("un changement d'edgeRadius seul (guide inchangé) NE relance PAS la construction SAT du guide (downsample+pack+squareCorr+scan), seulement les passes de lookup/composite bon marché (regression : la clé de cache de la SAT du guide doit être guideRevision, pas maskRevision+edgeRadius)", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const radiusChanged = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 45 } } };
    resolver.resolve(radiusChanged, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const delta = counts.passes - afterFirst.passes;
    // Le pipeline COMPLET (downsample x2 + pack + squareCorr + 2 SAT de
    // guide construites de zéro + leurs lookups + computeAB + SAT a/b +
    // son lookup + composite) coûte largement plus de 30 passes à une
    // résolution de test — un delta sous ce seuil prouve que la
    // construction SAT du guide N'A PAS été rejouée, seulement le chemin
    // bon marché (2 lookups guide + computeAB + SAT a/b + son lookup +
    // composite).
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThan(30);
  });

  it("un changement de contenu réel (invert) relance toute la construction SAT (guide ET a/b) — coût nettement supérieur à un simple changement de rayon", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const layer = oneSourceLayerWithRefineEdge({ edgeAware: true, edgeStrength: 1, edgeRadius: 5 });
    const pending: (GPUTexture | GPUBuffer)[] = [];
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterFirst = { ...counts };
    const radiusChanged = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 45 } } };
    resolver.resolve(radiusChanged, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const afterRadius = { ...counts };
    const cheapDelta = afterRadius.passes - afterFirst.passes;

    const inverted = { ...radiusChanged, mask: { ...radiusChanged.mask, invert: true } };
    resolver.resolve(inverted, createFakeEncoder(counts), {} as GPUTextureView, pending, 0);
    const fullDelta = counts.passes - afterRadius.passes;

    expect(fullDelta).toBeGreaterThan(cheapDelta);
  });
});

describe("MaskTextureResolver — gradient source params contract", () => {
  // Régression : gradientSource.defaultParams (mask/sources/gradient.ts) liste
  // `angle` en première clé — une commodité de saisie UI, jamais un slot du
  // contrat wgsl (`params[0]=startX, [1]=startY, [2]=endX, [3]=endY,
  // [4]=feather, [5]=invert`, documenté dans gradient.ts). Sans le filtrage
  // de `angle` avant flatten(), Object.keys(defaults) le sérialise en
  // premier et décale tout d'un cran — `feather` (params[4]) recevait la
  // valeur d'`endY`, cassant le contour de seuil (fwidth-based) dès qu'un
  // angle non-défaut recalculait endY vers une valeur de feather démesurée.
  it("writes startX/startY/endX/endY/feather/invert at the exact wgsl slots the shader contract expects, excluding angle", () => {
    const counts = { copies: 0, passes: 0 };
    const writeBufferCalls: Float32Array[] = [];
    const resolver = makeResolver(counts, writeBufferCalls);
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.addMaskSource(id, "gradient");
    let layer = stack.layers.find((l) => l.id === id)!;
    const gradientSource = layer.mask.sources.find((s) => s.type === "gradient")!;
    // Valeurs toutes distinctes et non-défaut pour détecter un décalage
    // d'index (un décalage silencieux avec des valeurs égales/nulles ne
    // ferait échouer aucune assertion).
    const params = { angle: 200, startX: 0.11, startY: 0.22, endX: 0.33, endY: 0.44, feather: 0.55, invert: 0 };
    layer = {
      ...layer,
      mask: {
        ...layer.mask,
        sources: layer.mask.sources.map((s) => (s.id === gradientSource.id && s.type !== "brush" ? { ...s, params } : s)),
      },
    };
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, [], 0);

    expect(writeBufferCalls.length).toBeGreaterThan(0);
    // ⚠️ PAS le dernier appel : depuis le 2026-08-14, chaque source
    // paramétrique écrit DEUX uniformes — ses paramètres (8 slots) puis les
    // dimensions du masque (4 slots, pour que le dégradé radial rende un
    // cercle et non une ellipse). Prendre le dernier lisait les dimensions et
    // comparait 4 à 0,11. On désigne donc celui qui porte les paramètres, par
    // sa longueur, qui est le contrat lui-même (`PARAM_COUNT_BY_TYPE`).
    const flat = writeBufferCalls.find((c) => c.length === 8)!;
    expect(flat).toBeDefined();
    // toBeCloseTo, pas toEqual : le tableau transite par un Float32Array
    // (précision f32), une comparaison stricte échouerait sur l'arrondi
    // (0.11 → 0.10999999940395355), pas sur un bug d'ordonnancement.
    const actual = Array.from(flat.slice(0, 6));
    const expected = [params.startX, params.startY, params.endX, params.endY, params.feather, params.invert];
    actual.forEach((v, i) => expect(v).toBeCloseTo(expected[i], 5));
  });
});

describe("MaskTextureResolver — guideRevision (séparé de maskRevision)", () => {
  it("avance guideRevision quand le contenu résident d'une source change, pas quand seul edgeRadius change", () => {
    const counts = { copies: 0, passes: 0 };
    const resolver = makeResolver(counts);
    const stack = new LayerStack();
    const id = stack.addLayer("glow");
    stack.addMaskSource(id, "luminosity");
    let layer = stack.layers.find((l) => l.id === id)!;
    layer = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeAware: true, edgeStrength: 1, edgeRadius: 5 } } };
    resolver.resolve(layer, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    // @ts-expect-error accès direct pour le test — méthode privée
    const guideRevAfterFirst = resolver.guideRevision(id);

    // Changement de edgeRadius seul (même contenu) : guideRevision ne bouge pas.
    const radiusChanged = { ...layer, mask: { ...layer.mask, refineEdge: { ...layer.mask.refineEdge, edgeRadius: 40 } } };
    resolver.resolve(radiusChanged, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    // @ts-expect-error accès direct pour le test
    expect(resolver.guideRevision(id)).toBe(guideRevAfterFirst);

    // Changement de contenu réel (invert) : guideRevision avance.
    const invertChanged = { ...radiusChanged, mask: { ...radiusChanged.mask, invert: true } };
    resolver.resolve(invertChanged, createFakeEncoder(counts), {} as GPUTextureView, [], 0);
    // @ts-expect-error accès direct pour le test
    expect(resolver.guideRevision(id)).toBeGreaterThan(guideRevAfterFirst);
  });
});
