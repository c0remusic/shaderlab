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
 * ASYMÉTRIE (2026-08-01, cahier de références §6bis). La référence Figma expose
 * un paramètre `Offset` SIGNÉ que nous n'avions pas. Ce qui manquait n'était pas
 * un décalage — `position` déplace déjà la ligne — mais la capacité d'étirer
 * d'UN SEUL CÔTÉ : `ease` est bâti sur `abs(d)`, donc la traînée partait
 * symétriquement de part et d'autre de la ligne, et aucun réglage des sept
 * autres curseurs ne pouvait rompre cette symétrie.
 *
 * La portée devient donc side-dépendante : `reach * (1 + offset * signe(d))`.
 * À 0 les deux côtés valent `reach` et le rendu est celui d'avant, au bit près.
 * À +1 le côté positif porte le double et le côté négatif tombe à zéro — la
 * portée nulle y rend `ease = 1`, donc `compress = 1`, donc l'image RIGOUREUSEMENT
 * intacte, sans qu'aucune frontière ait à être testée. C'est la même propriété
 * qui fait déjà que l'effet se rebranche proprement au bout de sa portée.
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
    // L'`Offset` signé de la référence Figma. Nommé pour ce qu'il FAIT — rien
    // n'est décalé, c'est la symétrie de la traînée qui se rompt — plutôt que
    // pour son nom d'origine, sur le précédent de « Largeur et Hauteur » qui a
    // remplacé « Échelle X et Échelle Y » (d54f91b).
    { name: "offset", label: "Asymétrie", unit: "percent", min: -1, max: 1, default: 0, step: 0.01, hint: "Répartit la portée entre les deux côtés de la ligne. 0 = traînée symétrique ; ±1 = elle ne part que d'un seul côté, l'autre reste intact" },
    // RÉGION. Défaut à 1.5, c'est-à-dire plus grand que la demi-diagonale de
    // n'importe quel cadre : le masque vaut 1 partout et l'effet reste GLOBAL,
    // comme avant ce paramètre. Le réduire est ce qui le rend local.
    { name: "regionRadius", label: "Rayon de la zone", unit: "percent", min: 0.02, max: 1.5, default: 1.5, step: 0.01, hint: "Limite l'étirement à un disque. Au maximum la zone couvre tout le cadre et l'effet est global — c'est en la réduisant que la photo reste lisible autour de la coulure" },
    { name: "regionX", label: "Centre X de la zone", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Position horizontale du disque d'étirement" },
    { name: "regionY", label: "Centre Y de la zone", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Position verticale du disque d'étirement" },
    { name: "regionFeather", label: "Fondu de la zone", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Adoucit la limite du disque — à 0 la coulure s'arrête net sur un cercle visible, ce qui trahit l'effet" },

  ],
  // MANIPULATEUR SUR LA TOILE (2026-08-02). Verdict d'usage : « difficile à
  // positionner correctement ». La région existait depuis la veille mais ne se
  // réglait qu'aux curseurs, là où la référence dit « place the on-canvas circle
  // over the area you want to stretch ». Le §6bis du cahier l'avait relevé
  // (« sans manipulateur direct ») sans que ça devienne du travail — c'est le
  // même manque qui avait fait ajouter la région, traité à moitié.
  //
  // Les curseurs RESTENT : le cercle vise, ils affinent. Retirer les uns pour
  // l'autre échangerait un défaut d'ergonomie contre un autre — un réglage fin
  // au pixel près ne se fait pas à la souris.
  canvasControls: [{ id: "zone", kind: "disk", x: "regionX", y: "regionY", radius: "regionRadius", label: "Zone" }],
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
  let offset = clamp(params[7], -1.0, 1.0);
  let regionRadius = max(params[8], 0.001);
  let regionCenter = vec2<f32>(params[9], params[10]);
  let regionFeather = clamp(params[11], 0.0, 1.0);

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
  // ASYMÉTRIE : la portée n'est plus la même des deux côtés de la ligne. À
  // \`offset\` = 0 les deux valent \`reach\` et tout ce qui suit est identique au
  // bit près à ce que l'effet calculait avant ce paramètre.
  //
  // Un côté à portée NULLE ne demande aucun cas particulier : le quotient
  // sature, \`ease\` vaut 1, donc \`compress\` vaut 1 et \`srcS == s\` — l'image y
  // est rigoureusement intacte. C'est la propriété qui fait déjà se rebrancher
  // la traînée au bout de sa portée, réutilisée telle quelle. Le plancher du
  // dénominateur n'est là que pour interdire la division par zéro, pas pour
  // rattraper un cas limite.
  // RÉGION (2026-08-01). L'écart le plus visible avec la référence Figma
  // n'était ni un easing ni un mode : leur pixel stretch se place sur la toile
  // (« place the on-canvas circle over the area you want to stretch »), le
  // nôtre s'appliquait à TOUTE l'image. La portée borne bien la traînée
  // PERPENDICULAIREMENT à la ligne source, mais LE LONG de cette ligne l'effet
  // courait sur toute la largeur — d'où une photo mangée en bandes là où la
  // leur reste lisible avec des coulures qui en sortent.
  //
  // Le masque agit sur la FORCE et non sur la couleur : hors du disque la force
  // tombe à 0, donc la compression vaut 1, donc srcS égale s et l'image est
  // rigoureusement intacte. Même propriété que le bout de la portée, et aucun
  // mélange à faire en sortie.
  //
  // Distance mesurée dans l'espace ISOTROPE (le même q que plus haut) : le
  // disque est un disque, pas une ellipse sur un panoramique.
  let regionDist = length(q - (regionCenter - vec2<f32>(0.5)) * ar);
  let region = 1.0 - smoothstep(regionRadius * (1.0 - regionFeather), regionRadius, regionDist);
  let localStrength = strength * region;

  let reachSide = reach * max(1.0 + offset * sign(d), 0.0);
  // \`ease\` va de 0 SUR la ligne à 1 au bout de la portée. \`smoothstep\` et non
  // une rampe linéaire : une rampe laisse une cassure de dérivée au bout de la
  // portée, qui se lit comme une ligne fantôme sur les aplats (ciel, mur).
  let ease = smoothstep(0.0, 1.0, clamp(abs(d) / max(reachSide, 0.00001), 0.0, 1.0));
  // Facteur de COMPRESSION de la coordonnée source. À \`ease\` = 1 il vaut
  // exactement 1, donc \`srcS == s\` : au-delà de la portée l'image est
  // rigoureusement intacte, sans avoir à tester une frontière.
  let compress = mix(1.0 - localStrength, 1.0, ease);
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
