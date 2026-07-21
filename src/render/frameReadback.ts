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
  ) {}

  /** Computes the padded RGBA row stride required by copyTextureToBuffer. */
  paddedBytesPerRow(): number {
    return paddedBytesPerRow(this.width);
  }

  /**
   * Returns RGBA pixels with WebGPU row padding intact. Call
   * `stripRowPadding` when a consumer needs tightly-packed rows.
   */
  async readTextureBytes(texture: GPUTexture): Promise<Uint8Array> {
    const bytesPerRow = this.paddedBytesPerRow();
    const buffer = this.device.createBuffer({
      size: bytesPerRow * this.height,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
    });
    const encoder = this.device.createCommandEncoder();
    encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow }, [
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
}

/** Computes the 256-byte-aligned stride for one RGBA pixel row. */
export function paddedBytesPerRow(width: number): number {
  return Math.ceil((width * 4) / 256) * 256;
}
