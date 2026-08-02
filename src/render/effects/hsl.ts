/**
 * Conversion HSL -> RGB partagée par les effets qui exposent une couleur
 * utilisateur via `EffectParam.colorGroup` (trio teinte/saturation/luminosité).
 *
 * Extrait de `duotone.ts` le 2026-07-31, quand `glow` a eu besoin de la même
 * conversion pour la teinte de son halo. Deux copies de cette formule auraient
 * dérivé : la pastille de couleur du panneau (`ui/hsl.ts`, côté CSS) et le
 * shader doivent montrer la MÊME couleur, donc il ne peut y avoir qu'une seule
 * formule GPU.
 *
 * IMPORTANT — espace colorimétrique : ce que rend `hsl2rgb` est une couleur
 * PERCEPTUELLE (sRGB), exactement ce qu'affiche la pastille. Tout appelant qui
 * la mélange à des échantillons d'image doit la décoder d'abord
 * (`srgb_to_linear3`, voir `srgbTransfer.ts`) — les textures sont en format
 * `-srgb`, donc `textureSample` rend déjà du linéaire.
 */
export const HSL_TO_RGB_WGSL = `
fn hue2rgb(p: f32, q: f32, tIn: f32) -> f32 {
  var t = tIn;
  if (t < 0.0) { t = t + 1.0; }
  if (t > 1.0) { t = t - 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 1.0 / 2.0) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}
fn hsl2rgb(h: f32, s: f32, l: f32) -> vec3<f32> {
  if (s == 0.0) { return vec3<f32>(l, l, l); }
  let q = select(l + s - l * s, l * (1.0 + s), l < 0.5);
  let p = 2.0 * l - q;
  return vec3<f32>(
    hue2rgb(p, q, h + 1.0 / 3.0),
    hue2rgb(p, q, h),
    hue2rgb(p, q, h - 1.0 / 3.0),
  );
}
`;

/**
 * Jumeau TS de `hsl2rgb`, ligne pour ligne — même rôle que `inputDriver` pour
 * `input_driver`. Il existe pour que la spécification pure d'un effet
 * (`channelMixSpec` et consorts) puisse être testée sans GPU alors qu'elle lit
 * une couleur de picker.
 *
 * À NE PAS CONFONDRE avec `ui/hsl.ts::hslToRgb`, qui est la variante du
 * PANNEAU : même résultat, écriture optimisée pour redessiner le carré du
 * sélecteur, et surtout de l'autre côté de la frontière de couches. Un effet ne
 * remonte pas vers `ui/`.
 *
 * `h` est en TOURS (0..1), comme le WGSL — pas en degrés. Les paramètres
 * `colorGroup` sont, eux, en degrés : la division par 360 se fait à l'appel,
 * des deux côtés.
 */
export function hsl2rgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) return [l, l, l];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = (t0: number): number => {
    let t = t0;
    if (t < 0) t = t + 1;
    if (t > 1) t = t - 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)];
}
