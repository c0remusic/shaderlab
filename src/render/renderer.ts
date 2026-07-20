import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";
import type { EffectModule } from "./effects/types";
import { composeShader, MAX_EFFECT_PARAMS, FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import { getBlendMode } from "./blend/registry";
import { FrameScheduler } from "./frameScheduler";
import { assertImageFitsGpu } from "./limits";
import { logDiagnostic } from "../launch";
import type { DirtyRect } from "../mask/maskPainter";
import { computeR8UploadRegion } from "./maskUpload";
import { defaultLayerMask } from "../mask/types";
import type { MaskSource } from "../mask/types";
import { planFold, snapshotFoldInputs, foldInputsEqual, type FoldSourceSnapshot } from "../mask/foldPlan";
import { buildCombineWgsl, buildInvertWgsl } from "../mask/maskFoldWgsl";
import { buildMorphologyWgsl } from "../mask/refineEdgeWgsl";
import type { RefineEdgeParams } from "../mask/types";
import { getMaskSourceModule } from "../mask/sources/registry";
import {
  buildLuminanceWgsl,
  buildPackWgsl,
  buildSquareCorrWgsl,
  buildBoxFilterHWgsl,
  buildBoxFilterVWgsl,
  buildComputeABWgsl,
  buildCompositeWgsl,
} from "../mask/edgeAwareWgsl";

/** Nombre de slots f32 réservés par type de source paramétrique dans le
 *  buffer uniform passé au shader de génération (voir `getParametricSourceTexture`).
 *  `colorRange` a besoin de 32 slots (tolerance/hardness/invert/sampleCount +
 *  jusqu'à 6 échantillons RGB) ; gradient/luminosity n'ont que quelques
 *  scalaires (8 suffit). Point d'extension à surveiller : un futur 4e type de
 *  source paramétrique (Tasks 3-5, hors scope ici) doit être ajouté ICI —
 *  sans entrée explicite il retomberait silencieusement sur le défaut `8` et
 *  verrait ses params tronqués sans erreur (flattenMaskSourceParams s'arrête
 *  silencieusement à `count`). */
const PARAM_COUNT_BY_TYPE: Record<string, number> = {
  gradient: 8,
  luminosity: 8,
  colorRange: 32,
};

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
export type MaskUploadScope = { kind: "full" } | { kind: "partial"; rect: DirtyRect };

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

const PASSTHROUGH_EFFECT: EffectModule = {
  id: "passthrough",
  name: "Passthrough",
  params: [],
  wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
};

/** Passe overlay du masque en mode peinture : teinte le composite en rouge
 *  safelight là où le masque du calque sélectionné > 0 (zone où l'effet
 *  s'applique — convention Lightroom), pour VOIR le masque qu'on peint.
 *  Tint = `--mask-overlay-color` #e63c46 exprimé en LINÉAIRE, opacité
 *  `--mask-overlay-opacity` 0.28. Le canvas sRGB ré-encode automatiquement. */
const MASK_OVERLAY_WGSL = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var overlaySrc: texture_2d<f32>;
@group(0) @binding(1) var overlaySampler: sampler;
@group(0) @binding(2) var overlayMask: texture_2d<f32>;

@fragment
fn fs_overlay(in: VertexOut) -> @location(0) vec4<f32> {
  let img = textureSample(overlaySrc, overlaySampler, in.uv);
  let m = textureSample(overlayMask, overlaySampler, in.uv).r;
  let tint = vec3<f32>(0.791, 0.045, 0.061);
  return vec4<f32>(mix(img.rgb, tint, m * 0.28), img.a);
}
`;

/**
 * WebGPU's `copyTextureToBuffer` requires each row to start at a 256-byte-aligned offset.
 * Computes the padded stride for a row of RGBA pixels.
 */
function paddedBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / 256) * 256;
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
  private ctx: GpuContext;
  private sourceTexture: GPUTexture | null = null;
  private width = 0;
  private height = 0;
  private pingPong: [GPUTexture, GPUTexture] | null = null;
  private exportTexture: GPUTexture | null = null;
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
  private pipelineCache = new Map<
    string,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
  /** Une texture GPU résidente par SOURCE de masque (clé "layerId:sourceId"),
   *  uploadée seulement quand la référence `raster` de cette source change
   *  (pattern `syncedFrom`). Alimente le fold ; la source pinceau EN COURS
   *  DE PEINTURE continue de passer par `liveMaskTexture` (chemin inchangé
   *  de Task 1/avant), pas par cette map. */
  private sourceTextures = new Map<string, { texture: GPUTexture; syncedFrom: Uint8Array }>();
  /** Une texture GPU résidente par SOURCE PARAMÉTRIQUE de masque (clé
   *  "layerId:sourceId"), régénérée seulement quand la référence
   *  `source.params` change (comparaison par référence — `updateMaskSourceParams`
   *  remplace toujours l'objet, jamais ne le mute). Distincte de
   *  `sourceTextures` (qui ne sert que le pinceau, upload CPU->GPU d'un
   *  raster) : ici la contribution masque est calculée par une passe shader
   *  depuis `params`, jamais peinte. Mêmes règles de résidence (sweep par
   *  layerId dans `runPipeline`, destruction dans `dispose()`). */
  private parametricSourceTextures = new Map<string, { texture: GPUTexture; syncedFrom: unknown }>();
  /** Pipelines de génération de source paramétrique, mis en cache par WGSL
   *  enveloppé (même principe que `pipelineCache`/`maskFoldPipelineCache`). */
  private maskSourcePipelineCache = new Map<string, { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout }>();
  /** Texture masque FOLDÉE résidente par calque. Deux
   *  textures de travail en ping-pong pour la chaîne combine->combine->invert
   *  sans qu'une passe ne lise et n'écrive la même texture. */
  private foldedMaskTextures = new Map<string, { texture: GPUTexture; lastInputs: FoldSourceSnapshot[]; lastInvert: boolean }>();
  /** Paire de textures de travail PAR CALQUE (clé layerId) pour la chaîne
   *  combine->combine->invert. Doit être par-calque et non partagée entre
   *  calques : `foldedMaskTextures` retient une RÉFÉRENCE directe vers l'une
   *  de ces deux textures comme résultat résident du fold — un pool partagé
   *  entre calques ferait écraser silencieusement le résultat mis en cache
   *  d'un calque par le fold d'un autre calque à la frame suivante (trouvé en
   *  revue adverse codex-crosscheck). */
  private foldPingPongByLayer = new Map<string, [GPUTexture, GPUTexture]>();
  private maskFoldPipelineCache = new Map<string, { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout }>();
  /** Textures de travail du guided filter edge-aware (design.md §4bis), une
   *  entrée PAR CALQUE — mêmes règles de résidence que `foldedMaskTextures` :
   *  créées à la demande, détruites quand le calque disparaît ou dans
   *  `dispose()`. Jamais partagées entre calques (même raison que
   *  `foldPingPongByLayer`). */
  private edgeAwareWorkTextures = new Map<
    string,
    {
      luminance: GPUTexture;
      packedIp: GPUTexture;
      squareCorr: GPUTexture;
      meanIp: GPUTexture;
      meanIpTmp: GPUTexture;
      corr: GPUTexture;
      corrTmp: GPUTexture;
      ab: GPUTexture;
      meanAB: GPUTexture;
      meanABTmp: GPUTexture;
      result: GPUTexture;
    }
  >();
  private edgeAwarePipelineCache = new Map<string, { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout }>();
  /** Paire de textures de travail PAR CALQUE pour le refine edge forme-seule
   *  (design.md §4 étape 5 : contracter/dilater -> feather -> lisser).
   *  Dédiée plutôt que de réutiliser `foldPingPongByLayer` : ces textures-là
   *  sont déjà occupées PENDANT le fold (voir commentaire du brief Task 2
   *  Step 6) — un pool partagé écraserait le résultat du fold en cours. */
  private refineEdgePingPongByLayer = new Map<string, [GPUTexture, GPUTexture]>();
  private whiteMask: GPUTexture | null = null;
  /** GPU texture backing the live mask-paint preview (see `MaskPreviewOverride`)
   *  — reuploaded every preview frame regardless of reference equality, since
   *  the live buffer is typically the SAME object mutated in place stroke by
   *  stroke, so residency's reference check would never detect a change. */
  private liveMaskTexture: GPUTexture | null = null;
  /** Which layer `liveMaskTexture`'s CONTENT currently reflects. When the
   *  live-previewed layer changes (or preview starts fresh), the texture's
   *  existing content is stale/wrong and a full upload is required before
   *  any partial (`dirtyRect`) update can be trusted. */
  private liveMaskLayerId: string | null = null;
  private renderScheduler = new FrameScheduler<{ layers: LayerState[]; preview: MaskPreviewOverride | null }>(
    (p) => this.render(p.layers, p.preview)
  );
  /** Set for the duration of one `runPipeline()` call by `render()`; read by
   *  `getMaskTexture()` to substitute the live-painted buffer for the
   *  layer currently being painted, bypassing the committed brush mask
   *  source entirely for that frame. */
  private livePreview: MaskPreviewOverride | null = null;
  /** Id du calque dont le masque est affiché en overlay safelight (mode
   *  peinture), ou null (pas d'overlay). Piloté par `setMaskOverlay()` depuis
   *  l'UI — état plutôt que paramètre de chaque `requestRender`, pour ne pas
   *  le faire transiter par tous les sites d'appel de rendu. */
  private maskOverlayLayerId: string | null = null;
  /** Debugging-only (see log_diagnostic in lib.rs / gpuContext.ts's device.lost
   *  handler): counts runPipeline() calls so diagnostics below can log every
   *  Nth frame instead of flooding the IPC channel during a fast paint
   *  stroke. Remove alongside the rest of this diagnostic pass once the GPU
   *  OOM crash (3 confirmed renderer aborts, 2026-07-14/15) is root-caused. */
  private diagFrameCount = 0;

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    this.sampler = ctx.device.createSampler({ magFilter: "linear", minFilter: "linear" });
    this.nearestSampler = ctx.device.createSampler({ magFilter: "nearest", minFilter: "nearest" });
  }

  /** Active/désactive l'overlay safelight du masque d'un calque (mode peinture).
   *  Passer `null` pour l'éteindre. Ne déclenche pas de rendu — l'appelant fait
   *  un `requestRender()` ensuite. */
  setMaskOverlay(layerId: string | null): void {
    this.maskOverlayLayerId = layerId;
  }

  async loadImage(bitmap: ImageBitmap): Promise<void> {
    assertImageFitsGpu(bitmap.width, bitmap.height, this.ctx.device.limits.maxTextureDimension2D);
    this.width = bitmap.width;
    this.height = bitmap.height;
    const { device, srgbFormat } = this.ctx;

    const makeTarget = () =>
      device.createTexture({
        size: [this.width, this.height],
        format: srgbFormat,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC,
      });

    this.sourceTexture = device.createTexture({
      size: [this.width, this.height],
      format: srgbFormat,
      usage:
        GPUTextureUsage.TEXTURE_BINDING |
        GPUTextureUsage.COPY_DST |
        GPUTextureUsage.RENDER_ATTACHMENT,
    });
    device.queue.copyExternalImageToTexture(
      { source: bitmap },
      { texture: this.sourceTexture },
      [this.width, this.height]
    );

    this.pingPong = [makeTarget(), makeTarget()];
  }

  render(layers: LayerState[], preview: MaskPreviewOverride | null = null): void {
    this.livePreview = preview;
    this.runPipeline(layers, getSrgbCanvasView(this.ctx));
    this.livePreview = null;
  }

  /** Rendu coalescé : à privilégier pour tout ce qui peut tirer plus vite
   *  que la frame (drag de slider, pinceau). `render()` reste disponible
   *  pour un rendu immédiat déterministe (premier affichage).
   *  `preview` : voir `MaskPreviewOverride` — utilisé par le pinceau pour un
   *  retour visuel par échantillon sans passer par `updateBrushMask()`. */
  requestRender(layers: LayerState[], preview: MaskPreviewOverride | null = null): void {
    this.renderScheduler.request({ layers, preview });
  }

  /**
   * Renders the full layer stack into an off-screen texture instead of the
   * canvas, then reads it back — used by the export pipeline (Task 10).
   *
   * `render()` always writes its last pass straight to the canvas's current
   * texture, never into `pingPong`, so `readPixels()` reading `pingPong[0]`
   * would return stale data (whatever pass happened to land there last, not
   * the actual final composited frame). This method sidesteps that by
   * reusing the same multi-pass loop (`runPipeline`) but targeting a
   * dedicated off-screen `exportTexture` for every pass, including the
   * last one, so the readback always reflects the true final frame.
   */
  async exportFrame(layers: LayerState[]): Promise<Uint8Array> {
    if (!this.sourceTexture) throw new Error("Aucune image chargée.");
    const { device, srgbFormat } = this.ctx;

    if (!this.exportTexture) {
      this.exportTexture = device.createTexture({
        size: [this.width, this.height],
        format: srgbFormat,
        usage:
          GPUTextureUsage.TEXTURE_BINDING |
          GPUTextureUsage.RENDER_ATTACHMENT |
          GPUTextureUsage.COPY_SRC,
      });
    }

    this.runPipeline(layers, this.exportTexture.createView());
    const padded = await this.readTextureBytes(this.exportTexture);
    return this.stripRowPadding(padded);
  }

  /**
   * `copyTextureToBuffer` requires each row to start at a 256-byte-aligned
   * offset, so `readTextureBytes` returns rows padded to that stride when
   * `width * 4` isn't already a multiple of 256. Callers that need a
   * tightly packed RGBA buffer (e.g. handing pixels to `ImageData`) must
   * strip that padding first — this does so.
   */
  private stripRowPadding(padded: Uint8Array): Uint8Array {
    const bytesPerRow = paddedBytesPerRow(this.width);
    const tightRowBytes = this.width * 4;
    if (bytesPerRow === tightRowBytes) return padded;
    const out = new Uint8Array(tightRowBytes * this.height);
    for (let row = 0; row < this.height; row++) {
      out.set(padded.subarray(row * bytesPerRow, row * bytesPerRow + tightRowBytes), row * tightRowBytes);
    }
    return out;
  }

  private runPipeline(layers: LayerState[], finalTargetView: GPUTextureView): void {
    if (!this.sourceTexture || !this.pingPong) throw new Error("Aucune image chargée.");
    const { device } = this.ctx;
    const diagStart = performance.now();

    {
      const aliveLayerIds = new Set(layers.map((l) => l.id));
      for (const key of [...this.sourceTextures.keys()]) {
        if (!aliveLayerIds.has(key.split(":")[0])) {
          this.sourceTextures.get(key)!.texture.destroy();
          this.sourceTextures.delete(key);
        }
      }
      // Même règle de résidence que sourceTextures (clé "layerId:sourceId").
      for (const key of [...this.parametricSourceTextures.keys()]) {
        if (!aliveLayerIds.has(key.split(":")[0])) {
          this.parametricSourceTextures.get(key)!.texture.destroy();
          this.parametricSourceTextures.delete(key);
        }
      }
      for (const id of [...this.foldedMaskTextures.keys()]) {
        if (!aliveLayerIds.has(id)) {
          this.foldedMaskTextures.get(id)!.texture.destroy();
          this.foldedMaskTextures.delete(id);
        }
      }
      for (const id of [...this.foldPingPongByLayer.keys()]) {
        if (!aliveLayerIds.has(id)) {
          const [a, b] = this.foldPingPongByLayer.get(id)!;
          a.destroy();
          b.destroy();
          this.foldPingPongByLayer.delete(id);
        }
      }
      // Mêmes règles de résidence que foldedMaskTextures/foldPingPongByLayer
      // (seul un calque vivant garde ses textures de travail refine-edge).
      for (const id of [...this.refineEdgePingPongByLayer.keys()]) {
        if (!aliveLayerIds.has(id)) {
          const [a, b] = this.refineEdgePingPongByLayer.get(id)!;
          a.destroy();
          b.destroy();
          this.refineEdgePingPongByLayer.delete(id);
        }
      }
      // Mêmes règles de résidence que foldedMaskTextures/foldPingPongByLayer
      // (seul un calque vivant garde ses textures de travail edge-aware).
      for (const id of [...this.edgeAwareWorkTextures.keys()]) {
        if (!aliveLayerIds.has(id)) {
          const w = this.edgeAwareWorkTextures.get(id)!;
          w.luminance.destroy();
          w.packedIp.destroy();
          w.squareCorr.destroy();
          w.meanIp.destroy();
          w.meanIpTmp.destroy();
          w.corr.destroy();
          w.corrTmp.destroy();
          w.ab.destroy();
          w.meanAB.destroy();
          w.meanABTmp.destroy();
          w.result.destroy();
          this.edgeAwareWorkTextures.delete(id);
        }
      }
    }

    let readTexture = this.sourceTexture;
    let writeIndex = 0;
    const enabledLayers = layers.filter((l) => l.enabled);
    // Overlay masque (mode peinture) : le calque sélectionné dont on montre le
    // masque en rouge. Quand actif, le composite final est rendu dans un slot
    // ping-pong au lieu du canvas, puis une passe overlay teinte → canvas.
    const overlayLayer = this.maskOverlayLayerId
      ? layers.find((l) => l.id === this.maskOverlayLayerId) ?? null
      : null;

    const encoder = device.createCommandEncoder();
    // Per-frame GPU resources — intermediate multi-pass textures (from
    // runInternalPasses) and each pass's paramBuffer — both live only for
    // this frame. They must not be destroyed until AFTER this frame's
    // command buffer has been submitted — recording a command against a
    // resource does NOT pin its lifetime through to a later submit (WebGPU
    // validates at submit() time), so destroying mid-encoder throws.
    // Collected here and drained once, post-submit, below.
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    if (enabledLayers.length === 0) {
      // Nothing to composite — blit the source straight to the target (ou vers
      // un slot ping-pong si overlay actif, pour teinter par-dessus ensuite).
      const blitTarget = overlayLayer ? this.pingPong[0] : null;
      this.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        { id: "", effectId: "", params: {}, enabled: true, opacity: 1, blendMode: "normal", mask: defaultLayerMask() },
        readTexture.createView(),
        blitTarget ? blitTarget.createView() : finalTargetView,
        {},
        pendingDestroy
      );
      if (overlayLayer && blitTarget) {
        this.runOverlayPass(
          encoder,
          blitTarget,
          this.getMaskTexture(overlayLayer, encoder, readTexture.createView(), pendingDestroy),
          finalTargetView
        );
      }
      device.queue.submit([encoder.finish()]);
      for (const resource of pendingDestroy) resource.destroy();
      return;
    }

    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const effect = getEffect(layer.effectId);
      const isLast = i === enabledLayers.length - 1;
      // Dernier calque : normalement le canvas ; mais si l'overlay est actif on
      // rend dans le slot ping-pong courant (writeIndex n'avance pas au dernier
      // tour, cf. `if (!isLast)` plus bas) pour teinter par-dessus ensuite.
      const targetView =
        isLast && !overlayLayer ? finalTargetView : this.pingPong[writeIndex].createView();

      let prevPassView: GPUTextureView | null = null;
      let prevPassTexture: GPUTexture | null = null;
      if (effect.passes && effect.passes.length > 0) {
        const lastPass = this.runInternalPasses(encoder, effect, layer, readTexture.createView(), pendingDestroy);
        prevPassView = lastPass.view;
        prevPassTexture = lastPass.texture;
      }

      this.runEffectPass(
        encoder,
        effect,
        layer,
        readTexture.createView(),
        targetView,
        { applyMask: true, prevPassView },
        pendingDestroy
      );

      // The final internal pass's texture was only needed as `prevPass` on
      // the composite pass above. Its usage there has just been recorded
      // onto `encoder`, but it must not be destroyed until this frame's
      // submit() has actually run — queue it instead of destroying now.
      if (prevPassTexture) pendingDestroy.push(prevPassTexture);

      if (!isLast) {
        readTexture = this.pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    // Overlay masque : le composite final est dans this.pingPong[writeIndex]
    // (le dernier calque y a écrit, writeIndex n'a pas avancé). Teinte rouge
    // là où le masque du calque sélectionné > 0, vers le canvas.
    if (overlayLayer) {
      this.runOverlayPass(
        encoder,
        this.pingPong[writeIndex],
        this.getMaskTexture(overlayLayer, encoder, this.pingPong[writeIndex].createView(), pendingDestroy),
        finalTargetView
      );
    }

    device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    this.logFrameDiagnostics(diagStart, enabledLayers.length, pendingDestroy.length);
  }

  /** Debugging-only, see the field comment on `diagFrameCount`. Logs every
   *  15th frame: JS-side encode+submit time (does NOT include actual GPU
   *  execution time, which WebGPU doesn't expose to JS), how many
   *  intermediate textures/buffers this single frame churned through
   *  (pendingDestroy.length — a proxy for GPU allocator pressure from
   *  per-frame effect passes like Glow's 5-pass bloom), and the resident
   *  mask/pipeline cache sizes (should stay bounded by layer/effect count,
   *  not grow unboundedly). */
  private logFrameDiagnostics(diagStart: number, enabledLayerCount: number, churnedResources: number): void {
    this.diagFrameCount++;
    if (this.diagFrameCount % 15 !== 0) return;
    const elapsedMs = Math.round((performance.now() - diagStart) * 100) / 100;
    logDiagnostic(
      `frame#${this.diagFrameCount} jsEncodeMs=${elapsedMs} enabledLayers=${enabledLayerCount} ` +
        `churnedThisFrame=${churnedResources} residentMaskTextures=${this.sourceTextures.size + this.foldedMaskTextures.size} ` +
        `pipelineCacheSize=${this.pipelineCache.size} imageSize=${this.width}x${this.height}`
    );
  }

  /**
   * Runs an effect's internal pass chain (bright-pass extract, downsample,
   * upsample, etc. — see Glow's dual-filter bloom, Task 13) in sequence,
   * each into its own intermediate texture sized `width*scale × height*scale`
   * and formatted `ctx.srgbFormat` (color data, same as the ping-pong pair).
   * Masking is deliberately NOT applied to internal passes — they're pure
   * signal-processing steps feeding the final composite, which is the only
   * pass the user's painted mask should gate. Returns the view (and owning
   * texture) of the last pass's output, to be bound as `prevPass` on the
   * final composite pass.
   *
   * None of these intermediate textures are destroyed here. WebGPU validates
   * texture liveness at `submit()` time, not at record time — a command
   * recorded against a texture does not pin that texture's lifetime through
   * to a later submit, so destroying a texture before the command buffer
   * referencing it is actually submitted throws a validation error at
   * `device.queue.submit()`. Every pass texture created in this method
   * (except the last, which the caller owns and queues itself) is instead
   * appended to `pendingDestroy`, which the caller (`runPipeline`) drains
   * with `.destroy()` only after `device.queue.submit([encoder.finish()])`
   * has actually run for this frame. This is unrelated to `pingPong`/
   * `sourceTexture`, which are never destroyed mid-frame because they're
   * reused across frames — these intermediate textures are new every
   * `render()` call and are torn down at the end of that same frame.
   */
  private runInternalPasses(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): { view: GPUTextureView; texture: GPUTexture } {
    const { device, srgbFormat } = this.ctx;
    let passInputView = sourceView;
    let prevTexture: GPUTexture | null = null;
    let lastTexture: GPUTexture | null = null;
    for (const pass of effect.passes!) {
      const passTarget = device.createTexture({
        size: [
          Math.max(1, Math.round(this.width * pass.scale)),
          Math.max(1, Math.round(this.height * pass.scale)),
        ],
        format: srgbFormat,
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
      });
      const passTargetView = passTarget.createView();
      this.runEffectPass(
        encoder,
        { ...effect, wgsl: pass.wgsl },
        layer,
        passInputView,
        passTargetView,
        { applyMask: false },
        pendingDestroy
      );
      // `prevTexture`'s only usage (as this pass's source) has just been
      // recorded above. It must not be destroyed until after this frame's
      // submit() — queue it for the caller to drain post-submit instead.
      if (prevTexture) pendingDestroy.push(prevTexture);
      passInputView = passTargetView;
      prevTexture = passTarget;
      lastTexture = passTarget;
    }
    return { view: passInputView, texture: lastTexture! };
  }

  /** Passe overlay du masque : teinte `src` en rouge safelight là où `mask` > 0
   *  et écrit vers `targetView`. Pipeline mis en cache (clé = MASK_OVERLAY_WGSL,
   *  comme les pipelines d'effet). Bindings : 0 image, 1 sampler, 2 masque. */
  private runOverlayPass(
    encoder: GPUCommandEncoder,
    src: GPUTexture,
    mask: GPUTexture,
    targetView: GPUTextureView
  ): void {
    const { device, srgbFormat } = this.ctx;
    let cached = this.pipelineCache.get(MASK_OVERLAY_WGSL);
    if (!cached) {
      const module = device.createShaderModule({ code: MASK_OVERLAY_WGSL });
      const bindGroupLayout = device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        ],
      });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_overlay", targets: [{ format: srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(MASK_OVERLAY_WGSL, cached);
    }
    const bindGroup = device.createBindGroup({
      layout: cached.bindGroupLayout,
      entries: [
        { binding: 0, resource: src.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: mask.createView() },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  private runEffectPass(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null } = {},
    pendingDestroy: (GPUTexture | GPUBuffer)[] = []
  ): void {
    const { applyMask = true, prevPassView = null } = options;
    const { device, srgbFormat } = this.ctx;
    const paramValues = new Float32Array(MAX_EFFECT_PARAMS);
    effect.params.forEach((p, idx) => {
      paramValues[idx] = layer.params[p.name] ?? p.default;
    });
    const paramBuffer = device.createBuffer({
      size: paramValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramBuffer, 0, paramValues);
    // paramBuffer is only used by the pipeline recorded below; like the
    // intermediate pass textures, it must not be destroyed until after this
    // frame's submit() has run, so it's queued rather than destroyed here.
    pendingDestroy.push(paramBuffer);

    const blendMode = getBlendMode(layer.blendMode ?? "normal");
    const shaderCode = composeShader(effect.wgsl, {
      applyMask,
      hasPrevPass: prevPassView !== null,
      blendWgsl: applyMask ? blendMode.wgsl : undefined,
    });

    // Uniform de compositing (opacité en .x), seulement quand on composite.
    let compositingBuffer: GPUBuffer | null = null;
    if (applyMask) {
      const compositing = new Float32Array([layer.opacity ?? 1, 0, 0, 0]);
      compositingBuffer = device.createBuffer({
        size: compositing.byteLength,
        usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      device.queue.writeBuffer(compositingBuffer, 0, compositing);
      pendingDestroy.push(compositingBuffer);
    }

    // Le pipeline (et son layout explicite) ne dépend que du code shader —
    // même code, même variante de bindings. Compilé UNE fois par variante,
    // réutilisé à chaque frame : c'était le poste n°1 du coût par frame
    // (createShaderModule + createRenderPipeline par passe par frame).
    let cached = this.pipelineCache.get(shaderCode);
    if (!cached) {
      const module = device.createShaderModule({ code: shaderCode });
      // Layout explicite, jamais `layout: "auto"` — voir le commentaire
      // historique du bug de pruning naga/Dawn (canvas noir silencieux).
      const layoutEntries: GPUBindGroupLayoutEntry[] = [
        { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
        { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
      ];
      if (applyMask) {
        layoutEntries.push({ binding: 3, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      }
      if (prevPassView) {
        layoutEntries.push({ binding: 4, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
      }
      if (applyMask) {
        layoutEntries.push({ binding: 5, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
      }
      const bindGroupLayout = device.createBindGroupLayout({ entries: layoutEntries });
      const pipelineLayout = device.createPipelineLayout({ bindGroupLayouts: [bindGroupLayout] });
      const pipeline = device.createRenderPipeline({
        layout: pipelineLayout,
        vertex: { module, entryPoint: "vs_main" },
        fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: srgbFormat }] },
      });
      cached = { pipeline, bindGroupLayout };
      this.pipelineCache.set(shaderCode, cached);
    }

    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sourceView },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: paramBuffer } },
    ];
    if (applyMask) {
      // Résidente — ne PAS la mettre dans pendingDestroy. `sourceView` sert
      // aussi de guide edge-aware : c'est la texture d'ENTRÉE de ce calque
      // (le composite accumulé sous lui, avant son propre effet) — voir la
      // décision documentée sur `maybeApplyEdgeAware`.
      entries.push({
        binding: 3,
        resource: this.getMaskTexture(layer, encoder, sourceView, pendingDestroy).createView(),
      });
    }
    if (prevPassView) {
      entries.push({ binding: 4, resource: prevPassView });
    }
    if (applyMask && compositingBuffer) {
      entries.push({ binding: 5, resource: { buffer: compositingBuffer } });
    }
    const bindGroup = device.createBindGroup({
      layout: cached.bindGroupLayout,
      entries,
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  /**
   * Reads back `pingPong[0]`. NOTE: `render()` always writes its last pass
   * straight to the canvas, never into `pingPong`, so this does NOT hold
   * the final composited frame after a call to `render()` — it's stale
   * data from whichever intermediate pass happened to land there. Do not
   * use this for export; use `exportFrame()` instead, which renders into a
   * dedicated off-screen texture and reads that back correctly. This
   * method is kept for any caller that genuinely wants a ping-pong buffer's
   * raw contents (e.g. debugging an intermediate pass).
   */
  async readPixels(): Promise<Uint8Array> {
    if (!this.pingPong) throw new Error("Aucune image chargée.");
    return this.readTextureBytes(this.pingPong[0]);
  }

  private async readTextureBytes(texture: GPUTexture): Promise<Uint8Array> {
    const { device } = this.ctx;
    const bytesPerRow = paddedBytesPerRow(this.width);
    const buffer = device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [this.width, this.height]);
    device.queue.submit([encoder.finish()]);
    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      return data;
    } finally {
      // Libère le buffer même si mapAsync rejette (device perdu pendant
      // l'export, par ex.) — sans ce finally, ce chemin d'erreur fuyait le
      // buffer GPU (audit 2026-07-17, finding 4).
      buffer.destroy();
    }
  }

  /** Masque absent : texture 1×1 opaque partagée. Le sampler linéaire
   *  échantillonne 1.0 partout — comportement identique à l'ancien buffer
   *  plein-résolution rempli à 255, sans l'allocation de 24 Mo par passe. */
  private getWhiteMask(): GPUTexture {
    if (!this.whiteMask) {
      this.whiteMask = this.ctx.device.createTexture({
        size: [1, 1],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
      this.uploadR8(this.whiteMask, new Uint8Array([255]), 1, 1);
    }
    return this.whiteMask;
  }

  /** Shared upload path for every r8unorm mask texture in this renderer
   *  (white fallback, resident per-layer masks, live-paint preview) —
   *  computes the WebGPU `writeTexture` arguments via the pure, tested
   *  `computeR8UploadRegion` and issues the one GPU call. */
  private uploadR8(texture: GPUTexture, data: Uint8Array, width: number, height: number, rect?: DirtyRect): void {
    const region = computeR8UploadRegion(width, height, rect);
    this.ctx.device.queue.writeTexture(
      { texture, origin: region.origin },
      data as BufferSource,
      region.dataLayout,
      [region.size.width, region.size.height]
    );
  }

  /** Texture de masque RÉSIDENTE par calque : créée une fois à la taille de
   *  l'image, réuploadée uniquement quand la référence `raster` de la source
   *  du calque change (les masques sont immuables par convention —
   *  updateBrushMask remplace la référence, jamais le contenu). Auparavant :
   *  création + upload 24MP à CHAQUE frame pour chaque calque masqué. */
  private getMaskTexture(
    layer: LayerState,
    encoder: GPUCommandEncoder,
    colorView: GPUTextureView,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    // Chemin pinceau EN COURS de peinture : inchangé depuis avant cette
    // tranche, zéro coût de fold (perf 60fps du geste de peinture non
    // impactée — l'aperçu live d'un calque à source unique n'entre jamais
    // dans le fold multi-passe ci-dessous, donc jamais dans l'edge-aware
    // non plus : suspendu pendant un stroke actif par construction).
    if (this.livePreview && this.livePreview.layerId === layer.id) {
      return this.getLiveMaskTexture(this.livePreview.layerId, this.livePreview.raster, this.livePreview.scope);
    }

    const plan = planFold(layer.mask);
    if (plan.length === 0) return this.getWhiteMask();

    // Raccourci : 1 seule source active et pas d'inversion => c'est
    // EXACTEMENT le comportement d'avant cette tâche (Task 1), zéro passe de
    // fold. C'est le cas réel de la Tranche 2 (aucune UI pour ajouter une 2e
    // source avant la Tranche 4) — éviter tout travail GPU supplémentaire
    // sur ce chemin, historiquement sensible au crash 24MP (design.md §4,
    // "Impact honnête sur le crash 24MP"). L'edge-aware doit s'appliquer
    // même sur ce raccourci (Step 12) — le fold sans edge-aware n'est pas
    // le seul moyen d'obtenir un masque source unique.
    if (plan.length === 1 && !layer.mask.invert) {
      const resident = this.getResidentSourceTexture(layer.id, plan[0], encoder, pendingDestroy);
      const edgeAware = this.maybeApplyEdgeAware(layer, resident, colorView, encoder, pendingDestroy);
      return this.runRefineEdgePipeline(layer.id, edgeAware, layer.mask.refineEdge, encoder, pendingDestroy);
    }

    const snapshot = snapshotFoldInputs(layer.mask);
    const cached = this.foldedMaskTextures.get(layer.id);
    if (cached && foldInputsEqual(cached.lastInputs, snapshot) && cached.lastInvert === layer.mask.invert) {
      const edgeAware = this.maybeApplyEdgeAware(layer, cached.texture, colorView, encoder, pendingDestroy);
      return this.runRefineEdgePipeline(layer.id, edgeAware, layer.mask.refineEdge, encoder, pendingDestroy);
    }

    const folded = this.runFoldPipeline(layer.id, plan, layer.mask.invert, encoder, pendingDestroy);
    this.foldedMaskTextures.set(layer.id, { texture: folded, lastInputs: snapshot, lastInvert: layer.mask.invert });
    const edgeAware = this.maybeApplyEdgeAware(layer, folded, colorView, encoder, pendingDestroy);
    return this.runRefineEdgePipeline(layer.id, edgeAware, layer.mask.refineEdge, encoder, pendingDestroy);
  }

  /** Texture résidente d'UNE source de masque (upload seulement quand sa
   *  référence `raster` change — même pattern que l'ancien `maskTextures`). */
  private getResidentSourceTexture(
    layerId: string,
    source: MaskSource,
    encoder: GPUCommandEncoder,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    if (source.type !== "brush") return this.getParametricSourceTexture(layerId, source, encoder, pendingDestroy);
    const key = `${layerId}:${source.id}`;
    const raster = source.raster!; // planFold ne retient que des sources avec raster non-null (chemin brush)
    const entry = this.sourceTextures.get(key);
    if (entry && entry.syncedFrom === raster) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        // COPY_SRC : runFoldPipeline() utilise la texture de la 1ère source
        // (le "seed") comme SOURCE d'un copyTextureToTexture vers le
        // ping-pong de fold — sans ce flag, WebGPU lève une erreur de
        // validation dès qu'un fold réel est déclenché (trouvé en revue
        // adverse codex-crosscheck, jamais exercé par le raccourci
        // 1-source qui ne passe jamais par copyTextureToTexture en lecture).
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
    // Même optimisation GPU-copy qu'avant (Task 1 / historique pré-tranche) :
    // si CETTE source est celle en cours de peinture, son contenu GPU est
    // déjà à jour dans liveMaskTexture — copie GPU->GPU au lieu d'un 2e
    // upload CPU->GPU complet (évite le hang traqué le 2026-07-15).
    if (this.liveMaskLayerId === layerId && this.liveMaskTexture && source.type === "brush") {
      encoder.copyTextureToTexture({ texture: this.liveMaskTexture }, { texture }, [this.width, this.height]);
      // Le raccourci n'est valide qu'UNE frame (celle qui suit immédiatement
      // la fin d'un stroke, où liveMaskTexture == raster fraîchement commité).
      // Sans ce reset, une résolution ULTÉRIEURE de cette source (undo,
      // changement de calque puis retour, nouveau render) reprendrait ce
      // même raccourci périmé au lieu d'uploader le raster réel (ex. plus
      // ancien après un undo) — l'undo semblait alors ne pas annuler le
      // dernier trait de pinceau. Voir getLiveMaskTexture : un nouveau
      // stroke qui démarre juste après ce reset verra liveMaskLayerId !==
      // layerId pour sa 1ère frame -> upload plein (comportement déjà
      // documenté par cette méthode), puis liveMaskLayerId est re-posé et
      // les frames suivantes redeviennent des uploads partiels normaux.
      this.liveMaskLayerId = null;
    } else {
      this.uploadR8(texture, raster, this.width, this.height);
    }
    this.sourceTextures.set(key, { texture, syncedFrom: raster });
    return texture;
  }

  /** Texture résidente d'une source PARAMÉTRIQUE (design.md §3) : régénérée
   *  seulement quand `source.params` change (comparaison par référence —
   *  `updateMaskSourceParams` remplace toujours l'objet, jamais ne le mute),
   *  PAS à la cadence du fold/pinceau (budget ≤100ms visé, pas 60fps —
   *  Global Constraints du plan Tranche 3). */
  private getParametricSourceTexture(
    layerId: string,
    source: MaskSource,
    encoder: GPUCommandEncoder,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    const key = `${layerId}:${source.id}`;
    const entry = this.parametricSourceTextures.get(key);
    if (entry && entry.syncedFrom === source.params) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC,
      });
    const module = getMaskSourceModule(source.type as "gradient" | "luminosity" | "colorRange");
    // Divergence de signature assumée (Task 5, arbitrage délégué à cette
    // tâche — voir rapport) : colorRange sérialise dans un array<f32,32>
    // (tolerance/hardness/invert/sampleCount + jusqu'à 6 échantillons RGB),
    // gradient/luminosity dans un array<f32,8>. Gardée telle quelle plutôt
    // qu'uniformisée à 32 partout : uniformiser gaspillerait de l'espace
    // uniform pour gradient/luminosity sans bénéfice (leurs modules n'ont
    // jamais plus de quelques scalaires), et le contrat `MaskSourceModule.wgsl`
    // (Task 3-5) est déjà écrit et testé sur cette asymétrie — la changer ici
    // reviendrait à modifier des fichiers hors scope de cette tâche
    // (gradient.ts/luminosity.ts/colorRange.ts).
    const paramCount = PARAM_COUNT_BY_TYPE[source.type] ?? 8;
    const flatParams = this.flattenMaskSourceParams(source.params, module.defaultParams, paramCount);
    const paramsBuffer = this.ctx.device.createBuffer({
      size: flatParams.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    this.ctx.device.queue.writeBuffer(paramsBuffer, 0, flatParams as BufferSource);
    const wgsl = this.wrapMaskSourceGenerateWgsl(module.wgsl, paramCount);
    const cacheKey = `parametric:${source.type}:${paramCount}`;
    let cached = this.maskSourcePipelineCache.get(cacheKey);
    if (!cached) {
      const layout = this.ctx.device.createBindGroupLayout({
        entries: [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
          { binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } },
        ],
      });
      const pipeline = this.ctx.device.createRenderPipeline({
        layout: this.ctx.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
        vertex: { module: this.ctx.device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
        fragment: {
          module: this.ctx.device.createShaderModule({ code: wgsl }),
          entryPoint: "fs_wrapped",
          targets: [{ format: "r8unorm" }],
        },
        primitive: { topology: "triangle-list" },
      });
      cached = { pipeline, layout };
      this.maskSourcePipelineCache.set(cacheKey, cached);
    }
    const bindGroup = this.ctx.device.createBindGroup({
      layout: cached.layout,
      entries: [
        { binding: 0, resource: this.sourceTexture!.createView() },
        { binding: 1, resource: this.sampler },
        { binding: 2, resource: { buffer: paramsBuffer } },
      ],
    });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: texture.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(cached.pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();

    // WebGPU valide la vivacité d'une ressource à submit(), pas à
    // l'enregistrement de la passe — détruire paramsBuffer ICI, avant
    // submit(), serait une erreur de validation puisque le bindGroup
    // ci-dessus vient d'être enregistré sur cet encoder. Pattern standard
    // ADR-0001 : pousser dans pendingDestroy, drainé après submit() par
    // l'appelant de frame (runPipeline).
    pendingDestroy.push(paramsBuffer);
    this.parametricSourceTextures.set(key, { texture, syncedFrom: source.params });
    return texture;
  }

  /** `source.params` est un `Record<string, number|number[]>` (noms), le
   *  wgsl attend un tableau POSITIONNEL fixe — cette fonction sérialise
   *  dans l'ordre des CLÉS de `defaultParams` (ordre d'insertion garanti en
   *  JS pour les clés string), avec un cas spécial pour `colorRange` qui
   *  déplie `samples: number[]` (RGB plats) après les scalaires. */
  private flattenMaskSourceParams(
    params: Record<string, number | number[]> | null,
    defaults: Record<string, number | number[]>,
    count: number
  ): Float32Array {
    const out = new Float32Array(count);
    const p = params ?? defaults;
    if ("samples" in defaults) {
      // colorRange : [tolerance, hardness, invert, sampleCount, r0,g0,b0, ...]
      const samples = (p.samples as number[] | undefined) ?? [];
      out[0] = (p.tolerance as number) ?? 0.15;
      out[1] = (p.hardness as number) ?? 0.5;
      out[2] = (p.invert as number) ?? 0;
      out[3] = Math.min(samples.length / 3, 6);
      for (let i = 0; i < Math.min(samples.length, 18); i++) out[4 + i] = samples[i];
      return out;
    }
    let i = 0;
    for (const key of Object.keys(defaults)) {
      if (i >= count) break;
      out[i] = (p[key] as number) ?? (defaults[key] as number);
      i++;
    }
    return out;
  }

  /** Enveloppe `fs_generate` (module de source) dans un fragment shader
   *  complet : lit la couleur SOURCE (photo originale, `this.sourceTexture`
   *  — voir mask/sources/types.ts, "ancré sur l'image source") et écrit sa
   *  contribution masque en r8. */
  private wrapMaskSourceGenerateWgsl(generateWgsl: string, paramCount: number): string {
    return `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcColor: texture_2d<f32>;
@group(0) @binding(1) var maskSampler: sampler;
@group(0) @binding(2) var<uniform> genParams: array<f32, ${paramCount}>;

${generateWgsl}

@fragment
fn fs_wrapped(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcColor, maskSampler, in.uv).rgb;
  let v = fs_generate(in.uv, color, genParams);
  return vec4<f32>(v, v, v, 1.0);
}
`;
  }

  private ensureFoldPingPong(layerId: string): [GPUTexture, GPUTexture] {
    let pair = this.foldPingPongByLayer.get(layerId);
    if (!pair) {
      const make = () =>
        this.ctx.device.createTexture({
          size: [this.width, this.height],
          format: "r8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC,
        });
      pair = [make(), make()];
      this.foldPingPongByLayer.set(layerId, pair);
    }
    return pair;
  }

  /** `binding2`: ce que porte le binding 2 du layout, au plus UN des deux
   *  (aucune passe de fold/refine-edge actuelle n'a besoin des deux à la
   *  fois) — "texture" pour `fs_combine` (2e source), "uniform" pour les
   *  passes Task 2 (`fs_smooth`/`fs_morphology`, radius), "none" pour
   *  `fs_invert`. `entryPoint` est lu dans le WGSL lui-même plutôt que
   *  deviné depuis `binding2` (Task 2 : extension rétro-compatible, ne
   *  redérive plus fs_combine/fs_invert d'un booléen). */
  private getMaskFoldPipeline(
    wgsl: string,
    binding2: "none" | "texture" | "uniform",
    entryPoint: string
  ): { pipeline: GPURenderPipeline; layout: GPUBindGroupLayout } {
    const cached = this.maskFoldPipelineCache.get(wgsl);
    if (cached) return cached;
    const { device } = this.ctx;
    const entries: GPUBindGroupLayoutEntry[] = [
      { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
      { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
    ];
    if (binding2 === "texture") {
      entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
    } else if (binding2 === "uniform") {
      entries.push({ binding: 2, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
    }
    const layout = device.createBindGroupLayout({ entries });
    const pipeline = device.createRenderPipeline({
      layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      vertex: { module: device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
      fragment: {
        module: device.createShaderModule({ code: wgsl }),
        entryPoint,
        targets: [{ format: "r8unorm" }],
      },
      primitive: { topology: "triangle-list" },
    });
    const entry = { pipeline, layout };
    this.maskFoldPipelineCache.set(wgsl, entry);
    return entry;
  }

  /** `uniformBuffer` (Task 2, extension rétro-compatible) : `undefined` =
   *  comportement Tranche 2 inchangé (fold `fs_combine`/`fs_invert`, jamais
   *  d'uniform). Fourni = passe refine-edge (`fs_smooth`/`fs_morphology`,
   *  radius en binding 2) — mutuellement exclusif avec `srcB`, aucune passe
   *  actuelle n'a besoin des deux. */
  private runMaskPass(
    encoder: GPUCommandEncoder,
    wgsl: string,
    srcA: GPUTexture,
    srcB: GPUTexture | null,
    target: GPUTexture,
    uniformBuffer?: GPUBuffer
  ): void {
    const entryPointMatch = wgsl.match(/\bfn (fs_\w+)\s*\(/);
    if (!entryPointMatch) throw new Error("runMaskPass: aucun point d'entrée fs_* trouvé dans le WGSL fourni.");
    const entryPoint = entryPointMatch[1];
    const binding2 = srcB !== null ? "texture" : uniformBuffer !== undefined ? "uniform" : "none";
    const { pipeline, layout } = this.getMaskFoldPipeline(wgsl, binding2, entryPoint);
    const bindEntries: GPUBindGroupEntry[] = [
      { binding: 0, resource: srcA.createView() },
      { binding: 1, resource: this.sampler },
    ];
    if (srcB) bindEntries.push({ binding: 2, resource: srcB.createView() });
    else if (uniformBuffer) bindEntries.push({ binding: 2, resource: { buffer: uniformBuffer } });
    const bindGroup = this.ctx.device.createBindGroup({ layout, entries: bindEntries });
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, bindGroup);
    pass.draw(3);
    pass.end();
  }

  /** Fold GPU résident (design.md §4) : seed (copie directe, combineMode
   *  ignoré) -> combine séquentiel des sources suivantes -> invert final.
   *  Le refine-edge (§4bis, Tranche 3) n'a PAS de passe ici — c'est un
   *  no-op tant que ses paramètres restent aux valeurs par défaut
   *  (`defaultRefineEdge()`), voir `RefineEdgeParams` dans `mask/types.ts`. */
  private runFoldPipeline(
    layerId: string,
    plan: MaskSource[],
    invert: boolean,
    encoder: GPUCommandEncoder,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    const [pingA, pingB] = this.ensureFoldPingPong(layerId);
    const seedTexture = this.getResidentSourceTexture(layerId, plan[0], encoder, pendingDestroy);
    let acc = pingA;
    encoder.copyTextureToTexture({ texture: seedTexture }, { texture: acc }, [this.width, this.height]);
    let next = pingB;
    for (let i = 1; i < plan.length; i++) {
      const srcTexture = this.getResidentSourceTexture(layerId, plan[i], encoder, pendingDestroy);
      this.runMaskPass(encoder, buildCombineWgsl(plan[i].combineMode), acc, srcTexture, next);
      [acc, next] = [next, acc];
    }
    if (invert) {
      this.runMaskPass(encoder, buildInvertWgsl(), acc, null, next);
      [acc, next] = [next, acc];
    }
    return acc;
  }

  /** Guided filter séparable (He, Sun, Tang 2010 — design.md §4bis) : le bord
   *  du masque foldé épouse les contours de contraste du calque plutôt que
   *  de rester géométrique. Suspendu pendant un stroke actif — le chemin
   *  `livePreview` de `getMaskTexture` ne passe jamais par `runFoldPipeline`
   *  ni par cette méthode, donc l'edge-aware ne s'applique qu'au relâchement
   *  du trait, même granularité que le reste du fold.
   *
   *  `colorView` = guide `I` du filtre (luminance). Choix documenté sur
   *  `maybeApplyEdgeAware` (jugement, pas une certitude — voir son
   *  commentaire).
   *
   *  Buffers d'uniform (radius/edgeStrength) jetables par frame, poussés
   *  dans `pendingDestroy` — voir `docs/adr/0001-guided-filter-uniform-buffers-per-frame.md` :
   *  pattern volontairement identique à `compositingBuffer` (ligne ~565),
   *  pas de cache persistant par calque. */
  private runEdgeAwarePipeline(
    layerId: string,
    foldedMask: GPUTexture,
    colorView: GPUTextureView,
    params: RefineEdgeParams,
    encoder: GPUCommandEncoder,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    const { device } = this.ctx;
    const size: [number, number] = [this.width, this.height];

    let w = this.edgeAwareWorkTextures.get(layerId);
    if (!w) {
      const r8 = () =>
        device.createTexture({
          size,
          format: "r8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
      const rg8 = () =>
        device.createTexture({
          size,
          format: "rg8unorm",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
      const rg16f = () =>
        device.createTexture({
          size,
          format: "rg16float",
          usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.RENDER_ATTACHMENT,
        });
      w = {
        luminance: r8(),
        packedIp: rg8(),
        squareCorr: rg16f(),
        meanIp: rg16f(),
        meanIpTmp: rg16f(),
        corr: rg16f(),
        corrTmp: rg16f(),
        ab: rg16f(),
        meanAB: rg16f(),
        meanABTmp: rg16f(),
        result: r8(),
      };
      this.edgeAwareWorkTextures.set(layerId, w);
    }
    const work = w;

    // Passe générique : compile/monte un pipeline (mis en cache par
    // wgsl+entryPoint, comme le reste du fichier) et l'exécute avec les vues
    // fournies. `views[0]` est TOUJOURS le binding 0 ; le sampler non
    // filtrant est toujours binding 1 (voir tous les générateurs WGSL de
    // edgeAwareWgsl.ts, qui suivent cette convention de binding fixe).
    const pass = (
      wgsl: string,
      entryPoint: string,
      target: GPUTexture,
      views: GPUTextureView[],
      uniformBuffer?: GPUBuffer
    ): void => {
      const cacheKey = `${entryPoint}:${wgsl.length}`;
      let cached = this.edgeAwarePipelineCache.get(cacheKey);
      if (!cached) {
        // sampleType "float" + sampler "filtering" (pas "unfilterable-float"/
        // "non-filtering") : tous les formats de travail edge-aware
        // (r8unorm/rg8unorm/rg16float) sont filtrables par le spec WebGPU, et
        // le WGSL de edgeAwareWgsl.ts appelle `textureSample()` partout — un
        // sampler non filtrant combiné à `textureSample()` (plutôt que
        // `textureLoad()`) est un rejet de validation au pipeline. Divergence
        // documentée vs le pseudo-code du brief (Task 1 Step 11), qui utilisait
        // "unfilterable-float"/"non-filtering" — jamais exercé avant ce fix
        // car aucun test ne crée de vrai device WebGPU (voir rapport de tâche).
        const entries: GPUBindGroupLayoutEntry[] = [
          { binding: 0, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } },
          { binding: 1, visibility: GPUShaderStage.FRAGMENT, sampler: { type: "filtering" } },
        ];
        for (let i = 1; i < views.length; i++) {
          entries.push({ binding: 1 + i, visibility: GPUShaderStage.FRAGMENT, texture: { sampleType: "float" } });
        }
        if (uniformBuffer) {
          entries.push({ binding: 1 + views.length, visibility: GPUShaderStage.FRAGMENT, buffer: { type: "uniform" } });
        }
        const layout = device.createBindGroupLayout({ entries });
        const pipeline = device.createRenderPipeline({
          layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
          vertex: { module: device.createShaderModule({ code: wgsl }), entryPoint: "vs_main" },
          fragment: {
            module: device.createShaderModule({ code: wgsl }),
            entryPoint,
            targets: [{ format: target.format }],
          },
          primitive: { topology: "triangle-list" },
        });
        cached = { pipeline, layout };
        this.edgeAwarePipelineCache.set(cacheKey, cached);
      }
      const bindEntries: GPUBindGroupEntry[] = [
        { binding: 0, resource: views[0] },
        { binding: 1, resource: this.nearestSampler },
      ];
      for (let i = 1; i < views.length; i++) bindEntries.push({ binding: 1 + i, resource: views[i] });
      if (uniformBuffer) bindEntries.push({ binding: 1 + views.length, resource: { buffer: uniformBuffer } });
      const bindGroup = device.createBindGroup({ layout: cached.layout, entries: bindEntries });
      const renderPass = encoder.beginRenderPass({
        colorAttachments: [
          { view: target.createView(), loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      });
      renderPass.setPipeline(cached.pipeline);
      renderPass.setBindGroup(0, bindGroup);
      renderPass.draw(3);
      renderPass.end();
    };

    const radiusBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(radiusBuffer, 0, new Float32Array([params.edgeRadius, 0, 0, 0]));
    pendingDestroy.push(radiusBuffer);
    const strengthBuffer = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(strengthBuffer, 0, new Float32Array([params.edgeStrength, 0, 0, 0]));
    pendingDestroy.push(strengthBuffer);

    const foldedMaskView = foldedMask.createView();
    pass(buildLuminanceWgsl(), "fs_luminance", work.luminance, [colorView]);
    pass(buildPackWgsl(), "fs_pack", work.packedIp, [work.luminance.createView(), foldedMaskView]);
    pass(buildSquareCorrWgsl(), "fs_squareCorr", work.squareCorr, [work.packedIp.createView()]);
    pass(buildBoxFilterHWgsl(2), "fs_boxH", work.meanIpTmp, [work.packedIp.createView()], radiusBuffer);
    pass(buildBoxFilterVWgsl(2), "fs_boxV", work.meanIp, [work.meanIpTmp.createView()], radiusBuffer);
    pass(buildBoxFilterHWgsl(2), "fs_boxH", work.corrTmp, [work.squareCorr.createView()], radiusBuffer);
    pass(buildBoxFilterVWgsl(2), "fs_boxV", work.corr, [work.corrTmp.createView()], radiusBuffer);
    pass(buildComputeABWgsl(), "fs_computeAB", work.ab, [work.meanIp.createView(), work.corr.createView()]);
    pass(buildBoxFilterHWgsl(2), "fs_boxH", work.meanABTmp, [work.ab.createView()], radiusBuffer);
    pass(buildBoxFilterVWgsl(2), "fs_boxV", work.meanAB, [work.meanABTmp.createView()], radiusBuffer);
    pass(
      buildCompositeWgsl(),
      "fs_composite",
      work.result,
      [work.meanAB.createView(), work.luminance.createView(), foldedMaskView],
      strengthBuffer
    );

    return work.result;
  }

  /** Applique le guided filter edge-aware si activé et `edgeStrength > 0`,
   *  sinon retourne `folded` tel quel — court-circuit explicite cohérent
   *  avec `composeEdgeAware(p, q, 0) === p` (aucun travail GPU
   *  supplémentaire quand l'utilisateur n'a pas activé l'edge-aware).
   *
   *  **Décision (jugement, pas une certitude — cf. rapport de tâche)** :
   *  `colorView` = la texture d'ENTRÉE du calque (le composite accumulé
   *  SOUS lui, avant l'application de son propre effet), pas sa sortie.
   *  Le pipeline actuel (`runPipeline`/`runEffectPass`) ne matérialise
   *  aucune texture nommée et stable représentant "la couleur du calque
   *  après son propre effet mais avant compositing" — `runEffectPass`
   *  applique effet ET compositing (mix mask/opacity/blend) en une seule
   *  passe shader, il n'existe pas de texture intermédiaire séparée entre
   *  les deux. La texture d'entrée (`sourceView`/`readTexture`), elle,
   *  EST déjà résidente et disponible à chaque site d'appel de
   *  `getMaskTexture`. design.md §4bis ne tranche pas explicitement entre
   *  "guide = calque avant son effet" et "guide = calque après son effet" ;
   *  les deux sont défendables (l'un suit la structure de l'image sous-
   *  jacente, l'autre suivrait la structure post-effet, ex. un warp qui
   *  déplace les contours). Choix retenu : avant effet, par simplicité et
   *  parce que c'est la texture déjà en main sans passe supplémentaire. */
  private maybeApplyEdgeAware(
    layer: LayerState,
    folded: GPUTexture,
    colorView: GPUTextureView,
    encoder: GPUCommandEncoder,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    const params = layer.mask.refineEdge;
    if (!params.edgeAware || params.edgeStrength <= 0) return folded;
    return this.runEdgeAwarePipeline(layer.id, folded, colorView, params, encoder, pendingDestroy);
  }

  /** Refine edge forme-seule (design.md §4 étape 5) : contracter/dilater ->
   *  feather -> lisser, dans cet ordre (Photoshop Select and Mask : forme
   *  d'abord, lissage en dernier pour ne pas re-rugueuser un bord tout juste
   *  adouci). No-op si les 3 paramètres sont à leur défaut (0) — pas de
   *  texture de travail créée ni de passe GPU sur ce chemin, cohérent avec
   *  le court-circuit `maybeApplyEdgeAware`.
   *
   *  Indépendant de l'image (contrairement à Task 1 edge-aware) : appelé
   *  APRÈS `maybeApplyEdgeAware` dans `getMaskTexture`, à chaque site
   *  d'appel (y compris le raccourci 1-source) — même règle de branchement
   *  que Task 1 Step 12. */
  private runRefineEdgePipeline(
    layerId: string,
    input: GPUTexture,
    params: RefineEdgeParams,
    encoder: GPUCommandEncoder,
    pendingDestroy: (GPUTexture | GPUBuffer)[]
  ): GPUTexture {
    if (params.feather <= 0 && params.contract === 0 && params.smooth <= 0) return input;
    const { device } = this.ctx;
    let pair = this.refineEdgePingPongByLayer.get(layerId);
    if (!pair) {
      const make = () =>
        device.createTexture({
          size: [this.width, this.height],
          format: "r8unorm",
          usage:
            GPUTextureUsage.TEXTURE_BINDING |
            GPUTextureUsage.RENDER_ATTACHMENT |
            GPUTextureUsage.COPY_DST |
            GPUTextureUsage.COPY_SRC,
        });
      pair = [make(), make()];
      this.refineEdgePingPongByLayer.set(layerId, pair);
    }
    let [acc, next] = pair;
    // Amorce `acc` avec `input` : les passes suivantes lisent/écrivent
    // uniquement la paire ping-pong dédiée, jamais `input` directement (même
    // raison que `runFoldPipeline`/`runEdgeAwarePipeline` : `input` peut être
    // une texture résidente partagée, ex. `getResidentSourceTexture` ou
    // `edgeAwareWorkTextures.result`, qu'on ne doit pas écraser en RENDER_ATTACHMENT).
    encoder.copyTextureToTexture({ texture: input }, { texture: acc }, [this.width, this.height]);

    // Buffers d'uniform jetables par frame — même pattern que
    // `runEdgeAwarePipeline` (radiusBuffer/strengthBuffer, ADR-0001).
    const radiusBuffer = (value: number): GPUBuffer => {
      const buf = device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
      device.queue.writeBuffer(buf, 0, new Float32Array([value, 0, 0, 0]));
      pendingDestroy.push(buf);
      return buf;
    };

    if (params.contract !== 0) {
      const mode = params.contract < 0 ? "erode" : "dilate";
      this.runMaskPass(encoder, buildMorphologyWgsl(mode), acc, null, next, radiusBuffer(Math.abs(params.contract)));
      [acc, next] = [next, acc];
    }
    if (params.feather > 0) {
      const r = radiusBuffer(params.feather);
      this.runMaskPass(encoder, buildBoxFilterHWgsl(1), acc, null, next, r);
      [acc, next] = [next, acc];
      this.runMaskPass(encoder, buildBoxFilterVWgsl(1), acc, null, next, r);
      [acc, next] = [next, acc];
    }
    for (let i = 0; i < params.smooth; i++) {
      const r = radiusBuffer(1);
      this.runMaskPass(encoder, buildBoxFilterHWgsl(1), acc, null, next, r);
      [acc, next] = [next, acc];
      this.runMaskPass(encoder, buildBoxFilterVWgsl(1), acc, null, next, r);
      [acc, next] = [next, acc];
    }
    return acc;
  }

  /** Backing texture for `MaskPreviewOverride` — a single texture reused
   *  across preview frames, never entered into the residency cache since it
   *  isn't associated with a stable `raster` reference.
   *
   *  A `"partial"` scope is only trusted when the texture is ALREADY known
   *  to reflect `layerId`'s content (`liveMaskLayerId` matches) — the
   *  source data offset/stride trick in `computeR8UploadRegion` lets WebGPU
   *  read just that sub-rectangle directly out of the full-resolution
   *  `raster` buffer, so this needs no extra JS-side copy either.
   *  Otherwise (layer just changed, or the caller explicitly asked for
   *  `"full"`) the whole image is uploaded and `liveMaskLayerId` updated. */
  private getLiveMaskTexture(layerId: string, raster: Uint8Array, scope: MaskUploadScope): GPUTexture {
    if (!this.liveMaskTexture) {
      this.liveMaskTexture = this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        // COPY_SRC: getMaskTexture()'s resident branch copies straight out
        // of this texture (GPU-to-GPU) once a stroke ends, instead of a
        // second CPU->GPU upload of the same bytes.
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.COPY_SRC,
      });
    }
    const rect = scope.kind === "partial" && this.liveMaskLayerId === layerId ? scope.rect : undefined;
    this.uploadR8(this.liveMaskTexture, raster, this.width, this.height, rect);
    if (!rect) this.liveMaskLayerId = layerId;
    return this.liveMaskTexture;
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
    this.sourceTexture?.destroy();
    this.sourceTexture = null;
    if (this.pingPong) {
      this.pingPong[0].destroy();
      this.pingPong[1].destroy();
      this.pingPong = null;
    }
    this.exportTexture?.destroy();
    this.exportTexture = null;
    this.pipelineCache.clear();
    this.whiteMask?.destroy();
    this.whiteMask = null;
    this.liveMaskTexture?.destroy();
    this.liveMaskTexture = null;
    for (const { texture } of this.sourceTextures.values()) texture.destroy();
    this.sourceTextures.clear();
    for (const { texture } of this.parametricSourceTextures.values()) texture.destroy();
    this.parametricSourceTextures.clear();
    this.maskSourcePipelineCache.clear();
    for (const { texture } of this.foldedMaskTextures.values()) texture.destroy();
    this.foldedMaskTextures.clear();
    for (const [a, b] of this.foldPingPongByLayer.values()) {
      a.destroy();
      b.destroy();
    }
    this.foldPingPongByLayer.clear();
    for (const [a, b] of this.refineEdgePingPongByLayer.values()) {
      a.destroy();
      b.destroy();
    }
    this.refineEdgePingPongByLayer.clear();
    this.maskFoldPipelineCache.clear();
    for (const w of this.edgeAwareWorkTextures.values()) {
      w.luminance.destroy();
      w.packedIp.destroy();
      w.squareCorr.destroy();
      w.meanIp.destroy();
      w.meanIpTmp.destroy();
      w.corr.destroy();
      w.corrTmp.destroy();
      w.ab.destroy();
      w.meanAB.destroy();
      w.meanABTmp.destroy();
      w.result.destroy();
    }
    this.edgeAwareWorkTextures.clear();
    this.edgeAwarePipelineCache.clear();
  }
}
