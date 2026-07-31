import type { EffectModule } from "./types";
import { UV_SPACE_WGSL } from "./uvSpace";

export const chromaticBleed: EffectModule = {
  id: "chromaticBleed",
  name: "Chromatic bleed",
  params: [
    // Défaut remonté de 0.008 à 0.035 et plafond de 0.15 à 0.30 (2026-07-31).
    // À 0.008 le curseur était posé à 5 % de sa course : poser l'effet ne
    // montrait rien, et il fallait le savoir pour aller le chercher. Le
    // plafond monte parce que la courbe radiale ci-dessous ne SURAMPLIFIE plus
    // les coins (voir `profile`) — à amount égal, les coins reçoivent
    // désormais moins qu'avant, et il faut de la course pour compenser.
    { name: "amount", label: "Décalage chromatique", unit: "percent", min: 0, max: 0.3, default: 0.035, step: 0.001 },
    { name: "centerFalloff", label: "Atténuation centrale", unit: "none", min: 0.5, max: 4, default: 2, step: 0.1, hint: "Vitesse à laquelle le décalage croît du centre vers les coins" },
    { name: "centerPresence", label: "Présence au centre", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Part du décalage des coins déjà présente au centre — 0 = aberration purement périphérique, 1 = décalage uniforme sur toute l'image" },
    { name: "asymmetry", label: "Asymétrie R/B", unit: "none", min: -1, max: 1, default: 0.15, step: 0.01, hint: "Déséquilibre entre la course du rouge et celle du bleu — un verre réel ne disperse pas les deux également" },
    { name: "angle", label: "Orientation", unit: "degrees", min: -45, max: 45, default: 0, step: 1, hint: "Fait pivoter le décalage : 0 = purement radial, ±45° = franges tangentielles (décentrement d'objectif)" },
  ],
  wgsl: `
${UV_SPACE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let amount = params[0];
  let falloff = params[1];
  let centerPresence = clamp(params[2], 0.0, 1.0);
  let asymmetry = params[3];
  let angle = radians(params[4]);
  // Isotropie (voir effects/uvSpace.ts) : tout le calcul radial se fait dans
  // l'espace corrigé de l'aspect, où une même distance vaut le même nombre de
  // pixels en X et en Y — sinon l'aberration est ~1.5x plus forte à
  // l'horizontale sur une photo 3:2, et les "cercles" d'égale aberration sont
  // des ellipses. Le décalage est reconverti en UV en fin de calcul (/ ar).
  let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
  let fromCenter = (uv - vec2<f32>(0.5, 0.5)) * ar;
  // COURBE RADIALE (réécrite 2026-07-31). L'ancienne forme était
  //   pow(dist * 2.0, falloff)
  // où \`dist\` est mesuré dans l'espace corrigé de l'aspect. Elle avait deux
  // défauts couplés :
  //   1. \`dist * 2.0\` ne vaut 1 nulle part de particulier. Sur une photo 3:2 il
  //      vaut 1.47 au coin (donc pow(.,2) = 2.17 : les coins étaient AMPLIFIÉS)
  //      et reste < 1 partout où dist < 0.5 — soit ~71 % de l'aire. Or élever un
  //      nombre inférieur à 1 à une puissance > 1 l'ATTÉNUE : sur les deux tiers
  //      de l'image la courbe travaillait CONTRE l'effet.
  //   2. Elle ne laissait aucun moyen d'exister au centre. Chiffré au défaut
  //      d'alors (amount = 0.008) sur 6240 px de large : ~3 px à mi-cadre,
  //      ~62 px au coin. L'effet n'existait que dans les angles.
  //
  // Nouvelle forme : la distance est normalisée par la distance au COIN, donc
  // \`radial\` vaut exactement 0 au centre et 1 au coin, quel que soit le format
  // de l'image — l'exposant n'amplifie plus rien, il ne fait que RÉPARTIR. Et
  // \`centerPresence\` pose un plancher : la courbe interpole entre ce plancher
  // (au centre) et 1 (au coin) au lieu de partir de zéro.
  let corner = length(vec2<f32>(0.5, 0.5) * ar);
  let radial = length(fromCenter) / corner;
  let profile = centerPresence + (1.0 - centerPresence) * pow(radial, falloff);
  // Rotation appliquée DANS l'espace corrigé de l'aspect, avant la reconversion
  // en UV : la pivoter après aurait été une rotation dans un espace anisotrope,
  // c'est-à-dire un cisaillement déguisé sur toute image non carrée.
  let nominal = fromCenter * amount * profile;
  let c = cos(angle);
  let s = sin(angle);
  let turned = vec2<f32>(nominal.x * c - nominal.y * s, nominal.x * s + nominal.y * c);
  let shift = turned / ar;
  // Asymétrie : le rouge et le bleu ne parcourent pas la même distance. Un
  // décalage strictement opposé (±shift) est le cas d'école, pas le cas réel —
  // la dispersion d'un verre n'est pas symétrique autour du vert.
  let shiftR = shift * (1.0 + asymmetry);
  let shiftB = shift * (1.0 - asymmetry);
  // mirrorUv : le décalage est maximal AU BORD, donc les taps R/B sortent du
  // cadre là où l'effet est le plus visible. Sans repli, le sampler
  // clamp-to-edge étire le texel de bord en traînée.
  let red = textureSample(srcTexture, srcSampler, mirrorUv(uv + shiftR)).r;
  let green = textureSample(srcTexture, srcSampler, uv).g;
  let blue = textureSample(srcTexture, srcSampler, mirrorUv(uv - shiftB)).b;
  return vec4<f32>(red, green, blue, color.a);
}
`,
};
