import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { OKLAB_WGSL } from "./oklab";
import { UV_SPACE_WGSL } from "./uvSpace";
import { APERTURE_WGSL } from "./aperture";
import { DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Lens flare — la lumière parasite qu'un objectif AJOUTE quand une source forte
 * entre dans son champ : la chaîne de fantômes colorés, l'anneau autour de
 * l'axe, et le voile qui lave les noirs.
 *
 * ─── POURQUOI CE N'EST PAS UN MODE DE `lensDistortion` ──────────────────────
 *
 * Le CLAUDE.md range déjà l'optique en trois questions : ce qu'un objectif
 * RENVOIE (les halos), ce qu'il ne met pas au point (les flous), ce que sa FORME
 * déforme (`lensDistortion`). Un flare n'est pas une déformation — l'image
 * derrière ne bouge pas d'un pixel. C'est de la lumière AJOUTÉE, par réflexion
 * entre les faces des lentilles. Il appartient donc à la première question, et
 * pas à la troisième, quel que soit le fait qu'il vienne du même objectif.
 *
 * ⚠️ **LA FAMILLE DES HALOS ROUVRE À TROIS**, après avoir été déclarée close à
 * deux le 2026-08-03 (`anamorphicStreak` en était sorti pour `lensDistortion`).
 * La clôture portait sur un découpage — `glow` étale sans colorer (diffusion),
 * `halation` réexpose en rouge sur fond sombre (film) — et celui-ci n'est
 * variante ni de l'un ni de l'autre : c'est une RÉFLEXION, qui produit des
 * copies DÉPLACÉES de la source au lieu de l'étaler sur place. Le cahier de
 * références le disait déjà en creux, en décrivant la traînée anamorphique
 * comme « ni bloom ni flare à fantômes ». Le flare à fantômes y était donc nommé
 * comme absent, et il l'est resté deux jours.
 *
 * ─── LES DEUX SOURCES SONT UNE SEULE MACHINERIE ─────────────────────────────
 *
 * Demande d'Antoine : le flare doit pouvoir partir des hautes lumières de la
 * photo ET d'un point qu'on pose soi-même. Ça n'oblige pas à écrire deux fois.
 *
 * Le point posé est INJECTÉ DANS LA PASSE DE SEUILLAGE, comme un lobe
 * synthétique ajouté aux hautes lumières réelles. Tout l'aval — fantômes,
 * anneau, voile — le traite ensuite comme n'importe quelle lumière de l'image,
 * sans savoir qu'il est artificiel.
 *
 * Et ça rend gratuitement une propriété qu'un fantôme calculé après coup ne
 * pourrait pas avoir : **le lobe injecté porte la forme du diaphragme, donc ses
 * copies l'héritent**. Un fantôme est un polygone parce que la source vue à
 * travers le diaphragme en est un, pas parce qu'on a dessiné un polygone. La
 * chaîne le montre : ils rétrécissent en gardant leurs arêtes.
 *
 * ⚠️ Corollaire honnête : les fantômes issus d'une haute lumière RÉELLE de la
 * photo sont ronds et mous, parce que cette lumière-là n'a pas de forme connue.
 * C'est le prix de la voie automatique, et il est visible.
 *
 * ─── LA GÉOMÉTRIE DES FANTÔMES, EN LECTURE ET NON EN ÉCRITURE ───────────────
 *
 * Un fantôme est la source réfléchie deux fois entre deux faces : il tombe sur
 * la droite qui joint la source au CENTRE optique, de l'autre côté, à une
 * distance qui dépend du couple de faces. D'où une chaîne alignée.
 *
 * On ne peut pas la DESSINER — il faudrait connaître toutes les sources. On la
 * LIT : pour le pixel P, le fantôme d'indice i vaut la luminance seuillée au
 * point `C + (P − C) · s_i`, avec `s_i` négatif. À `s = −1` le fantôme est le
 * miroir exact de la source par le centre ; plus `s` s'éloigne, plus le fantôme
 * est petit et proche de l'axe. Une seule texture, un tap par fantôme.
 *
 * ─── CE QUI EMPÊCHE QUE ÇA RENDE CHEAP ──────────────────────────────────────
 *
 * 1. **Tout est ADDITIF, en linéaire.** Une lumière parasite s'ajoute, elle ne
 *    remplace rien. Un flare composé en `mix` masquerait l'image sous lui, ce
 *    qui est le rendu « calque de flare posé par-dessus » qu'on veut éviter.
 * 2. **Les fantômes s'éteignent vers les bords.** Sans ce poids, la chaîne
 *    garde la même force jusqu'au coin du cadre et se lit comme une rangée de
 *    gommettes. La lumière réfléchie, elle, rate le capteur d'autant plus
 *    qu'elle est loin de l'axe.
 * 3. **Le dégradé de teinte de la chaîne court en OKLCH**, pas en RVB. Faire
 *    dériver la teinte par permutation de canaux — l'astuce habituelle — fait
 *    varier la CLARTÉ en même temps, et la chaîne se met à clignoter du clair au
 *    sombre alors qu'un seul curseur devrait la régler. Même mesure que celle
 *    qui a fait passer la roue d'`outlines` en OKLCH : 0,290 d'étendue de clarté
 *    perçue pour une teinte qui fait le tour.
 * 4. **Le voile n'est pas un glow.** Il ajoute une lumière SCALAIRE teintée, pas
 *    une copie floutée de l'image : c'est ce qui lave les noirs sans redessiner
 *    les formes. Un glow ajouterait la couleur locale et donnerait un halo, pas
 *    une perte de contraste.
 *
 * ─── COÛT ───────────────────────────────────────────────────────────────────
 *
 * Sept passes internes (seuillage-injection, trois réductions, trois remontées),
 * puis `nombre de fantômes + 2` taps en passe finale.
 *
 * ⚠️ **Les sept passes sautent quand les trois contributions sont à zéro**
 * (`EffectPass.enabled`). Et la passe finale porte le MÊME prédicat, en sortie
 * anticipée : sans lui, un effet posé et réglé à zéro lirait la texture SOURCE
 * en croyant lire son champ de hautes lumières, et ajouterait l'image à
 * elle-même. C'est l'avertissement écrit sur `EffectPass.enabled`, et c'est le
 * premier effet du dépôt où il mord.
 */

/** Index du paramètre d'étalement, lu par la remontée pyramidale partagée. En
 *  dur dans l'appel serait une panne silencieuse au premier réordonnancement. */
const P_SPREAD = 1;

/** Nombre maximal de fantômes. Borné en DUR et pas seulement par le curseur :
 *  la boucle WGSL doit avoir une borne constante, et un `count` lu d'un uniforme
 *  ne peut pas la donner. Le curseur s'arrête au même chiffre. */
const GHOSTS_MAX = 8;

/** Prédicat commun aux sept passes et à la sortie anticipée de la composite.
 *  ⚠️ LES DEUX DOIVENT DIRE LA MÊME CHOSE : si les passes sautent et que la
 *  composite lit quand même `prevPass`, elle lit la texture SOURCE — donc
 *  l'image ajoutée à elle-même. Un seul prédicat, appelé des deux côtés. */
const flareActif = (p: Record<string, number>) =>
  p.ghostIntensity > 0 || p.haloIntensity > 0 || p.veil > 0;

/** SEUILLAGE + INJECTION DE LA SOURCE POSÉE, fondus dans la même passe.
 *
 *  Fondus, et pas seulement par économie : une passe de plus coûterait une cible
 *  pleine résolution, mais surtout le lobe injecté DOIT traverser la même
 *  pyramide que les hautes lumières réelles. S'il était ajouté après, il aurait
 *  des bords nets là où les autres sont adoucies, et se lirait comme un
 *  autocollant. */
const FLARE_BRIGHT_WGSL = `
${UV_SPACE_WGSL}${SRGB_TO_LINEAR_WGSL}
// \`APERTURE_WGSL\` exige la constante \`TAU\`, que ses appelants déclarent
// eux-mêmes : la poser dans le module partagé ferait un doublon chez
// \`lensBlur\`, qui l'utilise déjà pour sa spirale d'angle d'or.
const TAU = 6.283185307179586;
${APERTURE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  // Seuil DÉCODÉ vers le linéaire : c'est une valeur de curseur, donc
  // perceptuelle, comparée à une luminance qui vient du format -srgb et est
  // donc déjà linéaire. Précédent coûteux : le bright-pass du glow, dont ce
  // décodage manquant rendait le curseur inerte sur 85 % de sa course.
  let seuil = srgb_to_linear(clamp(params[0], 0.0, 1.0));
  let l = max(color.r, max(color.g, color.b));
  // Genou doux plutôt que bascule : une coupure franche fait clignoter toute la
  // chaîne de fantômes quand une haute lumière traverse le seuil d'un cran
  // d'exposition — et un fantôme qui clignote se voit bien plus qu'un halo.
  let e = max(l - seuil, 0.0) / max(1.0 - seuil, 0.0001);
  // Couleur CONSERVÉE, pas seulement l'énergie : un fantôme issu d'un néon rouge
  // n'a pas la même dominante qu'un fantôme de ciel, et la teinte du réglage
  // vient TEINTER cette couleur au lieu de la remplacer.
  var bright = color.rgb * (e * e);

  // SOURCE POSÉE. Le lobe porte la forme du diaphragme — c'est ce qui donne
  // leurs arêtes aux fantômes, sans qu'aucun polygone ne soit dessiné plus bas.
  let intensite = max(params[5], 0.0);
  if (intensite > 0.0) {
    let ar = aspectScale(vec2<f32>(textureDimensions(srcTexture)));
    // Écart mesuré dans l'espace ISOTROPE : sans ça le lobe serait un ovale sur
    // une photo 3:2, et sa rotation un cisaillement.
    let d = (uv - vec2<f32>(params[2], params[3])) * ar;
    let theta = atan2(d.y, d.x);
    let rayon = max(params[4], 0.001) * aperture_radius(theta, params[6], radians(params[7]));
    // Bord adouci sur le dernier quart : un lobe à bord franc rendrait des
    // fantômes crénelés, et l'escalier se verrait d'autant plus qu'ils sont
    // petits.
    let lobe = 1.0 - smoothstep(0.75, 1.0, length(d) / rayon);
    bright = bright + vec3<f32>(intensite * lobe * lobe);
  }
  return vec4<f32>(bright, 1.0);
}
`;

export const lensFlare: EffectModule = {
  id: "lensFlare",
  name: "Lens flare",
  params: [
    { name: "threshold", label: "Seuil des hautes lumières", unit: "percent", min: 0, max: 1, default: 0.78, step: 0.01, hint: "À partir de quel ton une lumière provoque un flare. Haut = seules les sources franches, ce qui est le cas réel — un objectif ne fantôme pas sur un ciel gris" },
    { name: "spread", label: "Étalement des sources", unit: "none", min: 0.5, max: 6, default: 2, step: 0.05, hint: "Adoucit les hautes lumières avant d'en tirer les fantômes. Bas = des fantômes nets qui gardent la forme de la source ; haut = des taches molles" },
    // ── LA SOURCE POSÉE (manipulateur sur la toile) ──────────────────────────
    // Mêmes plages que la zone de `pixelStretch`, dont l'ADR dit pourquoi un
    // point se pose sur l'image et ne se règle pas aux curseurs. Débordement
    // au-delà du cadre volontairement autorisé : une source de flare est
    // souvent HORS champ, c'est même le cas le plus fréquent.
    { name: "sourceX", label: "Centre X de la source", unit: "percent", min: -0.5, max: 1.5, default: 0.5, step: 0.01, hint: "Position horizontale de la source posée. Peut sortir du cadre — un soleil qui provoque un flare est rarement dans l'image" },
    { name: "sourceY", label: "Centre Y de la source", unit: "percent", min: -0.5, max: 1.5, default: 0.2, step: 0.01, hint: "Position verticale de la source posée" },
    // DÉFAUT À 0,10 ET NON 0,05. Sous ~0,08, le lobe est plus petit que le
    // niveau le plus grossier de la pyramide et ses ARÊTES n'y survivent pas :
    // les fantômes sortent ronds, ce qui vide de son sens toute la mécanique
    // d'injection qui devait leur donner la forme du diaphragme. Le curseur
    // descend plus bas parce qu'une source lointaine est légitimement petite —
    // mais il faut alors savoir qu'on renonce au polygone.
    { name: "sourceRadius", label: "Rayon de la source", unit: "percent", min: 0.005, max: 0.5, default: 0.1, step: 0.005, hint: "Taille du lobe posé. C'est lui qui fixe la taille des fantômes : ils en sont des copies à l'échelle. Sous ~0,08 la forme du diaphragme ne survit pas au lissage et les fantômes redeviennent ronds" },
    { name: "sourceIntensity", label: "Intensité de la source posée", unit: "none", min: 0, max: 8, default: 0, step: 0.1, hint: "À 0, aucune source n'est posée et le flare ne part que des hautes lumières de la photo. Au-dessus, un lobe s'ajoute à l'endroit choisi — et comme il porte la forme du diaphragme, ses fantômes l'héritent" },
    { name: "blades", label: "Lames du diaphragme", unit: "none", min: 0, max: 12, default: 6, step: 1, hint: "Forme du lobe posé, donc de ses fantômes. Six lames donnent des hexagones, cinq des pentagones. Sous 3, le diaphragme est circulaire. C'est le MÊME diaphragme que celui de Lens blur — un objectif n'en a qu'un" },
    { name: "bladeRotation", label: "Rotation du diaphragme", unit: "degrees", min: 0, max: 180, default: 0, step: 1, hint: "Oriente le polygone. Sans objet sous 3 lames" },
    // ── LA CHAÎNE DE FANTÔMES ────────────────────────────────────────────────
    { name: "ghostCount", label: "Nombre de fantômes", unit: "none", min: 0, max: GHOSTS_MAX, default: 5, step: 1, hint: "Combien de reflets dans la chaîne. Chacun correspond à un couple de faces de l'objectif ; un zoom en compte plus qu'une focale fixe, et c'est ce qui les distingue à l'œil" },
    { name: "ghostSpacing", label: "Espacement", unit: "percent", min: 0.05, max: 1.2, default: 0.35, step: 0.01, hint: "Écart entre deux fantômes le long de l'axe source-centre. Bas = ils se serrent près du miroir de la source ; haut = la chaîne traverse tout le cadre" },
    { name: "ghostIntensity", label: "Intensité des fantômes", unit: "none", min: 0, max: 4, default: 0.7, step: 0.05, hint: "Force de la chaîne. À 0, avec l'anneau et le voile aussi à 0, les sept passes internes ne tournent PAS — l'effet ne coûte alors rien du tout" },
    { name: "ghostDispersion", label: "Dérive de teinte", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "Fait tourner la teinte le long de la chaîne — le traitement anti-reflet ne renvoie pas la même couleur à chaque face. 0 = tous les fantômes de la même teinte, ce qu'aucun objectif ne fait" },
    { name: "tintHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 30, step: 1, colorGroup: { key: "tint", role: "hue", label: "Teinte du traitement" } },
    { name: "tintSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, colorGroup: { key: "tint", role: "saturation", label: "Teinte du traitement" } },
    { name: "tintLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "tint", role: "lightness", label: "Teinte du traitement" } },
    // ── L'ANNEAU ET LE VOILE ─────────────────────────────────────────────────
    { name: "haloIntensity", label: "Intensité de l'anneau", unit: "none", min: 0, max: 4, default: 0.4, step: 0.05, hint: "Le cercle irisé autour de l'axe optique. Centré sur le CENTRE du cadre et non sur la source, parce que c'est l'axe de l'objectif qui le produit — c'est ce qui le distingue d'un halo de diffusion" },
    { name: "haloRadius", label: "Rayon de l'anneau", unit: "percent", min: 0.05, max: 0.9, default: 0.42, step: 0.01, hint: "Distance de l'anneau au centre du cadre, en fraction de la plus petite dimension" },
    { name: "veil", label: "Voile", unit: "none", min: 0, max: 2, default: 0.25, step: 0.01, hint: "Le lavage général du contraste quand une source forte entre dans le champ. Ajoute une lumière SCALAIRE teintée, pas une copie floutée de l'image — c'est ce qui remonte les noirs sans redessiner les formes, et ce qui sépare un voile d'un glow" },
  ],
  passes: [
    // Seuillage + injection de la source posée, fondus (voir FLARE_BRIGHT_WGSL).
    { scale: 0.5, wgsl: FLARE_BRIGHT_WGSL, enabled: flareActif },
    // DEUX NIVEAUX, ET PAS QUATRE COMME `glow`. Corrigé sur pièce : à quatre
    // niveaux la chaîne descend au 1/16, et un lobe de diaphragme de 12 px n'y
    // survit pas — les fantômes sortaient RONDS, ce qui vide de son sens toute
    // la mécanique d'injection qui leur donne leurs arêtes.
    //
    // C'est une différence de NATURE avec un bloom, pas un réglage : le halo
    // d'un glow EST un flou, donc plus il est profond mieux c'est. Un fantôme
    // est une IMAGE de l'ouverture — la pyramide ne sert ici qu'à ne pas
    // crénerler quand il rétrécit, et le curseur `Étalement` fait le reste.
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL, enabled: flareActif },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL, enabled: flareActif },
    { scale: 0.25, wgsl: upsampleWgsl(P_SPREAD), enabled: flareActif },
    { scale: 0.5, wgsl: upsampleWgsl(P_SPREAD), enabled: flareActif },
  ],
  canvasRegion: { centerX: "sourceX", centerY: "sourceY", radius: "sourceRadius" },
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${OKLAB_WGSL}

const FLARE_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

/** Une lecture du champ de hautes lumières, hors cadre comprise.
 *
 *  ⚠️ CLAMPÉE ET NON REPLIÉE, contrairement à presque tout le reste du dossier.
 *  Un fantôme lit très loin du pixel courant — c'est sa définition — et
 *  \`mirrorUv\` ferait alors RÉAPPARAÎTRE une source réelle par réflexion sur le
 *  bord, donc un fantôme fantôme, à un endroit qu'aucune optique ne justifie.
 *  Hors du champ seuillé il n'y a pas de lumière, et c'est exactement ce que le
 *  bord noir dit. */
fn flare_lire(uv: vec2<f32>) -> vec3<f32> {
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    return vec3<f32>(0.0);
  }
  return textureSampleLevel(prevPass, srcSampler, uv, 0.0).rgb;
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let ghostIntensity = max(params[10], 0.0);
  let haloIntensity = max(params[15], 0.0);
  let veil = max(params[17], 0.0);

  // SORTIE ANTICIPÉE, ET C'EST UNE CONDITION DE CORRECTION. Le prédicat est le
  // JUMEAU EXACT de celui des sept passes : quand elles sautent, \`prevPass\`
  // reçoit la texture SOURCE, et tout ce qui suit ajouterait l'image à
  // elle-même. Voir l'avertissement porté par \`EffectPass.enabled\`.
  if (ghostIntensity <= 0.0 && haloIntensity <= 0.0 && veil <= 0.0) {
    return color;
  }

  let dims = vec2<f32>(textureDimensions(srcTexture));
  let ar = aspectScale(dims);
  let centre = vec2<f32>(0.5, 0.5);
  // Écart au centre optique, en unités ISOTROPES : sans ça la chaîne de
  // fantômes sortirait de l'axe sur une photo 3:2, et l'anneau serait un ovale.
  let versCentre = (uv - centre) * ar;
  let dCentre = length(versCentre);
  // Demi-diagonale isotrope : la plus grande distance au centre, donc l'échelle
  // naturelle des atténuations qui suivent.
  let dMax = length(vec2<f32>(0.5) * ar);

  // TEINTE DU TRAITEMENT, en OKLCH. Elle sort du picker en sRGB — valeur
  // perceptuelle, exactement ce qu'affiche la pastille — donc décodée vers le
  // linéaire avant tout mélange, comme l'encre de duotone.
  let teinteRvb = srgb_to_linear3(hsl2rgb(params[12] / 360.0, params[13], params[14]));
  let teinteLch = oklab_to_oklch(linear_srgb_to_oklab(teinteRvb));
  let derive = clamp(params[11], 0.0, 1.0);

  var flare = vec3<f32>(0.0);

  // ─── LES FANTÔMES ───────────────────────────────────────────────────────
  //
  // Lus et non dessinés : pour ce pixel, le fantôme d'indice i vaut le champ de
  // hautes lumières au point \`centre + (uv - centre) * s\`, avec s négatif. À
  // s = -1 le fantôme est le miroir exact de la source par le centre optique ;
  // plus s s'éloigne, plus le fantôme est petit et proche de l'axe.
  //
  // Borne de boucle CONSTANTE (\`GHOSTS_MAX\`) et compte lu d'un uniforme : WGSL
  // n'accepte pas une borne dynamique, et le curseur s'arrête au même chiffre.
  if (ghostIntensity > 0.0) {
    let compte = i32(clamp(params[8], 0.0, ${GHOSTS_MAX}.0) + 0.5);
    let espacement = max(params[9], 0.01);
    for (var i = 0; i < ${GHOSTS_MAX}; i = i + 1) {
      if (i >= compte) { break; }
      let s = -1.0 - f32(i) * espacement;
      let uvS = centre + (uv - centre) * s;

      // ATTÉNUATION VERS LES BORDS. Sans elle la chaîne garde la même force
      // jusqu'au coin du cadre et se lit comme une rangée de gommettes ; la
      // lumière réfléchie, elle, rate le capteur d'autant plus qu'elle est loin
      // de l'axe.
      //
      // EXPOSANT 1 ET NON 2, corrigé sur pièce. Au carré, le fantôme d'indice 0
      // — le miroir exact de la source par le centre, donc le plus lisible et
      // celui qui SIGNE le flare — tombait à 19 % quand les suivants, plus près
      // de l'axe, passaient devant. La chaîne se lisait à l'envers.
      let att = clamp(1.0 - dCentre / dMax, 0.0, 1.0);

      // DÉRIVE DE TEINTE, EN OKLCH. La faire par permutation de canaux — l'astuce
      // habituelle — ferait varier la CLARTÉ en même temps que la teinte, et la
      // chaîne clignoterait du clair au sombre sous un curseur censé ne régler
      // que la couleur. Même mesure que celle qui a fait passer la roue
      // d'\`outlines\` en OKLCH.
      let t = f32(i) / max(f32(${GHOSTS_MAX} - 1), 1.0);
      let teinteI = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
        teinteLch.x, teinteLch.y, fract(teinteLch.z + derive * t)
      )));
      flare = flare + flare_lire(uvS) * teinteI * att;
    }
    flare = flare * ghostIntensity;
  }

  // ─── L'ANNEAU ───────────────────────────────────────────────────────────
  //
  // Centré sur le CENTRE DU CADRE et non sur la source, et ce n'est pas une
  // approximation : l'anneau vient de la réflexion sur une face SPHÉRIQUE, donc
  // il est centré sur l'axe optique quelle que soit la position de la source.
  // C'est précisément ce qui le distingue d'un halo de diffusion, lequel suit
  // la source. Le confondre donnerait un glow déguisé.
  if (haloIntensity > 0.0) {
    let rayon = clamp(params[16], 0.05, 0.9);

    // SOMME AZIMUTALE, ET C'EST CE QUI FAIT UN ANNEAU PLUTÔT QU'UN ARC.
    //
    // Deux écritures fausses ont précédé, et les deux paraissent la bonne :
    //
    // 1. \`uv - dir * rayon\` — un pas de \`rayon\` vers le centre depuis le pixel
    //    courant. Chaque pixel lit alors un point DIFFÉRENT, donc une source
    //    ponctuelle n'est vue que par un pixel : rien ne se forme du tout. Le
    //    garde de signal du harnais a refusé d'écrire la référence.
    // 2. \`centre - dir * rayon\` — le point diamétralement opposé, à distance
    //    fixe du centre. Mieux : tous les pixels d'un même rayon lisent le même
    //    point. Mais seul le SECTEUR face à la source s'allume, puisque les
    //    autres angles ne trouvent rien. Ça rend un ARC, et l'image l'a montré.
    //
    // Un anneau demande que chaque point du tour connaisse l'énergie de TOUT le
    // tour — une intégrale azimutale. Huit prélèvements régulièrement espacés
    // sur le cercle de rayon \`rayon\` suffisent : leur moyenne est l'énergie
    // trouvée à cette distance de l'axe, et elle est peinte sur tout l'anneau.
    // C'est la bonne physique par le bon bout : une face sphérique renvoie la
    // source en la répartissant sur un cercle centré sur l'AXE, pas en la
    // laissant là où elle est.
    var energie = vec3<f32>(0.0);
    for (var k = 0; k < 8; k = k + 1) {
      let a = f32(k) * 0.7853981633974483;
      energie = energie + flare_lire(centre + (vec2<f32>(cos(a), sin(a)) * rayon) / ar);
    }
    energie = energie * 0.125;

    // Profil d'anneau : un pic autour du rayon demandé, large de la moitié de
    // celui-ci. Au carré pour que le bord s'éteigne tangentiellement — une rampe
    // linéaire poserait deux plis fins de part et d'autre, soit deux traits au
    // lieu d'un anneau.
    let ring = clamp(1.0 - abs(dCentre - rayon) / max(rayon * 0.5, 1e-3), 0.0, 1.0);
    flare = flare + energie * teinteRvb * (ring * ring) * haloIntensity;
  }

  // ─── LE VOILE ───────────────────────────────────────────────────────────
  //
  // Une lumière SCALAIRE teintée, pas une copie floutée de l'image. C'est toute
  // la différence avec un glow : le glow ajoute la couleur LOCALE et redessine
  // donc les formes en plus clair ; le voile ajoute une lumière uniforme dont
  // seule la QUANTITÉ suit la lumière parasite, et remonte les noirs sans que
  // rien de nouveau n'apparaisse. C'est la perte de contraste qu'on lit sur une
  // photo à contre-jour.
  if (veil > 0.0) {
    let energie = dot(flare_lire(uv), FLARE_LUMA);
    flare = flare + teinteRvb * energie * veil;
  }

  // ADDITIF. Une lumière parasite s'AJOUTE — elle ne remplace rien. Un flare
  // composé en \`mix\` masquerait l'image sous lui, ce qui est exactement le
  // rendu « calque de flare posé par-dessus » que cet effet doit éviter.
  return vec4<f32>(color.rgb + flare, color.a);
}
`,
};
