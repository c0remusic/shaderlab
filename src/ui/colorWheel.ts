/**
 * Géométrie PURE de la roue chromatique (`ColorWheelControl`, ticket 06) — même
 * rôle que `ui/colorRamp.ts` pour la rampe : la conversion point ↔ (teinte,
 * saturation) sort du composant pour être testée sans DOM.
 *
 * Convention d'angle : teinte 0° à DROITE (3 h), croissant dans le sens
 * TRIGONOMÉTRIQUE (anti-horaire à l'écran). L'axe y de l'écran descend, d'où le
 * `-dy`. C'est un `Math.atan2` JS — le bandeau d'interdiction d'`atan2` ne vise
 * que le WGSL (bug Dawn), pas le pilotage d'un contrôle.
 */

export interface HueSat {
  /** Teinte 0..360. */
  hue: number;
  /** Saturation 0..100. */
  saturation: number;
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const wrap360 = (deg: number) => ((deg % 360) + 360) % 360;

/** Décalage (dx, dy) du centre, en pixels, vers (teinte, saturation). `radius` est
 *  le rayon utile de la roue en pixels ; la saturation sature à 100 au bord. */
export function pointToHueSat(dx: number, dy: number, radius: number): HueSat {
  const hue = wrap360((Math.atan2(-dy, dx) * 180) / Math.PI);
  const saturation = radius > 0 ? clamp((Math.hypot(dx, dy) / radius) * 100, 0, 100) : 0;
  return { hue, saturation };
}

/** (teinte, saturation) vers le décalage (x, y) du centre, en pixels. Inverse
 *  exact de `pointToHueSat` pour toute saturation ≤ 100. */
export function hueSatToPoint(hue: number, saturation: number, radius: number): { x: number; y: number } {
  const r = clamp(saturation, 0, 100) / 100 * radius;
  const angle = (wrap360(hue) * Math.PI) / 180;
  return { x: r * Math.cos(angle), y: -r * Math.sin(angle) };
}

/** Petit pas clavier sur la roue : `dHue` en degrés, `dSat` en points de
 *  saturation. Borne la saturation à 0..100 et replie la teinte sur 0..360. */
export function nudgeHueSat(current: HueSat, dHue: number, dSat: number): HueSat {
  return {
    hue: wrap360(current.hue + dHue),
    saturation: clamp(current.saturation + dSat, 0, 100),
  };
}
