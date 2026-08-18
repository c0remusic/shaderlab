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

// ── SIGNÉS ────────────────────────────────────────────────────────────────
//
// Arithmétique sur des QUANTITÉS DE LUMIÈRE, donc en linéaire — comme
// `multiply`/`screen`/`add`, et pour la même raison qu'eux.
//
// ⚠️ Ce n'est PAS ce que fait Photoshop, qui calcule tous ses modes sur des
// valeurs gamma. Le critère du dépôt n'est pas « ce que fait Photoshop » mais
// « l'opérateur a-t-il une lecture physique ? » : `multiply` est déjà en
// linéaire alors que Photoshop le fait en gamma, parce que multiplier deux
// transmittances FILTRE de la lumière. Une différence et une soustraction de
// lumière ont la même lecture ; `overlay` et consorts n'en ont aucune, d'où
// leur décodage explicite plus haut.
//
// Conséquence à connaître avant de comparer une capture à Photoshop : dans les
// ombres, l'écart calculé en linéaire ressort PLUS visible une fois ré-encodé,
// la courbe sRGB étant raide près de zéro. C'est un gain pour l'usage que le
// ticket 12 leur reconnaît — comparer deux états — et un écart de rendu pour
// l'usage créatif. La propriété qui compte dans les deux espaces est
// préservée : deux calques identiques rendent du noir.
export const difference: BlendMode = {
  id: "difference", name: "Différence",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return abs(base - top); }`,
};
export const subtract: BlendMode = {
  id: "subtract", name: "Soustraction",
  wgsl: `fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> { return max(base - top, vec3<f32>(0.0)); }`,
};

// ── NON SÉPARABLES ────────────────────────────────────────────────────────
//
// Les quatre modes qui recombinent teinte, saturation et luminosité de DEUX
// couleurs entières. Formules de la spec W3C « Compositing and Blending
// Level 1 », qui sont celles de Photoshop.
//
// Ils sont DÉFINIS-GAMMA, comme `overlay` et sa famille : leurs coefficients de
// luminosité (0,3 / 0,59 / 0,11) sont une luma perçue posée sur des valeurs
// ENCODÉES — elle n'a aucune lecture sur des quantités de lumière. Les
// appliquer en linéaire ne serait pas « plus correct », ce serait évaluer une
// formule hors de l'espace où elle a un sens.
//
// ⚠️ Ces helpers sont préfixés `blend_` parce que le corps est injecté DANS le
// shader composé (`shaderCompose.ts`), aux côtés des helpers d'effet. Un seul
// mode de fusion est injecté par pipeline, donc les quatre peuvent partager la
// même chaîne sans jamais se redéclarer entre eux.
const NON_SEPARABLES_HELPERS = `
fn blend_lum(c: vec3<f32>) -> f32 { return 0.3 * c.r + 0.59 * c.g + 0.11 * c.b; }
fn blend_sat(c: vec3<f32>) -> f32 {
  return max(c.r, max(c.g, c.b)) - min(c.r, min(c.g, c.b));
}
// Ramene la couleur dans [0,1] SANS bouger sa luminosite : c'est ce qui
// distingue ces modes d'un clamp par canal, qui la deplacerait.
fn blend_clip(c: vec3<f32>) -> vec3<f32> {
  let l = blend_lum(c);
  let n = min(c.r, min(c.g, c.b));
  let x = max(c.r, max(c.g, c.b));
  var r = c;
  if (n < 0.0) { r = l + (r - l) * l / max(l - n, 1e-6); }
  if (x > 1.0) { r = l + (r - l) * (1.0 - l) / max(x - l, 1e-6); }
  return r;
}
fn blend_set_lum(c: vec3<f32>, l: f32) -> vec3<f32> {
  return blend_clip(c + (l - blend_lum(c)));
}
fn blend_set_sat(c: vec3<f32>, s: f32) -> vec3<f32> {
  let cmin = min(c.r, min(c.g, c.b));
  let d = max(c.r, max(c.g, c.b)) - cmin;
  // A intervalle nul les trois canaux sont egaux : la spec les met a zero,
  // et diviser par d donnerait un NaN.
  return select(vec3<f32>(0.0), (c - cmin) * s / max(d, 1e-6), d > 0.0);
}
`;

/** Corps `blend` d'un mode non séparable, monté sur les helpers ci-dessus.
 *  `expr` est écrite sur `b` (base décodée) et `t` (top décodé), en sRGB.
 *  Le `clamp` avant ré-encodage est une ceinture : `blend_clip` borne déjà,
 *  mais `srgb2lin` sur une valeur négative évaluerait un `pow` de base
 *  négative. */
function nonSeparable(id: string, name: string, expr: string): BlendMode {
  return {
    id, name,
    wgsl: `${NON_SEPARABLES_HELPERS}
fn blend(base: vec3<f32>, top: vec3<f32>) -> vec3<f32> {
  let b = lin2srgb(base); let t = lin2srgb(top);
  let r = ${expr};
  return srgb2lin(clamp(r, vec3<f32>(0.0), vec3<f32>(1.0)));
}`,
  };
}

export const hue: BlendMode = nonSeparable(
  "hue", "Teinte",
  "blend_set_lum(blend_set_sat(t, blend_sat(b)), blend_lum(b))",
);
export const saturation: BlendMode = nonSeparable(
  "saturation", "Saturation",
  "blend_set_lum(blend_set_sat(b, blend_sat(t)), blend_lum(b))",
);
export const color: BlendMode = nonSeparable(
  "color", "Couleur",
  "blend_set_lum(t, blend_lum(b))",
);
export const luminosity: BlendMode = nonSeparable(
  "luminosity", "Luminosité",
  "blend_set_lum(b, blend_lum(t))",
);
