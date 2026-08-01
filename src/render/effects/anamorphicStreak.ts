import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Anamorphic streak — la traînée horizontale bleue des objectifs anamorphiques.
 *
 * D'OÙ ÇA VIENT. Cahier de références §7, où c'est le candidat le mieux justifié
 * après halation : « Traînée horizontale bleue issue du barillet cylindrique,
 * teinte donnée par le traitement anti-reflet. Ni bloom ni flare à fantômes :
 * un *smear* directionnel, que les moteurs ne savent pas faire nativement. »
 *
 * CE QUE C'EST, PHYSIQUEMENT, et pourquoi ce n'est ni `glow` ni `halation`. Un
 * objectif anamorphique porte un élément CYLINDRIQUE qui comprime l'image sur
 * un seul axe. Une lumière parasite qui s'y réfléchit ne s'étale donc pas en
 * disque comme dans un objectif sphérique : elle s'étale sur UNE SEULE
 * DIRECTION, celle du cylindre. La teinte bleue ne vient pas de la lumière mais
 * du TRAITEMENT ANTI-REFLET des lentilles, qui laisse passer une bande étroite
 * du spectre — c'est pour ça qu'elle est la même quelle que soit la couleur de
 * la source, là où une halation, elle, tient sa couleur du film.
 *
 * Les trois s'empilent sans se doubler, et chacun répond à une question
 * différente : `glow` étale la lumière SANS la colorer (diffusion), `halation`
 * la réexpose en rouge sur fond sombre (film), celui-ci la tire en trait
 * horizontal bleu (optique).
 *
 * LA CHAÎNE, et pourquoi elle n'est pas une simple boucle. Une traînée doit
 * courir sur une bonne part de la largeur : 400 px de portée demanderaient 200
 * taps en demi-résolution, à chaque pixel. Le procédé retenu est celui des
 * flares de moteur temps réel — un petit nombre de taps par passe, mais avec un
 * PAS QUI QUADRUPLE à chaque passe. Trois passes suffisent alors à couvrir des
 * centaines de pixels pour vingt-sept lectures.
 *
 * LE NOMBRE DE TAPS DOIT SUIVRE LA CROISSANCE DU PAS, et c'est la seule chose
 * délicate de la construction. Une passe dont les taps vont jusqu'à ±N pas
 * étale chaque point sur ±N pas ; si la passe suivante multiplie le pas par
 * plus de N, elle échantillonne AU-DELÀ de ce qui a été couvert et laisse un
 * trou. La première version avait des taps à ±1 et ±2 avec un pas ×4 : elle
 * perlait, et le témoin de rendu l'a montré immédiatement — des chapelets de
 * billes au lieu d'une traînée continue.
 *
 * Avec des taps jusqu'à ±4, une passe couvre ±4 pas et un facteur 4 devient
 * exactement continu. C'est pourquoi ces deux nombres sont liés : changer l'un
 * sans l'autre ramène le peigne.
 *
 * DISPERSION. Une vraie traînée n'est pas d'un bleu uniforme : le traitement
 * anti-reflet ne filtre pas exactement pareil aux grands angles, donc les
 * extrémités virent légèrement. La teinte est donc décalée le long de la
 * traînée, proportionnellement à la distance parcourue — la même idée que le
 * dégradé de `halation`, dérivé de l'énergie plutôt que d'une distance
 * géométrique.
 */

/** Facteur de pas entre deux passes. 4 plutôt que 2 : à 2 il faudrait cinq
 *  passes pour la même portée, à 8 il dépasserait les ±4 pas que couvre une
 *  passe et le peigne reviendrait. Ce facteur est LIÉ au nombre de taps de
 *  \`streakPass\` : changer l'un sans l'autre ramène le chapelet de billes que
 *  le témoin de rendu a montré sur la première version. */
const STRIDE = [1, 4, 16] as const;

/** Passe de bright-pass : ne garde que ce qui dépasse le seuil, et jette la
 *  couleur de la source.
 *
 *  La traînée prend sa teinte du TRAITEMENT de l'objectif, pas de la lumière
 *  qui l'a provoquée — une lampe verte donne une traînée bleue. Garder la
 *  couleur source produirait une traînée arc-en-ciel, ce qu'aucun objectif ne
 *  fait, et c'est la même raison qui fait jeter la couleur dans le bright-pass
 *  de `halation`. */
const STREAK_BRIGHT_WGSL = `
${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Seuil DÉCODÉ vers le linéaire : c'est une valeur de curseur, donc
  // perceptuelle, comparée à une luminance qui vient du format -srgb et est
  // donc linéaire. Précédent : le bright-pass du glow, dont ce décodage
  // manquant rendait le curseur inerte sur 85 % de sa course.
  let seuil = srgb_to_linear(clamp(params[0], 0.0, 1.0));
  let l = max(color.r, max(color.g, color.b));
  // Genou doux plutôt que bascule : une coupure franche fait clignoter la
  // traînée quand une haute lumière traverse le seuil d'un cran d'exposition.
  let e = max(l - seuil, 0.0) / max(1.0 - seuil, 0.0001);
  return vec4<f32>(vec3<f32>(e * e), 1.0);
}
`;

