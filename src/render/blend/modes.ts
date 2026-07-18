import type { BlendMode } from "./types";

// Séparables — corrects en espace linéaire.
export const normal: BlendMode = {
  id: "normal", name: "Normal",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return top; }`,
};
export const multiply: BlendMode = {
  id: "multiply", name: "Produit",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return base * top; }`,
};
export const screen: BlendMode = {
  id: "screen", name: "Écran",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return base + top - base * top; }`,
};
export const add: BlendMode = {
  id: "add", name: "Addition",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return min(base + top, vec3<f32>(1.0)); }`,
};
export const darken: BlendMode = {
  id: "darken", name: "Obscurcir",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return min(base, top); }`,
};
export const lighten: BlendMode = {
  id: "lighten", name: "Éclaircir",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return max(base, top); }`,
};

// Définis-gamma — décodent en sRGB, appliquent la formule Photoshop, ré-encodent.
// `srgb2lin`/`lin2srgb` sont injectés par shaderCompose.ts (helpers partagés).
export const overlay: BlendMode = {
  id: "overlay", name: "Incrustation",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let lo = 2.0 * b * t;
  let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - t);
  let r = select(hi, lo, b <= vec3<f32>(0.5));
  return srgb2lin(r);
}`,
};
export const hardLight: BlendMode = {
  id: "hard-light", name: "Lumière crue",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let lo = 2.0 * b * t;
  let hi = vec3<f32>(1.0) - 2.0 * (vec3<f32>(1.0) - b) * (vec3<f32>(1.0) - t);
  let r = select(hi, lo, t <= vec3<f32>(0.5));
  return srgb2lin(r);
}`,
};
export const softLight: BlendMode = {
  id: "soft-light", name: "Lumière tamisée",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let d = select(sqrt(b), ((16.0 * b - 12.0) * b + 4.0) * b, b <= vec3<f32>(0.25));
  let lo = b - (vec3<f32>(1.0) - 2.0 * t) * b * (vec3<f32>(1.0) - b);
  let hi = b + (2.0 * t - vec3<f32>(1.0)) * (d - b);
  let r = select(hi, lo, t <= vec3<f32>(0.5));
  return srgb2lin(r);
}`,
};
export const colorBurn: BlendMode = {
  id: "color-burn", name: "Densité couleur -",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let r = vec3<f32>(1.0) - min(vec3<f32>(1.0), (vec3<f32>(1.0) - b) / max(t, vec3<f32>(1e-4)));
  return srgb2lin(r);
}`,
};
export const colorDodge: BlendMode = {
  id: "color-dodge", name: "Densité couleur +",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let r = min(vec3<f32>(1.0), b / max(vec3<f32>(1.0) - t, vec3<f32>(1e-4)));
  return srgb2lin(r);
}`,
};
