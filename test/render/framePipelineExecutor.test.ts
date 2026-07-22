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
});
