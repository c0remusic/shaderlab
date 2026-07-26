/** Interpolation d'un canal sur la roue des teintes — détail interne de
 *  `hslToRgb`, jamais appelé directement ailleurs. */
function hue2rgb(p: number, q: number, tIn: number): number {
  let t = tIn;
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** HSL -> RGB en composantes 0..1, SANS passer par une chaîne. Chemin chaud du
 *  carré du sélecteur de couleur, qui recalcule 19 600 pixels à chaque
 *  changement de teinte : la version qui passait par `hslToHex` puis
 *  `parseInt` mesurait 4,65 ms par redessin contre 0,76 ms ici (mesuré dans la
 *  vraie fenêtre, 2026-07-26) — 6x, sur un budget d'image de 16,6 ms. */
export function hslToRgb(hueDeg: number, saturation: number, lightness: number): { r: number; g: number; b: number } {
  const h = (((hueDeg % 360) + 360) % 360) / 360;
  const s = Math.min(1, Math.max(0, saturation));
  const l = Math.min(1, Math.max(0, lightness));

  if (s === 0) return { r: l, g: l, b: l };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return {
    r: hue2rgb(p, q, h + 1 / 3),
    g: hue2rgb(p, q, h),
    b: hue2rgb(p, q, h - 1 / 3),
  };
}

/** HSL -> chaîne "#rrggbb", pour l'aperçu des pastilles de couleur du panneau
 *  Réglages. Reprend le helper WGSL `hsl2rgb()` de duotone.ts — même algorithme,
 *  tenu synchronisé à la main, GPU et UI ne pouvant pas partager de source. */
export function hslToHex(hueDeg: number, saturation: number, lightness: number): string {
  const { r, g, b } = hslToRgb(hueDeg, saturation, lightness);
  const toHex = (v: number) => Math.round(v * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Converts a "#rrggbb" (or "rrggbb") hex string to HSL (hue in degrees,
 *  saturation/lightness in 0..1) — inverse of hslToHex, used by
 *  ColorPickerPanel's hex input field. */
export function hexToHsl(hex: string): { hue: number; saturation: number; lightness: number } {
  const clean = hex.replace(/^#/, "");
  const r = parseInt(clean.slice(0, 2), 16) / 255;
  const g = parseInt(clean.slice(2, 4), 16) / 255;
  const b = parseInt(clean.slice(4, 6), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const lightness = (max + min) / 2;

  if (max === min) {
    return { hue: 0, saturation: 0, lightness };
  }

  const delta = max - min;
  const saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min);

  let hue: number;
  switch (max) {
    case r:
      hue = ((g - b) / delta) % 6;
      break;
    case g:
      hue = (b - r) / delta + 2;
      break;
    default:
      hue = (r - g) / delta + 4;
      break;
  }
  hue *= 60;
  if (hue < 0) hue += 360;

  return { hue, saturation, lightness };
}
