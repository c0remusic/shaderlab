import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { projectIsolation } from "../layers/isolation";
import { EffectPassRunner } from "./effectPassRunner";
import { MaskTextureResolver } from "./maskTextureResolver";
import { FramePipelineExecutor, type PhotoLayerInputPort } from "./framePipelineExecutor";
import { PhotoSourceStore } from "./photoSourceStore";
import { PhotoLayerInputResolver } from "./photoLayerInput";
import { PresentPass, presentBackgroundFor, maskOverlayFor, type PresentDestination } from "./presentPass";
import { FrameScheduler } from "./frameScheduler";
import { FrameReadback } from "./frameReadback";
import { noopDiagnosticLogger, type DiagnosticLogger } from "./diagnostics";
import { ImageFrameResources } from "./imageFrameResources";
import { FrameDiagnostics } from "./frameDiagnostics";
import type { DirtyRect } from "../mask/maskPainter";

/** Which part of the live-preview mask texture a `MaskPreviewOverride` needs
 *  uploaded this frame. `"full"` re-uploads the whole image — required the
 *  first time a layer starts being live-previewed, since `liveMaskTexture`
 *  may hold a DIFFERENT layer's stale content (or this same layer's content
 *  from before an undo/redo that happened between strokes). `"partial"`
 *  uploads only `rect` — safe for every sample after the first within one
 *  stroke, once the texture is known to already reflect this layer.
 *
 *  A discriminated union rather than an optional `dirtyRect` field
 *  (2026-07-15 cleanup): the previous shape used the field's ABSENCE to
 *  mean "force full upload," an intent easy to lose on the next edit since
 *  nothing in the type said "this optionality is load-bearing." */
export type MaskUploadScope =
  { kind: "full" } | { kind: "partial"; rect: DirtyRect };

/** Live mask-paint preview: renders `raster` (the painter's own live
 *  buffer, not yet committed to the layer's brush mask source) for
 *  `layerId` on this one frame only. Lets `handleMaskStroke` show visual
 *  feedback on every coalesced pointer sample without paying
 *  `LayerStack.updateBrushMask()`'s per-sample immutable-copy cost
 *  (~26MB on a 24MP photo).
 *
 *  `scope` controls how much of the texture actually gets uploaded — see
 *  `MaskUploadScope`. This matters independently of the copy above:
 *  crash-dump analysis (2026-07-15) showed that moving the FULL mask
 *  buffer at real drag sampling rates crashes the renderer with an OOM
 *  abort whether that move is a JS-side copy OR a full-buffer GPU
 *  `writeTexture` reupload — it's the size×frequency product that exceeds
 *  a throughput ceiling, not which mechanism carries it. A brush stroke
 *  only ever touches a small area, so there is no reason to move the whole
 *  buffer every sample. */
export interface MaskPreviewOverride {
  layerId: string;
  raster: Uint8Array;
  scope: MaskUploadScope;
}

/**
 * Multi-pass renderer: ping-pongs between two off-screen render targets, one
 * pass per enabled layer. All off-screen intermediate textures (source,
 * ping-pong pair) are created with `ctx.srgbFormat`, matching Task 2's
 * established pattern (srgbFormat is fine for regular textures — the
 * "no -srgb format" restriction only applies to GPUCanvasContext.configure()).
 * The final pass writes into the canvas via `getSrgbCanvasView`, so the
 * pipeline's fragment target format is always `ctx.srgbFormat`, whether the
 * target is an off-screen texture view or the canvas's sRGB view.
 */
