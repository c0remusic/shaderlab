import type { EffectModule } from "./types";
import { HASH_WGSL } from "./hash";
import { UV_SPACE_WGSL } from "./uvSpace";
import { LINEAR_TO_SRGB_WGSL, SRGB_TO_LINEAR_WGSL } from "./srgbTransfer";
import { APERTURE_WGSL } from "./aperture";

/**
 * Lens blur — le flou d'un OBJECTIF, pas celui d'un filtre gaussien.
 *
 * D'OÙ ÇA VIENT. Cahier de références du 2026-08-01, §6ter : aucun flou
 * n'existait au registre, et c'était l'absence la plus voyante face à la
 * référence. La Blur Gallery de Photoshop tient cinq outils, mais le vrai
 * clivage n'est pas entre eux — il est avec le gaussien.
 *
 * CE QUI SÉPARE UN LENS BLUR D'UN GAUSSIEN, et c'est tout l'écart de qualité :
 *
 * 1. **Il favorise les zones claires.** Une haute lumière ponctuelle s'étale en
 *    DISQUE NET au lieu de se diluer. C'est ça, le bokeh. Corollaire cité par
 *    la référence, et vérifiable ici : quand un point lumineux rétrécit, sa
 *    tache de bokeh ne rétrécit pas — elle devient plus transparente et ses
 *    bords plus nets.
 * 2. **La forme du diaphragme est réglable** et se lit dans la forme des
 *    taches. Six lames donnent des hexagones, cinq des pentagones ; un objectif
 *    à diaphragme circulaire donne des ronds.
 *
 * Un gaussien n'a ni l'un ni l'autre : il MOYENNE, donc il lave l'image.
 *
 * COMMENT LES DEUX PROPRIÉTÉS SONT OBTENUES ICI :
 *
 * - Le disque. Un flou pyramidal (celui de `glow`, `halation`, `gooeyMerge`)
 *   est hors-jeu : il ne sait produire qu'un noyau à décroissance douce, donc
 *   ni bord franc ni polygone. Il faut une COLLECTE explicite sur l'ouverture —
 *   des taps posés en spirale d'angle d'or, qui couvre le disque à densité
 *   constante sans laisser d'anneau ni de rayon vides (une grille polaire
 *   naïve entasse ses points au centre). Leur NOMBRE suit l'aire du disque :
 *   voir `TAPS_MAX`, et la mesure qui a imposé cette règle.
 * - Le polygone. Le rayon de la spirale est multiplié par le rayon du polygone
 *   régulier dans cette direction, `cos(pi/n) / cos(k)` avec `k` l'angle replié
 *   dans un secteur. Le résultat est le polygone INSCRIT dans le disque unité :
 *   les sommets touchent le cercle, les milieux d'arêtes sont à `cos(pi/n)`.
 * - Les hautes lumières. Chaque tap est pondéré par `1 + intensité x
 *   max(0, luma - seuil)`, et la somme est divisée par la somme des poids
 *   APPLIQUÉS. Un tap brûlé pèse donc plusieurs fois un tap sombre, et le
 *   disque garde son bord au lieu de se dissoudre dans le fond. Le seuil est
 *   DÉCODÉ vers le linéaire avant comparaison (précédent : le bright-pass du
 *   glow, dont ce décodage manquant rendait le curseur inerte sur 85 % de sa
 *   course).
 * - L'échantillonnage. La spirale est TOURNÉE d'un angle tiré par pixel : sans
 *   ça, des directions fixes se lisent comme une étoile sur les grands rayons,
 *   et le motif est le même partout donc l'œil l'attrape. Ce tirage a un revers
 *   qu'il faut payer et non ignorer — il décorrèle les voisins, donc il exige
 *   assez de taps pour que le reste passe sous le seuil du visible.
 *
 * GÉOMÉTRIE DE CHAMP. La référence range Field, Iris, Tilt-Shift, Path et Spin
 * comme des géométries posées PAR-DESSUS ce noyau : elles ne changent pas la
 * nature du flou, elles modulent son RAYON. Trois sont ici (linéaire, iris,
 * radial) ; Path et Spin relèvent du motion blur, une autre famille (nommée en
 * différé dans `CONTEXT.md`). Field, le dégradé libre par épingles, n'est pas
 * repris : le masque au pinceau par calque fait déjà ce travail, mieux et sans
 * nouvelle interface.
 *
 * COÛT, et pourquoi la collecte tient en demi-résolution. À pleine définition
 * sur 24 Mpx, 256 taps par pixel feraient six milliards de lectures. La
 * collecte tourne donc à 1/2 (comme les descentes de `glow` et `gooeyMerge`),
 * ce qui la divise par quatre — et divise aussi par deux le rayon en texels,
 * donc par quatre le nombre de taps que l'aire réclame. Ce n'est PAS la distinction aperçu/export que le projet
 * refuse : c'est une passe interne, et la sortie reste en définition native.
 * La passe finale, elle, tourne à pleine définition et MÉLANGE le net et le
 * flou selon le champ — sans ça, une zone à rayon nul ressortirait adoucie par
 * le seul aller-retour de résolution, et un lens blur qui ramollit ce qu'il est
 * censé laisser net a raté son unique promesse.
 */

