import type { LayerState } from "../layers/types";
import { defaultLayerMask } from "../mask/types";
import { getEffect } from "./effects/registry";
import { PASSTHROUGH_EFFECT } from "./effectPassRunner";

type FrameResource = GPUTexture | GPUBuffer;

/** The persistent colour textures required to encode one frame. */
export interface FrameResourcesPort {
  readonly sourceTexture: GPUTexture | null;
  readonly pingPong: [GPUTexture, GPUTexture] | null;
}

/** Stateless effect/overlay encoding. Frame submission remains outside this port. */
export interface EffectPassesPort {
  runEffectPass(
    encoder: GPUCommandEncoder,
    effect: ReturnType<typeof getEffect>,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null },
    pendingDestroy: FrameResource[],
  ): void;
  runInternalPasses(
    encoder: GPUCommandEncoder,
    effect: ReturnType<typeof getEffect>,
    layer: LayerState,
    sourceView: GPUTextureView,
    pendingDestroy: FrameResource[],
  ): { view: GPUTextureView; texture: GPUTexture };
  runOverlayPass(
    encoder: GPUCommandEncoder,
    source: GPUTexture,
    mask: GPUTexture,
    targetView: GPUTextureView,
  ): void;
}

/** Persistent mask residency; it encodes mask work but never submits it. */
export interface MaskTexturesPort {
  sweep(layerIds: ReadonlySet<string>): void;
  resolve(
    layer: LayerState,
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    pendingDestroy: FrameResource[],
  ): GPUTexture;
}

export type FramePipelineResult = {
  enabledLayerCount: number;
  churnedResourceCount: number;
};

/**
 * Encodes and submits one complete image frame. This is the sole owner of
 * frame-scoped GPU destruction: resources are released only after submit.
 */
export class FramePipelineExecutor {
  constructor(
    private readonly device: GPUDevice,
    private readonly resources: FrameResourcesPort,
    private readonly effects: EffectPassesPort,
    private readonly masks: MaskTexturesPort,
  ) {}

  run(
    layers: LayerState[],
    finalTargetView: GPUTextureView,
    maskOverlayLayerId: string | null,
  ): FramePipelineResult {
    const sourceTexture = this.resources.sourceTexture;
    const pingPong = this.resources.pingPong;
    if (!sourceTexture || !pingPong) throw new Error("Aucune image chargée.");

    this.masks.sweep(new Set(layers.map((layer) => layer.id)));
    const enabledLayers = layers.filter((layer) => layer.enabled);
    const overlayLayer = maskOverlayLayerId
      ? (layers.find((layer) => layer.id === maskOverlayLayerId) ?? null)
      : null;
    const encoder = this.device.createCommandEncoder();
    const pendingDestroy: FrameResource[] = [];

    if (enabledLayers.length === 0) {
      const blitTarget = overlayLayer ? pingPong[0] : null;
      this.effects.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        {
          id: "",
          effectId: "",
          params: {},
          enabled: true,
          opacity: 1,
          blendMode: "normal",
          mask: defaultLayerMask(),
        },
        sourceTexture.createView(),
        blitTarget ? blitTarget.createView() : finalTargetView,
        {},
        pendingDestroy,
      );
      if (overlayLayer && blitTarget) {
        this.effects.runOverlayPass(
          encoder,
          blitTarget,
          this.masks.resolve(
            overlayLayer,
            encoder,
            sourceTexture.createView(),
            pendingDestroy,
          ),
          finalTargetView,
        );
      }
      return this.submitAndDestroy(encoder, pendingDestroy, 0);
    }

    let readTexture = sourceTexture;
    let writeIndex = 0;
    for (let index = 0; index < enabledLayers.length; index++) {
      const layer = enabledLayers[index];
      const effect = getEffect(layer.effectId);
      const isLast = index === enabledLayers.length - 1;
      const targetView = isLast && !overlayLayer
        ? finalTargetView
        : pingPong[writeIndex].createView();
      let previousPass: { view: GPUTextureView; texture: GPUTexture } | null = null;
      if (effect.passes?.length) {
        previousPass = this.effects.runInternalPasses(
          encoder,
          effect,
          layer,
          readTexture.createView(),
          pendingDestroy,
        );
      }
      this.effects.runEffectPass(
        encoder,
        effect,
        layer,
        readTexture.createView(),
        targetView,
        { applyMask: true, prevPassView: previousPass?.view },
        pendingDestroy,
      );
      if (previousPass) pendingDestroy.push(previousPass.texture);
      if (!isLast) {
        readTexture = pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    if (overlayLayer) {
      this.effects.runOverlayPass(
        encoder,
        pingPong[writeIndex],
        this.masks.resolve(
          overlayLayer,
          encoder,
          pingPong[writeIndex].createView(),
          pendingDestroy,
        ),
        finalTargetView,
      );
    }
    return this.submitAndDestroy(encoder, pendingDestroy, enabledLayers.length);
  }

  private submitAndDestroy(
    encoder: GPUCommandEncoder,
    pendingDestroy: FrameResource[],
    enabledLayerCount: number,
  ): FramePipelineResult {
    this.device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    return { enabledLayerCount, churnedResourceCount: pendingDestroy.length };
  }
}
