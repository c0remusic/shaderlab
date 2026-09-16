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
  // Ajouté le 2026-08-03 avec les passes conditionnelles : `acquirePassTarget`
  // le lit, et aucun test ne descendait jusque-là avant.
  if (typeof (globalThis as any).GPUTextureUsage === "undefined") {
    (globalThis as any).GPUTextureUsage = {
      COPY_SRC: 1,
      COPY_DST: 2,
      TEXTURE_BINDING: 4,
      STORAGE_BINDING: 8,
      RENDER_ATTACHMENT: 16,
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
});

/** Appareil factice qui COMPTE ce que la chaîne de passes alloue et encode.
 *  C'est la seule mesure qui compte ici : une passe inutile n'est pas seulement
 *  lente, elle EMPRUNTE une cible — et sur 24 Mpx la seule cible à l'échelle 0,5
 *  pèse 24 Mo. */
function createRunnerCountingPasses() {
  const createTexture = vi.fn(() => ({ width: 2, height: 2, createView: vi.fn(() => ({})) }));
  const beginRenderPass = vi.fn(() => ({
    setPipeline: vi.fn(), setBindGroup: vi.fn(), draw: vi.fn(), end: vi.fn(),
  }));
  const device = {
    createShaderModule: vi.fn(() => ({})),
    createBindGroupLayout: vi.fn(() => ({})),
    createPipelineLayout: vi.fn(() => ({})),
    createRenderPipeline: vi.fn(() => ({})),
    createBindGroup: vi.fn(() => ({})),
    createBuffer: vi.fn(() => ({})),
    createTexture,
    queue: { writeBuffer: vi.fn() },
  } as unknown as GPUDevice;
  const runner = new EffectPassRunner(
    device, "bgra8unorm-srgb", 4, 4, {} as GPUSampler, () => null as unknown as GPUTexture,
  );
  const encoder = { beginRenderPass } as unknown as GPUCommandEncoder;
  const sourceView = { id: "source" } as unknown as GPUTextureView;
  return { runner, encoder, sourceView, createTexture, beginRenderPass };
}

const PASS_WGSL = "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }";

/** Trois passes dont la deuxième est conditionnée à `mode`. */
function effetTroisPasses() {
  return {
    id: "test-passes",
    name: "Test",
    params: [{ name: "mode", label: "Mode", unit: "none" as const, min: 0, max: 1, default: 0, step: 1 }],
    wgsl: PASS_WGSL,
    passes: [
      { scale: 0.5, wgsl: PASS_WGSL },
      { scale: 0.25, wgsl: PASS_WGSL, enabled: (p: Record<string, number>) => p.mode > 0.5 },
      { scale: 0.5, wgsl: PASS_WGSL, enabled: (p: Record<string, number>) => p.mode > 0.5 },
    ],
  };
}