export class Renderer {
  private readonly frameDiagnostics: FrameDiagnostics;
  private ctx: GpuContext;
  private readonly imageResources: ImageFrameResources;
  private sampler: GPUSampler;
  /** Sampler `nearest` (pas bilinéaire) pour les passes edge-aware — un box
   *  filter accumule des échantillons discrets, un filtrage bilinéaire
   *  parasiterait la moyenne. Suit le même pattern que `this.sampler`,
   *  jamais réutilisé pour les passes couleur/masque existantes. Malgré le
   *  filtre "nearest", son type de binding WebGPU reste "filtering" (pas
   *  "non-filtering", un type distinct côté validation) — voir le
   *  commentaire dans `runEdgeAwarePipeline`/`pass()`. Nommé `nearestSampler`
   *  plutôt que `nonFilteringSampler` pour ne pas laisser croire au type de
   *  binding WebGPU "non-filtering", qui aurait cassé `textureSample()`. */
  private nearestSampler: GPUSampler;
  private effectPassRunner: EffectPassRunner | null = null;
  private maskTextureResolver: MaskTextureResolver | null = null;
  private framePipelineExecutor: FramePipelineExecutor | null = null;
  /** Propriétaire GPU exclusif des textures de photo importée (double
   *  exposure, ARCHITECTURE.md §4.2) — créé/vidé avec le document, jamais
   *  référencé depuis `LayerState`/le state React. */
  private photoSourceStore: PhotoSourceStore | null = null;
  private photoLayerInputResolver: PhotoLayerInputResolver | null = null;
  private renderScheduler = new FrameScheduler<{
    layers: LayerState[];
    preview: MaskPreviewOverride | null;
  }>((payload) => this.render(payload.layers, payload.preview));
  /** Id du calque dont le masque est affiché en overlay safelight (mode
   *  peinture), ou null (pas d'overlay). Piloté par `setMaskOverlay()` depuis
   *  l'UI — état plutôt que paramètre de chaque `requestRender`, pour ne pas
   *  le faire transiter par tous les sites d'appel de rendu. */
  private maskOverlayLayerId: string | null = null;
  /** Id du calque ISOLÉ (Alt+clic sur l'œil), ou null. Même statut que
   *  `maskOverlayLayerId` : état d'interface transitoire porté par le renderer
   *  plutôt que paramètre de chaque `requestRender`, pour ne pas le faire
   *  transiter par tous les sites d'appel de rendu (App.tsx en compte une
   *  dizaine). Appliqué par `render()` uniquement — voir `setIsolatedLayer`. */
  private isolatedLayerId: string | null = null;
  /** Dernier frame d'overlay capturé par un rendu complet (`runPipeline`) —
   *  null si aucun overlay actif. Seule source lue par
   *  `tickOverlayAnimation` : jamais recalculée, jamais un nouvel appel à
   *  `MaskTexturesPort.resolve()` depuis la boucle d'animation (coûteux,
   *  voir `docs/superpowers/specs/2026-07-23-shaderlab-mask-threshold-contour-design.md`). */
  private lastOverlayFrame: {
    composedTexture: GPUTexture;
    overlayMaskTexture: GPUTexture;
    /** Buffer dans lequel la passe d'overlay a écrit ce frame-là — celui que
     *  `PresentPass` a ensuite aplati vers le canvas. `tickOverlayAnimation`
     *  le réutilise comme cible : c'est l'autre buffer de ping-pong que
     *  `composedTexture`, donc jamais lu et écrit dans la même passe. */
    overlayTargetTexture: GPUTexture;
  } | null = null;
  /** Aplatit le composite (alpha droit) sur un fond opaque — SEUL écrivain du
   *  canvas et de la cible d'export. Voir `presentPass.ts` pour pourquoi cette
   *  unicité est la garde contre le JPEG noir silencieux. */
  private readonly presentPass: PresentPass;
  constructor(
    ctx: GpuContext,
    diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger,
  ) {
    this.ctx = ctx;
    this.frameDiagnostics = new FrameDiagnostics(diagnosticLogger);
    // `clamp-to-edge` EXPLICITE, pas un défaut implicite : ce sampler est
    // partagé par toutes les passes (effets, fold de masque, générateurs,
    // edge-aware/SAT, pré-passe de calque photo), et plusieurs en dépendent
    // vraiment — `photoLayerInput.ts` transforme la photo hors du cadre puis
    // annule le hors-bornes par sa couverture alpha (un mode repeat/mirror y
    // ferait réapparaître la photo répétée sur tout le fond), et la chaîne
    // bloom/SAT s'appuie sur des bords non repliés. Il ne doit donc PAS être
    // basculé en repeat/mirror pour régler une traînée de bord : les effets qui
    // échantillonnent hors cadre (chromaticBleed, warp) traitent leur propre
    // bord via `mirrorUv` (voir effects/uvSpace.ts).
    this.sampler = ctx.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
    });
    this.nearestSampler = ctx.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
    });
    this.imageResources = new ImageFrameResources(
      ctx.device,
      ctx.srgbFormat,
      ctx.device.limits.maxTextureDimension2D,
    );
    // Aucun état lié au document : contrairement aux autres passes, elle ne
    // dépend ni de la taille de l'image ni du store de photos.
    this.presentPass = new PresentPass(ctx.device, ctx.srgbFormat, this.sampler);
  }

  /** Active/désactive l'overlay safelight du masque d'un calque (mode peinture).
   *  Passer `null` pour l'éteindre. Ne déclenche pas de rendu — l'appelant fait
   *  un `requestRender()` ensuite.
   *
   *  N'affecte QUE l'écran, même statut que `setIsolatedLayer` : l'overlay est
   *  une aide de visée, pas une propriété du document. La séparation n'est pas
   *  posée ici mais dans `maskOverlayFor` (presentPass.ts), dérivée de la
   *  destination — voir `runPipeline`. */
  setMaskOverlay(layerId: string | null): void {
    this.maskOverlayLayerId = layerId;
  }

  /** Isole un calque à l'écran (tous les autres masqués), ou `null` pour
   *  rétablir la visibilité réelle des calques. Ne déclenche pas de rendu —
   *  l'appelant fait un `requestRender()` ensuite (même contrat que
   *  `setMaskOverlay`).
   *
   *  N'affecte QUE `render()` (l'écran) : `exportFrame()` continue de rendre le
   *  document tel qu'il est, parce que l'isolation est une aide visuelle de
   *  jugement, pas une propriété du document. Le modèle de calques n'est jamais
   *  touché — voir `layers/isolation.ts`. */
  setIsolatedLayer(layerId: string | null): void {
    this.isolatedLayerId = layerId;
  }

  /**
   * Constructs a brand-new `Renderer` and loads `bitmap` into it, as a self-
   * contained candidate the caller can validate BEFORE touching whatever
   * renderer/document is currently active — the transactional-open pattern
   * `App.tsx`'s `openFile` relies on. If `loadImage()` throws (unsupported
   * image, GPU size limit, allocator OOM), this disposes the candidate's own
   * partially-created resources and rethrows, so a failed open can never
   * leave orphaned GPU textures behind, and the caller can simply discard
   * the rejected candidate — the renderer it was about to replace is never
   * touched.
   */
  static async createLoaded(
    ctx: GpuContext,
    bitmap: ImageBitmap,
    diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger,
  ): Promise<Renderer> {
    const candidate = new Renderer(ctx, diagnosticLogger);
    try {
      await candidate.loadImage(bitmap);
    } catch (e) {
      candidate.dispose();
      throw e;
    }
    return candidate;
  }

  async loadImage(bitmap: ImageBitmap): Promise<void> {
    this.imageResources.loadImage(bitmap);
    const { device, srgbFormat } = this.ctx;
    const { width, height } = this.imageResources;
    this.effectPassRunner?.clearPipelines();
    this.effectPassRunner = new EffectPassRunner(
      device,
      srgbFormat,
      width,
      height,
      this.sampler,
      (layer, encoder, sourceView, pendingDestroy, guideEpoch) =>
        this.maskTextureResolver!.resolve(
          layer,
          encoder,
          sourceView,
          pendingDestroy,
          guideEpoch,
        ),
    );
    this.maskTextureResolver?.dispose();
    this.maskTextureResolver = new MaskTextureResolver(
      this.ctx,
      width,
      height,
      this.sampler,
      this.nearestSampler,
      () => this.imageResources.sourceTexture!,
    );

    this.photoSourceStore?.dispose();
    this.photoSourceStore = new PhotoSourceStore(device, srgbFormat, device.limits.maxTextureDimension2D);
    this.photoLayerInputResolver?.dispose();
    this.photoLayerInputResolver = new PhotoLayerInputResolver(device, srgbFormat, this.sampler);
    const photoInputsAdapter: PhotoLayerInputPort = {
      resolve: (encoder, layer, bgWidth, bgHeight, pendingDestroy) => {
        if (!layer.imageSource || !layer.transform) {
          throw new Error(`Calque "${layer.id}" sans imageSource/transform passé au port photo — invariant violé.`);
        }
        const photoTexture = this.photoSourceStore!.get(layer.imageSource.sourceId);
        if (!photoTexture) {
          throw new Error(`Source de photo introuvable: ${layer.imageSource.sourceId} (calque "${layer.id}").`);
        }
        const dims = this.photoSourceStore!.dimensions(layer.imageSource.sourceId)!;
        return this.photoLayerInputResolver!.resolve(
          encoder, photoTexture, dims.width, dims.height, bgWidth, bgHeight, layer.transform, pendingDestroy,
        );
      },
    };

    this.framePipelineExecutor = new FramePipelineExecutor(
      device,
      this.imageResources,
      this.effectPassRunner,
      this.maskTextureResolver,
      photoInputsAdapter,
    );
  }

  /** Le `Renderer` est le propriétaire GPU réel (créé/vidé avec `loadImage`)
   *  — `App.tsx` s'en sert pour enregistrer/dimensionner les photos
   *  importées sans dupliquer un second store parallèle. */
  get photoSources(): PhotoSourceStore | null {
    return this.photoSourceStore;
  }

  render(
    layers: LayerState[],
    preview: MaskPreviewOverride | null = null,
  ): void {
    this.maskTextureResolver?.setLivePreview(preview);
    // try/finally : si runPipeline lance (échec GPU en cours d'encodage),
    // l'override de preview reste sinon posé indéfiniment — le PROCHAIN
    // rendu (sans preview) réutiliserait alors par erreur la texture de
    // preview périmée d'un trait de pinceau précédent.
    try {
      // Projection d'isolation ICI et pas dans `runPipeline` : `exportFrame`
      // passe par `runPipeline` et doit rendre le document réel.
      this.runPipeline(projectIsolation(layers, this.isolatedLayerId), { kind: "canvas" });
    } finally {
      this.maskTextureResolver?.setLivePreview(null);
    }
  }

  /** Rendu coalescé : à privilégier pour tout ce qui peut tirer plus vite
   *  que la frame (drag de slider, pinceau). `render()` reste disponible
   *  pour un rendu immédiat déterministe (premier affichage).
   *  `preview` : voir `MaskPreviewOverride` — utilisé par le pinceau pour un
   *  retour visuel par échantillon sans passer par `updateBrushMask()`. */
  requestRender(
    layers: LayerState[],
    preview: MaskPreviewOverride | null = null,
  ): void {
    this.renderScheduler.request({ layers, preview });
  }

  /** Ré-exécute UNIQUEMENT le pass d'overlay (contour + pointillés) sur le
   *  dernier frame composé — jamais le fold du masque ni les effets. No-op
   *  si aucun overlay n'est actif (`lastOverlayFrame` null). Appelée en
   *  boucle par `OverlayAnimationLoop` depuis `App.tsx`, jamais par un
   *  rendu normal. `timeMs` vient directement du timestamp rAF. */
  tickOverlayAnimation(timeMs: number): void {
    if (!this.lastOverlayFrame || !this.effectPassRunner) return;
    const { composedTexture, overlayMaskTexture, overlayTargetTexture } = this.lastOverlayFrame;
    const encoder = this.ctx.device.createCommandEncoder();
    // Même chaîne que le rendu complet : overlay dans un buffer de ping-pong,
    // PUIS aplatissement. Écrire le canvas directement ici court-circuiterait
    // le seul point qui rend l'alpha présentable — l'animation d'overlay
    // afficherait un rendu différent de celui de la frame précédente.
    this.effectPassRunner.runOverlayPass(
      encoder,
      composedTexture,
      overlayMaskTexture,
      overlayTargetTexture.createView(),
      timeMs / 1000,
    );
    this.presentPass.encode(
      encoder,
      overlayTargetTexture.createView(),
      getSrgbCanvasView(this.ctx),
      presentBackgroundFor({ kind: "canvas" }),
    );
    this.ctx.device.queue.submit([encoder.finish()]);
  }

  /**
   * Renders the full layer stack into an off-screen texture instead of the
   * canvas, then reads it back — used by the export pipeline (Task 10).
   *
   * `render()` always writes its last pass straight to the canvas's current
   * texture, never into `pingPong` — reading `pingPong[0]` back after a call
   * to `render()` would return stale data (whatever pass happened to land
   * there last, not the actual final composited frame). This method
   * sidesteps that by reusing the same multi-pass loop (`runPipeline`) but
   * targeting a dedicated off-screen `exportTexture` for every pass,
   * including the last one, so the readback always reflects the true final
   * frame.
   */
  async exportFrame(layers: LayerState[]): Promise<Uint8Array> {
    const exportTexture = this.imageResources.getExportTexture();
    this.runPipeline(layers, { kind: "export" });
    const readback = new FrameReadback(
      this.ctx.device,
      this.imageResources.width,
      this.imageResources.height,
      this.ctx.srgbFormat.startsWith("bgra"),
    );
    const padded = await readback.readTextureBytes(exportTexture);
    const stripped = readback.stripRowPadding(padded);
    return readback.swapRedBlueChannels(stripped);
  }

  /** Encode la frame puis l'APLATIT dans `destination`. `destination` est un
   *  type fermé, pas une vue de texture : c'est ce qui empêche un appelant de
   *  choisir lui-même le fond d'aplatissement — donc d'écrire le damier dans
   *  un fichier exporté (voir `presentBackgroundFor`). */
  private runPipeline(
    layers: LayerState[],
    destination: PresentDestination,
  ): void {
    if (!this.framePipelineExecutor) throw new Error("Aucune image chargée.");
    const diagStart = performance.now();
    const result = this.framePipelineExecutor.run(
      layers,
      // JAMAIS `this.maskOverlayLayerId` directement : l'overlay est dérivé de
      // la destination, au même titre que le fond d'aplatissement — voir
      // `maskOverlayFor`. C'est ce qui empêche le voile rouge d'atteindre un
      // fichier exporté.
      maskOverlayFor(destination, this.maskOverlayLayerId),
    );
    // `lastOverlayFrame` décrit le dernier frame d'ÉCRAN, seule chose que
    // `tickOverlayAnimation` a le droit de rejouer. Un export ne le remet donc
    // pas à null : sans ce garde, exporter pendant un aperçu de masque figerait
    // l'animation du contour jusqu'au rendu suivant.
    if (destination.kind === "canvas") {
      this.lastOverlayFrame =
        result.composedTexture && result.overlayMaskTexture
          ? {
              composedTexture: result.composedTexture,
              overlayMaskTexture: result.overlayMaskTexture,
              overlayTargetTexture: result.presentTexture,
            }
          : null;
    }
    const encoder = this.ctx.device.createCommandEncoder();
    this.presentPass.encode(
      encoder,
      result.presentTexture.createView(),
      this.destinationView(destination),
      presentBackgroundFor(destination),
    );
    this.ctx.device.queue.submit([encoder.finish()]);
    this.frameDiagnostics.record(diagStart, result, {
      pipelineCacheSize: this.effectPassRunner?.pipelineCount ?? 0,
      imageWidth: this.imageResources.width,
      imageHeight: this.imageResources.height,
    });
  }

  /** Unique traduction destination → surface GPU réelle. Le pendant de
   *  `presentBackgroundFor` : les deux dérivent du MÊME `destination`, donc le
   *  fond d'aplatissement ne peut pas se désynchroniser de la surface écrite. */
  private destinationView(destination: PresentDestination): GPUTextureView {
    return destination.kind === "canvas"
      ? getSrgbCanvasView(this.ctx)
      : this.imageResources.getExportTexture().createView();
  }

  /**
   * Destroys all persistent GPU textures owned by this renderer (source,
   * ping-pong pair, export target, resident mask textures, shared white
   * mask). Callers that replace a `Renderer` instance (e.g. `App.tsx`'s
   * `openFile` on a new image) must call this on the outgoing instance
   * first — otherwise its textures are orphaned on the GPU with no JS
   * reference left to ever destroy them.
   */
  dispose(): void {
    this.renderScheduler.cancel();
    this.imageResources.dispose();
    this.effectPassRunner?.clearPipelines();
    this.effectPassRunner = null;
    this.maskTextureResolver?.dispose();
    this.maskTextureResolver = null;
    this.photoSourceStore?.dispose();
    this.photoSourceStore = null;
    this.photoLayerInputResolver?.dispose();
    this.photoLayerInputResolver = null;
    this.framePipelineExecutor = null;
    this.presentPass.clearPipelines();
    this.lastOverlayFrame = null;
  }
}
