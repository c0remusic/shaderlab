import type { EffectModule } from "./types";

export const duotone: EffectModule = {
  id: "duotone",
  name: "Duotone",
  params: [
    { name: "shadowHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 350, step: 1, colorGroup: { key: "shadow", role: "hue", label: "Ombres" } },
    { name: "shadowSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.65, step: 0.01, colorGroup: { key: "shadow", role: "saturation", label: "Ombres" } },
    { name: "shadowLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, colorGroup: { key: "shadow", role: "lightness", label: "Ombres" } },
    { name: "midtoneHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 30, step: 1, colorGroup: { key: "midtone", role: "hue", label: "Ton moyen" } },
    { name: "midtoneSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "midtone", role: "saturation", label: "Ton moyen" } },
    { name: "midtoneLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "midtone", role: "lightness", label: "Ton moyen" } },
    { name: "highlightHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 220, step: 1, colorGroup: { key: "highlight", role: "hue", label: "Hautes lumières" } },
    { name: "highlightSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "highlight", role: "saturation", label: "Hautes lumières" } },
    { name: "highlightLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "highlight", role: "lightness", label: "Hautes lumières" } },
    { name: "contrast", label: "Contraste (écrasement)", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, hint: "0 = dégradé doux entre les trois teintes, 1 = bascules dures (aplats nets)" },
    { name: "pivot", label: "Pivot (ton moyen)", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Position du ton moyen sur l'axe de luminosité — décale l'équilibre ombres/hautes lumières" },
  ],
  wgsl: `
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
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let shadowColor = hsl2rgb(params[0] / 360.0, params[1], params[2]);
  let midtoneColor = hsl2rgb(params[3] / 360.0, params[4], params[5]);
  let highlightColor = hsl2rgb(params[6] / 360.0, params[7], params[8]);
  let contrast = params[9];
  let pivot = params[10];
  // Luma en espace linéaire (le format de texture -srgb a déjà décodé le sRGB
  // à l'échantillonnage) — même convention que les autres effets du registry.
  let luma = dot(color.rgb, vec3<f32>(0.2126, 0.7152, 0.0722));
  // Deux bascules symétriques autour du pivot : ombres->ton moyen à
  // pivot-0.3, ton moyen->hautes lumières à pivot+0.3. contrast=0 -> bascules
  // larges et douces ; contrast=1 -> bascules quasi instantanées (aplats).
  let halfSpan = 0.15 * (1.0 - contrast);
  let center1 = pivot - 0.3;
  let center2 = pivot + 0.3;
  let t1 = smoothstep(center1 - halfSpan, center1 + max(halfSpan, 0.0001), luma);
  let t2 = smoothstep(center2 - halfSpan, center2 + max(halfSpan, 0.0001), luma);
  let lowMid = mix(shadowColor, midtoneColor, t1);
  let result = mix(lowMid, highlightColor, t2);
  return vec4<f32>(result, color.a);
}
`,
};
