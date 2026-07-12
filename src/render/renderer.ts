import type { GpuContext } from "./gpuContext";
import { getSrgbCanvasView } from "./gpuContext";
import type { LayerState } from "../layers/types";
import { getEffect } from "./effects/registry";
import type { EffectModule } from "./effects/types";

const FULLSCREEN_VERTEX_WGSL = `
struct VertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) i: u32) -> VertexOut {
  var pos = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0), vec2<f32>(3.0, -1.0), vec2<f32>(-1.0, 3.0)
  );
  var out: VertexOut;
  out.position = vec4<f32>(pos[i], 0.0, 1.0);
  out.uv = pos[i] * vec2<f32>(0.5, -0.5) + vec2<f32>(0.5, 0.5);
  return out;
}
`;

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

    let readTexture = this.sourceTexture;
    let writeIndex = 0;
    const enabledLayers = layers.filter((l) => l.enabled);

    const encoder = device.createCommandEncoder();

    if (enabledLayers.length === 0) {
      // Nothing to composite — blit the source straight to the target.
      this.runEffectPass(
        encoder,
        PASSTHROUGH_EFFECT,
        { id: "", effectId: "", params: {}, enabled: true, maskData: null },
        readTexture.createView(),
        finalTargetView
      );
      device.queue.submit([encoder.finish()]);
      return;
    }

    for (let i = 0; i < enabledLayers.length; i++) {
      const layer = enabledLayers[i];
      const effect = getEffect(layer.effectId);
      const isLast = i === enabledLayers.length - 1;
      const targetView = isLast ? finalTargetView : this.pingPong[writeIndex].createView();

      let prevPassView: GPUTextureView | null = null;
      if (effect.passes && effect.passes.length > 0) {
        prevPassView = this.runInternalPasses(encoder, effect, layer, readTexture.createView());
      }

      this.runEffectPass(encoder, effect, layer, readTexture.createView(), targetView, {
        applyMask: true,
        prevPassView,
      });

      if (!isLast) {
        readTexture = this.pingPong[writeIndex];
        writeIndex = 1 - writeIndex;
      }
    }

    device.queue.submit([encoder.finish()]);
  }

  /**
   * Runs an effect's internal pass chain (bright-pass extract, downsample,
   * upsample, etc. — see Glow's dual-filter bloom, Task 13) in sequence,
   * each into its own intermediate texture sized `width*scale × height*scale`
   * and formatted `ctx.srgbFormat` (color data, same as the ping-pong pair).
   * Masking is deliberately NOT applied to internal passes — they're pure
   * signal-processing steps feeding the final composite, which is the only
   * pass the user's painted mask should gate. Returns the view of the last
   * pass's output, to be bound as `prevPass` on the final composite pass.
   */
  private runInternalPasses(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView
  ): GPUTextureView {
    const { device, srgbFormat } = this.ctx;
    let passInputView = sourceView;
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
        { applyMask: false }
      );
      passInputView = passTargetView;
    }
    return passInputView;
  }

  private runEffectPass(
    encoder: GPUCommandEncoder,
    effect: EffectModule,
    layer: LayerState,
    sourceView: GPUTextureView,
    targetView: GPUTextureView,
    options: { applyMask?: boolean; prevPassView?: GPUTextureView | null } = {}
  ): void {
    const { applyMask = true, prevPassView = null } = options;
    const { device, srgbFormat } = this.ctx;
    const paramValues = new Float32Array(8);
    effect.params.forEach((p, idx) => {
      paramValues[idx] = layer.params[p.name] ?? p.default;
    });
    const paramBuffer = device.createBuffer({
      size: paramValues.byteLength,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    device.queue.writeBuffer(paramBuffer, 0, paramValues);

    const maskBinding = applyMask
      ? "@group(0) @binding(3) var maskTexture: texture_2d<f32>;"
      : "";
    const prevPassBinding = prevPassView
      ? "@group(0) @binding(4) var prevPass: texture_2d<f32>;"
      : "";
    const fsBody = applyMask
      ? `let maskValue = textureSample(maskTexture, srcSampler, in.uv).r;
  return mix(color, effected, maskValue);`
      : "return effected;";

    const shaderCode = `
${FULLSCREEN_VERTEX_WGSL}

@group(0) @binding(0) var srcTexture: texture_2d<f32>;
@group(0) @binding(1) var srcSampler: sampler;
@group(0) @binding(2) var<uniform> params: array<f32, 8>;
${maskBinding}
${prevPassBinding}

${effect.wgsl}

@fragment
fn fs_wrapper(in: VertexOut) -> @location(0) vec4<f32> {
  let color = textureSample(srcTexture, srcSampler, in.uv);
  let effected = fs_main(in.uv, color);
  ${fsBody}
}
`;
    const module = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createRenderPipeline({
      layout: "auto",
      vertex: { module, entryPoint: "vs_main" },
      fragment: { module, entryPoint: "fs_wrapper", targets: [{ format: srgbFormat }] },
    });
    const entries: GPUBindGroupEntry[] = [
      { binding: 0, resource: sourceView },
      { binding: 1, resource: this.sampler },
      { binding: 2, resource: { buffer: paramBuffer } },
    ];
    if (applyMask) {
      const maskTexture = this.uploadMask(layer.maskData);
      entries.push({ binding: 3, resource: maskTexture.createView() });
    }
    if (prevPassView) {
      entries.push({ binding: 4, resource: prevPassView });
    }
    const bindGroup = device.createBindGroup({
      layout: pipeline.getBindGroupLayout(0),
      entries,
    });

    const pass = encoder.beginRenderPass({
      colorAttachments: [
        { view: targetView, loadOp: "clear", storeOp: "store", clearValue: { r: 0, g: 0, b: 0, a: 1 } },
      ],
    });
    pass.setPipeline(pipeline);
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

  /**
   * Uploads a layer's mask into an r8unorm texture. A mask is a linear
   * 0..1 opacity weight, not color data, so it deliberately does NOT use
   * `ctx.srgbFormat` — treating it as sRGB would bias the falloff curve.
   * `maskData === null` (no mask painted) uploads a fully-opaque mask so
   * the effect applies everywhere, matching pre-Task-9 behavior.
   */
  private uploadMask(maskData: Uint8Array | null): GPUTexture {
    const { device } = this.ctx;
    const texture = device.createTexture({
      size: [this.width, this.height],
      format: "r8unorm",
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
    });
    const fullMask = maskData ?? new Uint8Array(this.width * this.height).fill(255);
    device.queue.writeTexture(
      { texture },
      fullMask as BufferSource,
      { bytesPerRow: this.width },
      [this.width, this.height]
    );
    return texture;
  }
}
