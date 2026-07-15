/** Bounding box (in image pixels, inclusive-exclusive like a DOMRect) of the
 *  region a single `paintStroke()` call actually touched. A brush stroke
 *  only ever affects a small area — moving/uploading the FULL mask buffer
 *  per sample (26MB on a 24MP photo) at real-drag sampling rates was traced
 *  to a reproducible renderer OOM crash (2026-07-15); callers should use
 *  this to update only the touched region instead. */
export interface DirtyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class MaskPainter {
  private width: number;
  private height: number;
  private data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  paintStroke(x: number, y: number, radius: number, hardness: number, erase: boolean): DirtyRect {
    const minX = Math.max(0, Math.floor(x - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(x + radius));
    const minY = Math.max(0, Math.floor(y - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(y + radius));

    for (let py = minY; py <= maxY; py++) {
      for (let px = minX; px <= maxX; px++) {
        const dist = Math.hypot(px - x, py - y);
        if (dist > radius) continue;
        const falloffStart = radius * hardness;
        let strength = 1.0;
        if (dist > falloffStart) {
          strength = 1.0 - (dist - falloffStart) / Math.max(radius - falloffStart, 0.0001);
        }
        const idx = py * this.width + px;
        const delta = strength * 255;
        const current = this.data[idx];
        this.data[idx] = erase
          ? Math.max(0, current - delta)
          : Math.min(255, current + delta);
      }
    }

    return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  }

  getMaskData(): Uint8Array {
    return this.data;
  }

  clear(fill: 0 | 255): void {
    this.data.fill(fill);
  }

  loadFrom(data: Uint8Array): void {
    this.data.set(data);
  }
}
