import type { EffectModule } from "./types";
import { HASH_WGSL, VALUE_NOISE_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";

/**
 * Pixel stretch — étire les pixels d'une ligne de l'image dans une direction,
 * jusqu'à la traînée continue qui avale la moitié du cadre.
 *
 * LA VERSION NAÏVE, et pourquoi elle rend « filtre Photoshop 2005 » : choisir
 * une ligne, recopier ses pixels sur toute la zone en dessous, s'arrêter net.
 * Quatre pannes, toutes visibles à l'œil, toutes corrigées ici :
 *
 * 1. **La recopie franche pose une COUTURE là où elle s'arrête.** Le pixel
 *    juste après la zone étirée vient de l'image, celui juste avant vient de la
 *    ligne source : deux contenus sans rapport, bord à bord. On ne recopie donc
 *    pas, on COMPRIME : la coordonnée d'échantillonnage glisse continûment de
 *    « la ligne source » (au niveau de la ligne) vers « soi-même » (au bout de
 *    la portée). La traînée se rebranche sur l'image sans discontinuité, et
 *    c'est aussi ce qui la fait lire comme un vrai étirement de matière plutôt
 *    que comme un copier-coller.
 *
 * 2. **Un étirement en UV n'est pas droit.** Une direction à 45° exprimée en
 *    coordonnées UV sort à ~34° sur une photo 3:2 — le curseur d'angle mentirait
 *    sur toute sa course sauf aux multiples de 90°. Tout le calcul se fait donc
 *    dans l'espace isotrope d'`aspectScale` (pixels normalisés par sqrt(W*H)),
 *    et l'angle affiché est l'angle obtenu.
 *
 * 3. **Une ligne source parfaitement droite se voit comme une règle.** C'est ce
 *    qui trahit le filtre : la nature n'a pas d'arête au pixel près sur 6000 px.
 *    « Ondulation » déplace la ligne source par un `valueNoise` le long de la
 *    perpendiculaire — un bruit CONTINU, pas du bruit blanc : du bruit blanc
 *    donnerait une frange de traînées désolidarisées, l'ondulation donne une
 *    ligne qui respire.
 *
 * 4. **La ligne source est haute d'un pixel, donc son grain devient une
 *    rayure.** Tout ce qui est sur elle — bruit du capteur, poussière, un
 *    détail isolé — se retrouve étiré sur toute la longueur en un trait franc.
 *    « Lissage de la source » moyenne trois taps le long de la perpendiculaire,
 *    et sa force suit la COMPRESSION : au bout de la portée, où l'image est
 *    intacte, il ne floute rien. Sans ce couplage, l'effet floutait toute
 *    l'image dès que le curseur quittait zéro.
 *
 * COÛT : 3 taps, une seule passe, aucune texture intermédiaire.
 *
 * Pas de curseur « mélange avec l'original » : chaque calque porte déjà son
 * `opacity` et son `blendMode` (`LayerState`), et un masque. Un doublon dans
 * l'effet donnerait deux façons de faire la même chose, qui se multiplieraient.
 */
export const pixelStretch: EffectModule = {
  id: "pixelStretch",
  name: "Pixel stretch",
  params: [
    { name: "angle", label: "Direction", unit: "degrees", min: 0, max: 360, default: 90, step: 1, hint: "Axe de l'étirement — 90° étire verticalement (la ligne source est horizontale)" },
    { name: "position", label: "Position de la ligne", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.005, hint: "Où se trouve la ligne dont les pixels sont étirés, le long de l'axe de direction" },
    { name: "reach", label: "Portée", unit: "percent", min: 0.02, max: 1.5, default: 0.6, step: 0.01, hint: "Distance sur laquelle la traînée se rebranche progressivement sur l'image intacte" },
    { name: "strength", label: "Force", unit: "percent", min: 0, max: 1, default: 0.92, step: 0.01, hint: "1 = la ligne source occupe toute la portée (étirement franc), 0.5 = matière simplement comprimée vers elle" },
    { name: "wobble", label: "Ondulation", unit: "percent", min: 0, max: 1, default: 0.18, step: 0.01, hint: "Déforme la ligne source pour qu'elle ne se lise pas comme une règle — c'est ce qui distingue l'effet d'un copier-coller" },
    { name: "wobbleScale", label: "Échelle de l'ondulation", unit: "none", min: 1, max: 40, default: 7, step: 0.5, hint: "Bas = une grande vague sur toute la largeur ; haut = un froissement serré" },
    { name: "smooth", label: "Lissage de la source", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "Empêche le grain de la ligne source de devenir une rayure sur toute la traînée. N'agit QUE dans la zone étirée" },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HASH_WGSL}${VALUE_NOISE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let angle = radians(params[0]);
  let position = clamp(params[1], 0.0, 1.0);
  let reach = max(params[2], 0.001);
  let strength = clamp(params[3], 0.0, 1.0);
  let wobble = clamp(params[4], 0.0, 1.0);
  let wobbleScale = max(params[5], 0.001);
  // \`sourceSmooth\` et non \`smooth\` : \`smooth\` est un mot RÉSERVÉ de WGSL
  // (qualificatif d'interpolation), et le compilateur le refuse comme nom de
  // variable. Attrapé par \`npm run test:gpu-shaders\`, jamais par tsc.
  let sourceSmooth = clamp(params[6], 0.0, 1.0);

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  // Espace ISOTROPE : \`q\` est la position en pixels divisée par sqrt(W*H).
  // Une distance y vaut la même chose sur les deux axes, donc l'angle demandé
  // est l'angle obtenu et la portée est un vrai rayon, pas une ellipse.
  let q = (uv - vec2<f32>(0.5)) * ar;
  let dir = vec2<f32>(cos(angle), sin(angle));
  let perp = vec2<f32>(-dir.y, dir.x);

  let s = dot(q, dir);
  let t = dot(q, perp);

  // Demi-étendue de l'image PROJETÉE sur l'axe de direction : c'est elle qui
  // donne son sens au curseur de position, quel que soit l'angle. Avec une
  // constante à la place, « position = 0 » tomberait hors cadre en diagonale et
  // le curseur perdrait le premier tiers de sa course.
  let halfSpan = 0.5 * dot(abs(dir), ar);
  // Ondulation de la ligne source le long de la perpendiculaire. \`valueNoise\`
  // (continu) et non \`hash\` (discontinu) : la ligne doit onduler, pas se
  // hacher. Amplitude proportionnelle à la portée — une ondulation qui
  // dépasserait la zone étirée déplacerait la traînée hors de sa propre portée.
  let wob = (valueNoise(vec2<f32>(t * wobbleScale, 0.0)) - 0.5) * wobble * reach * 0.5;
  let origin = (position * 2.0 - 1.0) * halfSpan + wob;

  let d = s - origin;
  // \`ease\` va de 0 SUR la ligne à 1 au bout de la portée. \`smoothstep\` et non
  // une rampe linéaire : une rampe laisse une cassure de dérivée au bout de la
  // portée, qui se lit comme une ligne fantôme sur les aplats (ciel, mur).
  let ease = smoothstep(0.0, 1.0, clamp(abs(d) / reach, 0.0, 1.0));
  // Facteur de COMPRESSION de la coordonnée source. À \`ease\` = 1 il vaut
  // exactement 1, donc \`srcS == s\` : au-delà de la portée l'image est
  // rigoureusement intacte, sans avoir à tester une frontière.
  let compress = mix(1.0 - strength, 1.0, ease);
  let srcS = origin + d * compress;

  let uvSrc = (dir * srcS + perp * t) / ar + vec2<f32>(0.5);

  // Lissage de la source, PERPENDICULAIREMENT à la traînée (le long de la ligne
  // source) et pondéré par la compression : nul là où rien n'est étiré. Trois
  // taps suffisent — au-delà, on ne lisse plus le grain, on efface le contenu
  // de la ligne, qui est justement le sujet de l'effet.
  let rad = sourceSmooth * (1.0 - compress) * 3.0 / sqrt(dims.x * dims.y);
  let off = perp * rad;
  let c0 = textureSample(srcTexture, srcSampler, mirrorUv(uvSrc)).rgb;
  let c1 = textureSample(srcTexture, srcSampler, mirrorUv(uvSrc + off)).rgb;
  let c2 = textureSample(srcTexture, srcSampler, mirrorUv(uvSrc - off)).rgb;
  let stretched = c0 * 0.5 + c1 * 0.25 + c2 * 0.25;

  return vec4<f32>(stretched, color.a);
}
`,
};
