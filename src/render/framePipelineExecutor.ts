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
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; guideEpoch?: number },
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
    time: number,
  ): void;
}

/** Persistent mask residency; it encodes mask work but never submits it. */
export interface MaskTexturesPort {
  sweep(layerIds: ReadonlySet<string>): void;
  /** `guideEpoch` : identifie la "fraîcheur" de `colorView` (l'image de
   *  guide du filtre edge-aware) — constant pour le calque du bas (guide =
   *  image source stable), changeant à chaque exécution réelle du pipeline
   *  sinon (le composite en dessous est ré-encodé sans mémoïsation par
   *  calque). Sans ce signal, edge-aware pouvait rester figé sur un ancien
   *  composite après modif d'un calque en dessous. */
  resolve(
    layer: LayerState,
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    pendingDestroy: FrameResource[],
    guideEpoch: number,
  ): GPUTexture;
}

export type FramePipelineResult = {
  enabledLayerCount: number;
  churnedResourceCount: number;
  /** Texture composée AVANT overlay (le frame réel, sans le rouge/contour de
   *  masque) — null si aucun overlayLayer n'était actif ce rendu. Capturée
   *  ici plutôt que recalculée : c'est la seule source de vérité pour
   *  `Renderer.tickOverlayAnimation`, qui ne doit jamais deviner quel buffer
   *  ping-pong contient le bon frame. */
  composedTexture: GPUTexture | null;
  /** Texture de masque déjà résolue par `MaskTexturesPort.resolve()` pour
   *  l'overlay de ce rendu, ou null si aucun overlayLayer. `resolve()` n'est
   *  PAS un cache de résultat pour edge-aware/refine-edge (seul le fold est
   *  mis en cache, voir `maskTextureResolver.ts`) — la rappeler à chaque
   *  frame d'animation regénérerait ce travail coûteux. La capturer ici
   *  évite tout nouvel appel à `resolve()` hors d'un vrai rendu complet. */
  overlayMaskTexture: GPUTexture | null;
};

/**
 * Encodes and submits one complete image frame. This is the sole owner of
 * frame-scoped GPU destruction: resources are released only after submit.
 */
export class FramePipelineExecutor {
  /** Incrémenté à chaque exécution réelle du pipeline — sert de `guideEpoch`
   *  "changeant" pour tout calque dont le guide edge-aware n'est pas
   *  l'image source stable (voir `MaskTexturesPort.resolve`). */
  private runGeneration = 0;

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
    this.runGeneration++;

    this.masks.sweep(new Set(layers.map((layer) => layer.id)));
    const enabledLayers = layers.filter((layer) => layer.enabled);
    const overlayLayer = maskOverlayLayerId
      ? (layers.find((layer) => layer.id === maskOverlayLayerId) ?? null)
      : null;
    const encoder = this.device.createCommandEncoder();
    const overlayTimeSeconds = performance.now() / 1000;
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
      let overlayMaskTexture: GPUTexture | null = null;
      if (overlayLayer && blitTarget) {
        overlayMaskTexture = this.masks.resolve(
          overlayLayer,
          encoder,
          sourceTexture.createView(),
          pendingDestroy,
          // Guide = image source stable (aucun calque composité) — même
          // statut de fraîcheur que le premier calque de la pile.
          0,
        );
        this.effects.runOverlayPass(
          encoder,
          blitTarget,
          overlayMaskTexture,
          finalTargetView,
          overlayTimeSeconds,
        );
      }
      return this.submitAndDestroy(encoder, pendingDestroy, 0, blitTarget, overlayMaskTexture);
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
        {
          applyMask: true,
          prevPassView: previousPass?.view,
          // 0 = image source stable (premier calque) ; sinon le composite
          // des calques en dessous, ré-encodé à chaque run() (voir champ
          // `runGeneration`).
          guideEpoch: index === 0 ? 0 : this.runGeneration,
        },
        pendingDestroy,
      );
      if (previousPass) pendingDestroy.push(previousPass.texture);
      if (!isLast) {
        readTexture = pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    let overlayMaskTexture: GPUTexture | null = null;
    let composedTexture: GPUTexture | null = null;
    if (overlayLayer) {
      composedTexture = pingPong[writeIndex];
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        composedTexture.createView(),
        pendingDestroy,
        // Guide = composite de tous les calques activés, toujours ré-encodé
        // à chaque run() — jamais le cas stable "premier calque".
        this.runGeneration,
      );
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        finalTargetView,
        overlayTimeSeconds,
      );
    }
    return this.submitAndDestroy(encoder, pendingDestroy, enabledLayers.length, composedTexture, overlayMaskTexture);
  }

  private submitAndDestroy(
    encoder: GPUCommandEncoder,
    pendingDestroy: FrameResource[],
    enabledLayerCount: number,
    composedTexture: GPUTexture | null,
    overlayMaskTexture: GPUTexture | null,
  ): FramePipelineResult {
    this.device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    return {
      enabledLayerCount,
      churnedResourceCount: pendingDestroy.length,
      composedTexture,
      overlayMaskTexture,
    };
  }
}