describe("EffectPassRunner.runInternalPasses — passes conditionnelles", () => {
  it("exécute toutes les passes quand aucune ne déclare de condition", () => {
    const { runner, encoder, sourceView, createTexture } = createRunnerCountingPasses();
    const effect = { ...effetTroisPasses(), passes: [
      { scale: 0.5, wgsl: PASS_WGSL },
      { scale: 0.25, wgsl: PASS_WGSL },
    ] };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner.runInternalPasses(encoder, effect as any, { params: {} } as any, sourceView, []);
    expect(createTexture).toHaveBeenCalledTimes(2);
  });

  it("SAUTE les passes inutiles, et ne leur emprunte aucune cible", () => {
    const { runner, encoder, sourceView, createTexture, beginRenderPass } = createRunnerCountingPasses();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = runner.runInternalPasses(encoder, effetTroisPasses() as any, { params: { mode: 0 } } as any, sourceView, []);
    // Une seule des trois : l'allocation est évitée, pas seulement le dessin.
    expect(createTexture).toHaveBeenCalledTimes(1);
    expect(beginRenderPass).toHaveBeenCalledTimes(1);
    expect(res.texture).not.toBeNull();
  });

  it("exécute les mêmes passes quand les paramètres les rendent utiles", () => {
    const { runner, encoder, sourceView, createTexture } = createRunnerCountingPasses();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner.runInternalPasses(encoder, effetTroisPasses() as any, { params: { mode: 1 } } as any, sourceView, []);
    expect(createTexture).toHaveBeenCalledTimes(3);
  });

  it("applique le DÉFAUT du paramètre quand le calque ne le porte pas", () => {
    // Le prédicat reçoit les paramètres RÉSOLUS. Sans ça, un calque qui n'a
    // jamais touché le curseur verrait `undefined` et la comparaison rendrait
    // false en silence — l'effet perdrait ses passes sans que rien ne le dise.
    const { runner, encoder, sourceView, createTexture } = createRunnerCountingPasses();
    const effect = effetTroisPasses();
    effect.params[0].default = 1;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner.runInternalPasses(encoder, effect as any, { params: {} } as any, sourceView, []);
    expect(createTexture).toHaveBeenCalledTimes(3);
  });

  // ⚠️ CETTE COMBINAISON ÉTAIT INTERDITE PAR `validateEffect` jusqu'au
  // 2026-09-16, et l'interdit portait sur la plomberie : les passes internes ne
  // recevaient pas la texture de bibliothèque, donc elles échantillonnaient le
  // repli 1×1 — le binding 7 existe dès que l'effet déclare `libraryTexture`,
  // donc le shader compilait et l'image était fausse en silence. Deux capacités
  // du ROADMAP en dépendaient (le ZMap de `lensBlur`, la texture de `lensFlare`).
  it("sert la texture de bibliothèque à CHAQUE passe interne, pas seulement à la finale", () => {
    const { runner, encoder, sourceView } = createRunnerCountingPasses();
    const effect = {
      ...effetTroisPasses(),
      libraryTexture: { indexParam: "mode" },
      passes: [
        { scale: 0.5, wgsl: PASS_WGSL },
        { scale: 0.25, wgsl: PASS_WGSL },
      ],
    };
    const vue = { marque: "bibliotheque" } as unknown as GPUTextureView;
    const espion = vi.spyOn(runner, "runEffectPass").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner.runInternalPasses(encoder, effect as any, { params: {} } as any, sourceView, [], vue);
    expect(espion).toHaveBeenCalledTimes(2);
    for (const appel of espion.mock.calls) {
      expect((appel[5] as { libraryTextureView?: unknown }).libraryTextureView).toBe(vue);
    }
    espion.mockRestore();
  });

  it("sans texture de bibliothèque, les passes internes n'en reçoivent aucune", () => {
    const { runner, encoder, sourceView } = createRunnerCountingPasses();
    const effect = { ...effetTroisPasses(), passes: [{ scale: 0.5, wgsl: PASS_WGSL }] };
    const espion = vi.spyOn(runner, "runEffectPass").mockImplementation(() => {});
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    runner.runInternalPasses(encoder, effect as any, { params: {} } as any, sourceView, []);
    expect((espion.mock.calls[0][5] as { libraryTextureView?: unknown }).libraryTextureView).toBeNull();
    espion.mockRestore();
  });

  it("rend une texture NULLE et la vue SOURCE quand toutes les passes sautent", () => {
    // C'est le cas limite qui décide de la signature : il n'y a alors aucune
    // cible empruntée au pool. La passe composite finale reçoit donc la source
    // en `prevPass` — cohérent, mais le shader final doit être écrit en le
    // sachant (voir l'avertissement sur `EffectPass.enabled`).
    const { runner, encoder, sourceView, createTexture } = createRunnerCountingPasses();
    const effect = effetTroisPasses();
    effect.passes[0] = { scale: 0.5, wgsl: PASS_WGSL, enabled: (p: Record<string, number>) => p.mode > 0.5 };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res = runner.runInternalPasses(encoder, effect as any, { params: { mode: 0 } } as any, sourceView, []);
    expect(createTexture).not.toHaveBeenCalled();
    expect(res.texture).toBeNull();
    expect(res.view).toBe(sourceView);
  });
});
