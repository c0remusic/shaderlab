import type { EffectModule } from "./types";
import { SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";
import { DOWNSAMPLE_KARIS_WGSL, DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";

/**
 * Glow : bloom dual-filter.
 *
 * CE QUE C'EST, et ce que ce n'est plus. Un bloom est une DIFFUSION — la lumière
 * des hautes lumières s'étale dans le voisinage sans changer de couleur. C'est
 * le domaine des filtres physiques Pro-Mist / Black Pro-Mist / Glimmerglass, qui
 * ne relèvent que les zones brillantes (là où l'effet Orton, lui, agit sur toute
 * l'image, clairs comme sombres — deux looks distincts, pas deux dosages).
 *
 * Jusqu'au 2026-08-01 cet effet portait aussi une TEINTE de halo, orange par
 * défaut, qui imitait la halation argentique. Elle est partie : une halation
 * n'est pas un bloom coloré, c'est la ré-exposition de la couche rouge du film
 * par la lumière réfléchie sur les surfaces internes, et sa signature (dégradé
 * orange au bord vers rouge au loin, visible seulement sur fond sombre) est hors
 * de portée d'un gain de teinte uniforme. Voir `halation.ts`.
 *
 * CHAÎNE — descend jusqu'à 1/64 de l'image, remonte symétriquement :
 *   bright-pass 1/2 -> 1/4 -> 1/8 -> 1/16 -> 1/32 -> 1/64
 *               -> 1/32 -> 1/16 -> 1/8 -> 1/4 -> 1/2 -> composite pleine taille
 *
 * POURQUOI SI PROFOND. La chaîne précédente s'arrêtait à 1/8. Chaque noyau lit
 * `textureDimensions` de son ENTRÉE, donc son rayon en pixels pleine résolution
 * vaut 1/échelle-d'entrée. L'ancienne chaîne totalisait 2 + 4 + 8 + 4 = ~18 px
 * de halo, soit 0,3 % de la largeur d'une photo de 6240 px — quelle que soit la
 * position des deux curseurs. Un « bloom » qui ne dépasse pas 18 px sur 6240
 * n'est pas un halo, c'est un contour.
 *
 * RAYON DE LA CHAÎNE ACTUELLE, en pixels pleine résolution :
 *   descentes (écartement fixe) : 2 + 4 + 8 + 16 + 32          = 62
 *   remontées (x portée s)      : (64 + 32 + 16 + 8 + 4) * s   = 124 * s
 *   total = 62 + 124 * s  ->  s=0.4 : ~112 px | s=1.2 (défaut) : ~211 px
 *                             s=3.0 : ~434 px
 * Sur 6240 px de large : 3,4 % de la largeur au défaut, jusqu'à 7 %. Contre
 * 0,3 % avant, sans réglage possible.
 *
 * COÛT. Les cinq niveaux ajoutés pèsent 1/16, 1/64, 1/256… de la surface du
 * premier : sur une photo 6240x4160 ils ajoutent ~1 Mo de textures
 * intermédiaires à des ~67 Mo déjà alloués, et une fraction de pour-cent des
 * pixels traités. La profondeur est quasi gratuite ; c'est son absence qui
 * coûtait.
 *
 * POURQUOI LA PORTÉE AGIT SUR LE NOYAU ET NON SUR LE NOMBRE DE PASSES.
 * `passes` est un tableau STATIQUE du module d'effet, lu tel quel par
 * `EffectPassRunner.runInternalPasses` : le nombre de passes ne peut pas dépendre
 * d'un paramètre sans changer le moteur. Une pondération par niveau n'est pas non
 * plus accessible — la chaîne est strictement séquentielle et seule la DERNIÈRE
 * passe est exposée au composite (`prevPass`), les niveaux intermédiaires étant
 * détruits au fil de l'eau. Reste l'écartement des taps, qui est exactement le
 * `sampleScale` d'un bloom de moteur, et qui a le mérite d'être continu plutôt
 * que par paliers de puissance de deux.
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
    // TEINTE DU HALO RETIRÉE le 2026-08-01 (quatre paramètres : tintHue,
    // tintSaturation, tintLightness, tintStrength) — voir l'en-tête du module.
    //
    // Rupture assumée sur les presets. Un preset portant ces quatre clés les
    // garde en mémoire mais elles ne sont plus jamais lues : `effectPassRunner`
    // itère `effect.params` (donc n'y trouve rien), et `presetDocument` conserve
    // les clés inconnues sans les résoudre. Aucun crash — et surtout aucun
    // contrôle inerte, ce qui aurait été l'échec silencieux que ce dépôt
    // proscrit. Un halo teinté se refait en empilant `halation.ts`.
  ],
  passes: [
    {
      // Bright-pass à demi-résolution : ne garder que la part de chaque canal
      // au-dessus du seuil, remise à l'échelle sur la couleur d'origine pour
      // que la teinte de la source soit préservée dans le bloom.
      scale: 0.5,
      wgsl: `${SRGB_TO_LINEAR_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Le seuil vient d'un slider : c'est une valeur PERCEPTUELLE (sRGB), alors
  // que \`brightness\` est LINÉAIRE (le format -srgb décode déjà à
  // l'échantillonnage). Comparés tels quels, le défaut 0.7 posait la bascule
  // à 0.7 LINÉAIRE, soit ~0.87 perceptuel : le slider n'entamait l'image que
  // sur ses zones cramées, donc inerte sur ~85 % de sa course. On décode la
  // CONSTANTE vers le linéaire — l'échantillon d'image, lui, n'est jamais
  // converti. À 0.5 le seuil tombe désormais à ~0.214 linéaire : le bloom prend
  // les nuages et les peaux claires.
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
    // PREMIER downsample : pondéré par la moyenne de Karis. C'est le seul niveau
    // où un firefly est encore un point ISOLÉ, donc le seul où l'écraser sert à
    // quelque chose — et le seul où une pondération non conservatrice ne coûte
    // pas l'éclat de tout le halo. Voir DOWNSAMPLE_KARIS_WGSL.
    { scale: 0.25, wgsl: DOWNSAMPLE_KARIS_WGSL },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.015625, wgsl: DOWNSAMPLE_WGSL },
    { scale: 0.03125, wgsl: upsampleWgsl(3) },
    { scale: 0.0625, wgsl: upsampleWgsl(3) },
    { scale: 0.125, wgsl: upsampleWgsl(3) },
    { scale: 0.25, wgsl: upsampleWgsl(3) },
    { scale: 0.5, wgsl: upsampleWgsl(3) },
  ],
  // Composite ADDITIF et NEUTRE. Le halo garde la couleur de sa source — c'est
  // ce que fait une diffusion : elle étale la lumière présente, elle ne la
  // colore pas. Toute recoloration relève de `halation.ts`, qui est un autre
  // phénomène et désormais un autre effet.
  wgsl: `
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let intensity = params[2];
  let bloom = textureSample(prevPass, srcSampler, uv).rgb;
  return vec4<f32>(color.rgb + bloom * intensity, color.a);
}
`,
};
