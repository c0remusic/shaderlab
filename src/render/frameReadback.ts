/**
 * WebGPU requires texture-to-buffer copies to use 256-byte-aligned row
 * strides. This adapter owns that transport detail and the short-lived
 * MAP_READ buffer used to cross the GPU/CPU boundary.
 */
export class FrameReadback {
  constructor(
    private readonly device: GPUDevice,
    private readonly width: number,
    private readonly height: number,
    /** True when the source texture's native storage is a `bgra*` format
     *  (WebGPU's preferred canvas format on Windows/D3D12 — see
     *  gpuContext.ts:69). `copyTextureToBuffer` inherits that native byte
     *  layout (B,G,R,A per pixel) verbatim; downstream consumers (Canvas
     *  `ImageData`, JPEG encoding) always assume R,G,B,A. Without the swap
     *  below, every export produced on a bgra* platform has red and blue
     *  inverted (real bug: exported photo came out with a blue cast, found
     *  via visual checkpoint 2026-07-24 — the on-screen canvas is unaffected
     *  since WebGPU's own presentation pipeline already knows the native
     *  layout; only this manual CPU-side readback needs the correction). */
    private readonly swapRedBlue: boolean = false,
  ) {}

  /** Computes the padded RGBA row stride required by copyTextureToBuffer. */
  paddedBytesPerRow(): number {
    return paddedBytesPerRow(this.width);
  }

  /**
   * Returns RGBA pixels with WebGPU row padding intact. Call
   * `stripRowPadding` when a consumer needs tightly-packed rows.
   *
   * `origin` selects the top-left texel of the sub-rectangle to read; the
   * region read is always `this.width × this.height` from there. Default
   * `(0,0)` reads the whole texture — the pre-crop behaviour. A cropped export
   * (canvas frame, ticket 32) constructs the readback at the frame's
   * dimensions and passes the frame's origin, so the bytes returned are exactly
   * the sub-rectangle of the full composited texture — never a re-render in a
   * shifted space.
   */
  async readTextureBytes(
    texture: GPUTexture,
    origin: { x: number; y: number } = { x: 0, y: 0 },
  ): Promise<Uint8Array> {
    const bytesPerRow = this.paddedBytesPerRow();
    const buffer = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture, origin: { x: origin.x, y: origin.y, z: 0 } }, { buffer, bytesPerRow }, [
      this.width,
      this.height,
    ]);
    this.device.queue.submit([encoder.finish()]);

    try {
      await buffer.mapAsync(GPUMapMode.READ);
      const data = new Uint8Array(buffer.getMappedRange().slice(0));
      buffer.unmap();
      return data;
    } finally {
      // A lost device can reject mapAsync. The buffer must still be released
      // in that case, otherwise each failed export leaks a GPU allocation.
      buffer.destroy();
    }
  }

  /** Removes WebGPU's per-row alignment padding from an RGBA pixel buffer. */
  stripRowPadding(padded: Uint8Array): Uint8Array {
    const bytesPerRow = this.paddedBytesPerRow();
    const tightRowBytes = this.width * 4;
    if (bytesPerRow === tightRowBytes) return padded;

    const out = new Uint8Array(tightRowBytes * this.height);
    for (let row = 0; row < this.height; row++) {
      out.set(
        padded.subarray(row * bytesPerRow, row * bytesPerRow + tightRowBytes),
        row * tightRowBytes,
      );
    }
    return out;
  }

  /** Swaps R and B per pixel — see the `swapRedBlue` constructor param for
   *  why. No-op (returns the input unchanged) when the source texture is
   *  already rgba*. */
  swapRedBlueChannels(pixels: Uint8Array): Uint8Array {
    if (!this.swapRedBlue) return pixels;
    const out = new Uint8Array(pixels.length);
    for (let i = 0; i < pixels.length; i += 4) {
      out[i] = pixels[i + 2];
      out[i + 1] = pixels[i + 1];
      out[i + 2] = pixels[i];
      out[i + 3] = pixels[i + 3];
    }
    return out;
  }
}

/** Computes the 256-byte-aligned stride for one RGBA pixel row. */
export function paddedBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / 256) * 256;
}
