/**
 * Noyaux de la chaîne de flou pyramidale, partagés par les effets qui étalent
 * de la lumière : `glow` (bloom) et `halation`.
 *
 * Extraits de `glow.ts` le 2026-08-01, pour la raison qui a déjà sorti `hash.ts`
 * de `grain.ts` et `hsl.ts` de `duotone.ts` : deux copies d'un noyau auraient
 * dérivé. Ici la conséquence serait particulièrement sournoise — deux effets
 * empilés étaleraient la lumière selon deux profils légèrement différents, et
 * l'écart se lirait comme un défaut d'optique alors qu'il ne serait qu'un défaut
 * de copier-coller.
 *
 * Ces noyaux ne s'utilisent QUE dans des passes internes (`EffectPass.wgsl`),
 * jamais dans la passe finale : ils lisent `srcTexture`, qui pour une passe
 * interne est la sortie de la passe précédente.
 */

/**
 * Noyau de réduction dual-filter (ARM / Marius Bjørge, « Bandwidth-Efficient
 * Rendering », SIGGRAPH 2015) — moyenne 4 taps des diagonales plus le texel
 * central, pondérée pour conserver l'énergie à travers la division par deux de
 * la résolution.
 *
 * L'écartement des taps reste FIXE à un texel, et n'est PAS piloté par une
 * portée : une réduction de résolution doit rester échantillonnée serré, sinon
 * elle crépite (aliasing) au lieu de flouter. La portée agit uniquement sur la
 * remontée, exactement comme le `sampleScale` d'un bloom de moteur.
 */
export const DOWNSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  let o = texel * 1.0;
  var sum = textureSample(srcTexture, srcSampler, uv).rgb * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb;
  return vec4<f32>(sum / 8.0, 1.0);
}
`;

/**
 * Moyenne de Karis (Brian Karis, via Jorge Jimenez, « Next Generation Post
 * Processing in Call of Duty: Advanced Warfare », SIGGRAPH 2014).
 *
 * LE PROBLÈME. Un sous-pixel très brillant — reflet spéculaire, éclat sur de
 * l'eau, LED — passe le bright-pass presque intact. La chaîne de réduction
 * l'étale ensuite sur des dizaines de pixels : un point isolé devient une tache
 * pâle et large qui n'existe nulle part dans la photo. C'est le « firefly ».
 *
 * LE REMÈDE. Pondérer chaque tap par 1/(1+luma) avant de moyenner : un tap deux
 * fois plus lumineux que ses voisins pèse près de deux fois moins. La moyenne
 * cesse d'être dominée par son échantillon le plus extrême.
 *
 * POURQUOI SEULEMENT AU PREMIER NIVEAU. Cette pondération n'est PAS
 * conservatrice en énergie — elle sous-pondère délibérément les hautes lumières.
 * Posée à tous les niveaux elle assombrirait tout le halo, retirant au bloom ce
 * qu'il est censé rendre. Un seul niveau suffit : passé la première réduction,
 * le firefly est déjà moyenné avec ses voisins et n'est plus un point isolé.
 *
 * La somme est divisée par la somme des poids RÉELLEMENT appliqués, pas par la
 * constante 8 du noyau non pondéré. Diviser par 8 ferait fuir l'énergie
 * proportionnellement à la luminosité locale : une zone claire s'assombrirait
 * deux fois, une par la pondération et une par le dénominateur figé.
 *
 * Luma prise en LINÉAIRE — le format de texture -srgb décode déjà à
 * l'échantillonnage, et aucun gamma manuel n'entre en WGSL dans ce projet.
 */
export const DOWNSAMPLE_KARIS_WGSL = `
fn karisWeight(c: vec3<f32>) -> f32 {
  return 1.0 / (1.0 + dot(c, vec3<f32>(0.2126, 0.7152, 0.0722)));
}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  let o = texel * 1.0;
  let c0 = textureSample(srcTexture, srcSampler, uv).rgb;
  let c1 = textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb;
  let c2 = textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb;
  let c3 = textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb;
  let c4 = textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb;
  let w0 = 4.0 * karisWeight(c0);
  let w1 = karisWeight(c1);
  let w2 = karisWeight(c2);
  let w3 = karisWeight(c3);
  let w4 = karisWeight(c4);
  let sum = c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3 + c4 * w4;
  return vec4<f32>(sum / max(w0 + w1 + w2 + w3 + w4, 0.0001), 1.0);
}
`;

/**
 * Noyau de remontée : tente 3x3 canonique (1-2-1 / 2-4-2 / 1-2-1, somme 16),
 * échantillonnée sur la texture PLUS PETITE (l'entrée) à la résolution PLUS
 * GRANDE (la sortie) — c'est cette relecture élargie qui produit la chute douce
 * et large, au lieu d'un simple agrandissement net.
 *
 * POURQUOI LE TAP CENTRAL EST OBLIGATOIRE (correctif `0643c53`). Le noyau
 * précédent était un anneau de 8 taps SANS centre, à un demi-texel. Ce
 * demi-texel n'était pas esthétique : il compensait l'absence de centre. Mesuré
 * sur une impulsion unité, un anneau posé à un texel entier ne laissait que
 * 1,0 % de l'énergie sur le texel d'origine — les taps diagonaux tombant pile
 * sur des centres de texels voisins, la bilinéaire ne ramenait presque rien du
 * centre ; à un demi-texel il en gardait 19,8 %.
 *
 * Conséquence qui bloquait tout : l'écartement n'était PAS réglable. Le
 * multiplier par une portée utilisateur ramenait l'anneau sur des centres de
 * texels et rouvrait exactement ce trou. Le tap central explicite (poids
 * 4/16 = 25 %) supprime la dépendance : quelle que soit la portée, un quart de
 * l'énergie reste au centre par construction, et il n'y a plus de « coquille
 * trouée » possible. C'est ce qui rend le paramètre de portée sûr à exposer.
 *
 * @param spreadParamIndex index du paramètre de portée dans le tableau `params`
 *   de l'effet appelant. Paramétré plutôt que figé : glow et halation n'ont pas
 *   la même liste de paramètres, et un index recopié en dur dans un noyau
 *   partagé lirait le mauvais curseur au premier réordonnancement — panne
 *   silencieuse, le shader compilant parfaitement.
 */
export function upsampleWgsl(spreadParamIndex: number): string {
  return `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  // Portée : écartement des taps EN TEXELS de l'entrée. Bornée en dur en plus
  // du min du paramètre — un 0 laisserait les neuf taps sur le même point,
  // c'est-à-dire une copie, et l'effet disparaîtrait sans rien dire.
  let o = texel * max(params[${spreadParamIndex}], 0.05);
  var sum = textureSample(srcTexture, srcSampler, uv).rgb * 4.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  0.0)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  0.0)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( 0.0, -o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( 0.0,  o.y)).rgb * 2.0;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x, -o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>(-o.x,  o.y)).rgb;
  sum = sum + textureSample(srcTexture, srcSampler, uv + vec2<f32>( o.x,  o.y)).rgb;
  return vec4<f32>(sum / 16.0, 1.0);
}
`;
}
