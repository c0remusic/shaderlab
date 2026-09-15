import type { DisplayCondition, EffectModule } from "./types";
import { HSL_TO_RGB_WGSL } from "./hsl";
import { UV_SPACE_WGSL } from "./uvSpace";
import {
  INPUT_DRIVER_WGSL,
  INPUT_SOURCE_LUMA,
  INPUT_SOURCE_LUMA_INVERTED,
  inputSourceParam,
} from "./inputMode";
import { EDGE_GRADIENT_WGSL, EDGE_SPACING_WGSL, SCHARR_NORM } from "./edgeGradient";
import { OKLAB_WGSL } from "./oklab";
import { DOWNSAMPLE_WGSL, upsampleWgsl } from "./blurChain";
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
 * ─── SECONDE FUSION, LE 2026-08-03 : `echoOutlines` A ÉTÉ ABSORBÉ ICI ────────
 *
 * Même arbitrage d'Antoine, prononcé le même jour, et exécuté après parce qu'il
 * était BLOQUÉ sur une capacité du pipeline : l'effet absorbé porte neuf passes
 * de pyramide quand les deux modes d'ici n'en ont aucune, et `runInternalPasses`
 * les exécutait sans condition. Fusionner avant `EffectPass.enabled` aurait fait
 * payer la pyramide au mode Crête de gradient, qui n'en lit rien.
 *
 * La capacité est arrivée le jour même, par un autre chemin. Les neuf passes
 * portent donc un prédicat sur `detectMode`, et deux propriétés du runner les
 * rendent gratuites hors mode Échos : la passe sautée n'ALLOUE pas (elle est
 * écartée avant d'emprunter sa cible), et `framePipelineExecutor` lie `prevPass`
 * dès que l'effet DÉCLARE des passes, pas dès qu'il en exécute — quand elles
 * sautent toutes, `prevPass` reçoit la texture source. Une seule variante de
 * shader pour les trois modes, donc une seule entrée de cache de pipeline.
 *
 * CE QUE LES TROIS MODES ONT DE COMMUN, et qui justifie qu'ils cohabitent : ils
 * répondent tous à « où passe le trait ? », et se distinguent par la question
 * posée à l'image. Crête de gradient demande « où l'image CHANGE-t-elle ? ».
 * Seuil de forme demande « où est la FRONTIÈRE du niveau demandé ? ». Échos de
 * la forme demande « à quelle DISTANCE de cette frontière suis-je ? » — et c'est
 * la seule des trois qu'aucun opérateur local ne sait calculer, d'où la pyramide.
 *
 * ⚠️ CE QUE LE MODE ÉCHOS PAIE EN TROP, écrit plutôt que découvert : les huit
 * taps de Scharr sont calculés dans les TROIS modes, alors que lui n'en lit
 * rien. Ce n'est pas un oubli — `fwidth(mag)` exige un flux de contrôle
 * uniforme, donc le gradient et sa dérivée sont hoistés avant toute branche
 * (voir le commentaire de `band`). Huit taps de plus sur la passe finale, à
 * comparer aux neuf passes pleine chaîne que le mode vient d'allumer : le
 * rapport ne justifiait pas de fragiliser l'antialiasing des deux autres modes.
 *
 * ⚠️ L'id `echoOutlines` disparaît, comme `coloredEdges` avant lui — même
 * conséquence, même garde (`presetDocument.ts` avertit, ne lève pas). Et son
 * rendu est atteignable AU BIT : son scénario de rendu a été porté ici en
 * remappant ses paramètres, et l'image est sortie identique à l'octet.
 *
 * LA QUESTION DE NOM SE RÉSOUT D'ELLE-MÊME, et c'est un effet de bord heureux.
 * Le cahier de références la laissait ouverte : la fiche Figma appelle
 * `Outlines` l'effet à échos, et nous appelions `Outlines` le détecteur — deux
 * choses sous un nom. Il n'y a plus deux choses. Le nom est désormais celui d'un
 * effet qui contient les deux lectures, donc plus rien à arbitrer.
 *
 * ─── LE PRIX DES DEUX FUSIONS, PAYÉ LE 2026-08-05 ───────────────────────────
 *
 * Vingt-six paramètres et dix-huit combinaisons de trois modes croisés : une
 * liste plate les rend TOUS, tout le temps, et l'utilisateur lit en Crête de
 * gradient onze réglages qui ne peuvent rien pour lui. Les onze ont été rendues
 * deux fois chacune, aux bornes, dans les configurations où leur infobulle les
 * disait sans objet — les onze sont inertes, zéro canal d'écart. Elles portent
 * donc `appliesWhen` (voir le bloc de conditions plus bas), et les trois
 * sections `Détection` / `Encre` / `Échos` groupent ce qui apparaît ensemble.
 *
 * ⚠️ RIEN DE TOUT ÇA N'EST DU MODÈLE. `params[]` n'a pas bougé d'un index —
 * sept références de pixels et les presets en dépendent — et le shader ne sait
 * pas qu'un contrôle est masqué : ses clamps restent nécessaires, la valeur
 * masquée reste dans le calque et repart telle quelle dans les presets.
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
 * ⚠️ Cette preuve vaut pour un DÉTECTEUR DE GRADIENT et pour lui seul. Les deux
 * modes de détection par SEUIL DE FORME — celui de la fiche Figma, où
 * l'inversion change tout (« Inverse luma uses darkness, for dark art or text
 * on white ») — la rendent caduque, et c'est pourquoi le troisième choix a été
 * ROUVERT le jour où le premier d'entre eux a été écrit (voir
 * `INPUT_SOURCE_CHOICES`, qui porte les deux verdicts et leur ordre d'index).
 *
 * COÛT. Crête de gradient et Seuil de forme : 8 taps (le tap central a des poids
 * nuls dans les deux noyaux de Scharr — l'échantillonner serait une lecture
 * payée pour être multipliée par zéro), une seule passe, aucune texture
 * intermédiaire. Les deux modes d'ENCRE n'ajoutent aucun tap : ils lisent la
 * même mesure et n'en tirent pas la même chose. Échos de la forme : les mêmes 8
 * taps (hoistés, voir ci-dessus), plus 9 passes internes — une de
 * seuillage-réduction, quatre réductions, quatre remontées — et 5 taps sur le
 * champ en passe finale.
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
const INK_WHEEL = 1;