/** Étiquettes de la géométrie de champ. L'index EST la valeur du paramètre. */
const FIELD_SHAPES = ["Uniforme", "Linéaire", "Iris", "Radial"] as const;
const FIELD_UNIFORM = 0;

/** Les géométries qui ONT un champ — toutes sauf Uniforme.
 *
 *  C'est la frontière du SHADER et non une lecture d'infobulle : `lens_field`
 *  court-circuite sur Uniforme et rend 1.0 AVANT de lire le centre, l'angle,
 *  l'étendue et le fondu. Les cinq réglages du champ n'y touchent donc aucun
 *  canal, par construction et pas par mesure.
 *
 *  DÉRIVÉE DE LA LISTE plutôt qu'écrite `[1, 2, 3]` : une géométrie ajoutée à la
 *  FIN de `FIELD_SHAPES` — le seul ajout permis, l'index étant persisté dans les
 *  presets — tombe du bon côté toute seule, alors qu'un littéral la laisserait
 *  dehors sans rien dire. */
const FIELD_SHAPES_AVEC_CHAMP = FIELD_SHAPES.map((_, index) => index).filter((index) => index !== FIELD_UNIFORM);

/** Plafond du nombre de taps de la collecte, qui est sinon proportionnel à
 *  l'AIRE du disque (environ un tap pour trois texels — voir le shader).
 *
 *  Un nombre FIXE était la première version, et c'était l'erreur : la densité
 *  s'effondre quand le rayon monte, et la spirale étant tournée par un tirage
 *  par pixel, deux voisins tirent deux sous-ensembles différents. Le disque
 *  sort alors en nuée granuleuse au lieu d'un hexagone net.
 *
 *  256 est un arbitrage de COÛT, pas une valeur ronde : au-delà du rayon où ce
 *  plafond mord (~28 px, soit 14 texels ici), la couverture redescend et la
 *  granulation revient progressivement. C'est une limite connue et bornée, pas
 *  un effet propre sur toute sa course. */
const TAPS_MAX = 256;

/** Le rayon du diaphragme vit dans `effects/aperture.ts` depuis le 2026-08-03 :
 *  `lensFlare` en a besoin pour la forme de son lobe injecté, et un objectif n'a
 *  qu'UN diaphragme — deux copies rendraient un hexagone d'un côté et un
 *  heptagone de l'autre. Réexporté ici parce que c'est cet effet qui l'a vu
 *  naître et que ses tests l'importaient par ce chemin. */
export { apertureRadiusSpec } from "./aperture";

/** Champ de rayon, partagé par la collecte et la passe finale.
 *
 *  LES DEUX PASSES DOIVENT LIRE LE MÊME CHAMP, sinon la passe finale garderait
 *  net un endroit que la collecte a flouté (ou l'inverse) et le raccord se
 *  verrait comme une frange. D'où une seule définition, incluse des deux côtés
 *  plutôt que recopiée — la leçon de `blurChain.ts`, extrait pour la même
 *  raison entre `glow` et `halation`.
 *
 *  Requiert `UV_SPACE_WGSL` (aspectScale). */
