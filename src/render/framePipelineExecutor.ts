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
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; guideEpoch?: number; imageSourceView?: GPUTextureView | null },
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

/** Résout l'entrée d'un calque de photo (double exposure, ARCHITECTURE.md
 *  §4.3) en une texture pleine taille, couverture dans le canal alpha —
 *  jamais appelé pour un calque sans `imageSource`. Lève si
 *  `layer.imageSource.sourceId` est introuvable dans `PhotoSourceStore`
 *  (fail-fast, pas de calque photo silencieusement vide). */
export interface PhotoLayerInputPort {
  resolve(
    encoder: GPUCommandEncoder,
    layer: LayerState,
    bgWidth: number,
    bgHeight: number,
    pendingDestroy: FrameResource[],
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
    private readonly photoInputs: PhotoLayerInputPort,
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
    const encoder = this.device.createCommandEncoder();
    const overlayTimeSeconds = performance.now() / 1000;
    const pendingDestroy: FrameResource[] = [];

    // Une passe (effet interne, resolve de masque...) peut lancer en cours
    // de frame — sans ce garde, toute texture/buffer transitoire déjà
    // poussée dans pendingDestroy PAR UN CALQUE PRÉCÉDENT resterait
    // orpheline sur le GPU (jamais soumise, jamais détruite). Le catch
    // détruit ce qui a déjà été créé puis relance — aucun fallback silencieux,
    // l'appelant voit toujours l'erreur d'origine.
    try {
      return this.runFrame(
        layers,
        finalTargetView,
        maskOverlayLayerId,
        sourceTexture,
        pingPong,
        encoder,
        overlayTimeSeconds,
        pendingDestroy,
      );
    } catch (error) {
      for (const resource of pendingDestroy) resource.destroy();
      throw error;
    }
  }

  private runFrame(
    layers: LayerState[],
    finalTargetView: GPUTextureView,
    maskOverlayLayerId: string | null,
    sourceTexture: GPUTexture,
    pingPong: [GPUTexture, GPUTexture],
    encoder: GPUCommandEncoder,
    overlayTimeSeconds: number,
    pendingDestroy: FrameResource[],
  ): FramePipelineResult {
    const enabledLayers = layers.filter((layer) => layer.enabled);
    const overlayLayer = maskOverlayLayerId
      ? (layers.find((layer) => layer.id === maskOverlayLayerId) ?? null)
      : null;

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

      // Double exposure (ARCHITECTURE.md §4.3, approche C2) : un calque
      // portant `imageSource` ne doit JAMAIS voir le composite-en-dessous
      // comme son entrée d'effet/passes internes — sans ça, un effet
      // multi-passe (glow) échantillonnerait le fond au lieu de la
      // silhouette (défaut (a) du design doc). La pré-passe rend la photo
      // transformée dans une texture pleine taille (couverture en alpha),
      // consommée ensuite par la chaîne EXISTANTE sans cas particulier.
      let effectInputSourceView = readTexture.createView();
      let imageSourceView: GPUTextureView | null = null;
      if (layer.imageSource) {
        // I4 : `resolved` est la texture cible PERSISTANTE possédée par
        // PhotoLayerInputResolver (voir photoLayerInput.ts) — jamais
        // poussée dans pendingDestroy ici, elle survit à la frame et n'est
        // détruite que par PhotoLayerInputResolver.dispose() (au
        // changement de document, cf. renderer.ts).
        const resolved = this.photoInputs.resolve(encoder, layer, sourceTexture.width, sourceTexture.height, pendingDestroy);
        effectInputSourceView = resolved.createView();
        imageSourceView = resolved.createView();
      }

      let previousPass: { view: GPUTextureView; texture: GPUTexture } | null = null;
      if (effect.passes?.length) {
        previousPass = this.effects.runInternalPasses(
          encoder,
          effect,
          layer,
          effectInputSourceView,
          pendingDestroy,
        );
      }
      this.effects.runEffectPass(
        encoder,
        effect,
        layer,
        // `sourceView` (le `color`/base du mix) reste TOUJOURS le
        // composite-en-dessous, jamais la photo — c'est ce qui laisse
        // apparaître le fond hors des bornes de la silhouette (défaut (b),
        // couverture injectée séparément via `imageSourceView`).
        readTexture.createView(),
        targetView,
        {
          applyMask: true,
          prevPassView: previousPass?.view,
          imageSourceView,
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
      // L'invariant qui compte n'est PAS "l'overlay utilise tel guide
      // fixe" mais "les deux appels masks.resolve() d'un même calque, dans
      // la même frame, portent le même guideEpoch numérique" — c'est la
      // seule chose que MaskTextureResolver compare pour décider
      // d'invalider (maskTextureResolver.ts:243-247), pas l'identité de
      // texture. On mirrorise donc exactement la formule déjà utilisée par
      // la boucle principale (index === 0 ? 0 : this.runGeneration) sur
      // l'index réel du calque overlay, plutôt qu'une valeur fixe — sans
      // ça, un calque non-premier édité avec overlay actif invaliderait
      // son cache SAT à CHAQUE appel au lieu d'aucun (voir
      // docs/superpowers/specs/2026-07-24-shaderlab-overlay-guide-source-design.md,
      // amendement).
      const overlayIndex = enabledLayers.findIndex((l) => l.id === overlayLayer.id);
      overlayMaskTexture = this.masks.resolve(
        overlayLayer,
        encoder,
        overlayIndex <= 0 ? sourceTexture.createView() : composedTexture.createView(),
        pendingDestroy,
        overlayIndex <= 0 ? 0 : this.runGeneration,
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
