/**
 * Bruit pseudo-aléatoire partagé par les effets qui ont besoin d'une valeur
 * reproductible par point : `grain` (le grain lui-même), `sliceShift` (le
 * tirage par tranche) et `pixelStretch` (l'ondulation de la ligne source).
 *
 * Extrait de `grain.ts` le 2026-07-31, pour la même raison que `hsl.ts` l'avait
 * été de `duotone.ts` : trois copies d'une formule de hachage auraient dérivé.
 * Ici la conséquence d'une dérive serait sournoise — deux effets empilés
 * tireraient des motifs qui se corrèlent ou pas selon la copie, et le rendu
 * dépendrait de l'ordre d'écriture des fichiers plutôt que des réglages.
 *
 * `hash` est le classique « hash without sine » (Dave Hoskins, domaine public
 * via son shader `hash11`/`hash12` sur Shadertoy) : entièrement en arithmétique
 * flottante, sans `sin()`, donc SANS la dépendance à la précision du `sin` du
 * pilote qui fait qu'un même shader ne grène pas pareil sur deux GPU.
 *
 * `valueNoise` est l'interpolation bilinéaire lissée de ce hachage sur une
 * grille entière — un bruit CONTINU, à ne pas confondre avec `hash` qui saute à
 * chaque cellule. Choisir l'un pour l'autre est une erreur visible : du bruit
 * blanc là où on voulait une ondulation scintille, une ondulation là où on
 * voulait du bruit blanc fait des taches.
 *
 * `warp.ts` garde son propre `hash2` (vec2 -> vec2) : c'est une autre signature
 * pour un autre usage (un vecteur de gradient, pas un scalaire), pas une
 * quatrième copie de celle-ci.
 */
export const HASH_WGSL = `
fn hash(p: vec2<f32>) -> f32 {
  var p3 = fract(vec3<f32>(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
`;

export const VALUE_NOISE_WGSL = `
fn valueNoise(p: vec2<f32>) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2<f32>(1.0, 0.0)), u.x),
    mix(hash(i + vec2<f32>(0.0, 1.0)), hash(i + vec2<f32>(1.0, 1.0)), u.x),
    u.y
  );
}
`;
