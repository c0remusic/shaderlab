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
 * Outlines — trace les contours de l'image, du simple rehaut de silhouette au
 * dessin au trait sur fond délavé, à l'encre unique ou colorés par leur
 * ORIENTATION.
 *
 * ─── FUSION DU 2026-08-03 : `coloredEdges` A ÉTÉ ABSORBÉ ICI ────────────────
 *
 * Les deux effets partageaient déjà leur détecteur (`edgeGradient.ts`) et cinq
 * paramètres sur les huit du premier — `thickness`, `threshold`, `softness`,
 * `chroma`, `wash` — écrits deux fois, aux mêmes valeurs, avec les mêmes
 * infobulles. Ce qui les séparait tenait en UNE décision : que fait-on de la
 * DIRECTION du gradient ? L'un la jette et trace une encre unique ; l'autre la
 * garde et en fait une teinte. Une décision n'est pas un effet, c'est un mode —
 * d'où le paramètre `inkMode`, et l'arbitrage d'Antoine qui l'a demandé.
 *
 * L'ORDRE DES NEUF PREMIERS PARAMÈTRES EST CELUI D'`outlines`, INCHANGÉ, et ce
 * n'est pas de la courtoisie : l'index d'un paramètre est PERSISTÉ dans les
 * presets, et les références de pixels `effet-outlines` / `effet-outlines-bruit`
 * doivent rester valables AU BIT à travers la fusion. Tout ce qui vient de
 * `coloredEdges` est donc ajouté À LA SUITE, et `inkMode` a pour défaut l'encre
 * unique — le rendu d'`outlines` est rigoureusement celui d'avant.
 *
 * ⚠️ L'id `coloredEdges` disparaît : un preset qui le cite perd ce calque avec
 * un avertissement (`presetDocument.ts`), il ne plante pas. Le rendu, lui, est
 * atteignable au pixel près — ses deux scénarios de rendu ont été portés ici en
 * remappant leurs paramètres, et les images sont sorties identiques à l'octet.
 * C'est ce qui autorise à dire que la fusion ne perd rien, plutôt qu'à l'espérer.
 *
 * ─── LA VERSION NAÏVE, et pourquoi elle rend « filtre Photoshop 2005 » ───────
 *
 * Sobel sur la luminance, seuil binaire, trait noir. Quatre pannes, toutes
 * visibles à l'œil, toutes corrigées ici :
 *
 * 1. **Le seuil binaire crénelle.** Un contour est une isoligne : la trancher à
 *    un booléen produit un escalier de pixels. Ici le seuil est un
 *    `smoothstep`, et sa largeur ne descend JAMAIS sous `fwidth(mag)` — la
 *    dérivée écran de la magnitude. Le trait est donc antialiasé par
 *    construction, quelle que soit la position du curseur « Fondu ». C'est le
 *    même garde-fou analytique que l'overlay de masque (`effectPassRunner.ts`).
 *
 * 2. **Sobel n'est pas isotrope.** Ses poids (1,2,1) donnent une réponse qui
 *    dépend de l'ORIENTATION du contour : une diagonale sort ~10 % plus faible
 *    qu'une verticale, donc un même seuil ouvre les traits horizontaux et ferme
 *    les obliques — le dessin se troue par endroits sans raison lisible. Les
 *    poids de Scharr (3,10,3) sont l'optimum de symétrie de rotation pour un
 *    noyau 3x3 ; le trait garde le même poids dans toutes les directions.
 *    En mode Roue, cette isotropie n'est plus un confort mais une CONDITION :
 *    une réponse qui dépend de l'orientation ferait varier la teinte avec elle.
 *
 * 3. **Le gradient d'une image LINÉAIRE mesure un niveau, pas un contraste.**
 *    C'est la panne la plus grave et la moins soupçonnée : en lumière linéaire,
 *    l'écart entre deux tons voisins est proportionnel au niveau local. Un même
 *    contraste perçu produit donc un gradient ~10x plus grand dans une haute
 *    lumière que dans une ombre — le filtre entoure les ciels et ignore
 *    entièrement les zones sombres, et le seuil devient un réglage
 *    d'EXPOSITION déguisé. Le gradient est donc mesuré sur le ton PERCEPTUEL
 *    (`linear_to_srgb(luma)`), ce qui normalise la réponse : c'est le même
 *    usage, déjà précédent dans ce dépôt, que la courbe de `grain` et les
 *    bascules de `duotone` — on POSITIONNE une réponse sur l'axe perceptuel,
 *    on ne modifie aucune valeur de couleur.
 *
 * 4. **Un gradient de luminance est aveugle aux contours isoluminants.** Une
 *    fleur rouge sur des feuilles vertes, un vêtement sur une peau : mêmes
 *    luminances, contour bien réel, et Sobel n'y voit rien. Le curseur
 *    « Sensibilité couleur » ajoute un second gradient, calculé sur la
 *    CHROMATICITÉ (les écarts de canaux normalisés par leur somme, donc
 *    indépendants de l'exposition). Sans tap supplémentaire : les mêmes neuf
 *    échantillons portent les deux mesures.
 *
 * ─── LA ROUE EST EN OKLCH, ET C'EST UN CORRECTIF PAYÉ ───────────────────────
 *
 * Elle était en HSL jusqu'au 2026-08-02, et le verdict d'usage était « horrible,
 * inutilisable ». Mesuré sur les seuls pixels pleinement encrés, pour un unique
 * curseur `Clarté` : la clarté RÉELLEMENT PERÇUE balayait **0,290** selon la
 * seule orientation du bord (bleu à 0,534, vert-jaune à 0,883). L'effet
 * promettait « la teinte vient de l'orientation » et livrait « la teinte ET la
 * clarté ET le chroma viennent de l'orientation ». Reconstruite en OKLCH :
 * étendue **0,018**, seize fois moins.
 *
 * ENTRÉE (2026-08-01, cahier de références §6bis). Figma expose trois modes
 * d'entrée sur son équivalent : Luma, Luma INVERSÉ, Alpha. Nous en exposons
 * DEUX, et le troisième est écarté sur preuve : cet effet mesure un GRADIENT,
 * or |∇(1−x)| = |∇x| — inverser la luminance laisse la magnitude rigoureusement
 * inchangée, donc le trait tracé serait identique au pixel près. « Luma
 * inversé » ici serait un contrôle inerte, l'échec silencieux que ce dépôt
 * proscrit (voir `INPUT_SOURCE_CHOICES`). L'entrée Alpha, elle, mord sur du
 * réel depuis que la toile porte une couverture (« le fond devient un calque »,
 * 2026-07-28) : elle trace la SILHOUETTE d'un élément de montage, ce que le
 * gradient de luminance ne sait pas voir quand l'élément et son fond ont des
 * tons voisins.
 *
 * ⚠️ Cette preuve vaut pour un DÉTECTEUR DE GRADIENT et pour lui seul. Un mode
 * de détection par SEUIL DE FORME — celui de la fiche Figma, où l'inversion
 * change tout (« Inverse luma uses darkness, for dark art or text on white ») —
 * la rendrait caduque. Il est demandé et pas encore écrit ; voir `echoOutlines`,
 * qui seuille déjà une forme.
 *
 * COÛT : 8 taps (le tap central a des poids nuls dans les deux noyaux de
 * Scharr — l'échantillonner serait une lecture payée pour être multipliée par
 * zéro), une seule passe, aucune texture intermédiaire. La fusion n'ajoute
 * AUCUN tap : les deux modes lisent la même mesure, ils n'en tirent pas la même
 * chose.
 */

/** Chroma OKLab maximal du trait en mode Roue. Au-delà, la plupart des teintes
 *  quittent le gamut sRGB — et comme `oklab_to_linear_srgb` ne borne rien (choix
 *  documenté d'`oklab.ts` : l'écrêtage appartient à la cible), une valeur plus
 *  haute rendrait la roue irrégulière PAR L'ÉCRÊTAGE, soit exactement le défaut
 *  que le passage en OKLCH vient de corriger. */
const EDGE_CHROMA_MAX = 0.3;

/** Modes d'encre. ⚠️ L'index est PERSISTÉ dans les presets : on ajoute à la FIN.
 *  `Encre unique` est en tête parce que c'est le comportement historique
 *  d'`outlines`, donc le défaut qui conserve son rendu au bit. */
const INK_MODES = ["Encre unique", "Roue d'orientation"] as const;
const INK_SINGLE = 0;

export const outlines: EffectModule = {
  id: "outlines",
  name: "Outlines",
  params: [
    // Écartement des taps, EN PIXELS. Il fait deux choses à la fois, et c'est
    // voulu : il donne son épaisseur au trait ET il agit comme passe-bas (des
    // taps écartés ne voient plus le grain). Un noyau à écartement fixe aurait
    // exigé un second curseur « lissage » pour ne pas dessiner le bruit.
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 12, default: 2.5, step: 0.1, hint: "Écartement des taps — épaissit le trait et, du même geste, empêche le grain d'être dessiné" },
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 0.6, default: 0.09, step: 0.005, hint: "Contraste minimal (en tons perceptuels, sur l'épaisseur du trait) pour qu'un contour soit tracé" },
    { name: "softness", label: "Fondu du trait", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "0 = trait franc (toujours antialiasé), 1 = trait fondu qui s'éteint progressivement sur les contours faibles" },
    { name: "chroma", label: "Sensibilité couleur", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Fait aussi lever les contours entre deux couleurs de MÊME luminosité (rouge/vert), qu'un contour de luminance ne voit pas. En Roue d'orientation, empêche en plus la teinte de scintiller faute d'orientation lisible. Sans objet en entrée Alpha : une couverture n'a pas de chromaticité." },
    { name: "inkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 210, step: 1, colorGroup: { key: "ink", role: "hue", label: "Encre" } },
    { name: "inkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "ink", role: "saturation", label: "Encre" } },
    { name: "inkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.06, step: 0.01, colorGroup: { key: "ink", role: "lightness", label: "Encre" } },
    // Effacement du fond. Il fondait vers du BLANC en dur jusqu'à la fusion ;
    // c'est désormais vers la couleur de fond ci-dessous, dont le défaut EST le
    // blanc — le rendu d'avant est donc conservé au bit, et un fond noir ou
    // coloré devient atteignable, avec lui le rendu d'affiche que le blanc seul
    // interdisait. Le mélange reste ADDITIF en linéaire : physiquement une
    // lumière parasite (veiling glare), pas un fondu en perceptuel qui
    // demanderait un gamma manuel, interdit ici. C'est pour ça qu'une petite
    // valeur agit déjà beaucoup — 0,20 en linéaire remonte un gris moyen de
    // ~0,48 à ~0,63 en perceptuel.
    { name: "wash", label: "Effacement du fond", unit: "percent", min: 0, max: 1, default: 0.2, step: 0.01, hint: "Fait disparaître la photo sous le trait au profit de la couleur de fond — 0 = contours sur la photo intacte, 1 = contours seuls" },
    inputSourceParam(),

    // ── CE QUI VIENT DE `coloredEdges` (fusion du 2026-08-03) ────────────────
    // Ajouté À LA SUITE et jamais au milieu : les huit index ci-dessus sont
    // persistés dans les presets d'`outlines`, et ses références de pixels
    // doivent rester valables au bit.
    { name: "inkMode", label: "Encre", unit: "none", min: 0, max: INK_MODES.length - 1, default: INK_SINGLE, step: 1, choices: [...INK_MODES], hint: "Encre unique : tous les contours à la couleur choisie ci-dessus. Roue d'orientation : la teinte vient de l'ANGLE du bord, donc deux bords d'une même forme sortent de deux couleurs — c'est l'ancien effet `Colored edges`" },
    { name: "hueOffset", label: "Rotation des teintes", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "Fait tourner la roue chromatique : choisit quelle couleur reçoit un bord horizontal. Sans objet en Encre unique" },
    { name: "hueSpread", label: "Étendue des teintes", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, hint: "Part du cercle chromatique parcourue par un tour complet d'orientation. 1 = toutes les teintes ; bas = une gamme resserrée autour de la rotation. Sans objet en Encre unique" },
    // Noms `wheelChroma` / `wheelLightness` et non `saturation` / `lightness` :
    // les anciens noms de `coloredEdges` auraient cohabité ici avec `inkSaturation`
    // et `inkLightness` sans qu'on puisse deviner lequel agit dans quel mode. Les
    // presets de `coloredEdges` ne survivent de toute façon pas au retrait de son
    // id, donc conserver ses noms n'aurait racheté personne.
    { name: "wheelChroma", label: "Chroma de la roue", unit: "percent", min: 0, max: 1, default: 0.42, step: 0.01, hint: "Vivacité des contours, en chroma PERCEPTUEL — la même valeur donne la même vivacité à toutes les teintes, ce que la saturation HSL ne savait pas faire. Bornée au gamut sRGB. Sans objet en Encre unique" },
    { name: "wheelLightness", label: "Clarté de la roue", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, hint: "Clarté PERCEPTUELLE des contours. Constante sur tout le tour de la roue — avant la refonte du 2026-08-02, elle balayait 0,290 selon la seule orientation du bord. Sans objet en Encre unique" },
    { name: "backgroundHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "background", role: "hue", label: "Couleur de fond" } },
    { name: "backgroundSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "background", role: "saturation", label: "Couleur de fond" } },
    { name: "backgroundLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, colorGroup: { key: "background", role: "lightness", label: "Couleur de fond" } },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INPUT_DRIVER_WGSL}${EDGE_GRADIENT_WGSL}${EDGE_SPACING_WGSL}${OKLAB_WGSL}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[1];
  let softness = clamp(params[2], 0.0, 1.0);
  let chroma = clamp(params[3], 0.0, 1.0);
  let wash = clamp(params[7], 0.0, 1.0);
  let source = params[8];
  let inkMode = i32(params[9] + 0.5);

  // Écartement des taps et noyau de Scharr : voir effects/edgeGradient.ts. Le
  // module est resté partagé après la fusion — \`echoOutlines\` le lit aussi, et
  // deux effets de contour posés sur la même photo doivent dessiner leurs bords
  // AU MÊME ENDROIT. Deux copies auraient dérivé, ce qui ressemble à un choix
  // esthétique et n'est qu'un copier-coller qui a vieilli.
  let g = edge_scharr(uv, edge_spacing(params[0]), source);
  let gx = g.gx;
  let gy = g.gy;

  // /32 : réponse du noyau à une rampe unité sur un écartement de tap. \`mag\`
  // se lit donc directement comme « écart de ton perceptuel sur l'épaisseur du
  // trait », et le seuil garde le même sens quand on change l'épaisseur.
  let toneMag = sqrt(gx.x * gx.x + gy.x * gy.x) / ${SCHARR_NORM}.0;
  let chromaMag = sqrt(gx.y * gx.y + gy.y * gy.y + gx.z * gx.z + gy.z * gy.z) / ${SCHARR_NORM}.0;
  // max, pas somme : un contour de luminance NET ne doit pas être renforcé
  // parce qu'il est accessoirement coloré (le trait s'épaissirait sur les
  // contours colorés et nulle part ailleurs). Les deux mesures sont deux
  // DÉTECTEURS du même contour, pas deux contributions à additionner.
  // Le facteur 3 ramène l'échelle de la chromaticité sur celle du ton, pour que
  // le curseur soit lisible sur toute sa course plutôt que sur son dernier
  // dixième.
  let mag = max(toneMag, chroma * 3.0 * chromaMag);

  // LARGEUR DE LA BASCULE, RELATIVE AU SEUIL (corrigé le 2026-08-03).
  //
  // Elle valait \`softness * 0.5\`, une constante ABSOLUE — et c'était l'erreur
  // d'échelle qui rendait les DEUX effets d'origine inutilisables. Mesure, sur
  // une mire à aplats bruités et deux marches franches :
  //
  //   marche de 0,32 de contraste  ->  52 % d'encre, jamais le noir
  //   marche de 0,14 de contraste  ->   5 % d'encre, invisible
  //   rapport 10,6 pour un rapport de contraste de 2,3
  //
  // La raison tient en une ligne : au défaut, \`softness * 0.5\` vaut 0,175 quand
  // un contour FRANC de cette mire ne produit qu'un \`mag\` de 0,16. La rampe du
  // smoothstep était donc plus large que tout le signal utile — elle dépensait
  // sa course entière sur les contours réels au lieu de trancher entre eux, si
  // bien qu'aucun contour n'atteignait jamais l'encre pleine et que les
  // secondaires disparaissaient.
  //
  // Rendue proportionnelle au SEUIL, la bascule a le même sens partout sur la
  // course : à \`softness\` = 1, elle s'étale de \`threshold\` à \`2 * threshold\`,
  // donc les contours au-delà du double du seuil sortent PLEINS quel que soit le
  // réglage. Le plancher de 0,02 garde un fondu utilisable à seuil nul, où une
  // largeur proportionnelle serait nulle.
  //
  // ⚠️ \`fwidth\` est calculé ICI, avant toute branche de mode : une dérivée
  // écran exige un flux de contrôle UNIFORME. La bascule ne descend jamais sous
  // la variation de \`mag\` d'un pixel à l'autre, ce qui interdit
  // structurellement le trait crénelé même à \`softness\` = 0 — et un contour
  // COLORÉ crénelé serait deux fois plus visible qu'un noir, puisque l'escalier
  // y changerait aussi de teinte.
  let band = max(max(softness * max(threshold, 0.02), fwidth(mag)), 0.0005);
  let line = smoothstep(threshold, threshold + band, mag);

  // COULEUR DU TRAIT. Le branchement est SÛR : \`inkMode\` vient d'un uniforme,
  // donc il est uniforme sur toute la passe — même raisonnement que
  // \`input_driver\` et que le style de \`dither\`. Aucune dérivée n'est lue ici.
  var edgeColor: vec3<f32>;
  if (inkMode == ${INK_SINGLE}) {
    // ENCRE UNIQUE. Elle sort du picker en sRGB (valeur PERCEPTUELLE, exactement
    // ce qu'affiche la pastille) : décodée vers le linéaire avant tout mélange,
    // comme duotone et glow.
    edgeColor = srgb_to_linear3(hsl2rgb(params[4] / 360.0, params[5], params[6]));
  } else {
    // ROUE D'ORIENTATION — c'est ici que l'ancien \`coloredEdges\` se séparait de
    // ce fichier, qui jetait cette information. Le vecteur somme le gradient de
    // TON et celui de CHROMATICITÉ : sur un contour isoluminant, le premier est
    // nul et sa direction serait du bruit, donc la teinte scintillerait pixel à
    // pixel. Le poids est le même que celui qui règle la magnitude — un seul
    // curseur pour une seule notion.
    let gTone = vec2<f32>(gx.x, gy.x);
    let gChroma = vec2<f32>(gx.y + gx.z, gy.y + gy.z);
    let dirVec = gTone + chroma * 3.0 * gChroma;
    // atan2 rend -PI..PI ; ramené en TOURS, comme la teinte. \`fract\` referme le
    // cercle : sans lui, les bords orientés à 180° porteraient une couture, là
    // où la rampe de teinte sauterait d'un bout à l'autre de la roue.
    let turns = atan2(dirVec.y, dirVec.x) / 6.283185307179586;
    let hue = fract(params[10] / 360.0 + turns * clamp(params[11], 0.05, 1.0));
    // En OKLCH, et c'est tout le correctif du 2026-08-02 : parcourir la teinte à
    // L et C constants y donne une clarté et un chroma constants, ce qu'exige
    // une roue pilotée par un ANGLE. \`oklch_to_oklab\` attend la teinte en
    // TOURS, ce que \`hue\` est déjà — aucune constante d'angle à ressaisir,
    // c'est la raison d'être de cette convention (voir \`oklab.ts\`).
    edgeColor = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
      clamp(params[13], 0.0, 1.0),
      clamp(params[12], 0.0, 1.0) * ${EDGE_CHROMA_MAX},
      hue
    )));
  }

  // FOND. Une COULEUR, pas un blanc imposé — la référence Figma expose un
  // Background là où \`outlines\` ne savait fondre que vers le blanc. Le défaut
  // (teinte 0, saturation 0, luminosité 1) EST le blanc, donc le rendu d'avant
  // la fusion est conservé au bit près.
  let background = srgb_to_linear3(hsl2rgb(params[14] / 360.0, params[15], params[16]));
  let paper = mix(color.rgb, background, wash);
  return vec4<f32>(mix(paper, edgeColor, line), color.a);
}
`,
};
