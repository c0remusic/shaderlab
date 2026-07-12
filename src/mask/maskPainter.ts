export class MaskPainter {
  private width: number;
  private height: number;
  private data: Uint8Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8Array(width * height);
  }

  paintStroke(x: number, y: number, radius: number, hardness: number, erase: boolean): void {
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
  }

  getMaskData(): Uint8Array {
    return this.data;
  }

  clear(fill: 0 | 255): void {
    this.data.fill(fill);
  }
}
