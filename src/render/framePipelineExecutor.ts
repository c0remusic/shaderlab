import type { LayerState } from "../layers/types";
import { resolveClipping, type ClipResolution } from "../layers/clipping";
import { defaultLayerMask } from "../mask/types";
import { getEffect } from "./effects/registry";
import { PASSTHROUGH_EFFECT } from "./effectPassRunner";

type FrameResource = GPUTexture | GPUBuffer;

/** Descripteur de calque NEUTRE d'une passe qui doit se contenter de recopier
 *  son entrée : opacité pleine, fusion normale, masque par défaut, aucun
 *  paramètre. Sert au court-circuit « 0 calque activé » et à la neutralisation
 *  d'un calque écrêté `suppressed` (design 2026-07-27 §3.4) — dans les deux cas
 *  couplé à `PASSTHROUGH_EFFECT`, dont le `fs_main` rend son entrée telle
 *  quelle : le mix de compositing ramène alors `color` quel que soit le masque
 *  résolu. */
function neutralPassLayer(): LayerState {
  return {
    id: "",
    effectId: "",
    params: {},
    enabled: true,
    opacity: 1,
    blendMode: "normal",
    mask: defaultLayerMask(),
  };
}

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
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null; guideEpoch?: number; imageSourceView?: GPUTextureView | null; clipCoverageView?: GPUTextureView | null },
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
  /** Texture qui contient le résultat FINAL de cette frame, à alpha droit
   *  composé. L'exécuteur n'écrit plus jamais la surface visible (canvas ou
   *  cible d'export) : c'est `PresentPass` qui l'aplatit sur un fond opaque,
   *  en un seul point (voir `presentPass.ts`). Toujours l'un des deux buffers
   *  de ping-pong — aucune texture supplémentaire n'est allouée pour ça. */
  presentTexture: GPUTexture;
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
      const blitTarget = pingPong[0];
      this.effects.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        neutralPassLayer(),
        sourceTexture.createView(),
        blitTarget.createView(),
        // `applyMask: false` — c'est une COPIE, pas un compositing. Depuis que
        // l'alpha est réellement composé (shaderCompose.ts), passer cette
        // passe par le chemin de compositing forcerait `outAlpha` à 1 (poids =
        // opacité 1 × masque par défaut 1) et écraserait l'alpha de l'entrée
        // qu'elle est censée recopier — une toile transparente ressortirait
        // opaque. Le chemin sans masque rend `effected` tel quel, alpha inclus,
        // et évite au passage un `masks.resolve` inutile.
        { applyMask: false },
        pendingDestroy,
      );
      let overlayMaskTexture: GPUTexture | null = null;
      let presentTexture: GPUTexture = blitTarget;
      if (overlayLayer) {
        overlayMaskTexture = this.masks.resolve(
          overlayLayer,
          encoder,
          sourceTexture.createView(),
          pendingDestroy,
          // Guide = image source stable (aucun calque composité) — même
          // statut de fraîcheur que le premier calque de la pile.
          0,
        );
        // L'overlay LIT `blitTarget` (pingPong[0]) et ÉCRIT l'autre buffer :
        // jamais la même texture en lecture et en écriture.
        presentTexture = pingPong[1];
        this.effects.runOverlayPass(
          encoder,
          blitTarget,
          overlayMaskTexture,
          presentTexture.createView(),
          overlayTimeSeconds,
        );
      }
      return this.submitAndDestroy(
        encoder,
        pendingDestroy,
        0,
        overlayLayer ? blitTarget : null,
        overlayMaskTexture,
        presentTexture,
      );
    }

    // Écrêtage (design 2026-07-27 §3.2/§3.4) : l'attachement est STRUCTUREL
    // (calculé sur la pile reçue, sans regarder `enabled`), l'effectivité
    // dépend de ce que cette frame encode réellement — donc des calques
    // activés APRÈS la projection d'isolation, qui a déjà eu lieu (renderer.ts).
    const clipResolutions = resolveClipping(layers, new Set(enabledLayers.map((l) => l.id)));
    // Vue de la cible photo déjà résolue, RETENUE d'une itération à l'autre :
    // aucune passe, aucune texture, aucun octet de VRAM supplémentaires. Ce qui
    // rend la rétention correcte est la garde « la photo est terminale »
    // (layers/clipping.ts) : entre une base photo et le calque écrêté qui la
    // consomme, la pile ne peut contenir que des calques écrêtés NON photo,
    // donc aucun `photoInputs.resolve()` ne peut s'intercaler et re-`clear`er
    // la cible partagée.
    let clipCoverageView: GPUTextureView | null = null;

    let readTexture = sourceTexture;
    let writeIndex = 0;
    for (let index = 0; index < enabledLayers.length; index++) {
      const layer = enabledLayers[index];
      const effect = getEffect(layer.effectId);
      const isLast = index === enabledLayers.length - 1;
      // Toujours un buffer de ping-pong, y compris pour la DERNIÈRE passe : la
      // surface visible n'est plus écrite ici mais par `PresentPass`, qui
      // aplatit l'alpha composé sur un fond opaque (presentPass.ts). Retirer
      // cette destination externe supprime aussi un cas particulier de la
      // boucle la plus sensible du projet.
      const targetView = pingPong[writeIndex].createView();
      const clip: ClipResolution = clipResolutions.get(layer.id) ?? { kind: "none" };

      // Calque écrêté dont la base photo n'est pas rendue : il ne contribue
      // pas, mais il RESTE dans la boucle, à son index, encodé en passe
      // neutre. Le filtrer casserait tout ce que la boucle dérive de
      // `enabledLayers` — `isLast`, le choix cible finale/ping-pong,
      // `guideEpoch`, l'avance du ping-pong, l'index overlay et le compte
      // remonté : si le DERNIER calque activé était sauté, plus aucune passe
      // n'écrirait `finalTargetView`. Aucune option (donc aucune passe
      // interne, aucun `masks.resolve` du calque) : le coût se réduit à une
      // copie plein écran, sur le chemin déjà éprouvé du court-circuit
      // « 0 calque activé ».
      if (clip.kind === "suppressed") {
        this.effects.runEffectPass(
          encoder,
          PASSTHROUGH_EFFECT,
          neutralPassLayer(),
          readTexture.createView(),
          targetView,
          // `applyMask: false` : copie stricte, alpha inclus — même raison que
          // le court-circuit « 0 calque activé » ci-dessus.
          { applyMask: false },
          pendingDestroy,
        );
        clipCoverageView = null;
        if (!isLast) {
          readTexture = pingPong[writeIndex];
          writeIndex = 1 - writeIndex;
        }
        continue;
      }

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
        // I4 : `resolved` est la texture cible PERSISTANTE et PARTAGÉE
        // possédée par PhotoLayerInputResolver (voir photoLayerInput.ts) —
        // jamais poussée dans pendingDestroy ici, elle survit à la frame et
        // n'est détruite que par PhotoLayerInputResolver.dispose() (au
        // changement de document, cf. renderer.ts).
        //
        // ⚠️ Avec N calques photo (MAX_PHOTO_LAYERS = 4), TOUS reçoivent la
        // MÊME texture. Ce qui rend ça correct est l'ordre d'encodage ici :
        // resolve(A) puis les passes de A, ENSUITE resolve(B) puis les
        // passes de B — les passes d'un même encoder s'exécutent dans
        // l'ordre de soumission, donc A a fini de lire la cible avant que B
        // ne la re-clear. Ne jamais hisser ces resolve() hors de la boucle,
        // ni les regrouper en tête de frame : le premier calque photo
        // verrait les pixels du dernier.

        const resolved = this.photoInputs.resolve(encoder, layer, sourceTexture.width, sourceTexture.height, pendingDestroy);
        effectInputSourceView = resolved.createView();
        imageSourceView = resolved.createView();
      }

      // Rétention : un calque photo POSE la couverture pour ce qui vient
      // au-dessus, un écrêté `active` la CONSOMME et la CONSERVE (chaîne),
      // tout autre calque la remet à null.
      const clipView: GPUTextureView | null = clip.kind === "active" ? clipCoverageView : null;
      if (clip.kind === "active" && clipView === null) {
        // Invariant rompu : `active` signifie que la base photo est rendue et
        // qu'elle précède ce calque sans qu'aucun calque non écrêté ne
        // s'intercale. Lever plutôt que rendre linéairement en silence — un
        // écrêtage qui « ne fait rien » serait invisible à l'œil nu.
        throw new Error(
          `Écrêtage: couverture absente pour le calque ${layer.id} (base ${clip.baseLayerId}) — invariant d'ordre des passes rompu.`,
        );
      }
      clipCoverageView = layer.imageSource ? imageSourceView : clipView;

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
          // Écrêté `active` : la couverture de la base photo borne le POIDS de
          // compositing, sans toucher à l'entrée d'effet (qui reste le
          // composite en dessous) — voir shaderCompose §clipToCoverage.
          clipCoverageView: clipView,
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
    // La boucle n'avance pas le ping-pong après sa dernière passe : le
    // composite final est donc dans `pingPong[writeIndex]`.
    let presentTexture: GPUTexture = pingPong[writeIndex];
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
      // L'overlay LIT `composedTexture` (pingPong[writeIndex]) et ÉCRIT
      // l'autre buffer. Sûr : ce buffer-là a servi de `readTexture` à la
      // dernière passe de la boucle, donc plus tôt dans le MÊME encoder — les
      // passes s'exécutent dans l'ordre de soumission (même raisonnement que
      // le partage de la cible photo, plus haut).
      presentTexture = pingPong[1 - writeIndex];
      this.effects.runOverlayPass(
        encoder,
        composedTexture,
        overlayMaskTexture,
        presentTexture.createView(),
        overlayTimeSeconds,
      );
    }
    return this.submitAndDestroy(
      encoder,
      pendingDestroy,
      enabledLayers.length,
      composedTexture,
      overlayMaskTexture,
      presentTexture,
    );
  }

  private submitAndDestroy(
    encoder: GPUCommandEncoder,
    pendingDestroy: FrameResource[],
    enabledLayerCount: number,
    composedTexture: GPUTexture | null,
    overlayMaskTexture: GPUTexture | null,
    presentTexture: GPUTexture,
  ): FramePipelineResult {
    this.device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    return {
      enabledLayerCount,
      churnedResourceCount: pendingDestroy.length,
      composedTexture,
      overlayMaskTexture,
      presentTexture,
    };
  }
}
