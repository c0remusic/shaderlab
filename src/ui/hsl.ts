/** Converts HSL (hue in degrees, saturation/lightness in 0..1) to a "#rrggbb"
 *  hex string, for swatch previews in ParamPanel color-group controls. Mirrors
 *  the hsl2rgb() WGSL helper in duotone.ts — same algorithm, kept in sync by
 *  hand since GPU and UI code can't share a source file across languages.
 */
export function hslToHex(hueDeg: number, saturation: number, lightness: number): string {
  const h = (((hueDeg % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));

  const hue2rgb = (p: number, q: number, tIn: number): number => {
    let t = tIn;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }

  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}
