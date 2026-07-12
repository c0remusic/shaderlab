import type { Renderer } from "../render/renderer";
import type { LayerState } from "../layers/types";
import { writeImageFile } from "../launch";

export function buildCopyPath(sourcePath: string, existing: Set<string> = new Set()): string {
  const lastDot = sourcePath.lastIndexOf(".");
  const base = lastDot === -1 ? sourcePath : sourcePath.slice(0, lastDot);
  const ext = lastDot === -1 ? "" : sourcePath.slice(lastDot);
  let candidate = `${base}-edited${ext}`;
  let counter = 2;
  while (existing.has(candidate)) {
    candidate = `${base}-edited-${counter}${ext}`;
    counter += 1;
  }
  return candidate;
}

async function encodeJpeg(pixels: Uint8Array, width: number, height: number): Promise<Uint8Array> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  const imageData = new ImageData(new Uint8ClampedArray(pixels.buffer as ArrayBuffer), width, height);
  ctx.putImageData(imageData, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.95 });
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Renders the current layer stack and writes the result to `targetPath`.
 * Caller decides `targetPath`: a fresh copy path (manual export, via
 * buildCopyPath) or the exact Lightroom launch path (round-trip export,
 * per the design doc's contract — overwrite in place).
 *
 * Uses `renderer.exportFrame()`, NOT `render()` + `readPixels()`. `render()`
 * writes its final pass straight to the canvas, never into the ping-pong
 * buffers `readPixels()` reads from — calling `readPixels()` after
 * `render()` would return stale data from an intermediate pass, not the
 * actual final composited frame (a real bug flagged in Task 5's review).
 * `exportFrame()` reruns the same multi-pass pipeline targeting a dedicated
 * off-screen texture for every pass, including the last one, so its
 * readback is always correct.
 */
export async function exportImage(
  renderer: Renderer,
  layers: LayerState[],
  targetPath: string,
  width: number,
  height: number
): Promise<void> {
  const pixels = await renderer.exportFrame(layers);
  const jpegBytes = await encodeJpeg(pixels, width, height);
  await writeImageFile(targetPath, jpegBytes);
}