const FIELD_WGSL = `
fn lens_field(uv: vec2<f32>, dims: vec2<f32>) -> f32 {
  let shape = params[5];
  let center = vec2<f32>(params[6], params[7]);
  let angle = params[8] * 0.017453292519943295;
  let range = max(params[9], 0.001);
  let feather = clamp(params[10], 0.0, 1.0);

  let s = i32(shape + 0.5);
  if (s == ${FIELD_UNIFORM}) {
    return 1.0;
  }

  // Écart au centre, corrigé de l'aspect : sans ça l'iris serait une ellipse
  // sur une photo panoramique alors que l'utilisateur a réglé un cercle, et le
  // dégradé linéaire ne serait pas perpendiculaire à l'angle affiché.
  let ar = aspectScale(dims);
  let d = (uv - center) * ar;

  if (s == 1) {
    // LINÉAIRE (tilt-shift) : net sur une bande centrée, flou en s'en éloignant.
    // La distance est prise PERPENDICULAIREMENT à l'angle, donc l'angle oriente
    // la bande nette elle-même, ce qu'on attend en le réglant.
    let dir = vec2<f32>(-sin(angle), cos(angle));
    let t = abs(dot(d, dir)) / range;
    return smoothstep(1.0 - feather, 1.0 + 0.001, t);
  }
  if (s == 2) {
    // IRIS : net à l'intérieur d'une ellipse, flou dehors. L'angle fait tourner
    // l'ellipse, dont l'allongement vient de l'aspect du cadre de réglage.
    let c = cos(angle);
    let sn = sin(angle);
    let r = vec2<f32>(d.x * c + d.y * sn, -d.x * sn + d.y * c);
    let t = length(r) / range;
    return smoothstep(1.0 - feather, 1.0 + 0.001, t);
  }
  // RADIAL : le rayon croît continûment avec la distance au centre — le défaut
  // d'un objectif bon marché, net au milieu et mou dans les coins. Pas de
  // bascule ici : c'est une rampe, et \`feather\` en règle la raideur.
  let t = length(d) / range;
  return pow(clamp(t, 0.0, 1.0), mix(3.0, 0.4, feather));
}
`;

/**
 * Collecte sur l'ouverture, en demi-résolution.
 *
 * `params[0]` (rayon) est exprimé en pixels PLEINE définition : la passe tourne
 * à 1/2, donc les décalages sont divisés par les dimensions de CETTE cible, et
 * le facteur 0.5 tombe tout seul. Le poser à la main serait une seconde
 * correction pour le même fait.
 */
