import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { SRGB_TO_LINEAR_VEC3_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";

/**
 * Dual-filter downsample kernel (ARM/Marius Bjørge, "Bandwidth-Efficient
 * Rendering", SIGGRAPH 2015) — a 4-tap box average of the texel's diagonal
 * neighbors plus itself, weighted so it stays energy-preserving across the
 * resolution halving. Reused at every downsample step of the bloom chain.
 *
 * L'écartement des taps reste FIXE à un texel, et n'est PAS piloté par le
 * paramètre de portée : une réduction de résolution doit rester échantillonnée
 * serré, sinon elle crépite (aliasing) au lieu de flouter. La portée agit
 * uniquement sur la remontée (voir UPSAMPLE_WGSL), exactement comme le
 * `sampleScale` d'un bloom de moteur.
 */
const DOWNSAMPLE_WGSL = `
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
 * Noyau de remontée : TENTE 3x3 canonique (1-2-1 / 2-4-2 / 1-2-1, somme 16),
 * échantillonnée sur la texture PLUS PETITE (l'entrée) à la résolution PLUS
 * GRANDE (la sortie) — c'est cette relecture élargie qui produit la chute
 * douce et large, au lieu d'un simple agrandissement net.
 *
 * ÉCART AVEC LA VERSION PRÉCÉDENTE, et pourquoi. L'ancien noyau était un
 * anneau de 8 taps SANS tap central (poids 1/2/1/2/… , somme 12), à un
 * demi-texel. Ce demi-texel n'était pas un choix esthétique : il compensait
 * l'absence de tap central. Mesuré à l'époque sur une impulsion unité, un
 * anneau posé à un texel entier ne laissait que 1,0 % de l'énergie sur le
 * texel d'origine (les taps diagonaux tombant pile sur des centres de texels
 * voisins, la bilinéaire ne ramenait presque rien du centre) ; à un demi-texel
 * il en gardait 19,8 %.
 *
 * Ce montage a une conséquence qui bloquait tout : l'écartement des taps
 * n'était PAS réglable. Le multiplier par une portée utilisateur ramenait
 * l'anneau sur des centres de texels et rouvrait exactement le trou mesuré.
 * Le tap central explicite (poids 4/16 = 25 %) supprime la dépendance : quelle
 * que soit la portée, un quart de l'énergie reste au centre par construction,
 * et il n'y a plus de « coquille trouée » possible. C'est ce qui rend le
 * paramètre `spread` (params[3]) sûr à exposer.
 */
const UPSAMPLE_WGSL = `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let texel = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  // Portée : écartement des taps EN TEXELS de l'entrée. Bornée en dur en plus
  // du min du paramètre — un 0 laisserait les neuf taps sur le même point,
  // c'est-à-dire une copie, et l'effet disparaîtrait sans rien dire.
  let o = texel * max(params[3], 0.05);
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

/**
 * Glow : bloom dual-filter.
 *
 * CHAÎNE (2026-07-31) — descend jusqu'à 1/64 de l'image, remonte
 * symétriquement :
 *   bright-pass 1/2 -> 1/4 -> 1/8 -> 1/16 -> 1/32 -> 1/64
 *               -> 1/32 -> 1/16 -> 1/8 -> 1/4 -> 1/2 -> composite pleine taille
 *
 * POURQUOI PLUS PROFOND. La chaîne précédente s'arrêtait à 1/8. Chaque noyau
 * lit `textureDimensions` de son ENTRÉE, donc son rayon en pixels pleine
 * résolution vaut 1/échelle-d'entrée. L'ancienne chaîne totalisait
 * 2 + 4 + 8 + 4 = ~18 px de halo, soit 0,3 % de la largeur d'une photo de
 * 6240 px — quelle que soit la position des deux curseurs. Un « bloom » qui
 * ne dépasse pas 18 px sur 6240 n'est pas un halo, c'est un contour.
 *
 * RAYON DE LA NOUVELLE CHAÎNE, en pixels pleine résolution :
 *   descentes (écartement fixe) : 2 + 4 + 8 + 16 + 32          = 62
 *   remontées (x portée s)      : (64 + 32 + 16 + 8 + 4) * s   = 124 * s
 *   total = 62 + 124 * s  ->  s=0.4 : ~112 px | s=1.2 (défaut) : ~211 px
 *                             s=3.0 : ~434 px
 * Sur 6240 px de large : 3,4 % de la largeur au défaut, jusqu'à 7 %. Contre
 * 0,3 % avant, sans réglage possible.
 *
 * COÛT. Les cinq niveaux ajoutés pèsent 1/16, 1/64, 1/256… de la surface du
 * premier : sur une photo 6240x4160 ils ajoutent ~1 Mo de textures
 * intermédiaires à des ~67 Mo déjà alloués par la chaîne d'avant, et une
 * fraction de pour-cent des pixels traités. La profondeur est quasi gratuite ;
 * c'est son absence qui coûtait.
 *
 * POURQUOI LA PORTÉE AGIT SUR LE NOYAU ET NON SUR LE NOMBRE DE PASSES.
 * `passes` est un tableau STATIQUE du module d'effet, lu tel quel par
 * `EffectPassRunner.runInternalPasses` : le nombre de passes ne peut pas
 * dépendre d'un paramètre sans changer le moteur. Une pondération par niveau
 * n'est pas non plus accessible — la chaîne est strictement séquentielle et
 * seule la DERNIÈRE passe est exposée au composite (`prevPass`), les niveaux
 * intermédiaires sont détruits au fil de l'eau. Reste l'écartement des taps,
 * qui est exactement le `sampleScale` d'un bloom de moteur, et qui a le mérite
 * d'être continu plutôt que par paliers de puissance de deux.
 */
export const glow: EffectModule = {
  id: "glow",
  name: "Glow",
  params: [
    // Défaut abaissé de 0.70 à 0.55 (2026-07-31) : à 0.70 perceptuel (0.448
    // linéaire) le bloom n'attrapait que les hautes lumières franches. À 0.55
    // (0.264 linéaire) il prend aussi les demi-tons clairs — peaux, ciels,
    // reflets — qui sont ce qui fait lire un halo comme de la lumière.
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, hint: "Luminosité à partir de laquelle un pixel alimente le halo" },
    { name: "knee", label: "Douceur du seuil", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, hint: "0 = bascule franche au seuil, 1 = entrée très progressive (les demi-tons contribuent un peu)" },
    // Plafond monté de 3 à 6 : le bright-pass ne laisse entrer qu'une FRACTION
    // de chaque pixel (voir la passe 0), et cette fraction est ensuite étalée
    // sur toute la surface du noyau. Un plafond de 3 bornait donc le halo bien
    // avant que l'utilisateur ne le juge trop fort.
    { name: "intensity", label: "Intensité", unit: "none", min: 0, max: 6, default: 1.6, step: 0.05 },
    { name: "spread", label: "Portée du halo", unit: "none", min: 0.4, max: 3, default: 1.2, step: 0.05, hint: "Écartement des taps de remontée — rayon ≈ 62 + 124 x portée, en pixels pleine résolution" },
    { name: "tintHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 35, step: 1, colorGroup: { key: "tint", role: "hue", label: "Teinte du halo" } },
    { name: "tintSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "tint", role: "saturation", label: "Teinte du halo" } },
    { name: "tintLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, colorGroup: { key: "tint", role: "lightness", label: "Teinte du halo" } },
    { name: "tintStrength", label: "Force de la teinte", unit: "percent", min: 0, max: 1, default: 0.15, step: 0.01, hint: "0 = halo neutre (couleur de la source) ; 1 = halo entièrement recoloré" },
  ],
  passes: [
    {
      // Bright-pass extract at half resolution: keep only the part of each
      // channel above `threshold`, scaled back onto the original color so
      // hue is preserved in the bloom.
      scale: 0.5,
      wgsl: `${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Le seuil vient d'un slider : c'est une valeur PERCEPTUELLE (sRGB), alors
  // que \`brightness\` est LINÉAIRE (le format -srgb décode déjà à
  // l'échantillonnage). Comparés tels quels, le défaut 0.7 posait la bascule
  // à 0.7 LINÉAIRE, soit ~0.87 perceptuel : le slider n'entamait l'image que
  // sur ses zones cramées, donc
  // inerte sur ~85% de sa course. On décode la CONSTANTE vers le linéaire —
  // l'échantillon d'image, lui, n'est jamais converti. À 0.5 le seuil tombe
  // désormais à ~0.214 linéaire : le bloom prend les nuages et les peaux
  // claires.
  let threshold = srgb_to_linear(params[0]);
  let brightness = max(color.r, max(color.g, color.b));
  // GENOU (soft knee, 2026-07-31). La bascule était SÈCHE :
  //   contribution = max(brightness - threshold, 0) / brightness
  // Un pixel juste sous le seuil ne contribuait rien, un pixel juste au-dessus
  // contribuait une miette, et la fraction retenue restait faible longtemps
  // au-dessus : à seuil 0.70 sRGB, un pixel à 0.80 sRGB n'entrait qu'à 26 % de
  // sa couleur, un pixel à 0.90 à 43 % — puis cette miette était étalée sur
  // toute la surface du noyau. D'où un halo qui « existe » sans se voir.
  //
  // La largeur du genou est proportionnelle au seuil (et non absolue) : c'est
  // ce qui rend le curseur lisible à toutes les positions du seuil — un genou
  // absolu serait imperceptible à seuil haut et avalerait l'image à seuil bas.
  // Le \`max\` avec 1e-4 évite la division par zéro quand le genou est à 0.
  let knee = max(params[1] * threshold, 0.0001);
  let d = brightness - threshold;
  // Épaule quadratique : continue et à dérivée continue au raccord, donc pas
  // de liseré visible à la frontière du seuil (c'est la signature « filtre »
  // d'une bascule sèche). Au-delà du genou, on repasse sur la droite exacte
  // \`d\` — le genou adoucit l'entrée, il ne bride pas les hautes lumières.
  var soft = clamp(d + knee, 0.0, 2.0 * knee);
  soft = soft * soft / (4.0 * knee);
  let energy = max(soft, max(d, 0.0));
  let contribution = energy / max(brightness, 0.0001);
  return vec4<f32>(color.rgb * contribution, 1.0);
}
`,
    },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.015625, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: UPSAMPLE_WGSL },
    { scale: 0.0625, wgsl: UPSAMPLE_WGSL },
    { scale: 0.125, wgsl: UPSAMPLE_WGSL },
    { scale: 0.25, wgsl: UPSAMPLE_WGSL },
    { scale: 0.5, wgsl: UPSAMPLE_WGSL },
  ],
  wgsl: `
${HSL_TO_RGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[2];
  let bloom = textureSample(prevPass, srcSampler, uv).rgb;
  // TEINTE DU HALO : gain PAR CANAL, pas un mélange vers une couleur. Un
  // mélange écraserait le modelé du halo (toutes les zones tireraient vers la
  // même teinte quelle que soit leur couleur d'origine) ; un gain le conserve
  // et ne fait que déplacer sa balance — c'est ce que fait un verre d'objectif.
  //
  // La couleur sort du picker en sRGB (valeur PERCEPTUELLE, exactement ce
  // qu'affiche la pastille) : on la décode vers le linéaire avant tout usage,
  // comme le duotone. Normalisée par srgb_to_linear(0.5) pour que le réglage
  // NEUTRE (saturation 0, luminosité 0.5) donne exactement (1,1,1) — la
  // luminosité reste donc un vrai gain d'ensemble, et la force à 0 rend le
  // halo strictement identique à celui d'avant la teinte.
  let tintLinear = srgb_to_linear3(hsl2rgb(params[4] / 360.0, params[5], params[6]));
  let neutral = srgb_to_linear(0.5);
  let gain = mix(vec3<f32>(1.0), tintLinear / neutral, params[7]);
  return vec4<f32>(color.rgb + bloom * intensity * gain, color.a);
}
`,
};