/** Modes de DÉTECTION — comment le bord est trouvé, avant toute question
 *  d'encre. Même contrat d'index que ci-dessus : on ajoute à la FIN.
 *  `Crête de gradient` est en tête parce que c'est le comportement historique. */
const DETECT_MODES = ["Crête de gradient", "Seuil de forme", "Échos de la forme"] as const;
const DETECT_RIDGE = 0;
const DETECT_SHAPE = 1;
const DETECT_ECHO = 2;

/**
 * LES CINQ CONDITIONS D'AFFICHAGE DE CET EFFET, écrites une fois chacune.
 *
 * D'OÙ ÇA VIENT. Onze paramètres portaient dans leur infobulle une mention
 * « Sans objet en … » — une phrase écrite au jugement par l'auteur de l'effet,
 * que rien n'obligeait à rester vraie quand le shader bougeait. Les onze ont
 * été RENDUES le 2026-08-05, deux valeurs aux bornes dans chaque configuration
 * excluante, avec la garde qui manquait au geste naïf : l'écart de la
 * configuration contre la photo seule, sans quoi « aucun écart » aurait pu
 * signifier « l'effet entier ne fait rien ici »
 * (`docs/superpowers/plans/2026-08-05-applicabilite-task1-resultats.md`). Les
 * onze sont exactes. Ce sont donc les VERDICTS qui deviennent des conditions
 * ici, pas la prose qui les annonçait — et la nuance vient d'être payée
 * ailleurs : sur `glass`, une douzième déclaration du même lot s'est révélée
 * FAUSSE, sur un curseur qui déplace la moitié de l'image.
 *
 * ⚠️ LE MASQUAGE NE REMPLACE PAS L'INFOBULLE. Il dit QUE le réglage ne sert pas
 * ici, elle dit POURQUOI. Les onze `hint` restent donc mot pour mot.
 *
 * ⚠️ UNE CONDITION NE SAIT PAS DIRE « ET » (voie A : déclaratif seul, aucune
 * échappatoire prédicat). Un cas résiduel en découle, connu et assumé : en
 * Échos de la forme, `inkMode` se masque mais sa VALEUR reste, donc un calque
 * laissé sur Roue d'orientation y garde ses quatre curseurs de roue affichés
 * alors que ce mode calcule sa propre encre. Le remède serait une conjonction —
 * exactement ce que la voie A refuse, parce qu'un prédicat saurait tout
 * exprimer et ne se relirait plus, ni par `validateEffect` ni par qui cherche
 * ce qui commande quoi.
 */

/** Le pilote a-t-il une CHROMATICITÉ à mesurer ? Une couverture alpha n'en a
 *  pas — c'est une fraction de surface, pas une couleur. */
const AVEC_CHROMATICITE = {
  param: "inputSource",
  equals: [INPUT_SOURCE_LUMA, INPUT_SOURCE_LUMA_INVERTED],
} satisfies DisplayCondition;

/** Les quatre réglages de la roue ne servent qu'à la roue : en Encre unique, la
 *  direction du gradient est jetée avant qu'aucun d'eux ne soit lu. */
const EN_ROUE = { param: "inkMode", equals: INK_WHEEL } satisfies DisplayCondition;

/** Les deux modes qui ont une FORME, donc un intérieur à remplir. Une crête n'en
 *  a pas : elle marque un endroit où l'image change, pas un dedans. */
const SUR_UNE_FORME = {
  param: "detectMode",
  equals: [DETECT_SHAPE, DETECT_ECHO],
} satisfies DisplayCondition;

/** Les deux modes dont l'encre sort d'`inkMode`. Le troisième calcule la sienne,
 *  par un dégradé indexé par le numéro de l'écho. */
const HORS_ECHO = {
  param: "detectMode",
  equals: [DETECT_RIDGE, DETECT_SHAPE],
} satisfies DisplayCondition;

/**
 * LE MODE ÉCHOS — une seule déclaration pour DEUX contrats.
 *
 * Le contrat de COÛT existait déjà : les neuf passes de pyramide portent ce
 * prédicat via `EffectPass.enabled`, et c'est lui qui a débloqué l'absorption
 * d'`echoOutlines`. Le contrat d'AFFICHAGE dit la même chose au même moment —
 * la section Échos n'apparaît que là où ces passes tournent.
 *
 * Les deux sont donc DÉRIVÉS d'ici, et pas écrits deux fois : deux copies d'un
 * même prédicat ne divergent pas bruyamment, elles divergent en silence — une
 * section qui resterait affichée là où la pyramide ne tourne plus rendrait des
 * curseurs qui ne peuvent plus rien, sans qu'aucun test de rendu ne bronche.
 */
const EN_ECHO = { param: "detectMode", equals: DETECT_ECHO } satisfies DisplayCondition;

/** Index de `detectMode` dans la liste ci-dessous. Le prédicat des neuf passes
 *  le lit PAR NOM (`runInternalPasses` résout les paramètres en dictionnaire),
 *  mais le shader le lit par index — les deux doivent désigner le même
 *  paramètre, et cette constante est là pour que le lien se relise. */
const DETECT_MODE_PARAM = 17;

/** Index du paramètre de lissage, lu par la remontée pyramidale partagée. En dur
 *  dans l'appel serait une panne silencieuse au premier réordonnancement — le
 *  shader compilerait et remonterait sur la mauvaise valeur. */
const SMOOTHING_PARAM = 19;

/** Seuillage de la forme FONDU DANS la première réduction, plutôt qu'en passe
 *  séparée. Deux raisons, et la seconde est la vraie : une passe de plus coûte
 *  une cible pleine résolution (~26 Mo sur une photo 26 Mpx) ; et seuiller les
 *  cinq taps AVANT de les moyenner rend une couverture déjà antialiasée, là où
 *  seuiller après aurait produit un masque binaire à recrénéler ensuite.
 *
 *  Le pilote passe par `input_source` et non `input_driver` : c'est le
 *  vocabulaire d'`outlines` (Luminance / Alpha / Luminance inversée, dans CET
 *  ordre), et l'absorption d'`echoOutlines` a dû traverser le remappage
 *  d'index qu'il porte — son « Luminance inversée » était à 1, il est à 2 ici. */
