import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { projectIsolation } from "../layers/isolation";
import { bottomPhotoSourceId } from "../layers/photoLayer";
import { EffectPassRunner } from "./effectPassRunner";
import { GpuTiming, type GpuTimingReport } from "./gpuTiming";
import { MaskTextureResolver } from "./maskTextureResolver";
import { FramePipelineExecutor, type PhotoLayerInputPort } from "./framePipelineExecutor";
import { PhotoSourceStore } from "./photoSourceStore";
import { TextureLibraryStore } from "./textureLibraryStore";
import { readImageFile } from "../launch";

/** Décodage par défaut d'une texture de bibliothèque : lecture du fichier par
 *  IPC puis décodage navigateur. C'est le SEUL endroit du projet qui lit un
 *  scan en pleine résolution — les vignettes, elles, sont fabriquées côté Rust
 *  (`get_texture_thumbnail`, mesure du 2026-08-05). */
async function defaultDecodeTexture(path: string): Promise<ImageBitmap> {
  const bytes = await readImageFile(path);
  return createImageBitmap(new Blob([bytes.buffer as ArrayBuffer]));
}
import { PhotoLayerInputResolver } from "./photoLayerInput";
import { PresentPass, presentBackgroundFor, maskOverlayFor, type PresentDestination } from "./presentPass";
import { FrameScheduler } from "./frameScheduler";
import { FrameReadback } from "./frameReadback";
import { noopDiagnosticLogger, type DiagnosticLogger } from "./diagnostics";
import { ImageFrameResources } from "./imageFrameResources";
import { FrameDiagnostics } from "./frameDiagnostics";
import type { DirtyRect } from "../mask/maskPainter";
import type { CanvasPixelSize } from "../layers/canvasFormat";
import type { ExportedFrame } from "../export/exportImage";
import type { CanvasFrameState } from "../layers/canvasFrame";
import type { DevelopSettings } from "../layers/developSettings";
import { regionDeLecture, remapUvPourCadre, IDENTITY_UV_REMAP, type UvRemap } from "./cadreProjection";

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
  private textureLibraryStore: TextureLibraryStore | null = null;
  private photoLayerInputResolver: PhotoLayerInputResolver | null = null;
  /** `sourceId` de la photo d'ouverture, enregistrée comme toutes les autres
   *  (tranche T1). Le renderer ne sait rien du calque qui la porte — il ne fait
   *  que rendre l'id à `App.tsx`, qui construit la pile initiale. */
  private backgroundSource: string | null = null;
  /** Pile RÉELLEMENT passée au dernier encodage de frame. Sert uniquement à
   *  `parametricMaskSourceTexture()`, appelée pendant l'encodage : le resolver
   *  de masque ne reçoit pas la pile en paramètre, et la lui faire traverser
   *  toucherait quatre signatures pour une donnée dont un seul point a besoin.
   *  Posée dans `runPipeline`, juste avant `FramePipelineExecutor.run` — donc
   *  toujours la pile de la frame en cours, isolation projetée comprise. */
  private currentLayers: LayerState[] = [];
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
  /** Facteur de réduction CSS du canvas (px CSS de mise en page par px de
   *  canvas). Même statut que `maskOverlayLayerId`/`isolatedLayerId` : un état
   *  d'ÉCRAN porté par le renderer plutôt que passé à chaque `requestRender`.
   *
   *  Le renderer ne le MESURE pas — il ne peut pas : la valeur est une propriété
   *  de mise en page du DOM, qui change au redimensionnement de la fenêtre comme
   *  à l'ouverture d'un panneau, deux événements que le moteur de rendu ne voit
   *  pas. `App.tsx` l'observe (`ResizeObserver` sur l'élément canvas, seul
   *  détenteur du fait) et la pose ici — voir `setDisplayScale`. Le défaut 1
   *  correspond à un canvas affiché à sa taille native : c'est la seule valeur
   *  vraie tant qu'aucune mesure n'a eu lieu. */
  private displayScale = 1;
  /** Cadre de toile pour la PRÉSENTATION (l'écran), ou `null` (toile entière).
   *
   *  État d'ÉCRAN, exactement au même titre que `displayScale`/`isolatedLayerId`
   *  — posé par `App` (à chaque commit qui touche le cadre) plutôt que passé à
   *  chaque `requestRender`, dont les sites d'appel se comptent par dizaines.
   *
   *  ⚠️ N'est LU QUE par le chemin canvas de `runPipeline` (remappage UV de la
   *  présentation). L'EXPORT ne le lit JAMAIS : il reçoit son cadre en paramètre
   *  explicite d'`exportFrame`, donc un champ d'écran resté périmé ne peut pas
   *  produire un fichier mal découpé. C'est la moitié PROUVABLE au harnais, et
   *  elle est tenue sans état dupliqué (ticket 32, §4.3 du ticket 28). */
  private cadre: CanvasFrameState = null;
  /** Réglages de l'ÉTAGE DE DÉVELOPPEMENT pour l'ÉCRAN (ticket 03), ou `{}`.
   *
   *  État de rendu posé par `App` (`setDevelop`) plutôt que passé à chaque
   *  `requestRender`, dont les sites d'appel se comptent par dizaines — même
   *  statut que `cadre`/`displayScale`/`isolatedLayerId`. Contrairement au
   *  `cadre`, l'étage s'applique DANS le pipeline (au composite, espace
   *  d'origine), pas seulement à la présentation ; il vaut donc à l'écran ET à
   *  l'export. `exportFrame` reçoit néanmoins son étage en PARAMÈTRE explicite,
   *  comme le cadre : un champ d'écran resté périmé ne peut pas corrompre un
   *  fichier exporté. */
  private develop: DevelopSettings = {};
  constructor(
    ctx: GpuContext,
    diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger,
    /**
     * Décodage d'une texture de bibliothèque, injecté. Par défaut il lit le
     * fichier par IPC — c'est ce que fait l'application.
     *
     * ⚠️ **LE HARNAIS DE RENDU NE PEUT PAS UTILISER L'IPC**, et c'est une
     * limite structurelle et non un défaut : ses modules sont importés depuis
     * un Vite séparé (origine 1421), et Tauri v2 restreint ses commandes à
     * l'origine de l'application. Un `read_image_file` y répond
     * `not allowed. Plugin not found`. Sans ce port, aucun scénario ne pourrait
     * verrouiller un effet à texture — il rendrait le repli 1×1, et le garde de
     * signal du harnais l'a mesuré à 0,000 % d'écart le 2026-08-05.
     *
     * Le harnais y passe donc une mire GÉNÉRÉE dans la page, ce qui rend la
     * référence plus reproductible qu'un fichier : rien à versionner, rien à
     * télécharger, même discipline que ses autres mires.
     */
    private readonly decodeTexture: (path: string) => Promise<ImageBitmap> = defaultDecodeTexture,
    /**
     * Horloge de l'overlay de masque, injectée pour la même raison que le port
     * ci-dessus : rendre verrouillable ce que l'application, elle, laisse
     * bouger. Le contour du safelight est POINTILLÉ et sa phase avance avec le
     * temps ; à horloge libre, deux rendus de la même pile ne donnent pas les
     * mêmes octets, donc aucune référence de pixels n'est possible.
     *
     * Le harnais la fixe (`scripts/render-check.mjs`) ; l'application garde le
     * défaut. Voir `FramePipelineExecutor` pour le détail.
     */
    private readonly overlayClockMs: () => number = () => performance.now(),
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
    // échantillonnent hors cadre (lensDistortion, warp) traitent leur propre
    // bord via `mirrorUv` (voir effects/uvSpace.ts).
    this.sampler = ctx.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      // Trilinéaire. Le défaut de WebGPU est `nearest`, qui saute d'un niveau à
      // l'autre en laissant une couture visible — et surtout, sans lui les
      // pyramides construites par `mipmapGenerator.ts` ne serviraient à rien.
      //
      // NEUTRE PARTOUT AILLEURS, et c'est ce qui rend ce réglage global sûr :
      // toutes les autres textures du pipeline (ping-pong, masques, photos)
      // n'ont qu'UN niveau, et le LOD y est donc borné à 0 quel que soit ce
      // filtre. Seules les textures de bibliothèque en ont plusieurs.
      mipmapFilter: "linear",
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

  /** Pose le facteur de réduction CSS du canvas (px CSS par px de canvas), mesuré
   *  par l'appelant. Ne déclenche pas de rendu — même contrat que
   *  `setMaskOverlay`/`setIsolatedLayer` : l'appelant fait un `requestRender()`
   *  ensuite, et il doit le faire, sinon le damier garde la taille de case du
   *  dernier rendu (le navigateur, lui, se contente de redimensionner l'image
   *  déjà présente dans le canvas).
   *
   *  N'affecte QUE l'écran, par construction et pas par discipline : la valeur
   *  n'entre dans le pipeline que via le cas `canvas` de `PresentDestination`. */
  setDisplayScale(scale: number): void {
    this.displayScale = scale;
  }

  /** Pose le cadre de toile visible à l'ÉCRAN (ou `null` pour la toile entière).
   *  Ne déclenche pas de rendu — même contrat que `setDisplayScale` : l'appelant
   *  fait un `requestRender()` ensuite, sinon la présentation garde le cadre du
   *  dernier rendu. N'affecte QUE l'écran ; l'export prend son cadre en
   *  paramètre. */
  setCadre(cadre: CanvasFrameState): void {
    this.cadre = cadre;
  }

  /** Pose les réglages de l'ÉTAGE DE DÉVELOPPEMENT pour l'écran (ou `{}`). Ne
   *  déclenche pas de rendu — même contrat que `setCadre` : l'appelant fait un
   *  `requestRender` ensuite. N'affecte QUE l'écran ; l'export prend son étage en
   *  paramètre d'`exportFrame`. */
  setDevelop(develop: DevelopSettings): void {
    this.develop = develop;
  }

  /**
   * Constructs a brand-new `Renderer` and loads `bitmap` into it, as a self-
   * contained candidate the caller can validate BEFORE touching whatever
   * renderer/document is currently active — the transactional-open pattern
   * `App.tsx`'s `openFile` relies on. If `loadImage()` throws (unsupported
   * image, GPU size limit, allocator OOM, échec d'enregistrement de la source
   * de fond), this disposes the candidate's own partially-created resources
   * and rethrows, so a failed open can never leave orphaned GPU textures
   * behind, and the caller can simply discard the rejected candidate — the
   * renderer it was about to replace is never touched.
   *
   * Depuis la tranche T1, « réussir » inclut l'enregistrement de la photo
   * d'ouverture dans `PhotoSourceStore` : un candidat rendu ici porte toujours
   * un `backgroundSourceId`, donc l'appelant ne peut jamais committer un
   * document sans fond (design 2026-07-28 §2.4).
   */
  static async createLoaded(
    ctx: GpuContext,
    bitmap: ImageBitmap,
    diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger,
    canvasSize?: CanvasPixelSize,
  ): Promise<Renderer> {
    const candidate = new Renderer(ctx, diagnosticLogger);
    try {
      await candidate.loadImage(bitmap, canvasSize);
    } catch (e) {
      candidate.dispose();
      throw e;
    }
    return candidate;
  }

  /**
   * Ouvre un document : ALLOUE la toile, puis enregistre `bitmap` comme SOURCE
   * PHOTO — la photo d'ouverture est un calque comme un autre (§1.1) et la toile
   * n'est plus jamais uploadée (§1.2). L'appelant construit le calque de fond à
   * partir de `backgroundSourceId`.
   *
   * `canvasSize` OMIS = toile aux dimensions de `bitmap`, c'est-à-dire
   * exactement le comportement d'avant la tranche T2. Ce n'est pas une
   * politesse : c'est le mécanisme qui rend « ouvrir sans rien choisir » et
   * « le comportement d'aujourd'hui » le MÊME chemin de code, donc identique au
   * pixel près sans qu'aucun test n'ait à le surveiller.
   *
   * Les deux moitiés sont séparées (`allocateDocument` / enregistrement de la
   * photo) parce que la tranche T2 avait besoin d'allouer une toile dont les
   * dimensions ne viennent d'aucune image : avant, « allouer une toile » et
   * « charger une photo » étaient fondues ici et `allocateCanvas` commence par
   * tout détruire.
   */
  async loadImage(bitmap: ImageBitmap, canvasSize?: CanvasPixelSize): Promise<void> {
    this.allocateDocument(canvasSize ?? { width: bitmap.width, height: bitmap.height });
    // EN DERNIER, et dans la même méthode : le document n'est utilisable que si
    // sa photo d'ouverture est une source enregistrée. Un rejet ici (limite GPU,
    // plafond de sources) remonte à `createLoaded`, qui dispose le candidat —
    // aucun document sans fond ne peut être committé (§2.4).
    this.backgroundSource = await this.photoSourceStore!.register(bitmap);
  }

  /**
   * Alloue la TOILE aux dimensions données et (re)construit tout ce qui est
   * dimensionné au document : cibles d'effets, textures de masque, store de
   * sources photo, pré-passe photo, exécuteur de frame. Ne connaît AUCUNE image
   * — c'est la trace dans la signature que la géométrie du document est
   * découplée de celle des photos qu'il contient.
   */
  private allocateDocument(canvasSize: CanvasPixelSize): void {
    this.libererRessourcesGpu();
    this.imageResources.allocateCanvas(canvasSize.width, canvasSize.height);
    const { device, srgbFormat } = this.ctx;
    const { width, height } = this.imageResources;
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
    this.maskTextureResolver = new MaskTextureResolver(
      this.ctx,
      width,
      height,
      this.sampler,
      this.nearestSampler,
      () => this.parametricMaskSourceTexture(),
    );

    this.photoSourceStore = new PhotoSourceStore(device, srgbFormat, device.limits.maxTextureDimension2D);
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

    this.textureLibraryStore = new TextureLibraryStore(
      device,
      srgbFormat,
      device.limits.maxTextureDimension2D,
      // Décodage par le navigateur, et le fichier ne transite qu'ICI : c'est le
      // seul endroit qui lit un scan en pleine résolution. Les VIGNETTES, elles,
      // ne passent jamais par ce chemin — elles sont fabriquées côté Rust
      // (`get_texture_thumbnail`), mesure du 2026-08-05.
      this.decodeTexture,
      // Une texture arrivée après coup doit redemander une frame, sinon l'effet
      // resterait inerte jusqu'au prochain geste — un défaut silencieux.
      () => this.requestRender(this.currentLayers),
    );

    this.framePipelineExecutor = new FramePipelineExecutor(
      device,
      this.imageResources,
      this.effectPassRunner,
      this.maskTextureResolver,
      photoInputsAdapter,
      this.textureLibraryStore,
      this.overlayClockMs,
    );
  }

  /** Catalogue de la bibliothèque de textures — les chemins triés du dossier
   *  courant. C'est ce qui donne un sens au RANG que porte le paramètre d'un
   *  effet `texture`. Posé par `App` quand la bibliothèque change de dossier. */
  setTextureCatalog(paths: readonly string[]): void {
    this.textureLibraryStore?.setCatalog(paths);
    this.requestRender(this.currentLayers);
  }

  /** Nombre de textures au catalogue, ou -1 si aucun store n'existe.
   *  Point de MESURE : « l'effet texture ne fait rien » a exactement deux
   *  causes possibles — le catalogue n'est pas arrivé, ou il est arrivé et le
   *  chargement échoue. Les distinguer à l'œil est impossible, les deux
   *  produisent la texture de repli et donc une image inchangée. */
  get textureCatalogSize(): number {
    return this.textureLibraryStore?.catalogSize ?? -1;
  }

  get textureLibraryDiagnostics(): { catalogue: number; residentes: number; enCours: number } | null {
    return this.textureLibraryStore?.diagnostics ?? null;
  }

  /** Attend qu'une texture de bibliothèque soit résidente. Voir
   *  `TextureLibraryStore.ensureLoaded` — sert au harnais de rendu, qui doit
   *  composer une frame déterministe et ne peut pas partir sur le repli 1×1. */
  async ensureTextureLoaded(index: number): Promise<void> {
    await this.textureLibraryStore?.ensureLoaded(index);
  }

  /**
   * DIMENSIONS DU DOCUMENT, source unique (design §4.3). Le state React les
   * COPIE d'ici à l'ouverture ; l'export ne les lit plus du tout (il les reçoit
   * avec les octets, voir `exportFrame`). Avant la tranche T2, `imageSize`
   * (React) et `ImageFrameResources.width/height` (GPU) étaient deux sources
   * séparées que rien ne réconciliait : l'invariant ne tenait que parce qu'un
   * seul site posait les deux au même instant, et une toile réglable crée un
   * second site.
   */
  get canvasSize(): CanvasPixelSize {
    return { width: this.imageResources.width, height: this.imageResources.height };
  }

  /** `sourceId` de la photo qui a ouvert le document, à partir duquel
   *  `App.tsx` construit le calque de fond. `null` tant qu'aucune image n'est
   *  chargée. */
  get backgroundSourceId(): string | null {
    return this.backgroundSource;
  }

  /**
   * Image que les masques PARAMÉTRIQUES (luminosité, plage de couleur,
   * dégradé) échantillonnent — injectée dans `MaskTextureResolver`, qui est
   * son unique consommateur (`maskTextureResolver.ts`, binding 0 des pipelines
   * `parametric:*`).
   *
   * Ce n'est PLUS la toile depuis la tranche T1 : la toile est vide, un masque
   * de luminosité y lirait du noir partout et deviendrait aveugle (§2.1). On
   * rend la texture du calque photo le PLUS BAS de la pile en cours de rendu —
   * tant que le fond est en bas, c'est exactement la photo qu'on
   * échantillonnait avant, donc comportement inchangé.
   *
   * Repli sur la toile quand la pile ne contient aucune photo : c'est
   * littéralement ce qui est sous le calque, et c'est la seule texture dont
   * l'existence est garantie. Jamais une exception — un masque paramétrique sur
   * un document dont l'utilisateur a supprimé toutes les photos est un cas
   * ordinaire, pas une erreur de pipeline.
   */
  private parametricMaskSourceTexture(): GPUTexture {
    const sourceId = bottomPhotoSourceId(this.currentLayers);
    const texture = sourceId === null ? null : this.photoSourceStore?.get(sourceId);
    return texture ?? this.imageResources.canvasTexture!;
  }

  /** Le `Renderer` est le propriétaire GPU réel (créé/vidé avec `loadImage`)
   *  — `App.tsx` s'en sert pour enregistrer/dimensionner les photos
   *  importées sans dupliquer un second store parallèle. */
  get photoSources(): PhotoSourceStore | null {
    return this.photoSourceStore;
  }

  /**
   * Côté maximal d'une texture accepté par ce device — le seuil exact
   * qu'applique `assertImageFitsGpu` (`render/limits.ts`) au moment d'importer
   * une image.
   *
   * Exposé pour que la bibliothèque de textures puisse DÉSACTIVER une vignette
   * trop grande au lieu de laisser l'utilisateur cliquer et récolter un bandeau
   * d'erreur. C'est la même valeur, lue au même endroit, donc les deux ne
   * peuvent pas diverger.
   *
   * ⚠️ Ce n'est PAS ce que l'adaptateur sait faire, c'est ce que le device a
   * demandé : shaderlab ne passe aucun `requiredLimits` à `requestDevice`, donc
   * il reçoit les limites PAR DÉFAUT de la spec WebGPU — 8192, quelle que soit
   * la carte. Un scan « 8K » carré passe donc exactement à la limite, et 8193
   * est refusé. Monter ce plafond serait une décision à part entière (mémoire
   * VRAM), pas un réglage.
   */
  get maxTextureDimension(): number {
    return this.ctx.device.limits.maxTextureDimension2D;
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
      this.runPipeline(
        projectIsolation(layers, this.isolatedLayerId),
        this.canvasDestination(),
        // Le calque en aperçu live est le SEUL dont le contenu de masque
        // change sans nouveau `LayerState` : l'exécuteur ne peut pas le
        // déduire de la pile qu'il reçoit (voir `computeGuideEpochs`).
        preview?.layerId ?? null,
        // Étage de développement de l'ÉCRAN, posé par `setDevelop`.
        this.develop,
      );
    } finally {
      this.maskTextureResolver?.setLivePreview(null);
    }
  }

  /** Rendu coalescé : à privilégier pour tout ce qui peut tirer plus vite
   *  que la frame (drag de slider, pinceau). `render()` reste disponible
   *  pour un rendu immédiat déterministe (premier affichage).
   *  `preview` : voir `MaskPreviewOverride` — utilisé par le pinceau pour un
   *  retour visuel par échantillon sans passer par `updateBrushMask()`. */
  /** Diagnostic (DEV) : QUI appelle `requestRender` avec un calque du bas
   *  RECOPIÉ — même id, objet neuf. Cette recopie ne périme plus la chaîne de
   *  guides (corrigé par `layers/contentKey.ts`), mais elle reste du travail
   *  fait pour rien, et on ne savait pas d'où elle venait. La pile d'appel se
   *  capture ICI et pas dans l'exécuteur : le rendu réel est coalescé par
   *  `FrameScheduler`, donc appelé depuis un rAF où l'appelant d'origine a
   *  déjà disparu de la pile. */
  private diagDernierBasRequest: LayerState | null = null;
  private diagRecopies = new Map<string, number>();
  drainRecopieDiagnostics(): Record<string, number> {
    const copie = Object.fromEntries(this.diagRecopies);
    this.diagRecopies.clear();
    return copie;
  }

  requestRender(
    layers: LayerState[],
    preview: MaskPreviewOverride | null = null,
  ): void {
    if (import.meta.env.DEV) {
      const bas = layers[0] ?? null;
      const precedent = this.diagDernierBasRequest;
      if (bas && precedent && bas !== precedent && bas.id === precedent.id) {
        const pile = (new Error().stack ?? "")
          .split("\n")
          .slice(2, 6)
          .map((ligne) => ligne.trim().replace(/^at\s+/, "").replace(/\?t=\d+/g, ""))
          .join(" <- ");
        this.diagRecopies.set(pile, (this.diagRecopies.get(pile) ?? 0) + 1);
      }
      if (bas) this.diagDernierBasRequest = bas;
    }
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
      presentBackgroundFor(this.canvasDestination()),
      this.presentUvRemap(this.canvasDestination()),
    );
    this.ctx.device.queue.submit([encoder.finish()]);
  }

  /** Unique construction du cas `canvas` de `PresentDestination` : les deux
   *  chemins d'écran (rendu complet et animation d'overlay) passent par ici,
   *  donc ils ne peuvent pas diverger sur le facteur d'échelle. */
  private canvasDestination(): PresentDestination {
    return { kind: "canvas", displayScale: this.displayScale };
  }

  /** Remappage UV de la présentation, dérivé de la destination — pendant de
   *  `presentBackgroundFor`. À l'ÉCRAN, il vient du cadre courant (`this.cadre`)
   *  et n'affiche que le sous-rectangle recadré. À l'EXPORT, identité : l'export
   *  compose la toile entière et découpe à la relecture (voir `exportFrame`),
   *  donc sa présentation ne remappe jamais. */
  private presentUvRemap(destination: PresentDestination): UvRemap {
    return destination.kind === "canvas"
      ? remapUvPourCadre(this.cadre, this.imageResources.width, this.imageResources.height)
      : IDENTITY_UV_REMAP;
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
  /** Compteurs de recalcul du résolveur de masque, vidés à chaque lecture —
   *  instrument de diagnostic, pas une API de rendu. Voir
   *  `MaskTextureResolver.drainDiagnostics`. */
  drainMaskDiagnostics(): Record<string, number> | null {
    return this.maskTextureResolver?.drainDiagnostics() ?? null;
  }

  /** Où la chaîne de guides devient périmée, par frame — voir
   *  `FramePipelineExecutor.drainGuideDiagnostics`. */
  drainGuideDiagnostics(): Record<string, number> | null {
    return this.framePipelineExecutor?.drainGuideDiagnostics() ?? null;
  }

  async exportFrame(
    layers: LayerState[],
    cadre: CanvasFrameState = null,
    /** Étage de développement à appliquer à l'export (ticket 03). Pris en
     *  PARAMÈTRE, comme `cadre`, pour qu'un champ d'écran périmé ne puisse pas
     *  produire un fichier mal développé. Un seul pipeline : l'étage passe par le
     *  même `runPipeline` que l'écran. */
    develop: DevelopSettings = {},
  ): Promise<ExportedFrame> {
    // ⚠️ ATTENDRE LES TEXTURES DE BIBLIOTHÈQUE ENCORE EN VOL. `viewFor` ne
    // bloque JAMAIS — un rendu à l'écran ne s'arrête pas pour un décodage, il
    // sert le repli 1×1 et redemande une frame. Un EXPORT n'a pas cette
    // seconde chance : le fichier écrit serait dépourvu de l'effet,
    // définitivement et sans message.
    //
    // Défaut trouvé le 2026-08-05 par le garde de signal du harnais de rendu,
    // qui a mesuré 0,000 % d'écart là où un effet à texture aurait dû tout
    // changer. Sans ce garde, la référence aurait été figée sur une image sans
    // texture et le verrou serait devenu vert et aveugle.
    await this.textureLibraryStore?.awaitPending();
    const exportTexture = this.imageResources.getExportTexture();
    // Le pipeline compose TOUJOURS la toile entière, en espace d'origine : le
    // cadre ne découpe qu'à la RELECTURE, jamais à l'évaluation. C'est ce qui
    // garantit que l'export cadré est le crop octet pour octet du sous-rectangle
    // de l'export non cadré — donc que rien (dégradé, masque, transform) n'est
    // évalué dans l'espace du cadre (ticket 28, § second défaut silencieux).
    this.runPipeline(layers, { kind: "export" }, null, develop);
    const region = regionDeLecture(cadre, this.imageResources.width, this.imageResources.height);
    const readback = new FrameReadback(
      this.ctx.device,
      region.width,
      region.height,
      this.ctx.srgbFormat.startsWith("bgra"),
    );
    const padded = await readback.readTextureBytes(exportTexture, { x: region.x, y: region.y });
    const stripped = readback.stripRowPadding(padded);
    // Les dimensions repartent AVEC les octets, prises au même endroit que
    // celles qui ont dimensionné la relecture : l'encodeur JPEG n'a donc aucune
    // autre source à consulter (design §4.3, `ExportedFrame`). Sous cadre, ce
    // sont celles du cadre écrêté.
    return { pixels: readback.swapRedBlueChannels(stripped), width: region.width, height: region.height };
  }

  /** Encode la frame puis l'APLATIT dans `destination`. `destination` est un
   *  type fermé, pas une vue de texture : c'est ce qui empêche un appelant de
   *  choisir lui-même le fond d'aplatissement — donc d'écrire le damier dans
   *  un fichier exporté (voir `presentBackgroundFor`). */
  private runPipeline(
    layers: LayerState[],
    destination: PresentDestination,
    livePreviewLayerId: string | null = null,
    develop: DevelopSettings = {},
  ): void {
    if (!this.framePipelineExecutor) throw new Error("Aucune image chargée.");
    const diagStart = performance.now();
    this.currentLayers = layers;
    const result = this.framePipelineExecutor.run(
      layers,
      // JAMAIS `this.maskOverlayLayerId` directement : l'overlay est dérivé de
      // la destination, au même titre que le fond d'aplatissement — voir
      // `maskOverlayFor`. C'est ce qui empêche le voile rouge d'atteindre un
      // fichier exporté.
      maskOverlayFor(destination, this.maskOverlayLayerId),
      livePreviewLayerId,
      develop,
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
      this.presentUvRemap(destination),
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
  /** Chronomètre GPU. Vit sur le Renderer et non sur le runner, qui est
   *  reconstruit à chaque redimensionnement (`allocateDocument`) : le query set
   *  et les buffers de relecture n'ont aucune raison de mourir avec lui. */
  private gpuTiming: GpuTiming | null = null;

  /**
   * Arme une capture du temps GPU PAR PASSE sur la prochaine frame rendue, et
   * rend le rapport quand les timestamps sont relus.
   *
   * ⚠️ N'ORDONNE PAS DE RENDU. C'est délibéré : la question intéressante est
   * « que coûte la pile PENDANT un vrai geste », pas « que coûte une frame
   * isolée déclenchée par la sonde ». Armer, puis bouger un curseur, mesure ce
   * qui se passe vraiment — la faute inverse est celle de la sonde à 63 `input`
   * (voir l'en-tête de `scripts/perf-probe.mjs`), qui fabriquait la lenteur
   * qu'elle mesurait.
   *
   * Rejette si `timestamp-query` manque, ou si une capture est déjà en vol.
   */
  captureGpuTiming(): Promise<GpuTimingReport> {
    const runner = this.effectPassRunner;
    if (!runner) return Promise.reject(new Error("Aucun document chargé."));
    this.gpuTiming ??= new GpuTiming(this.ctx.device);
    // Rattaché À CHAQUE capture plutôt qu'à la construction du runner : c'est
    // la seule façon de rester correct à travers un redimensionnement, qui
    // remplace l'objet runner sans prévenir ce module.
    runner.timing = this.gpuTiming;
    return this.gpuTiming.arm();
  }

  /** Rend au GPU tout ce qui possède des ressources vivant plus d'une frame.
   *
   *  UNE liste, appelée par les DEUX chemins de démontage — `allocateDocument`
   *  (le document change, tout est reconstruit) et `dispose()` (fin de vie du
   *  renderer). Ils énuméraient auparavant des ensembles DIFFÉRENTS sous
   *  quatre verbes différents, et les deux écarts entre ces listes étaient
   *  exactement les deux fuites : `TextureLibraryStore` était démonté par le
   *  premier et pas par le second (jusqu'à six scans résidents, 268 Mo pièce
   *  en 8192²), et `FramePipelineExecutor` par aucun des deux, donc la
   *  `MippedSourceCache` qu'il possède n'avait aucun appelant de démontage
   *  dans tout le dépôt.
   *
   *  Ce que la forme achète : un module GPU neuf s'ajoute ICI, et il est alors
   *  démonté par les deux chemins ou par aucun — jamais par un seul. Rien
   *  d'autre ne pouvait l'attraper, une fuite VRAM ne changeant aucun pixel :
   *  les 143 références de rendu restent vertes, le compilateur ne compte pas
   *  les textures, et le `GPUDevice` ne meurt jamais (`initGpu` n'est appelé
   *  qu'une fois) donc rien ne rattrape l'oubli en aval. `App` fabrique un
   *  Renderer NEUF à chaque ouverture de fichier : c'est le geste qui paie.
   *
   *  ⚠️ Elle NE MET RIEN À `null` — `allocateDocument` réassigne juste après,
   *  et c'est `dispose()` qui possède la remise à zéro. */
  private libererRessourcesGpu(): void {
    this.effectPassRunner?.clearPipelines();
    this.maskTextureResolver?.dispose();
    this.photoSourceStore?.dispose();
    this.photoLayerInputResolver?.dispose();
    this.textureLibraryStore?.dispose();
    this.framePipelineExecutor?.dispose();
  }

  dispose(): void {
    this.renderScheduler.cancel();
    this.imageResources.dispose();
    this.gpuTiming?.destroy();
    this.gpuTiming = null;
    this.libererRessourcesGpu();
    this.effectPassRunner = null;
    this.maskTextureResolver = null;
    this.photoSourceStore = null;
    this.photoLayerInputResolver = null;
    this.textureLibraryStore = null;
    this.framePipelineExecutor = null;
    this.presentPass.clearPipelines();
    this.lastOverlayFrame = null;
    this.backgroundSource = null;
    this.currentLayers = [];
    this.cadre = null;
    this.develop = {};
  }
}
