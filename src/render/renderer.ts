import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";
import type { EffectModule } from "./effects/types";
import { composeShader, MAX_EFFECT_PARAMS } from "./shaderCompose";
import { staleMaskIds } from "./maskResidency";
import { FrameScheduler } from "./frameScheduler";

const PASSTHROUGH_EFFECT: EffectModule = {
  id: "passthrough",
  name: "Passthrough",
  params: [],
  wgsl: "fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> { return color; }",
};

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
  private renderScheduler = new FrameScheduler<LayerState[]>((layers) => this.render(layers));

  constructor(ctx: GpuContext) {
    this.ctx = ctx;
    this.sampler = ctx.device.createSampler({ magFilter: "linear", minFilter: "linear" });
  }

  async loadImage(bitmap: ImageBitmap): Promise<void> {
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

  render(layers: LayerState[]): void {
    this.runPipeline(layers, getSrgbCanvasView(this.ctx));
  }

  /** Rendu coalescé : à privilégier pour tout ce qui peut tirer plus vite
   *  que la frame (drag de slider, pinceau). `render()` reste disponible
   *  pour un rendu immédiat déterministe (premier affichage). */
  requestRender(layers: LayerState[]): void {
    this.renderScheduler.request(layers);
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

    for (const id of staleMaskIds(this.maskTextures.keys(), layers)) {
      this.maskTextures.get(id)!.texture.destroy();
      this.maskTextures.delete(id);
    }

    let readTexture = this.sourceTexture;
    let writeIndex = 0;
    const enabledLayers = layers.filter((l) => l.enabled);

    const encoder = device.createCommandEncoder();
    // Per-frame GPU resources — intermediate multi-pass textures (from
    // runInternalPasses), each pass's paramBuffer, and each pass's mask
    // texture (from uploadMask) — all live only for this frame. They must
    // not be destroyed until AFTER this frame's command buffer has been
    // submitted — recording a command against a resource does NOT pin its
    // lifetime through to a later submit (WebGPU validates at submit()
    // time), so destroying mid-encoder throws. Collected here and drained
    // once, post-submit, below.
    const pendingDestroy: (GPUTexture | GPUBuffer)[] = [];

    if (enabledLayers.length === 0) {
      // Nothing to composite — blit the source straight to the target.
      this.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        { id: "", effectId: "", params: {}, enabled: true, maskData: null },
        readTexture.createView(),
        finalTargetView,
        {},
        pendingDestroy
      );
      device.queue.submit([encoder.finish()]);
      for (const resource of pendingDestroy) resource.destroy();
      return;
    }

    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const effect = getEffect(layer.effectId);
      const isLast = i === enabledLayers.length - 1;
      const targetView = isLast ? finalTargetView : this.pingPong[writeIndex].createView();

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

    device.queue.submit([encoder.finish()]);
    for (const resource of pendingDestroy) resource.destroy();
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
      entries.push({ binding: 3, resource: this.getMaskTexture(layer).createView() });
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
    await buffer.mapAsync(GPUMapMode.READ);
    const data = new Uint8Array(buffer.getMappedRange().slice(0));
    buffer.unmap();
    return data;
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
      this.ctx.device.queue.writeTexture({ texture: this.whiteMask }, new Uint8Array([255]), {}, [1, 1]);
    }
    return this.whiteMask;
  }

  /** Texture de masque RÉSIDENTE par calque : créée une fois à la taille de
   *  l'image, réuploadée uniquement quand la référence `maskData` du calque
   *  change (les masques sont immuables par convention — updateMask remplace
   *  la référence, jamais le contenu). Auparavant : création + upload 24MP à
   *  CHAQUE frame pour chaque calque masqué. */
  private getMaskTexture(layer: LayerState): GPUTexture {
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
    this.ctx.device.queue.writeTexture(
      { texture },
      layer.maskData as BufferSource,
      { bytesPerRow: this.width },
      [this.width, this.height]
    );
    this.maskTextures.set(layer.id, { texture, syncedFrom: layer.maskData });
    return texture;
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
  }
}
