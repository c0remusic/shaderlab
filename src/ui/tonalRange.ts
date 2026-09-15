export interface TonalRangeValues {
  shadowsMin: number; shadowsMax: number; highlightsMin: number; highlightsMax: number; tolerance?: number;
}

function smoothstep(a: number, b: number, x: number): number {
  if (a === b) return x < a ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

/** Miroir CPU exact de la réponse tonale WGSL, utilisé uniquement pour l'UI. */
export function tonalMembership(values: TonalRangeValues, luminance: number): number {
  const tolerance = Math.max(values.tolerance ?? 0.01, 0.001);
  const window = (min: number, max: number) =>
    smoothstep(min - tolerance, min + tolerance, luminance) *
    (1 - smoothstep(max - tolerance, max + tolerance, luminance));
  return Math.min(1, Math.max(0, Math.max(window(values.shadowsMin, values.shadowsMax), window(values.highlightsMin, values.highlightsMax))));
}

export function tonalCurvePath(values: TonalRangeValues, width: number, height: number, samples = 48): string {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const x = index / samples;
    const y = tonalMembership(values, x);
    return `${index === 0 ? "M" : "L"}${(x * width).toFixed(2)},${((1 - y) * height).toFixed(2)}`;
  }).join(" ");
}

/** Réponse d'une plage d'EFFET : montée, plateau, descente — distincte de
 * l'union de deux fenêtres utilisée par une source de masque. */
function effectTonalMembership(values: TonalRangeValues, luminance: number): number {
  return smoothstep(values.shadowsMin, values.shadowsMax, luminance) *
    (1 - smoothstep(values.highlightsMin, values.highlightsMax, luminance));
}

export function effectTonalCurvePath(values: TonalRangeValues, width: number, height: number, samples = 48): string {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const x = index / samples;
    return `${index === 0 ? "M" : "L"}${(x * width).toFixed(2)},${((1 - effectTonalMembership(values, x)) * height).toFixed(2)}`;
  }).join(" ");
}

export function clampTonalHandle(values: TonalRangeValues, key: keyof TonalRangeValues, raw: number): number {
  const bounds: Record<keyof TonalRangeValues, readonly [number, number]> = {
    shadowsMin: [0, values.shadowsMax], shadowsMax: [values.shadowsMin, values.highlightsMin],
    highlightsMin: [values.shadowsMax, values.highlightsMax], highlightsMax: [values.highlightsMin, 1], tolerance: [0, 1],
  };
  const [min, max] = bounds[key];
  return Math.min(max, Math.max(min, Math.round(raw * 100) / 100));
}
