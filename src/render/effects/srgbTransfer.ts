/**
 * Fonctions de transfert sRGB <-> linéaire, partagées par les effets.
 *
 * Rappel de la chaîne colorimétrique du projet (CLAUDE.md § Stack) : toutes
 * les textures couleur sont au format `-srgb`, donc `textureSample` rend déjà
 * du LINÉAIRE et l'écriture dans la cible ré-encode en sRGB automatiquement.
 * Il ne faut JAMAIS ajouter de gamma manuel sur l'échantillon d'image.
 *
 * Ce que ces helpers corrigent est l'asymétrie inverse : un seuil posé par un
 * slider ou une couleur choisie dans un color picker est une valeur
 * PERCEPTUELLE (sRGB), aujourd'hui comparée ou mélangée à des valeurs
 * LINÉAIRES venues de `textureSample`. On convertit donc la CONSTANTE ou la
 * COULEUR D'ENTRÉE vers le linéaire au moment de l'usage — jamais l'image.
 *
 * `linear_to_srgb` (OETF) reste l'exception documentée par le précédent
 * duotone (`bb114f3`) : il ne sert qu'à POSITIONNER une bascule/une courbe de
 * réponse sur l'axe perceptuel, jamais à modifier une valeur de couleur.
 *
 * Les variantes WGSL et les variantes TS ci-dessous implémentent la MÊME
 * formule : les tests verrouillent les nombres côté TS, les shaders
 * référencent la constante WGSL — pas de seconde formule qui puisse dériver.
 */

/** Décodage sRGB (EOTF) : valeur PERCEPTUELLE -> valeur LINÉAIRE. */
export function srgbToLinear(c: number): number {
  const x = Math.max(c, 0);
  return x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
}

/** Encodage sRGB (OETF) : valeur LINÉAIRE -> valeur PERCEPTUELLE. */
export function linearToSrgb(c: number): number {
  const x = Math.max(c, 0);
  return x <= 0.0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - 0.055;
}

/** Décodage sRGB (EOTF) : convertit une valeur PERCEPTUELLE (seuil de slider,
 *  couleur de picker) en valeur LINÉAIRE, comparable/mélangeable aux
 *  échantillons rendus par `textureSample` sur une texture `-srgb`. */
export const SRGB_TO_LINEAR_WGSL = `
fn srgb_to_linear(c: f32) -> f32 {
  let x = max(c, 0.0);
  return select(pow((x + 0.055) / 1.055, 2.4), x / 12.92, x <= 0.04045);
}
`;

/** Variante composante par composante de `srgb_to_linear`, pour une couleur
 *  entière fournie par l'utilisateur. Requiert `SRGB_TO_LINEAR_WGSL`. */
export const SRGB_TO_LINEAR_VEC3_WGSL = `
fn srgb_to_linear3(c: vec3<f32>) -> vec3<f32> {
  return vec3<f32>(srgb_to_linear(c.r), srgb_to_linear(c.g), srgb_to_linear(c.b));
}
`;

/** Encodage sRGB (OETF) : convertit une luminance LINÉAIRE en luminance
 *  PERCEPTUELLE. Utilisé uniquement pour POSITIONNER des bascules/courbes de
 *  réponse tonales, pas pour la couleur elle-même — le mélange reste linéaire,
 *  conformément à la décision projet "jamais de gamma manuel sur les valeurs
 *  de couleur". */
export const LINEAR_TO_SRGB_WGSL = `
fn linear_to_srgb(c: f32) -> f32 {
  let x = max(c, 0.0);
  return select(1.055 * pow(x, 1.0 / 2.4) - 0.055, x * 12.92, x <= 0.0031308);
}
`;