const SHAPE_DOWNSAMPLE_WGSL = `
${LINEAR_TO_SRGB_WGSL}${INPUT_DRIVER_WGSL}
fn shapeAt(uv: vec2<f32>) -> f32 {
  // Bascule ÉTROITE et non binaire : la forme est une couverture, et une
  // couverture binaire perdrait le demi-pixel de bord que toute la mesure de
  // distance exploite ensuite.
  let v = input_source(textureSample(srcTexture, srcSampler, uv), params[8]);
  return smoothstep(params[1] - 0.02, params[1] + 0.02, v);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let o = 1.0 / vec2<f32>(textureDimensions(srcTexture));
  var sum = shapeAt(uv) * 4.0;
  sum = sum + shapeAt(uv + vec2<f32>(-o.x, -o.y));
  sum = sum + shapeAt(uv + vec2<f32>( o.x, -o.y));
  sum = sum + shapeAt(uv + vec2<f32>(-o.x,  o.y));
  sum = sum + shapeAt(uv + vec2<f32>( o.x,  o.y));
  // La couverture voyage sur les TROIS canaux : la chaîne partagée
  // (\`DOWNSAMPLE_WGSL\`, \`upsampleWgsl\`) travaille en \`.rgb\`, et n'écrire que
  // le rouge ferait lire du noir aux deux autres à la remontée.
  return vec4<f32>(vec3<f32>(sum / 8.0), 1.0);
}
`;

/** Prédicat des neuf passes de pyramide. Sans lui, les deux modes locaux
 *  paieraient une chaîne complète dont ils ne lisent pas un texel — c'est
 *  exactement ce qui a retardé cette fusion jusqu'à l'arrivée d'
 *  `EffectPass.enabled`.
 *
 *  LU DEPUIS `EN_ECHO` et non réécrit : c'est la même question posée au même
 *  paramètre, et la déclaration en est la seule source (voir son en-tête). */
const enEcho = (params: Record<string, number>) =>
  Math.round(params[EN_ECHO.param]) === EN_ECHO.equals;