const LENS_GATHER_WGSL = `
${UV_SPACE_WGSL}${LINEAR_TO_SRGB_WGSL}${SRGB_TO_LINEAR_WGSL}${HASH_WGSL}${FIELD_WGSL}
const LENS_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);
const GOLDEN_ANGLE = 2.399963229728653;
const TAU = 6.283185307179586;
${APERTURE_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let radiusPx = max(params[0], 0.0) * lens_field(uv, dims);
  let blades = params[1];
  let rotation = params[2] * 0.017453292519943295;
  // Seuil DÉCODÉ vers le linéaire : c'est une valeur de curseur, donc
  // perceptuelle, comparée à une luminance qui vient du format -srgb et est
  // donc linéaire. Sans ce décodage, un curseur à 0.5 poserait la bascule à
  // ~0.73 perceptuel — l'erreur qui rendait le bright-pass du glow inerte.
  let threshold = srgb_to_linear(clamp(params[3], 0.0, 1.0));
  let boost = max(params[4], 0.0);

  // Rayon nul : la collecte n'a rien à faire, et 48 taps sur le même point
  // coûteraient plein tarif pour rendre une copie.
  if (radiusPx < 0.35) {
    return color;
  }

  // Rotation de la spirale, tirée PAR PIXEL. Sans elle, les directions fixes se
  // lisent comme une étoile dès que le rayon dépasse quelques pixels, et le
  // motif étant le même partout, l'œil l'attrape immédiatement.
  let jitter = hash(uv * dims) * TAU;
  // RAYON EN TEXELS DE CETTE CIBLE. La passe tourne à 1/2, donc un pixel pleine
  // définition vaut un DEMI-texel ici. La première version divisait \`radiusPx\`
  // par \`dims\` en affirmant que « le facteur 0.5 tombe tout seul » : il ne
  // tombe pas, et le flou sortait au DOUBLE du rayon réglé. Invisible sur une
  // mire de damier — tout y est lavé dans les deux cas — et flagrant sur des
  // points lumineux isolés, d'où le scénario de rendu « lens-blur-bokeh » qui
  // l'a attrapé.
  let rt = radiusPx * 0.5;
  let step = rt / dims;

  // NOMBRE DE TAPS PROPORTIONNEL À L'AIRE du disque, environ un pour trois
  // texels. À nombre FIXE, la densité s'effondre quand le rayon monte, et comme
  // la spirale est tournée par un tirage PAR PIXEL, deux voisins tirent deux
  // sous-ensembles différents : le disque sort en nuée granuleuse au lieu d'un
  // hexagone net. C'est ce que rendait la première version, et c'est
  // exactement le « filtre Photoshop 2005 » que ce dépôt s'interdit.
  //
  // Le plafond à 256 est un arbitrage de coût assumé, pas une valeur ronde : à
  // rayon maximal (120 px, soit 60 texels ici) la couverture retombe sous 7 %
  // et la granulation revient. Le dire ici plutôt que de laisser croire que
  // l'effet est propre sur toute sa course.
  let taps = clamp(i32(3.141592653589793 * rt * rt / 3.0), 24, ${TAPS_MAX});
  let tapsF = f32(taps);

  var sum = vec4<f32>(0.0);
  var wsum = 0.0;
  for (var i = 0; i < taps; i = i + 1) {
    let fi = f32(i);
    // sqrt(t) et non t : sur un disque, la densité doit croître comme la racine
    // du rang, sinon les taps s'entassent au centre et le bord du bokeh est
    // sous-échantillonné — c'est-à-dire crénelé, exactement là où il se voit.
    let t = (fi + 0.5) / tapsF;
    let theta = fi * GOLDEN_ANGLE + jitter;
    let r = sqrt(t) * aperture_radius(theta, blades, rotation);
    let off = vec2<f32>(cos(theta), sin(theta)) * r * step;
    // \`textureSampleLevel\` et non \`textureSample\` : le court-circuit de rayon
    // nul juste au-dessus rend le flux de contrôle NON UNIFORME, et
    // \`textureSample\` calcule des dérivées implicites, donc WGSL l'y interdit.
    // Le niveau explicite 0 est de toute façon ce qu'on veut — la texture n'a
    // pas de mipmaps et une collecte d'ouverture ne doit jamais choisir son
    // niveau toute seule.
    let c = textureSampleLevel(srcTexture, srcSampler, mirrorUv(uv + off), 0.0);
    // PONDÉRATION DES HAUTES LUMIÈRES — la moitié du bokeh. Un tap brûlé pèse
    // plusieurs fois un tap sombre, donc le disque garde son bord franc au lieu
    // de se diluer dans le fond. La somme est divisée par la somme des poids
    // APPLIQUÉS, jamais par le nombre de taps : diviser par 48 ferait fuir
    // l'énergie proportionnellement à la luminosité locale (même piège que la
    // moyenne de Karis du glow, et même correctif).
    let w = 1.0 + boost * max(0.0, dot(c.rgb, LENS_LUMA) - threshold);
    sum = sum + c * w;
    wsum = wsum + w;
  }
  return sum / max(wsum, 0.0001);
}
`;

