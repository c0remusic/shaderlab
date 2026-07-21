import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";
import { EffectPassRunner, PASSTHROUGH_EFFECT } from "./effectPassRunner";
import { MaskTextureResolver } from "./maskTextureResolver";
import { FrameScheduler } from "./frameScheduler";
import { FrameReadback } from "./frameReadback";
import { assertImageFitsGpu } from "./limits";
import { noopDiagnosticLogger, type DiagnosticLogger } from "./diagnostics";
import type { DirtyRect } from "../mask/maskPainter";
import { defaultLayerMask } from "../mask/types";

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
  private readonly diagnosticLogger: DiagnosticLogger;
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
  private effectPassRunner: EffectPassRunner | null = null;
  private maskTextureResolver: MaskTextureResolver | null = null;
  private renderScheduler = new FrameScheduler<{
    layers: LayerState[];
    preview: MaskPreviewOverride | null;
  }>((payload) => this.render(payload.layers, payload.preview));
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

  constructor(
    ctx: GpuContext,
    diagnosticLogger: DiagnosticLogger = noopDiagnosticLogger,
  ) {
    this.ctx = ctx;
    this.diagnosticLogger = diagnosticLogger;
    this.sampler = ctx.device.createSampler({
      magFilter: "linear",
      minFilter: "linear",
    });
    this.nearestSampler = ctx.device.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
    });
  }

  /** Active/désactive l'overlay safelight du masque d'un calque (mode peinture).
   *  Passer `null` pour l'éteindre. Ne déclenche pas de rendu — l'appelant fait
   *  un `requestRender()` ensuite. */
  setMaskOverlay(layerId: string | null): void {
    this.maskOverlayLayerId = layerId;
  }

  async loadImage(bitmap: ImageBitmap): Promise<void> {
    assertImageFitsGpu(
      bitmap.width,
      bitmap.height,
      this.ctx.device.limits.maxTextureDimension2D,
    );
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
      [this.width, this.height],
    );

    this.pingPong = [makeTarget(), makeTarget()];
    this.effectPassRunner?.clearPipelines();
    this.effectPassRunner = new EffectPassRunner(
      device,
      srgbFormat,
      this.width,
      this.height,
      this.sampler,
      (layer, encoder, sourceView, pendingDestroy) =>
        this.maskTextureResolver!.resolve(
          layer,
          encoder,
          sourceView,
          pendingDestroy,
        ),
    );
    this.maskTextureResolver?.dispose();
    this.maskTextureResolver = new MaskTextureResolver(
      this.ctx,
      this.width,
      this.height,
      this.sampler,
      this.nearestSampler,
      () => this.sourceTexture!,
    );
  }

  render(
    layers: LayerState[],
    preview: MaskPreviewOverride | null = null,
  ): void {
    this.maskTextureResolver?.setLivePreview(preview);
    this.runPipeline(layers, getSrgbCanvasView(this.ctx));
    this.maskTextureResolver?.setLivePreview(null);
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
    const readback = new FrameReadback(device, this.width, this.height);
    const padded = await readback.readTextureBytes(this.exportTexture);
    return readback.stripRowPadding(padded);
  }

  private runPipeline(
    layers: LayerState[],
    finalTargetView: GPUTextureView,
  ): void {
    if (!this.sourceTexture || !this.pingPong)
      throw new Error("Aucune image chargée.");
    if (!this.effectPassRunner) throw new Error("Aucune image chargée.");
    const { device } = this.ctx;
    const diagStart = performance.now();
    this.maskTextureResolver?.sweep(new Set(layers.map((layer) => layer.id)));

    let readTexture = this.sourceTexture;
    let writeIndex = 0;
    const enabledLayers = layers.filter((l) => l.enabled);
    // Overlay masque (mode peinture) : le calque sélectionné dont on montre le
    // masque en rouge. Quand actif, le composite final est rendu dans un slot
    // ping-pong au lieu du canvas, puis une passe overlay teinte → canvas.
    const overlayLayer = this.maskOverlayLayerId
      ? (layers.find((l) => l.id === this.maskOverlayLayerId) ?? null)
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
      this.effectPassRunner.runEffectPass(
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
        readTexture.createView(),
        blitTarget ? blitTarget.createView() : finalTargetView,
        {},
        pendingDestroy,
      );
      if (overlayLayer && blitTarget) {
        this.effectPassRunner.runOverlayPass(
          encoder,
          blitTarget,
          this.maskTextureResolver!.resolve(
            overlayLayer,
            encoder,
            readTexture.createView(),
            pendingDestroy,
          ),
          finalTargetView,
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
        isLast && !overlayLayer
          ? finalTargetView
          : this.pingPong[writeIndex].createView();

      let prevPassView: GPUTextureView | null = null;
      let prevPassTexture: GPUTexture | null = null;
      if (effect.passes && effect.passes.length > 0) {
        const lastPass = this.effectPassRunner.runInternalPasses(
          encoder,
          effect,
          layer,
          readTexture.createView(),
          pendingDestroy,
        );
        prevPassView = lastPass.view;
        prevPassTexture = lastPass.texture;
      }

      this.effectPassRunner.runEffectPass(
        encoder,
        effect,
        layer,
        readTexture.createView(),
        targetView,
        { applyMask: true, prevPassView },
        pendingDestroy,
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
      this.effectPassRunner.runOverlayPass(
        encoder,
        this.pingPong[writeIndex],
        this.maskTextureResolver!.resolve(
          overlayLayer,
          encoder,
          this.pingPong[writeIndex].createView(),
          pendingDestroy,
        ),
        finalTargetView,
      );
    }

    device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
    this.logFrameDiagnostics(
      diagStart,
      enabledLayers.length,
      pendingDestroy.length,
    );
  }

  /** Debugging-only, see the field comment on `diagFrameCount`. Logs every
   *  15th frame: JS-side encode+submit time (does NOT include actual GPU
   *  execution time, which WebGPU doesn't expose to JS), how many
   *  intermediate textures/buffers this single frame churned through
   *  (pendingDestroy.length — a proxy for GPU allocator pressure from
   *  per-frame effect passes like Glow's 5-pass bloom), and the resident
   *  mask/pipeline cache sizes (should stay bounded by layer/effect count,
   *  not grow unboundedly). */
  private logFrameDiagnostics(
    diagStart: number,
    enabledLayerCount: number,
    churnedResources: number,
  ): void {
    this.diagFrameCount++;
    if (this.diagFrameCount % 15 !== 0) return;
    const elapsedMs = Math.round((performance.now() - diagStart) * 100) / 100;
    this.diagnosticLogger(
      `frame#${this.diagFrameCount} jsEncodeMs=${elapsedMs} enabledLayers=${enabledLayerCount} ` +
        `churnedThisFrame=${churnedResources} residentMaskTextures=resolver-owned ` +
        `pipelineCacheSize=${this.effectPassRunner?.pipelineCount ?? 0} imageSize=${this.width}x${this.height}`,
    );
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
    return new FrameReadback(this.ctx.device, this.width, this.height)
      .readTextureBytes(this.pingPong[0]);
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
    this.effectPassRunner?.clearPipelines();
    this.effectPassRunner = null;
    this.maskTextureResolver?.dispose();
    this.maskTextureResolver = null;
  }
}
