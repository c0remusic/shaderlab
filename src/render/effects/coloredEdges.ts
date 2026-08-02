import type { EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
import { INPUT_DRIVER_WGSL, inputSourceParam } from "./inputMode";
import { EDGE_GRADIENT_WGSL, EDGE_SPACING_WGSL, SCHARR_NORM } from "./edgeGradient";
import { OKLAB_WGSL } from "./oklab";
import {
  LINEAR_TO_SRGB_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Colored edges — les contours, colorés par leur ORIENTATION.
 *
 * D'OÙ ÇA VIENT. Demandé par Antoine le 2026-08-01 ; `Colored edges` figure au
 * catalogue Figma des shaders (Ellie Lin), et sa fiche n'a pas pu être lue — la
 * page ne publie que ses quatre vedettes. Conçu donc d'après la référence de
 * détection de contours, écart avec Figma assumé et écrit ici.
 *
 * CE QUI LE SÉPARE D'`outlines`, et pourquoi ce n'est pas un doublon. La
 * question est légitime : les deux tracent des bords, et depuis ce commit ils
 * partagent le MÊME détecteur (`edgeGradient.ts`). Ce qu'ils font de la mesure
 * n'a rien à voir :
 *
 * - `outlines` jette la DIRECTION du gradient et n'en garde que la magnitude.
 *   Son trait est d'une seule encre, choisie au sélecteur. Le résultat est un
 *   dessin — silhouette, dessin au trait sur fond délavé.
 * - `coloredEdges` garde la direction et en fait une TEINTE. Deux bords d'une
 *   même forme, orientés différemment, sortent de deux couleurs différentes ;
 *   un contour fermé parcourt le cercle chromatique. Le résultat n'est pas un
 *   dessin mais une lecture de la géométrie, celle qu'on reconnaît sur une
 *   carte de normales.
 *
 * Aucun réglage d'`outlines` ne produit ça, et aucun empilement non plus : la
 * direction du gradient n'existe nulle part ailleurs dans le pipeline.
 *
 * TROIS CHOSES QUI ÉVITENT LE RENDU CHEAP :
 *
 * 1. **La direction tient compte des contours ISOLUMINANTS.** Un gradient de
 *    luminance seul est aveugle à une fleur rouge sur des feuilles vertes : sa
 *    direction y serait du bruit, donc la teinte y scintillerait pixel à pixel.
 *    Le vecteur d'orientation somme donc le gradient de ton et celui de
 *    chromaticité, avec le même poids que celui qui règle déjà la magnitude.
 * 2. **La teinte est CYCLIQUE, comme l'angle qu'elle représente.** Un angle
 *    fait le tour ; une rampe de teinte qui ne boucle pas poserait une couture
 *    visible sur les bords orientés à 180°, là où le rouge redeviendrait
 *    brutalement du violet. `fract` sur un tour de roue supprime la couture par
 *    construction.
 * 3. **Le trait reste antialiasé par le plancher `fwidth`**, exactement comme
 *    `outlines` : la largeur de la bascule ne descend jamais sous la variation
 *    de la magnitude d'un pixel écran à l'autre. Un contour coloré crénelé
 *    serait deux fois plus visible qu'un contour noir, puisque l'escalier y
 *    change aussi de teinte.
 *
 * COÛT : 8 taps (ceux du module partagé), une seule passe.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * REFONTE DU 2026-08-02 — LA ROUE ÉTAIT EN HSL, ET C'EST TOUT LE DÉFAUT
 *
 * Verdict d'usage d'Antoine : « horrible, inutilisable ». Le §6quinquies avait
 * pourtant écrit « conçu à l'aveugle, et tombé juste » — un verdict de SURFACE
 * DE CONTRÔLE (les paramètres correspondent bien à la fiche), pas de rendu.
 *
 * CE QUE LA MESURE DIT, et qui nomme le défaut mieux que le mot « horrible ».
 * Sur la référence de rendu, les pixels encrés groupés par secteur de teinte :
 *
 *     secteur     L (OKLab)   chroma
 *       0°          0,617      0,225
 *      90°          0,883      0,175
 *     180°          0,861      0,141
 *     240°          0,534      0,228
 *     300°          0,557      0,261
 *
 * Un SEUL curseur `Luminosité`, réglé à une seule valeur — et la clarté
 * réellement perçue balaie **0,349**, soit plus du tiers de l'échelle, selon
 * l'orientation du bord. Le chroma varie du simple au double.
 *
 * Autrement dit : l'effet promet « la teinte vient de l'orientation » et livre
 * « la teinte ET la clarté ET le chroma viennent de l'orientation ». Deux des
 * trois ne sont voulus par personne. Un bord horizontal et un bord vertical ne
 * diffèrent pas par leur couleur, l'un est presque noir et l'autre éclate.
 *
 * LA CAUSE EST STRUCTURELLE, pas un mauvais réglage : `hsl2rgb` prend une
 * saturation et une clarté qui ne sont PAS perceptuelles. À `s = 0.85`,
 * `l = 0.55`, le jaune HSL et le bleu HSL n'ont ni la même clarté ni le même
 * chroma — aucun réglage des douze paramètres ne peut le corriger, parce que
 * la variation est dans la conversion elle-même.
 *
 * LE CORRECTIF est le seul qui attaque la cause : la couleur du trait est
 * construite en **OKLCH**, où parcourir la teinte à L et C constants donne
 * précisément une clarté et un chroma constants. C'est la même conclusion que
 * la mesure de `gradientMap` avait déjà tirée pour les rampes de teinte, et le
 * dossier a déjà l'espace sous la main (`oklab.ts`).
 *
 * DEUX CONSÉQUENCES à ne pas découvrir plus tard :
 * - Les paramètres gardent leurs NOMS (`saturation`, `lightness`) pour ne pas
 *   réinitialiser les presets qui les citent, mais changent d'INTERPRÉTATION et
 *   d'étiquette : `saturation` pilote désormais un chroma OKLab, `lightness` un
 *   L OKLab. Un preset existant garde donc ses valeurs et rend autre chose —
 *   c'est le propre d'une refonte, et c'est écrit ici plutôt que subi.
 * - Le chroma est BORNÉ à 0,30. Au-delà, la plupart des teintes sortent du
 *   gamut sRGB ; la conversion ne borne rien (choix documenté d'`oklab.ts`),
 *   donc l'écrêtage de la cible ramènerait exactement les teintes néon qu'on
 *   vient de retirer, et la roue redeviendrait irrégulière par le bas.
 */
/** Chroma OKLab maximal du trait. Au-delà, la plupart des teintes quittent le
 *  gamut sRGB — et comme `oklab_to_linear_srgb` ne borne rien (choix documenté
 *  d'`oklab.ts` : l'écrêtage appartient à la cible), une valeur plus haute
 *  rendrait la roue irrégulière PAR L'ÉCRÊTAGE, soit exactement le défaut que
 *  le passage en OKLCH vient de corriger. */
const EDGE_CHROMA_MAX = 0.3;

export const coloredEdges: EffectModule = {
  id: "coloredEdges",
  name: "Colored edges",
  params: [
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 12, default: 2, step: 0.1, hint: "Écartement des taps — épaissit le trait et, du même geste, empêche le grain d'être dessiné" },
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 0.6, default: 0.07, step: 0.005, hint: "Contraste minimal (en tons perceptuels, sur l'épaisseur du trait) pour qu'un contour soit tracé" },
    { name: "softness", label: "Fondu du trait", unit: "percent", min: 0, max: 1, default: 0.3, step: 0.01, hint: "0 = trait franc (toujours antialiasé), 1 = trait fondu qui s'éteint progressivement sur les contours faibles" },
    { name: "chroma", label: "Sensibilité couleur", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Fait lever les contours entre deux couleurs de MÊME luminosité, et empêche leur teinte de scintiller faute d'orientation lisible. Sans objet en entrée Alpha" },
    { name: "hueOffset", label: "Rotation des teintes", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "Fait tourner la roue chromatique : choisit quelle couleur reçoit un bord horizontal" },
    { name: "hueSpread", label: "Étendue des teintes", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, hint: "Part du cercle chromatique parcourue par un tour complet d'orientation. 1 = toutes les teintes ; bas = une gamme resserrée autour de la rotation" },
    // Noms CONSERVÉS (les presets les citent), interprétation et étiquettes
    // changées : ce sont désormais les deux axes non circulaires d'OKLCH.
    { name: "saturation", label: "Chroma", unit: "percent", min: 0, max: 1, default: 0.42, step: 0.01, hint: "Vivacité des contours, en chroma PERCEPTUEL — la même valeur donne la même vivacité à toutes les teintes, ce que la saturation HSL ne savait pas faire. Borné au gamut sRGB : au-delà, les teintes seraient écrêtées et redeviendraient irrégulières" },
    { name: "lightness", label: "Clarté", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, hint: "Clarté PERCEPTUELLE des contours. Constante sur tout le tour de la roue — avant la refonte du 2026-08-02, elle balayait 0,349 selon la seule orientation du bord" },
    { name: "wash", label: "Effacement du fond", unit: "percent", min: 0, max: 1, default: 0.45, step: 0.01, hint: "Fait disparaître la photo sous les contours au profit de la couleur de fond — 0 = contours sur la photo intacte, 1 = contours seuls sur la couleur de fond" },
    { name: "backgroundHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "background", role: "hue", label: "Couleur de fond" } },
    { name: "backgroundSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "background", role: "saturation", label: "Couleur de fond" } },
    { name: "backgroundLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, colorGroup: { key: "background", role: "lightness", label: "Couleur de fond" } },
    inputSourceParam(),
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INPUT_DRIVER_WGSL}${EDGE_GRADIENT_WGSL}${EDGE_SPACING_WGSL}${OKLAB_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[1];
  let softness = clamp(params[2], 0.0, 1.0);
  let chroma = clamp(params[3], 0.0, 1.0);
  let hueOffset = params[4] / 360.0;
  let hueSpread = clamp(params[5], 0.05, 1.0);
  let saturation = clamp(params[6], 0.0, 1.0);
  let lightness = clamp(params[7], 0.0, 1.0);
  let wash = clamp(params[8], 0.0, 1.0);
  let source = params[12];

  // Détecteur PARTAGÉ avec \`outlines\` (effects/edgeGradient.ts) : mêmes huit
  // taps, mêmes poids de Scharr, même écartement isotrope. Ce qui diffère
  // commence en dessous.
  let g = edge_scharr(uv, edge_spacing(params[0]), source);
  let gx = g.gx;
  let gy = g.gy;

  // MAGNITUDE — identique à celle d'\`outlines\`, et pour les mêmes raisons :
  // \`max\` et non somme (un contour de luminance net ne doit pas s'épaissir
  // parce qu'il est accessoirement coloré), facteur 3 pour ramener l'échelle de
  // la chromaticité sur celle du ton.
  let toneMag = sqrt(gx.x * gx.x + gy.x * gy.x) / ${SCHARR_NORM}.0;
  let chromaMag = sqrt(gx.y * gx.y + gy.y * gy.y + gx.z * gx.z + gy.z * gy.z) / ${SCHARR_NORM}.0;
  let mag = max(toneMag, chroma * 3.0 * chromaMag);

  // ORIENTATION — c'est ici que cet effet se sépare d'\`outlines\`, qui jette
  // cette information. Le vecteur somme le gradient de TON et celui de
  // CHROMATICITÉ : sur un contour isoluminant, le premier est nul et sa
  // direction serait du bruit, donc la teinte scintillerait pixel à pixel. Le
  // poids est le même que celui qui règle la magnitude — un seul curseur pour
  // une seule notion.
  let gTone = vec2<f32>(gx.x, gy.x);
  let gChroma = vec2<f32>(gx.y + gx.z, gy.y + gy.z);
  let dirVec = gTone + chroma * 3.0 * gChroma;
  // atan2 rend -PI..PI ; ramené en TOURS, comme la teinte. \`fract\` referme le
  // cercle : sans lui, les bords orientés à 180° porteraient une couture, là où
  // la rampe de teinte sauterait d'un bout à l'autre de la roue.
  let turns = atan2(dirVec.y, dirVec.x) / 6.283185307179586;
  let hue = fract(hueOffset + turns * hueSpread);

  // LARGEUR DE LA BASCULE, RELATIVE AU SEUIL — voir \`outlines\`, qui porte la
  // mesure. Les deux effets partagent le détecteur ET partageaient ce défaut
  // d'échelle : une constante absolue (\`softness * 0.5\` = 0,175 au défaut) plus
  // large que tout le signal utile (un contour franc rend \`mag\` ≈ 0,16), donc
  // aucun contour n'atteignait l'encre pleine et les secondaires disparaissaient.
  // C'est la moitié de l'explication du « horrible, inutilisable » qui visait
  // les deux effets ensemble — l'autre moitié était la roue HSL, corrigée la
  // veille.
  //
  // Plancher fwidth conservé : un contour COLORÉ crénelé serait deux fois plus
  // visible qu'un contour noir, puisque l'escalier y changerait aussi de teinte.
  let band = max(max(softness * max(threshold, 0.02), fwidth(mag)), 0.0005);
  let line = smoothstep(threshold, threshold + band, mag);

  // COULEUR DU TRAIT, en OKLCH — et c'est tout le correctif du 2026-08-02.
  // Parcourir la teinte à L et C constants y donne une clarté et un chroma
  // constants, ce qui est exactement ce qu'exige une roue pilotée par un ANGLE.
  // En HSL, le même geste faisait varier la clarté perçue de 0,349 sur le tour
  // (mesure en tête de fichier) : deux bords d'orientation différente ne
  // différaient pas par leur couleur, l'un était presque noir et l'autre
  // éclatait.
  //
  // \`oklch_to_oklab\` attend la teinte en TOURS, ce que \`hue\` est déjà —
  // aucune constante d'angle à ressaisir, c'est la raison d'être de cette
  // convention (voir \`oklab.ts\`).
  //
  // Le chroma est borné à ${EDGE_CHROMA_MAX} : au-delà, la plupart des teintes
  // sortent du gamut sRGB, la conversion ne borne rien, et l'écrêtage de la
  // cible ramènerait les teintes néon que cette refonte retire.
  let edgeColor = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(lightness, saturation * ${EDGE_CHROMA_MAX}, hue)));
  // FOND. Une COULEUR, pas un blanc imposé — la référence Figma expose un
  // Background et une Opacity là où cette ligne ne savait fondre que vers le
  // blanc. Le défaut (teinte 0, saturation 0, luminosité 1) EST le blanc, donc
  // le rendu d'avant ce paramètre est conservé au bit près ; ce qui change,
  // c'est qu'un fond noir ou coloré devient atteignable, et avec lui le rendu
  // d'affiche que le blanc seul interdisait.
  let background = srgb_to_linear3(hsl2rgb(params[9] / 360.0, params[10], params[11]));
  let paper = mix(color.rgb, background, wash);
  return vec4<f32>(mix(paper, edgeColor, line), color.a);
}
`,
};
