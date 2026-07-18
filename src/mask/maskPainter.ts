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

/** Bounding-box union of two dirty rects — used by `paintLine` to combine
 *  the touched region of every interpolated dab along a segment. */
function unionRect(a: DirtyRect, b: DirtyRect): DirtyRect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  const right = Math.max(a.x + a.width, b.x + b.width);
  const bottom = Math.max(a.y + a.height, b.y + b.height);
  return { x, y, width: right - x, height: bottom - y };
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

  /**
   * Stamps a run of interpolated dabs from (fromX,fromY) to (toX,toY), so a
   * fast drag reads as a continuous stroke instead of isolated dots. A single
   * `paintStroke` per raw pointer sample leaves visible gaps whenever the
   * cursor travels farther between two samples than the brush diameter —
   * reported live (dotted/gapped trail on a real drag, 2026-07-18).
   *
   * Dabs are spaced at 25% of the brush radius (dense enough that
   * consecutive circles overlap and blend into a solid line — standard
   * "brush spacing" in painting tools). The FROM point itself is NOT
   * re-stamped: it was already painted by the previous call in the stroke
   * (or is the stroke's very first dab, painted separately) — a duplicate
   * dab there would be redundant, not incorrect, but wasted work.
   */
  paintLine(fromX: number, fromY: number, toX: number, toY: number, radius: number, hardness: number, erase: boolean): DirtyRect {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return this.paintStroke(toX, toY, radius, hardness, erase);

    const spacing = Math.max(1, radius * 0.25);
    const steps = Math.max(1, Math.ceil(distance / spacing));

    let touched: DirtyRect = this.paintStroke(toX, toY, radius, hardness, erase);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const rect = this.paintStroke(fromX + dx * t, fromY + dy * t, radius, hardness, erase);
      touched = unionRect(touched, rect);
    }
    return touched;
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
