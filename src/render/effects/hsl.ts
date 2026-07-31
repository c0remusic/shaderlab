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
