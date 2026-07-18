import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";
import type { EffectModule } from "./effects/types";
import { composeShader, MAX_EFFECT_PARAMS, FULLSCREEN_VERTEX_WGSL } from "./shaderCompose";
import { staleMaskIds } from "./maskResidency";
import { FrameScheduler } from "./frameScheduler";
import { assertImageFitsGpu } from "./limits";
import { logDiagnostic } from "../launch";
import type { DirtyRect } from "../mask/maskPainter";
import { computeR8UploadRegion } from "./maskUpload";

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

/** Live mask-paint preview: renders `maskData` (the painter's own live
 *  buffer, not yet committed to `LayerState.maskData`) for `layerId` on this
 *  one frame only. Lets `handleMaskStroke` show visual feedback on every
 *  coalesced pointer sample without paying `LayerStack.updateMask()`'s
 *  per-sample immutable-copy cost (~26MB on a 24MP photo).
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
  maskData: Uint8Array;
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
  private pipelineCache = new Map<
    string,
    { pipeline: GPURenderPipeline; bindGroupLayout: GPUBindGroupLayout }
  >();
  private maskTextures = new Map<string, { texture: GPUTexture; syncedFrom: Uint8Array }>();
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
   *  layer currently being painted, bypassing `LayerState.maskData`
   *  entirely for that frame. */
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
   *  retour visuel par échantillon sans passer par `updateMask()`. */
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

    for (const id of staleMaskIds(this.maskTextures.keys(), layers)) {
      this.maskTextures.get(id)!.texture.destroy();
      this.maskTextures.delete(id);
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
        { id: "", effectId: "", params: {}, enabled: true, maskData: null },
        readTexture.createView(),
        blitTarget ? blitTarget.createView() : finalTargetView,
        {},
        pendingDestroy
      );
      if (overlayLayer && blitTarget) {
        this.runOverlayPass(encoder, blitTarget, this.getMaskTexture(overlayLayer, encoder), finalTargetView);
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
        this.getMaskTexture(overlayLayer, encoder),
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
        `churnedThisFrame=${churnedResources} residentMaskTextures=${this.maskTextures.size} ` +
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

    const shaderCode = composeShader(effect.wgsl, {
      applyMask,
      hasPrevPass: prevPassView !== null,
    });

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
      // Résidente — ne PAS la mettre dans pendingDestroy.
      entries.push({ binding: 3, resource: this.getMaskTexture(layer, encoder).createView() });
    }
    if (prevPassView) {
      entries.push({ binding: 4, resource: prevPassView });
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
   *  l'image, réuploadée uniquement quand la référence `maskData` du calque
   *  change (les masques sont immuables par convention — updateMask remplace
   *  la référence, jamais le contenu). Auparavant : création + upload 24MP à
   *  CHAQUE frame pour chaque calque masqué. */
  private getMaskTexture(layer: LayerState, encoder: GPUCommandEncoder): GPUTexture {
    if (this.livePreview && this.livePreview.layerId === layer.id) {
      return this.getLiveMaskTexture(this.livePreview.layerId, this.livePreview.maskData, this.livePreview.scope);
    }
    if (!layer.maskData) return this.getWhiteMask();
    const entry = this.maskTextures.get(layer.id);
    if (entry && entry.syncedFrom === layer.maskData) return entry.texture;
    const texture =
      entry?.texture ??
      this.ctx.device.createTexture({
        size: [this.width, this.height],
        format: "r8unorm",
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      });
    // The common case reaching this branch is "a mask stroke on this exact
    // layer just ended" — `layer.maskData` is a fresh CPU copy of the same
    // painter buffer `liveMaskTexture` was already uploading sample-by-
    // sample during the stroke, so its GPU content is already byte-
    // identical. Reuse it via a GPU-side copy instead of a second full
    // CPU->GPU `writeTexture` of the whole image: that second upload,
    // through this exact branch, was traced (CDP repro, 2026-07-15) to
    // reliably hang the renderer at 24MP — the JS commit completes, but the
    // already-scheduled requestAnimationFrame never fires again afterward.
    // The equivalent upload via `getLiveMaskTexture` (same buffer, same
    // size) never reproduces it, so avoiding the redundant second upload
    // sidesteps the hang rather than explaining its exact driver mechanism.
    if (this.liveMaskLayerId === layer.id && this.liveMaskTexture) {
      encoder.copyTextureToTexture({ texture: this.liveMaskTexture }, { texture }, [this.width, this.height]);
    } else {
      this.uploadR8(texture, layer.maskData, this.width, this.height);
    }
    this.maskTextures.set(layer.id, { texture, syncedFrom: layer.maskData });
    return texture;
  }

  /** Backing texture for `MaskPreviewOverride` — a single texture reused
   *  across preview frames, never entered into the residency cache since it
   *  isn't associated with a stable `maskData` reference.
   *
   *  A `"partial"` scope is only trusted when the texture is ALREADY known
   *  to reflect `layerId`'s content (`liveMaskLayerId` matches) — the
   *  source data offset/stride trick in `computeR8UploadRegion` lets WebGPU
   *  read just that sub-rectangle directly out of the full-resolution
   *  `maskData` buffer, so this needs no extra JS-side copy either.
   *  Otherwise (layer just changed, or the caller explicitly asked for
   *  `"full"`) the whole image is uploaded and `liveMaskLayerId` updated. */
  private getLiveMaskTexture(layerId: string, maskData: Uint8Array, scope: MaskUploadScope): GPUTexture {
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
    this.uploadR8(this.liveMaskTexture, maskData, this.width, this.height, rect);
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
    for (const { texture } of this.maskTextures.values()) texture.destroy();
    this.maskTextures.clear();
    this.whiteMask?.destroy();
    this.whiteMask = null;
    this.liveMaskTexture?.destroy();
    this.liveMaskTexture = null;
  }
}