/** Une passe d'étalement directionnel. `stride` est baké dans le corps — le pas
 *  DOIT différer d'une passe à l'autre, et `passes` n'a aucun moyen de dire à
 *  une passe quel rang elle occupe. Même solution que la chaîne de `glow`, qui
 *  passe son index en argument pour la même raison. */
const streakPass = (stride: number) => `
${UV_SPACE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let angle = radians(params[3]);
  // Direction de la traînée, en UV. La correction d'aspect passe par
  // \`aspectScale\` : sans elle, une traînée à 30° sortirait à un autre angle sur
  // une photo 3:2, et le curseur mentirait.
  let ar = aspectScale(dims);
  let dir = vec2<f32>(cos(angle), sin(angle)) / ar;
  // Portée en pixels pleine définition ; la passe tourne à 1/2, d'où le facteur.
  let pas = dir * (max(params[1], 0.0) * 0.5 * ${stride}.0) / dims;

  // HUIT taps symétriques, jusqu'a ±4 pas — et non ±2. Une passe couvre donc
  // ±4 pas, ce qui est exactement le facteur par lequel la passe suivante
  // multiplie le pas : la couverture est continue, sans trou. À ±2 taps pour un
  // facteur 4, la traînée perle en chapelet de billes.
  //
  // Pondération décroissante : les extrémités pèsent moins, sinon la traînée
  // finit sur un bord franc au lieu de s'éteindre.
  var sum = textureSample(srcTexture, srcSampler, uv).rgb;
  var w = 1.0;
  for (var i = 1; i <= 4; i = i + 1) {
    let d = pas * f32(i);
    // 1/(1+i) : décroissance douce, sans constante magique par rang.
    let poids = 1.0 / (1.0 + f32(i));
    sum = sum + textureSample(srcTexture, srcSampler, mirrorUv(uv + d)).rgb * poids;
    sum = sum + textureSample(srcTexture, srcSampler, mirrorUv(uv - d)).rgb * poids;
    w = w + poids * 2.0;
  }
  return vec4<f32>(sum / w, 1.0);
}
`;

export const anamorphicStreak: EffectModule = {
  id: "anamorphicStreak",
  name: "Anamorphic streak",
  params: [
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, hint: "À partir de quel ton une lumière provoque une traînée. Haut = seules les sources franches, ce qui est le cas réel" },
    { name: "length", label: "Longueur", unit: "pixels", min: 4, max: 400, default: 90, step: 1, hint: "Portée de la traînée, en pixels pleine définition. Elle est multipliée par les pas croissants des trois passes" },
    { name: "intensity", label: "Intensité", unit: "none", min: 0, max: 4, default: 1.1, step: 0.05, hint: "Force du composite additif. C'est une lumière parasite : elle s'AJOUTE, elle ne remplace rien" },
    { name: "angle", label: "Orientation", unit: "degrees", min: 0, max: 180, default: 0, step: 1, hint: "0° = horizontale, l'orientation d'un anamorphique de cinéma. L'axe du cylindre de l'objectif" },
    { name: "tintHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 210, step: 1, colorGroup: { key: "tint", role: "hue", label: "Traitement" } },
    { name: "tintSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.8, step: 0.01, colorGroup: { key: "tint", role: "saturation", label: "Traitement" } },
    { name: "tintLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "tint", role: "lightness", label: "Traitement" } },
    { name: "dispersion", label: "Dispersion", unit: "percent", min: 0, max: 1, default: 0.25, step: 0.01, hint: "Fait virer la teinte vers les extrémités de la traînée — le traitement anti-reflet ne filtre pas pareil aux grands angles. 0 = traînée d'un bleu uniforme, ce qu'aucun objectif ne fait" },
  ],
  passes: [
    { scale: 0.5, wgsl: STREAK_BRIGHT_WGSL },
    { scale: 0.5, wgsl: streakPass(STRIDE[0]) },
    { scale: 0.5, wgsl: streakPass(STRIDE[1]) },
    { scale: 0.5, wgsl: streakPass(STRIDE[2]) },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = max(params[2], 0.0);
  let dispersion = clamp(params[7], 0.0, 1.0);

  // Énergie de la traînée. Elle est MONOCHROME depuis le bright-pass : la
  // couleur vient du traitement de l'objectif, pas de la source.
  let energie = textureSample(prevPass, srcSampler, uv).r;

  // DISPERSION. La teinte est décalée d'après l'énergie LOCALE et non d'après
  // une distance géométrique : là où la traînée est faible — donc loin de la
  // source — elle vire. Même construction que le dégradé de halation, et pour
  // la même raison : l'énergie est déjà calculée, une distance demanderait un
  // second champ et serait fausse dès que deux sources voisines se rejoignent.
  let vire = (1.0 - clamp(energie * 4.0, 0.0, 1.0)) * dispersion;
  let teinte = fract(params[4] / 360.0 + vire * 0.12);
  let tint = srgb_to_linear3(hsl2rgb(teinte, params[5], params[6]));

  // ADDITIF en lumière LINÉAIRE : une traînée est une lumière parasite qui
  // s'ajoute à l'image, jamais un calque qui la remplace. C'est aussi pourquoi
  // il n'y a pas de curseur « mélange » — le calque porte déjà son opacité.
  return vec4<f32>(color.rgb + tint * energie * intensity, color.a);
}
`,
};