export const lensBlur: EffectModule = {
  id: "lensBlur",
  name: "Lens blur",
  params: [
    { name: "radius", label: "Rayon", unit: "pixels", min: 0, max: 120, default: 24, step: 0.5, hint: "Rayon de l'ouverture, en pixels pleine définition — c'est la taille des taches de bokeh" },
    // Slider et non liste de choix : c'est un COMPTE, et sa valeur se lit
    // toute seule (6 = hexagone). Les valeurs intermédiaires modélisent bien
    // quelque chose — le polygone se déforme continûment d'une lame à l'autre,
    // ce qu'un vrai diaphragme fait aussi en s'ouvrant.
    { name: "blades", label: "Lames du diaphragme", unit: "none", min: 0, max: 12, default: 0, step: 1, hint: "0 à 2 = diaphragme circulaire (taches rondes). À partir de 3, le bokeh prend la forme du polygone : 6 pour l'hexagone des objectifs courants" },
    // ⚠️ PAS D'`appliesWhen` ICI, ET CE N'EST PAS UN OUBLI. La campagne du
    // 2026-08-05 donne bien ce curseur inerte sur un diaphragme circulaire
    // (`docs/superpowers/plans/2026-08-05-applicabilite-task1-resultats.md`),
    // mais ce qui l'éteint est `blades` sous 3 : un SEUIL sur un curseur
    // continu, pas un choix nommé. `appliesWhen` exige une cible à `choices`, et
    // cette exigence est la garantie qu'on relise ce qui commande quoi — un
    // seuil chiffré serait une décision d'affichage cachée dans un nombre, que
    // ni `validateEffect` ni un relecteur ne rattacheraient à sa cause. Faire de
    // `blades` un `choices` coûterait sa course continue de 0 à 12 pour un
    // masquage. L'infobulle reste donc l'unique porteur de la déclaration.
    { name: "bladeRotation", label: "Orientation des lames", unit: "degrees", min: 0, max: 360, default: 0, step: 1, hint: "Fait tourner la forme du diaphragme. Sans objet sur un diaphragme circulaire." },
    { name: "highlightThreshold", label: "Seuil des hautes lumières", unit: "percent", min: 0, max: 1, default: 0.6, step: 0.01, hint: "À partir de quel ton un point compte comme une haute lumière — c'est ce qui sépare le bokeh du flou gaussien" },
    { name: "highlightBoost", label: "Intensité du bokeh", unit: "none", min: 0, max: 20, default: 6, step: 0.1, hint: "Combien une haute lumière pèse de plus qu'un ton sombre. À 0 le flou est une moyenne — c'est-à-dire un gaussien, et il lave l'image" },
    { name: "fieldShape", label: "Géométrie du champ", unit: "none", min: 0, max: FIELD_SHAPES.length - 1, default: FIELD_UNIFORM, step: 1, choices: [...FIELD_SHAPES], hint: "Uniforme : tout est flou. Linéaire : bande nette (tilt-shift). Iris : zone nette elliptique. Radial : net au centre, mou dans les coins. Les quatre réglages suivants ne servent qu'aux trois dernières." },
    { name: "fieldCenterX", label: "Centre X", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Position horizontale de la zone nette, en fraction de la toile" },
    { name: "fieldCenterY", label: "Centre Y", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Position verticale de la zone nette, en fraction de la toile" },
    // Les deux seules géométries qui aient une DIRECTION : Linéaire (1) oriente
    // sa bande, Iris (2) son ellipse. Uniforme n'a pas de champ du tout et
    // Radial est isotrope par construction — les deux configurations ont été
    // rendues séparément le 2026-08-05, et le signal le plus faible de toute la
    // campagne est justement celui-là (Radial, 10,5 % des canaux) : bien
    // au-dessus du seuil, donc l'effet agissait quand le curseur ne faisait rien.
    // Valeurs 0 et 37° et non 0 et 360°, qui sont le MÊME angle.
    { name: "fieldAngle", label: "Orientation du champ", unit: "degrees", min: 0, max: 360, default: 0, step: 1, appliesWhen: { param: "fieldShape", equals: [1, 2] }, hint: "Oriente la bande nette (Linéaire) ou l'ellipse (Iris). Sans objet en Uniforme et en Radial." },
    { name: "fieldRange", label: "Étendue nette", unit: "percent", min: 0.01, max: 1.5, default: 0.35, step: 0.01, hint: "Demi-largeur de la bande ou rayon de l'ellipse, en fraction de la plus petite dimension de la toile" },
    { name: "fieldFeather", label: "Fondu du champ", unit: "percent", min: 0, max: 1, default: 0.5, step: 0.01, hint: "Longueur de la transition entre net et flou — 0 = bascule franche, 1 = dégradé long. En Radial, règle la raideur de la montée." },
  ],
  /**
   * DEUX SECTIONS, parce que cet effet est deux réglages SUPERPOSÉS et non un :
   * le NOYAU — ce dont le flou est fait — et le CHAMP — où il s'applique.
   * L'en-tête de ce fichier range déjà les géométries ainsi (§ GÉOMÉTRIE DE
   * CHAMP) : elles « ne changent pas la nature du flou, elles modulent son
   * RAYON ». Le découpage ne fait que rendre visible une frontière qui existait.
   *
   * CE QUE ÇA RÈGLE. En Uniforme, le champ n'existe pas — `lens_field` sort sur
   * 1.0 sans lire un seul de ses cinq réglages — et pourtant les cinq curseurs
   * restaient affichés. Le seul endroit qui le disait était la queue de
   * l'infobulle de `fieldShape` (« Les quatre réglages suivants ne servent qu'aux
   * trois dernières ») : une demi-phrase, tout en bas d'une bulle, pour cinq
   * curseurs morts. La section porte désormais cette déclaration là où
   * `validateEffect` la relit, et l'infobulle garde le POURQUOI.
   *
   * ⚠️ LE SÉLECTEUR RESTE DANS `Noyau`, ET CE N'EST PAS UN RANGEMENT PAR DÉFAUT.
   * `fieldShape` placé dans la section qu'il commande partirait AVEC elle dès
   * qu'on choisit Uniforme, et plus rien ne le ramènerait — la faute exacte que
   * `validateEffect` refuse déjà sur un `appliesWhen` qui se vise lui-même. Il
   * vit donc dans la seule section toujours présente, et il y est en DERNIER,
   * immédiatement au-dessus du titre de la section qu'il ouvre.
   *
   * ⚠️ AUCUN INDEX N'A BOUGÉ : les deux sections sont deux blocs CONTIGUS de
   * `params[]` (0..5 et 6..10), cités dans leur ordre d'index. Il n'y avait rien
   * à réordonner — ce fichier rangeait déjà ses paramètres comme il les affiche.
   *
   * GABARIT `liste` DES DEUX CÔTÉS. `paire` demande deux réglages qui vont par
   * deux (deux bornes, deux points) : le seuil et son intensité sont un seuil et
   * un POIDS, pas une plage. Le vrai candidat serait `fieldCenterX`/`Y`, mais un
   * gabarit s'applique à la section entière — les isoler coûterait un troisième
   * titre pour deux lignes, et le jour où ce centre mérite mieux qu'un curseur,
   * c'est un `canvasControl` point (gabarit `pose`) qu'il lui faut, pas `paire`.
   * `grille` demande plus de six réglages courts ; la plus grosse section en a six.
   */
  sections: [
    {
      id: "noyau",
      label: "Noyau",
      params: ["radius", "blades", "bladeRotation", "highlightThreshold", "highlightBoost", "fieldShape"],
      layout: "liste",
    },
    {
      // Les cinq réglages du champ, absents du régime qui n'en a pas. La
      // condition est celle du shader, pas une transcription de mesure.
      // ⚠️ `fieldAngle` garde EN PLUS son propre `appliesWhen` ([1, 2]) : les
      // deux se cumulent, et c'est voulu — la section dit « il n'y a pas de
      // champ ici », le paramètre dit « ce champ-là n'a pas de direction ».
      // Radial est isotrope par construction, et il est dans la section.
      id: "champ",
      label: "Champ",
      params: ["fieldCenterX", "fieldCenterY", "fieldAngle", "fieldRange", "fieldFeather"],
      appliesWhen: { param: "fieldShape", equals: FIELD_SHAPES_AVEC_CHAMP },
      layout: "liste",
    },
  ],
  passes: [{ scale: 0.5, wgsl: LENS_GATHER_WGSL }],
  wgsl: `
${UV_SPACE_WGSL}${FIELD_WGSL}
fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let dims = vec2<f32>(textureDimensions(srcTexture));
  let radiusPx = max(params[0], 0.0) * lens_field(uv, dims);
  let blurred = textureSample(prevPass, srcSampler, uv);

  // MÉLANGE NET/FLOU, et c'est la raison d'être de cette passe. La collecte
  // tourne en demi-résolution : là où le champ demande un rayon nul, son
  // résultat est quand même passé par un aller-retour de résolution, donc
  // légèrement mou. Reprendre \`color\` (pleine définition) sous le seuil rend
  // à ces zones leur netteté exacte — un lens blur qui ramollit ce qu'il doit
  // laisser net a raté sa seule promesse.
  //
  // Le seuil est le MÊME que le court-circuit de la collecte (0.35 px), et la
  // transition court jusqu'à 1 px : en dessous, la collecte rend déjà la copie
  // du pixel central, donc les deux chemins coïncident et le raccord est
  // invisible par construction plutôt que par réglage.
  let sharpness = smoothstep(0.35, 1.0, radiusPx);
  return vec4<f32>(mix(color.rgb, blurred.rgb, sharpness), color.a);
}
`,
};
