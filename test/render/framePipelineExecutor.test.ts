import { describe, expect, it, vi } from "vitest";
import {
  FramePipelineExecutor,
  type EffectPassesPort,
  type MaskTexturesPort,
} from "../../src/render/framePipelineExecutor";
import { defaultLayerMask } from "../../src/mask/types";
import type { LayerState } from "../../src/layers/types";

function texture() {
  return { createView: vi.fn(() => ({})), destroy: vi.fn() };
}

function layer(overrides: Partial<LayerState> = {}): LayerState {
  return {
    id: "L1",
    effectId: "grain",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
    ...overrides,
  };
}

function createExecutor() {
  const source = texture();
  const firstTarget = texture();
  const secondTarget = texture();
  const finish = vi.fn(() => ({}));
  const submit = vi.fn();
  const device = {
    createCommandEncoder: vi.fn(() => ({ finish })),
    queue: { submit },
  } as unknown as GPUDevice;
  const transient = texture();
  const effects: EffectPassesPort = {
    runEffectPass: vi.fn((_encoder, _effect, _layer, _source, _target, _options, pending) => {
      pending.push(transient as unknown as GPUTexture);
    }),
    runInternalPasses: vi.fn(),
    runOverlayPass: vi.fn(),
  };
  const masks: MaskTexturesPort = {
    sweep: vi.fn(),
    resolve: vi.fn(() => texture() as unknown as GPUTexture),
  };
  return {
    executor: new FramePipelineExecutor(
      device,
      { sourceTexture: source as unknown as GPUTexture, pingPong: [firstTarget, secondTarget] as unknown as [GPUTexture, GPUTexture] },
      effects,
      masks,
    ),
    effects,
    masks,
    submit,
    transient,
    firstTarget,
    secondTarget,
    source,
  };
}

describe("FramePipelineExecutor", () => {
  it("sweeps masks, submits the empty-stack blit, then destroys frame resources", () => {
    const { executor, effects, masks, submit, transient } = createExecutor();

    const result = executor.run([], {} as GPUTextureView, null);

    expect(masks.sweep).toHaveBeenCalledWith(new Set());
    expect(effects.runEffectPass).toHaveBeenCalledOnce();
    expect(submit).toHaveBeenCalledOnce();
    expect(transient.destroy).toHaveBeenCalledOnce();
    expect(submit.mock.invocationCallOrder[0]).toBeLessThan(
      transient.destroy.mock.invocationCallOrder[0],
    );
    expect(result).toEqual({
      enabledLayerCount: 0,
      churnedResourceCount: 1,
      composedTexture: null,
      overlayMaskTexture: null,
    });
  });

  it("returns null composedTexture/overlayMaskTexture when the overlay id matches no layer", () => {
    const { executor } = createExecutor();

    const result = executor.run([layer({ enabled: false })], {} as GPUTextureView, "no-such-id");

    expect(result.composedTexture).toBeNull();
    expect(result.overlayMaskTexture).toBeNull();
  });

  it("captures composedTexture/overlayMaskTexture on the empty-stack path when the overlay layer is disabled", () => {
    const { executor, effects, masks, firstTarget } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    const result = executor.run([layer({ enabled: false })], {} as GPUTextureView, "L1");

    expect(effects.runOverlayPass).toHaveBeenCalledOnce();
    expect(result.composedTexture).toBe(firstTarget);
    expect(result.overlayMaskTexture).toBe(resolved);
  });

  it("captures composedTexture/overlayMaskTexture from the ping-pong buffer when the overlay layer is enabled", () => {
    const { executor, effects, masks } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    const result = executor.run([layer({ enabled: true })], {} as GPUTextureView, "L1");

    expect(effects.runOverlayPass).toHaveBeenCalledOnce();
    const [, overlaySource, overlayMask] = (effects.runOverlayPass as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(result.composedTexture).toBe(overlaySource);
    expect(result.overlayMaskTexture).toBe(overlayMask);
    expect(result.overlayMaskTexture).toBe(resolved);
  });

  it("uses the source texture and epoch 0 as the overlay's guide when the overlay layer is the bottom layer", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run([layer({ id: "L1", enabled: true })], {} as GPUTextureView, "L1");

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , colorView, , guideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(colorView).toBe(source.createView.mock.results.at(-1)!.value);
    expect(guideEpoch).toBe(0);
  });

  it("uses the source texture and epoch 0 as the overlay's guide when the overlay layer is disabled (absent from enabledLayers)", () => {
    const { executor, masks, source } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run(
      [layer({ id: "L1", enabled: true }), layer({ id: "L2", enabled: false })],
      {} as GPUTextureView,
      "L2",
    );

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , colorView, , guideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(colorView).toBe(source.createView.mock.results.at(-1)!.value);
    expect(guideEpoch).toBe(0);
  });

  it("uses the composite and the same epoch as the layer's own render pass when the overlay layer is not the bottom layer", () => {
    const { executor, effects, masks, secondTarget } = createExecutor();
    const resolved = texture() as unknown as GPUTexture;
    masks.resolve = vi.fn(() => resolved);

    executor.run(
      [layer({ id: "L1", enabled: true }), layer({ id: "L2", enabled: true })],
      {} as GPUTextureView,
      "L2",
    );

    expect(masks.resolve).toHaveBeenCalledOnce();
    const [, , overlayColorView, , overlayGuideEpoch] = (masks.resolve as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(overlayColorView).toBe(secondTarget.createView.mock.results.at(-1)!.value);

    // Le calque overlay (L2, index 1) est aussi rendu normalement par la
    // boucle principale — c'est son deuxième appel à runEffectPass (le
    // premier est pour L1). Les deux appels doivent porter le même
    // guideEpoch numérique, sans quoi ils s'invalident mutuellement dans
    // MaskTextureResolver (voir design doc, amendement 2026-07-24).
    const runEffectPassCalls = (effects.runEffectPass as ReturnType<typeof vi.fn>).mock.calls;
    expect(runEffectPassCalls).toHaveLength(2);
    const l2Options = runEffectPassCalls[1][5];
    expect(overlayGuideEpoch).toBe(l2Options.guideEpoch);
    expect(overlayGuideEpoch).not.toBe(0);
  });

  it("destroys already-created frame resources before rethrowing when a pass throws mid-frame", () => {
    // Deux calques activés : le premier pousse une texture transitoire dans
    // pendingDestroy (via runEffectPass) puis le SECOND lance — sans
    // try/finally, la texture transitoire du premier calque resterait
    // orpheline sur le GPU (jamais détruite, jamais soumise non plus).
    const { executor, effects, transient } = createExecutor();
    let call = 0;
    effects.runEffectPass = vi.fn((_encoder, _effect, _layer, _source, _target, _options, pending) => {
      call += 1;
      pending.push(transient as unknown as GPUTexture);
      if (call === 2) throw new Error("pass GPU failure");
    });

    expect(() => executor.run([layer({ id: "L1" }), layer({ id: "L2" })], {} as GPUTextureView, null)).toThrow(
      "pass GPU failure",
    );
    // Le calque L1 (call 1) ET le calque L2 (call 2, avant qu'il ne lance)
    // ont chacun poussé `transient` dans pendingDestroy — les deux doivent
    // être détruits, aucun ne doit rester orphelin sur le GPU.
    expect(transient.destroy).toHaveBeenCalledTimes(2);
  });
});