export const outlines: EffectModule = {
  id: "outlines",
  name: "Outlines",
  params: [
    // Écartement des taps, EN PIXELS. Il fait deux choses à la fois, et c'est
    // voulu : il donne son épaisseur au trait ET il agit comme passe-bas (des
    // taps écartés ne voient plus le grain). Un noyau à écartement fixe aurait
    // exigé un second curseur « lissage » pour ne pas dessiner le bruit.
    // MAXIMUM PORTÉ DE 12 À 40 PX par l'absorption d'`echoOutlines`, dont
    // l'épaisseur de trait montait jusque-là. Aucune valeur existante ne change
    // de rendu — seule la course du curseur s'allonge, et elle s'allonge dans
    // les trois modes parce que le paramètre est le même. En Crête de gradient,
    // un écartement de 40 px reste licite : le trait y devient très épais et
    // très passe-bas, ce qui est la conséquence annoncée par l'infobulle.
    { name: "thickness", label: "Épaisseur du trait", unit: "pixels", min: 0.5, max: 40, default: 2.5, step: 0.1, hint: "En Crête de gradient : écartement des taps — épaissit le trait et, du même geste, empêche le grain d'être dessiné. Dans les deux modes de forme : largeur du trait en pixels, indépendante de tout le reste" },
    // MAXIMUM PORTÉ DE 0,6 À 1, et ce n'est pas qu'un besoin du mode Échos : les
    // deux scénarios de rendu du Seuil de forme verrouillaient déjà `0,8`, une
    // valeur que `updateParams` ne borne pas mais que le curseur ne pouvait pas
    // atteindre (`ParamPanel` borne à `param.max`). Le verrou figeait donc un
    // rendu INACCESSIBLE depuis l'interface. Un seuil de forme se pose sur toute
    // l'échelle des tons par nature — un plafond calibré pour un CONTRASTE
    // minimal n'avait plus de sens dès le second mode.
    { name: "threshold", label: "Seuil", unit: "percent", min: 0, max: 1, default: 0.09, step: 0.005, hint: "En Crête de gradient : contraste minimal (en tons perceptuels, sur l'épaisseur du trait) pour qu'un contour soit tracé. Dans les deux modes de forme : le niveau où passe le bord du sujet" },
    { name: "softness", label: "Fondu du trait", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, hint: "0 = trait franc (toujours antialiasé), 1 = trait fondu qui s'éteint progressivement sur les contours faibles" },
    { name: "chroma", label: "Sensibilité couleur", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, appliesWhen: AVEC_CHROMATICITE, hint: "Fait aussi lever les contours entre deux couleurs de MÊME luminosité (rouge/vert), qu'un contour de luminance ne voit pas. En Roue d'orientation, empêche en plus la teinte de scintiller faute d'orientation lisible. Sans objet en entrée Alpha : une couverture n'a pas de chromaticité." },
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
    // DÉFAUT 0.2 → 0 (2026-08-21). Le mélange est ADDITIF en linéaire vers la
    // couleur de fond, dont le défaut est le BLANC : sur une image sombre, un
    // wash de 0,2 posait déjà un voile blanchâtre visible à l' APPLICATION —
    // « blanchit tout l'écran quand appliqué » (retour d'Antoine), le plus
    // frappant en mode Échos où le reste du cadre reste sombre. Le point de
    // départ naturel d'un effet de CONTOUR est la photo intacte SOUS le trait ;
    // l'effacement est un geste que l'on demande, pas un défaut. Les trois modes
    // en profitent. Aucune référence de pixels ne bouge : tous les scénarios
    // d'outlines fixent `wash` explicitement (1, 0.7…), jamais par le défaut.
    { name: "wash", label: "Effacement du fond", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, hint: "Fait disparaître la photo sous le trait au profit de la couleur de fond — 0 = contours sur la photo intacte, 1 = contours seuls" },
    inputSourceParam(),

    // ── CE QUI VIENT DE `coloredEdges` (fusion du 2026-08-03) ────────────────
    // Ajouté À LA SUITE et jamais au milieu : les NEUF index ci-dessus sont
    // (le neuvième est `inputSource`, qui vient de la fabrique
    // `inputSourceParam()` et qu'un grep sur `{ name:` ne voit pas — même
    // piège que les 32 params de `curves`. Le compte disait huit.)
    // persistés dans les presets d'`outlines`, et ses références de pixels
    // doivent rester valables au bit.
    { name: "inkMode", label: "Encre", unit: "none", min: 0, max: INK_MODES.length - 1, default: INK_SINGLE, step: 1, choices: [...INK_MODES], appliesWhen: HORS_ECHO, hint: "Encre unique : tous les contours à la couleur choisie ci-dessus. Roue d'orientation : la teinte vient de l'ANGLE du bord, donc deux bords d'une même forme sortent de deux couleurs — c'est l'ancien effet `Colored edges`. Sans objet en Échos de la forme, dont l'encre suit un dégradé indexé par le numéro de l'écho" },
    { name: "hueOffset", label: "Rotation des teintes", unit: "degrees", min: 0, max: 360, default: 0, step: 1, appliesWhen: EN_ROUE, hint: "Fait tourner la roue chromatique : choisit quelle couleur reçoit un bord horizontal. Sans objet en Encre unique" },
    { name: "hueSpread", label: "Étendue des teintes", unit: "percent", min: 0.05, max: 1, default: 1, step: 0.01, appliesWhen: EN_ROUE, hint: "Part du cercle chromatique parcourue par un tour complet d'orientation. 1 = toutes les teintes ; bas = une gamme resserrée autour de la rotation. Sans objet en Encre unique" },
    // Noms `wheelChroma` / `wheelLightness` et non `saturation` / `lightness` :
    // les anciens noms de `coloredEdges` auraient cohabité ici avec `inkSaturation`
    // et `inkLightness` sans qu'on puisse deviner lequel agit dans quel mode. Les
    // presets de `coloredEdges` ne survivent de toute façon pas au retrait de son
    // id, donc conserver ses noms n'aurait racheté personne.
    { name: "wheelChroma", label: "Chroma de la roue", unit: "percent", min: 0, max: 1, default: 0.42, step: 0.01, appliesWhen: EN_ROUE, hint: "Vivacité des contours, en chroma PERCEPTUEL — la même valeur donne la même vivacité à toutes les teintes, ce que la saturation HSL ne savait pas faire. Bornée au gamut sRGB. Sans objet en Encre unique" },
    { name: "wheelLightness", label: "Clarté de la roue", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, appliesWhen: EN_ROUE, hint: "Clarté PERCEPTUELLE des contours. Constante sur tout le tour de la roue — avant la refonte du 2026-08-02, elle balayait 0,290 selon la seule orientation du bord. Sans objet en Encre unique" },
    { name: "backgroundHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 0, step: 1, colorGroup: { key: "background", role: "hue", label: "Couleur de fond" } },
    { name: "backgroundSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, colorGroup: { key: "background", role: "saturation", label: "Couleur de fond" } },
    { name: "backgroundLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, colorGroup: { key: "background", role: "lightness", label: "Couleur de fond" } },

    // ── LE SECOND MODE DE DÉTECTION (2026-08-03) ─────────────────────────────
    // Demandé par Antoine, d'après la fiche Figma. Ajouté à la FIN pour la même
    // raison que tout le reste : l'index est persisté.
    { name: "detectMode", label: "Détection", unit: "none", min: 0, max: DETECT_MODES.length - 1, default: DETECT_RIDGE, step: 1, choices: [...DETECT_MODES], hint: "Crête de gradient : le trait suit les endroits où l'image CHANGE, et son épaisseur suit le contraste local. Seuil de forme : le trait suit l'isoligne du niveau demandé, à épaisseur constante en pixels — c'est une silhouette, et le Seuil décide où elle passe. Échos de la forme : la même silhouette, RÉPÉTÉE vers l'extérieur à intervalles réguliers, comme des ondes à la surface de l'eau" },
    { name: "fill", label: "Remplir la forme", unit: "percent", min: 0, max: 1, default: 0, step: 0.01, appliesWhen: SUR_UNE_FORME, hint: "Peint l'INTÉRIEUR de la forme à la couleur d'encre, sous le trait. Sans objet en Crête de gradient : une crête n'a pas d'intérieur. C'est ce contrôle qui rend l'entrée « Luminance inversée » porteuse — inverser change quel côté est peint, ce qu'aucun réglage du seuil ne fait" },

    // ── CE QUI VIENT D'`echoOutlines` (fusion du 2026-08-03) ─────────────────
    // À LA SUITE, pour la même raison que les deux lots précédents : les dix-neuf
    // index au-dessus sont persistés, et sept références de pixels en dépendent.
    //
    // SEPT PARAMÈTRES SEULEMENT pour un effet qui en déclarait dix-huit : les
    // onze autres se recouvrent avec ceux d'ici, et le recouvrement n'est pas
    // une économie de façade — le seuil de la forme EST le seuil, l'épaisseur du
    // trait EST l'épaisseur, la couleur du premier écho EST l'encre. Ne restent
    // que les réglages qui n'ont aucun sens dans les deux autres modes.
    { name: "smoothing", label: "Lissage de la forme", unit: "none", min: 0.5, max: 6, default: 2.5, step: 0.05, appliesWhen: EN_ECHO, hint: "Simplifie la forme avant d'en tirer les échos — et fixe du même geste la portée : au-delà d'environ 62 + 60 × cette valeur pixels, il n'y a plus d'écho à tracer. Sans objet hors du mode Échos" },
    { name: "spacing", label: "Espacement des échos", unit: "pixels", min: 2, max: 200, default: 22, step: 0.5, appliesWhen: EN_ECHO, hint: "Distance entre deux échos successifs, en pixels — c'est la longueur d'onde des ondes. Sans objet hors du mode Échos" },
    { name: "echoCount", label: "Nombre d'échos", unit: "none", min: 1, max: 24, default: 6, step: 1, appliesWhen: EN_ECHO, hint: "Combien d'échos avant de s'arrêter. L'écho 0 est le bord de la forme lui-même. Sans objet hors du mode Échos" },
    { name: "falloff", label: "Atténuation", unit: "percent", min: 0, max: 1, default: 0.35, step: 0.01, appliesWhen: EN_ECHO, hint: "Fait pâlir les échos à mesure qu'ils s'éloignent — 0 = tous à la même force, 1 = le dernier s'éteint complètement. Sans objet hors du mode Échos" },
    // Le dégradé va de l'ENCRE (ci-dessus) à cette couleur-ci. Trois paramètres
    // et non six : le premier écho n'avait aucune raison d'avoir sa propre
    // couleur à côté de celle du trait, qui est la même chose.
    { name: "endHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 320, step: 1, colorGroup: { key: "dernierEcho", role: "hue", label: "Dernier écho" } },
    { name: "endSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, colorGroup: { key: "dernierEcho", role: "saturation", label: "Dernier écho" } },
    { name: "endLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.62, step: 0.01, colorGroup: { key: "dernierEcho", role: "lightness", label: "Dernier écho" } },
  ],
  /**
   * TROIS SECTIONS — trois questions, dans l'ordre où on se les pose : OÙ passe
   * le trait, DE QUOI il est fait, et (s'il se répète) comment il se répète.
   *
   * POURQUOI CET EFFET EN A BESOIN quand la moitié du registre n'a rien à y
   * gagner : deux fusions lui ont donné 26 paramètres et trois modes croisés,
   * soit dix-huit combinaisons. `appliesWhen` seul n'aurait rendu qu'une liste
   * plate PLUS COURTE ; ce qui manque à une liste plate, c'est de dire que « le
   * seuil » et « l'entrée » répondent à la même question.
   *
   * ⚠️ AUCUN INDEX N'A BOUGÉ. Une section cite des NOMS et regroupe des items de
   * RENDU ; `params[]` reste dans son ordre d'origine, où sept références de
   * pixels et les presets le lisent. L'ordre d'affichage DANS une section reste
   * celui de `params[]` (`ParamPanel`), donc l'ordre de citation ci-dessous est
   * documentaire — il est écrit dans l'ordre des index pour que personne n'y
   * lise une intention de tri qui n'existe pas.
   *
   * ⚠️ LES TROIS GROUPES DE COULEUR RESTENT ENTIERS, chacun dans une seule
   * section : `ParamPanel` ancre un groupe à l'index de son premier membre, donc
   * une section qui n'en citerait que deux rôles sur trois casserait le contrôle
   * plutôt que de le déplacer.
   *
   * `Encre` porte tout ce qui DÉPOSE de la couleur, et pas seulement le trait :
   * l'encre, le fond qui remplace la photo sous lui, et l'intérieur de la forme
   * qui se peint de la même encre. Les séparer aurait fait une quatrième
   * section de trois lignes.
   */
  sections: [
    {
      id: "detection",
      label: "Détection",
      params: ["thickness", "threshold", "softness", "chroma", "inputSource", "detectMode"],
      layout: "liste",
    },
    {
      id: "encre",
      label: "Encre",
      params: [
        "inkHue", "inkSaturation", "inkLightness",
        "wash",
        "inkMode", "hueOffset", "hueSpread", "wheelChroma", "wheelLightness",
        "backgroundHue", "backgroundSaturation", "backgroundLightness",
        "fill",
      ],
      // `liste` MAINTENUE, et c'est un refus mesuré (2026-08-18, ticket 16).
      // Neuf rangées en une colonne en font la section la plus haute de l'effet
      // le plus chargé, donc elle était candidate au passage en `grille` comme
      // quatre autres. Elle porte DEUX PASTILLES — une pastille est un contrôle
      // repliable, pas un curseur, et `channelMixer` a déjà écarté `grille` pour
      // cette raison exacte : deux colonnes étroites la déforment.
      // Sa hauteur est le prix d'un contrôle qui n'entre pas en demi-largeur.
      layout: "liste",
    },
    {
      // LE MIROIR DU CONTRAT DE COÛT : cette section apparaît exactement là où
      // les neuf passes de pyramide tournent, parce que les deux lisent la même
      // déclaration (`EN_ECHO`). Ses sept réglages n'ont aucun lecteur ailleurs
      // — quatre le disent déjà dans leur infobulle, les trois du dégradé de
      // dernier écho ne le disaient nulle part et c'est la section qui le dit
      // pour eux.
      id: "echos",
      label: "Échos",
      params: ["smoothing", "spacing", "echoCount", "falloff", "endHue", "endSaturation", "endLightness"],
      appliesWhen: EN_ECHO,
      layout: "liste",
    },
  ],
  // NEUF PASSES DE PYRAMIDE, toutes conditionnées au mode Échos. Hors de lui,
  // elles sont écartées AVANT d'emprunter leur cible — donc zéro allocation,
  // zéro draw, et `prevPass` reçoit la texture source (que la passe finale ne
  // lit pas dans ces modes). Voir `EffectPass.enabled` et l'en-tête de ce
  // fichier.
  passes: [
    // Seuillage + première réduction, fondus (voir SHAPE_DOWNSAMPLE_WGSL).
    { scale: 0.5, wgsl: SHAPE_DOWNSAMPLE_WGSL, enabled: enEcho },
    { scale: 0.25, wgsl: DOWNSAMPLE_WGSL, enabled: enEcho },
    { scale: 0.125, wgsl: DOWNSAMPLE_WGSL, enabled: enEcho },
    { scale: 0.0625, wgsl: DOWNSAMPLE_WGSL, enabled: enEcho },
    { scale: 0.03125, wgsl: DOWNSAMPLE_WGSL, enabled: enEcho },
    { scale: 0.0625, wgsl: upsampleWgsl(SMOOTHING_PARAM), enabled: enEcho },
    { scale: 0.125, wgsl: upsampleWgsl(SMOOTHING_PARAM), enabled: enEcho },
    { scale: 0.25, wgsl: upsampleWgsl(SMOOTHING_PARAM), enabled: enEcho },
    { scale: 0.5, wgsl: upsampleWgsl(SMOOTHING_PARAM), enabled: enEcho },
  ],
  wgsl: `
${UV_SPACE_WGSL}${HSL_TO_RGB_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${INPUT_DRIVER_WGSL}${EDGE_GRADIENT_WGSL}${EDGE_SPACING_WGSL}${OKLAB_WGSL}

/** Couverture d'un trait, comme DIFFÉRENCE DE DEUX BORDS. \`h\` est la
 *  demi-largeur et \`aa\` la demi-largeur de transition, en unités de phase.
 *
 *  L'écriture évidente — \`smoothstep(h + aa, h - aa, d)\` — rend 0,5 au centre
 *  quand h vaut 0, donc un voile gris là où rien ne doit être tracé. Ici les
 *  deux termes deviennent égaux quand h s'annule, par construction. Repris de
 *  \`hatching\`, où la même panne avait été évitée pour la même raison. */
fn echo_stripe(d: f32, h: f32, aa: f32) -> f32 {
  let dedans = clamp((h + aa - d) / (2.0 * aa), 0.0, 1.0);
  let dehors = clamp((aa - h - d) / (2.0 * aa), 0.0, 1.0);
  return dedans - dehors;
}

/** LINÉARISATION DU CHAMP, et c'est ce qui rend les échos ÉQUIDISTANTS.
 *
 *  La lecture naïve d'un champ lissé — \`(champ − 0,5) / pente\` — suppose le
 *  champ localement LINÉAIRE. Un échelon flouté ne l'est pas : c'est un
 *  sigmoïde, raide au centre et plat dans les queues. Loin du bord la pente
 *  s'effondre, la distance est donc sur-estimée, et les anneaux d'indice entier
 *  y tombent plus serrés qu'ils ne devraient.
 *
 *  MESURÉ, sur la mire commune à espacement demandé de 18 px : les écarts
 *  allaient de 6 à 20 px, soit 31,9 % de dispersion — et l'écart rétrécissait
 *  systématiquement avec l'éloignement, la signature exacte de ce biais.
 *
 *  Or un échelon logistique est EXACTEMENT une droite dans l'espace logit. Y
 *  mesurer la pente la rend quasi constante d'un bout à l'autre du champ, donc
 *  la distance quasi exacte. Le flou pyramidal n'est pas rigoureusement
 *  logistique, mais il en est bien plus près que de l'affine.
 *
 *  LE CLAMP EST CALCULÉ, PAS CHOISI. Le logit amplifie le bruit d'entrée par
 *  \`1 / (f (1 − f))\`, et le champ est en 8 bits — un LSB vaut 1/255 ≈ 0,004.
 *  À f = 0,002 l'amplification vaut 500, donc un seul LSB déplace le logit de
 *  2,0 : plus du DOUBLE d'un interligne d'anneau, c'est-à-dire du bruit pur.
 *  À f = 0,02 elle vaut 51, soit 0,2 en logit — moins du quart d'un interligne.
 *
 *  Essayé à 0,002 et mesuré : les anneaux proches devenaient justes (moyenne
 *  18,59 px pour 18 demandés, contre 13,42 avant le logit) mais les lointains
 *  partaient de 5 à 31,5 px. C'était exactement cette amplification.
 *
 *  Hors de la plage, la pente logit tombe à zéro et la distance part à l'infini
 *  — comportement voulu : l'effet s'éteint là où il ne mesure plus rien, plutôt
 *  que de tracer des anneaux faux. */
fn echo_logit(f: f32) -> f32 {
  let c = clamp(f, 0.02, 0.98);
  return log(c / (1.0 - c));
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let threshold = params[1];
  let softness = clamp(params[2], 0.0, 1.0);
  let chroma = clamp(params[3], 0.0, 1.0);
  let wash = clamp(params[7], 0.0, 1.0);
  let source = params[8];
  let inkMode = i32(params[9] + 0.5);
  let detectMode = i32(params[${DETECT_MODE_PARAM}] + 0.5);
  let fill = clamp(params[18], 0.0, 1.0);

  // Écartement des taps et noyau de Scharr : voir effects/edgeGradient.ts. Le
  // module est resté un FICHIER À PART après les deux fusions, bien qu'il n'ait
  // plus qu'un lecteur : le prochain effet à bords doit trouver le noyau, ses
  // poids et la preuve d'isotropie écrits ailleurs que dans ces 500 lignes.
  // C'est la copie qui coûte, pas le fichier.
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

  // PILOTE LISSÉ, sans un seul tap de plus : \`g.moyenne\` est la moyenne des huit
  // taps déjà lus. Le seuil de forme se paie donc zéro lecture supplémentaire.
  //
  // ⚠️ LE PILOTE BRUT NE MARCHE PAS, et la référence de ce mode l'a montré à sa
  // PREMIÈRE exécution : sur un bord franc, l'isoligne du pilote brut sort en
  // POINTILLÉ d'un pixel quelle que soit l'épaisseur demandée. Un échelon n'a
  // aucune valeur intermédiaire, donc l'isoligne n'a nulle part où s'épaissir —
  // et \`fwidth\` y explose au lieu de mesurer une pente, ce qui écrase la
  // distance calculée. Le pilote lissé a, lui, une rampe large de l'écartement
  // des taps.
  //
  // LA PENTE VIENT DONC DE \`toneMag\` ET NON DE \`fwidth\`. \`toneMag\` se lit comme
  // « écart de pilote sur l'épaisseur du trait » (c'est le sens du /32) : divisé
  // par cette épaisseur, il donne la pente PAR PIXEL, exactement l'unité qu'il
  // faut pour convertir un écart de ton en une distance. C'est ce qui rend le
  // trait d'épaisseur constante — la doctrine d'\`isolines\`, et ce qui sépare ce
  // mode d'un posterize suivi d'un détecteur, où la largeur suivrait la pente.
  let pilote = g.moyenne;
  let pentePx = max(toneMag / max(params[0], 0.5), 0.00001);

  // RÉSERVÉS AU MODE ÉCHOS. Son encre vient d'un DÉGRADÉ indexé par le numéro
  // de l'écho, donc ni de l'encre unique ni de la roue d'orientation — les deux
  // modes d'encre plus bas sont sans objet pour lui, et il calcule la sienne.
  var echoEncre = vec3<f32>(0.0);
  var echoRemplissage = vec3<f32>(0.0);
  var echoDedans = 0.0;

  var line: f32;
  if (detectMode == ${DETECT_RIDGE}) {
    line = smoothstep(threshold, threshold + band, mag);
  } else if (detectMode == ${DETECT_ECHO}) {
    // ÉCHOS DE LA FORME — corps porté verbatim d'\`echoOutlines\` lors de son
    // absorption (2026-08-03). Seuls les index de paramètres ont bougé ; les
    // expressions sont à l'identique, et c'est ce qui rend la fusion prouvable
    // à l'octet plutôt que « visuellement proche ».
    //
    // ⚠️ \`textureSample\` DANS une branche, et c'est légal ici : \`detectMode\`
    // vient d'un uniforme, donc le flux de contrôle reste UNIFORME au sens de
    // l'analyse WGSL. Le mettre là plutôt que de le hoister est un choix de
    // coût — hoisté, les cinq taps du champ seraient payés par les deux modes
    // locaux, qui ne lisent pas \`prevPass\` (et qui n'y trouveraient d'ailleurs
    // que la texture source, puisque leurs neuf passes sautent).
    let spacing = max(params[20], 1.0);
    let thickness = max(params[0], 0.1);
    let count = max(params[21], 1.0);
    let falloff = clamp(params[22], 0.0, 1.0);

    let dims = vec2<f32>(textureDimensions(srcTexture));
    let fieldDims = vec2<f32>(textureDimensions(prevPass));
    // Un pixel ÉCRAN vaut cette fraction de texel du champ. Le champ vit en
    // demi-résolution : le facteur est donc ~0,5, mais il est LU et non supposé —
    // une passe finale posée à une autre échelle ne casserait rien.
    let texelsParPixel = fieldDims / dims;

    // Champ de couverture, flouté. La chaîne écrit la même valeur sur les trois
    // canaux ; on en lit un seul.
    let field = textureSample(prevPass, srcSampler, uv).r;

    // PENTE, en unités de champ par PIXEL ÉCRAN, sur une base LARGE.
    //
    // Le pas d'un texel — le plus court qui ait un sens sur une texture
    // bilinéaire — a été essayé et rend des anneaux FRAGMENTÉS. La raison est
    // celle que \`gooeyMerge\` a déjà payée : les cibles de passe interne sont en
    // 8 bits (\`effectPassRunner\`), et sur un champ très lissé deux texels voisins
    // sont souvent IDENTIQUES. La différence rend alors zéro, la pente aussi, et
    // l'anneau disparaît par plaques.
    //
    // ICI C'EST PIRE QUE POUR gooeyMerge, et le pas est donc élargi davantage :
    // là-bas la pente ne servait qu'à donner une DIRECTION, ici elle passe au
    // DÉNOMINATEUR d'une division. Une pente sous-estimée n'incline pas un
    // liseré, elle envoie la distance à l'infini — et le contour avec.
    //
    // Base proportionnelle au lissage : plus le champ est lisse, plus il faut
    // aller loin pour mesurer sa pente au-dessus du bruit de quantification.
    let k = 2.0 + 4.0 * max(params[${SMOOTHING_PARAM}], 0.0);
    let gs = k / fieldDims;
    // Tout se mesure dans l'espace LOGIT (voir \`echo_logit\`) : c'est lui qui rend
    // les anneaux équidistants, en redressant le sigmoïde du flou en droite.
    let gCentre = echo_logit(field);
    let dx = echo_logit(textureSample(prevPass, srcSampler, uv + vec2<f32>(gs.x, 0.0)).r)
           - echo_logit(textureSample(prevPass, srcSampler, uv - vec2<f32>(gs.x, 0.0)).r);
    let dy = echo_logit(textureSample(prevPass, srcSampler, uv + vec2<f32>(0.0, gs.y)).r)
           - echo_logit(textureSample(prevPass, srcSampler, uv - vec2<f32>(0.0, gs.y)).r);
    // Le pas vaut 2k texels du champ sur chaque axe, soit \`2k / texelsParPixel\`
    // pixels écran — c'est par ça qu'il faut diviser pour obtenir une pente PAR
    // PIXEL, la seule unité dans laquelle la distance qui suit ait un sens.
    let pasPx = 2.0 * k / texelsParPixel;
    let pente = length(vec2<f32>(dx / pasPx.x, dy / pasPx.y));

    // DISTANCE SIGNÉE au bord. Positive DEDANS. \`gCentre\` s'annule exactement où
    // le champ vaut 0,5, c'est-à-dire sur le bord de la forme.
    //
    // Le plancher n'est pas un garde-fou cosmétique : là où le champ est saturé
    // (loin de la forme), la pente logit tend vers zéro et la distance part à
    // l'infini. C'est le comportement VOULU — la phase dépasse alors le compte
    // demandé et plus aucun contour n'est tracé, donc l'effet s'éteint exactement
    // là où sa mesure cesse d'être fiable, sans qu'aucun anneau parasite ne
    // s'accumule au bord de la zone utile.
    let dist = gCentre / max(pente, 0.000001);

    // PHASE : 0 sur le bord de la forme, 1 au premier écho, 2 au deuxième...
    // Comptée vers l'EXTÉRIEUR (\`-dist\`), comme la référence : « echo your shape
    // outward ».
    let phase = -dist / spacing;
    let anneau = round(phase);
    // Distance au contour le plus proche, en unités de phase.
    let ecart = abs(phase - anneau);

    // Antialiasing ANALYTIQUE : un pixel écran change la phase de 1/espacement,
    // exactement. Aucun \`fwidth\` — il n'apporterait rien, et c'est aussi ce qui
    // autorise ce bloc à vivre DANS une branche.
    let aa = 1.0 / spacing;
    let demi = 0.5 * thickness / spacing;

    // Les contours vont de 0 (le bord de la forme) à \`count\`. Au-delà, rien.
    let dansLeCompte = step(-0.5, anneau) * step(anneau, count + 0.5);
    // \`encrage\` et non \`trait\` : \`trait\` est un mot RÉSERVÉ de WGSL, et le
    // compilateur le refuse comme nom de variable. Même piège exactement que le
    // \`smooth\` de \`pixelStretch\` — attrapé par \`npm run test:gpu-shaders\`,
    // jamais par tsc, qui ne voit qu'une chaîne de caractères.
    let encrage = echo_stripe(ecart, demi, aa) * dansLeCompte;

    // Atténuation avec l'éloignement : le dernier contour s'éteint à \`falloff\` = 1.
    let t = clamp(anneau / max(count, 1.0), 0.0, 1.0);

    // ZONE DE CONFIANCE. Aux abords du clamp de \`echo_logit\`, une des deux
    // lectures de la différence centrale est bornée et l'autre non : la pente
    // n'est alors pas NULLE, elle est FAUSSE, et les anneaux s'y entassent au lieu
    // de disparaître. Mesuré : les deux plus externes tombaient à 5 et 10 px
    // d'écart quand les suivants tenaient 18 à 20.
    //
    // L'encre s'éteint donc AVANT la borne, sur une bande étroite. C'est la
    // différence entre « je ne sais plus mesurer, je me tais » et « je ne sais
    // plus mesurer, je dessine quand même » — et c'est la deuxième qui produit un
    // artefact qu'on prendrait pour une intention.
    //
    // La bande a dû être ÉLARGIE après mesure : à 0,02–0,07, les deux anneaux les
    // plus externes tombaient encore à 5 et 10 px d'écart pour 18 demandés, et
    // s'effilochaient visiblement dans le coin le plus saturé. À 0,06–0,16, ce qui
    // reste tracé est ce qui est mesuré — le reste ne l'était pas.
    let fiable = smoothstep(0.06, 0.16, field) * smoothstep(0.06, 0.16, 1.0 - field);
    let force = encrage * (1.0 - falloff * t) * fiable;
    line = clamp(force, 0.0, 1.0);

    // DÉGRADÉ DU PREMIER AU DERNIER ÉCHO, en OKLCH. En HSL, il rejouerait le
    // défaut mesuré sur \`coloredEdges\` la veille : à saturation et clarté
    // fixées, parcourir la teinte fait varier la clarté PERÇUE de 0,290 sur le
    // tour. Ici la teinte court d'un bout à l'autre du dégradé — c'est exactement
    // le cas où l'espace compte.
    //
    // Le PREMIER écho est l'encre de l'effet (params 4-6), pas une couleur à
    // lui : c'est le recouvrement qui a permis à l'absorption de ne coûter que
    // trois slots de couleur au lieu de six.
    //
    // \`h - round(h)\` : le PLUS COURT chemin sur le cercle, en tours. Sans lui, un
    // dégradé de 350° à 10° ferait tout le tour à l'envers au lieu des 20° qui
    // séparent les deux.
    let debut = oklab_to_oklch(linear_srgb_to_oklab(srgb_to_linear3(hsl2rgb(params[4] / 360.0, params[5], params[6]))));
    let fin = oklab_to_oklch(linear_srgb_to_oklab(srgb_to_linear3(hsl2rgb(params[23] / 360.0, params[24], params[25]))));
    let dh = fin.z - debut.z;
    let teinte = debut.z + (dh - round(dh)) * t;
    echoEncre = oklab_to_linear_srgb(oklch_to_oklab(vec3<f32>(
      mix(debut.x, fin.x, t),
      mix(debut.y, fin.y, t),
      teinte
    )));

    // Remplissage de la forme, SOUS les traits. \`echoRemplissage\` passe par le
    // même aller-retour OKLCH que \`echoEncre\` — et pas par la valeur linéaire
    // directe, pourtant disponible : l'aller-retour n'est pas l'identité en
    // flottant, et c'est lui que la référence a figé.
    echoDedans = clamp(field * 2.0 - 1.0, 0.0, 1.0);
    echoRemplissage = oklab_to_linear_srgb(oklch_to_oklab(debut));
  } else {
    // SEUIL DE FORME. Distance à l'isoligne, ramenée en PIXELS par la pente. La
    // demi-largeur ne descend pas sous 0,5 px : en deçà, le trait tomberait
    // entre deux pixels et clignoterait selon l'échantillonnage.
    let distPx = abs(pilote - threshold) / pentePx;
    let demi = max(params[0] * 0.5, 0.5);
    // \`softness\` garde ici un sens, mais ce n'est plus le même : il élargit le
    // FONDU des bords du trait, pas le domaine de contraste qui l'allume — un
    // seuil de forme n'a pas de contraste à trancher, il a une frontière.
    // Le plancher de 0,5 px est l'antialiasing minimal, jamais franchi.
    let flou = 0.5 + softness * demi;
    line = 1.0 - smoothstep(demi - flou, demi + flou, distPx);
  }

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
  var paper = mix(color.rgb, background, wash);

  // REMPLISSAGE, SOUS le trait — et c'est l'opération ASYMÉTRIQUE de cet effet,
  // la seule qui distingue l'intérieur de l'extérieur. Sans elle, « Luminance
  // inversée » serait redondante avec le curseur de seuil (inverser reviendrait
  // à chercher l'isoligne au niveau 1 − seuil) ; avec elle, inverser change QUEL
  // CÔTÉ est peint, et aucun réglage du seuil ne le fait. Voir l'en-tête
  // d'\`INPUT_SOURCE_CHOICES\`, qui porte le raisonnement complet.
  //
  // Bascule sur la même pente que le trait, donc antialiasée de la même façon :
  // un remplissage à bord franc trahirait le trait qui le borde.
  //
  // Le mode Échos sort ICI, avec son propre couple encre/remplissage : sa
  // couverture d'intérieur vient du CHAMP (\`field * 2 - 1\`) et non de la pente
  // locale, parce que loin du bord la pente ne dit plus de quel côté on est.
  if (detectMode == ${DETECT_ECHO}) {
    paper = mix(paper, echoRemplissage, fill * echoDedans);
    return vec4<f32>(mix(paper, echoEncre, line), color.a);
  }
  if (detectMode != ${DETECT_RIDGE}) {
    let dedans = smoothstep(-pentePx, pentePx, pilote - threshold);
    paper = mix(paper, edgeColor, fill * dedans);
  }
  return vec4<f32>(mix(paper, edgeColor, line), color.a);
}
`,
};
