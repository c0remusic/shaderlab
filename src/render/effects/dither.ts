import type { DisplayCondition, EffectModule } from "./types";
import { INK_TEXTURE_WGSL, inkTextureParams } from "./inkTexture";
import { BAYER4_WGSL, BAYER8_WGSL } from "./bayer";
import { HASH_WGSL } from "./hash";
import { HSL_TO_RGB_WGSL } from "./hsl";
import {
  LINEAR_TO_SRGB_WGSL,
  LINEAR_TO_SRGB_VEC3_WGSL,
  SRGB_TO_LINEAR_VEC3_WGSL,
  SRGB_TO_LINEAR_WGSL,
} from "./srgbTransfer";

/**
 * Dither — la quantification ASSUMÉE : peu de niveaux, et un motif qui rend
 * lisible ce qui tombe entre deux. C'est le rendu riso, le 1 bit, le journal.
 *
 * D'OÙ ÇA VIENT. Cahier de références, §6quinquies : `Dither` figure parmi les
 * effets Figma sans équivalent ici, avec sa surface — Style (Bayer / Blue Noise
 * / Threshold), Size, Levels, Mono. Demandé par Antoine le 2026-08-03 dans la
 * suite d'`echoOutlines` (devenu depuis le mode « Échos de la forme »
 * d'`outlines`, ADR-0015), « dans le genre, la même DA ».
 *
 * CE N'EST PAS LE TRAMAGE DE `posterize`, et il vaut mieux écrire pourquoi que
 * de laisser croire à un doublon. Le sien est un correctif : un décalage d'au
 * plus un demi-palier, en Bayer 4x4, sur les trois canaux, POUR CACHER la
 * frontière entre deux aplats. Il est au service de la quantification, il ne se
 * voit pas. Ici le motif EST le sujet — sa taille se règle, il descend à deux
 * niveaux, et il peut réduire l'image à deux encres. Aucun réglage de
 * `posterize` n'atteint ça : son tramage n'a ni taille, ni style, ni mono.
 *
 * ─── TROIS STYLES, ET CE QUI LES SÉPARE VRAIMENT ────────────────────────────
 *
 * - **Bayer** (ordonné). Un seuil par position dans une matrice, donc un motif
 *   RÉGULIER et parfaitement stable. C'est le rendu « ordinateur 8 bits » : on
 *   voit la grille, et c'est ce qu'on vient chercher. Matrice 8x8 et non 4x4 :
 *   à deux niveaux, les seize seuils d'une 4x4 sont toute l'information
 *   disponible et la trame se lit en blocs. Voir `bayer.ts`.
 * - **Bruit bleu**. Un seuil pseudo-aléatoire dont le spectre est pauvre en
 *   basses fréquences : le motif ne fait pas de paquets, donc l'œil ne voit plus
 *   de grille mais un grain fin. C'est le rendu « impression », plus organique.
 *   ⚠️ CE QUI EST IMPLÉMENTÉ EST UNE APPROXIMATION, et c'est écrit ici plutôt
 *   que sous-entendu : le vrai bruit bleu se précalcule (recuit simulé sur une
 *   texture), ce qui demanderait une texture de plus dans un pipeline qui n'en
 *   a pas prévu. On utilise l'`interleaved gradient noise` de Jimenez — la même
 *   source que le bloom de ce dépôt cite déjà — dont le spectre est proche du
 *   bruit bleu pour un coût de trois multiplications. La différence se voit sur
 *   un dégradé très lent, pas sur une photo.
 * - **Seuil**. Aucun motif : la quantification nue. Il n'est pas là pour être
 *   beau mais pour être le TÉMOIN — c'est en basculant dessus qu'on voit ce que
 *   les deux autres font réellement, et c'est le rendu « photocopie » quand les
 *   niveaux tombent à deux.
 *
 * ─── DEUX CHOSES QUI ÉVITENT LE RENDU CHEAP ─────────────────────────────────
 *
 * 1. **La comparaison se fait sur l'axe PERCEPTUEL.** Quantifier une valeur
 *    linéaire répartirait presque tous les niveaux dans les hautes lumières —
 *    une image dont les ombres seraient un aplat noir et les clairs un dégradé
 *    fin. C'est la même panne, et le même correctif, que le seuil d'`outlines`
 *    et les bascules de `duotone` : on POSITIONNE une réponse sur l'axe
 *    perceptuel, on ne convertit aucune couleur.
 * 2. **La taille du motif est en pixels de l'IMAGE, et elle monte jusqu'à 32.**
 *    Une trame de 2 px source sur une photo de 26 Mpx affichée à 30 % fait
 *    0,6 px à l'écran : elle ne peut que se moyenner en bouillie. La leçon a
 *    déjà été payée sur `posterize` (journal du 2026-08-02) — un phénomène
 *    exprimé en pixels source se juge à l'échelle d'affichage.
 *
 * COÛT : aucun tap supplémentaire, une seule passe.
 */

/**
 * L'ORDRE EST UN CONTRAT : l'index est persisté dans les presets et lu tel quel
 * par le shader. Les quatre derniers ont été AJOUTÉS À LA FIN le 2026-08-03, ce
 * qui donne une liste dont l'ordre n'est pas celui qu'on écrirait aujourd'hui
 * — « Bayer fin » gagnerait à suivre « Bayer ». Le ranger serait décaler les
 * index, donc changer le style de tout preset déjà enregistré : la lisibilité de
 * la liste ne vaut pas ça.
 */
const STYLES = [
  "Bayer",
  "Bruit bleu",
  "Seuil",
  "Bayer fin",
  "Bruit blanc",
  "Lignes",
  "Points groupés",
] as const;
const STYLE_BAYER = 0;
const STYLE_BLUE = 1;
const STYLE_BAYER_FIN = 3;
const STYLE_BRUIT_BLANC = 4;
const STYLE_LIGNES = 5;
const STYLE_POINTS = 6;

/** Étiquettes de l'axe de répartition — reprises de `posterize`, mot pour mot,
 *  parce que c'est le même axe et la même question. */
const DISTRIBUTIONS = ["Linéaire", "Perceptuel"] as const;
const DISTRIB_PERCEPTUEL = 1;

/**
 * Le TÉMOIN. Il n'a pas de constante côté shader, et son absence est
 * significative : aucune branche de `ditherThreshold` ne le teste, il est ce qui
 * reste quand toutes les autres ont échoué (`return 0.0`). Il en faut une ici
 * parce que l'AFFICHAGE, lui, doit le nommer — c'est le seul style qui commande
 * quoi que ce soit au panneau.
 */
const STYLE_SEUIL = 2;

/**
 * « Ce style pose-t-il un MOTIF ? » — la seule question que `style` pose au
 * panneau, et la seule frontière d'applicabilité de tout l'effet.
 *
 * DÉRIVÉE, PAS ÉCRITE À LA MAIN. Un style ajouté à la fin de `STYLES` entre ici
 * tout seul, ce qui est le bon défaut : les six autres posent un motif, le
 * témoin est l'exception. Une liste d'index écrite à la main aurait oublié le
 * nouveau venu en silence — un curseur masqué à tort ne se plaint pas, ne bouge
 * aucun pixel et ne rougit aucun test.
 */
const AVEC_MOTIF: DisplayCondition = {
  param: "style",
  equals: STYLES.map((_, index) => index).filter((index) => index !== STYLE_SEUIL),
};

export const dither: EffectModule = {
  id: "dither",
  name: "Dither",
  params: [
    { name: "style", label: "Style", unit: "none", min: 0, max: STYLES.length - 1, default: STYLE_BAYER, step: 1, choices: [...STYLES], hint: "Bayer : matrice ordonnée 8×8, on voit la grille (rendu 8 bits). Bruit bleu : grain fin sans grille (rendu impression). Seuil : aucun motif, la quantification nue — le témoin. Bayer fin : la 4×4, sa grille est plus grosse à taille égale. Bruit blanc : granuleux, filmique. Lignes : trame de traits, la gravure. Points groupés : le point qui grossit, la presse" },
    // Sans objet en Seuil : cette branche ne lit ni la cellule ni sa taille —
    // elle est le `return 0.0` de sortie de `ditherThreshold`, celle qu'aucun
    // `if` ne teste. Le curseur ne peut donc y déplacer aucun pixel.
    { name: "size", label: "Taille du motif", unit: "pixels", min: 1, max: 32, default: 4, step: 1, appliesWhen: AVEC_MOTIF, hint: "Côté d'une cellule de trame, en pixels de l'image. Sur une grande photo affichée en réduction, une trame de 1 ou 2 px se moyenne en bouillie : c'est ici qu'on la remonte. Sans objet en Seuil, qui ne pose aucun motif" },
    { name: "levels", label: "Niveaux", unit: "none", min: 2, max: 8, default: 3, step: 1, hint: "Nombre de valeurs conservées. 2 = un bit, le rendu photocopie ; au-delà de 6 le tramage cesse de se voir" },
    { name: "mono", label: "Deux encres", unit: "percent", min: 0, max: 1, default: 1, step: 0.01, hint: "0 = chaque canal est tramé séparément (rendu couleur rétro). 1 = l'image se réduit à l'encre et au papier ci-dessous, comme une risographie" },
    { name: "blackPoint", label: "Point noir", unit: "percent", min: 0, max: 0.95, default: 0.05, step: 0.01, hint: "Ton d'entrée qui reçoit le niveau le plus sombre — le monter écrase les ombres" },
    { name: "whitePoint", label: "Point blanc", unit: "percent", min: 0.05, max: 1, default: 0.95, step: 0.01, hint: "Ton d'entrée qui reçoit le niveau le plus clair — le descendre brûle les hautes lumières" },
    { name: "inkHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 220, step: 1, colorGroup: { key: "encre", role: "hue", label: "Encre" } },
    { name: "inkSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.55, step: 0.01, colorGroup: { key: "encre", role: "saturation", label: "Encre" } },
    { name: "inkLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.13, step: 0.01, colorGroup: { key: "encre", role: "lightness", label: "Encre" } },
    { name: "paperHue", label: "Teinte", unit: "degrees", min: 0, max: 360, default: 40, step: 1, colorGroup: { key: "papier", role: "hue", label: "Papier" } },
    { name: "paperSaturation", label: "Saturation", unit: "percent", min: 0, max: 1, default: 0.18, step: 0.01, colorGroup: { key: "papier", role: "saturation", label: "Papier" } },
    { name: "paperLightness", label: "Luminosité", unit: "percent", min: 0, max: 1, default: 0.94, step: 0.01, colorGroup: { key: "papier", role: "lightness", label: "Papier" } },
    // ── LES DEUX CONTRÔLES QUI FONT DE CET EFFET UN SURENSEMBLE DE `posterize`
    //
    // Ajoutés le 2026-08-03 sur demande d'Antoine (« ajouter Posterize à un
    // effet global Dither »). Les deux effets se recouvraient déjà sur les
    // niveaux et la plage d'entrée ; il manquait exactement ceci.
    //
    // Défauts choisis pour que le rendu d'avant soit conservé AU BIT : la
    // référence `effet-dither` reste valable, et c'est elle qui le prouve.
    {
      name: "distribution",
      label: "Répartition",
      unit: "none",
      min: 0,
      max: DISTRIBUTIONS.length - 1,
      default: DISTRIB_PERCEPTUEL,
      step: 1,
      choices: [...DISTRIBUTIONS],
      // Le défaut DIVERGE de celui de `posterize` (Linéaire), et c'est
      // délibéré : un tramage sert à rendre un dégradé, donc ses niveaux ont
      // intérêt à être également espacés À L'ŒIL. Un posterize sert à faire des
      // aplats, où le choix est une décision de look que le cahier §5 laissait
      // explicitement ouverte.
      hint: "Linéaire : les niveaux sont également espacés en lumière. Perceptuel : ils le sont à l'œil, donc plus nombreux dans les ombres — c'est ce qu'une presse fait, elle quantifie la densité d'encre",
    },
    {
      name: "amount",
      label: "Force du tramage",
      unit: "percent",
      min: 0,
      max: 1,
      default: 1,
      step: 0.01,
      // Sans objet en Seuil, et pour une raison qui vaut d'être écrite : ce
      // curseur MULTIPLIE le seuil, or la branche Seuil rend 0. Autrement dit
      // le style Seuil EST ce curseur à 0, sur n'importe quel autre style — les
      // deux ne sont pas seulement inertes ensemble, ils sont la même chose.
      appliesWhen: AVEC_MOTIF,
      hint: "À 0, le motif disparaît et les frontières entre niveaux redeviennent FRANCHES — c'est le rendu sérigraphie, celui que `posterize` fait. À 1, le motif est à pleine amplitude. Sans objet en Seuil, qui n'a aucun motif à doser",
    },
    // ── ENCRE RÉELLE (transversal, `inkTexture.ts`), ajoutée À LA FIN le
    // 2026-08-05 : l'index d'un paramètre est persisté dans les presets.
    ...inkTextureParams(),
  ],
  // Le scan arrive par le binding 7. Interdit les passes internes
  // (`validateEffect`) — sans conséquence, `dither` est mono-passe.
  libraryTexture: { indexParam: "encreRang" },
  /**
   * QUATRE SECTIONS POUR QUATORZE RÉGIMES — et il faut dire pourquoi ce ne sont
   * pas quatorze panneaux.
   *
   * `style` (7) × `distribution` (2) font bien quatorze régimes de RENDU, et
   * c'est ce compte qui a fait retenir cet effet. Mais un régime de rendu n'est
   * pas un régime de PANNEAU : ce qui commande l'affichage n'est pas le nombre
   * de combinaisons, c'est ce que chaque branche LIT. Relevé branche par
   * branche dans `ditherThreshold`, plutôt que déduit du nombre de choix :
   *
   * - Bayer, Bruit bleu, Bayer fin, Bruit blanc, Lignes, Points groupés — les
   *   six lisent `cell` (donc `size`), et leur seuil est multiplié par `amount`.
   *   Ils diffèrent par la FORME du motif, jamais par les réglages qui le
   *   commandent : les mêmes deux curseurs les servent tous les six.
   * - Seuil — la seule branche qui ne lit rien. `cell` n'y entre pas et
   *   `0 × amount` reste 0 : les deux réglages de trame y sont morts, les douze
   *   autres vivants.
   * - `distribution` ne commande AUCUNE applicabilité : il déplace les niveaux
   *   sur l'axe des tons, il n'en supprime ni n'en ajoute. C'est un mode de
   *   RÉGLAGE (design §2B), pas un mode exclusif — et un panneau qui se
   *   réorganiserait en changeant d'axe de répartition serait du bruit.
   *
   * UNE SEULE FRONTIÈRE, donc, et elle est portée par les deux paramètres
   * concernés plutôt que par leur section. Le groupe *Trame* garde son sens
   * dans les quatorze régimes puisque `style` y vit : une section conditionnelle
   * emporterait avec elle le sélecteur qui seul permet d'en revenir.
   *
   * LES QUATRE QUESTIONS, dans l'ordre où l'effet les pose : de quel MOTIF on
   * rend l'entre-deux (*Trame*), combien de niveaux et répartis comment
   * (*Quantification*), avec quelles couleurs (*Encres*), et entre quels tons
   * d'entrée (*Tonalité*).
   *
   * ⚠️ AUCUN INDEX N'A BOUGÉ — une section cite des NOMS et regroupe des items
   * de RENDU. Conséquence assumée : les blocs s'ouvrent à la place de leur
   * PREMIER paramètre (`ParamPanel`), donc *Tonalité* s'affiche en dernier bien
   * qu'elle prolonge *Quantification* — `mono` (index 3) ouvre *Encres* avant
   * que `blackPoint` (index 4) n'ouvre *Tonalité*. Ranger l'affichage
   * demanderait de réordonner `params[]`, où la référence `effet-dither` et les
   * presets lisent chaque index : c'est exactement ce qu'on ne fait pas.
   *
   * ⚠️ LES DEUX GROUPES DE COULEUR RESTENT ENTIERS dans *Encres*. `ParamPanel`
   * ancre un groupe à l'index de son premier rôle et refuse un groupe réparti
   * entre deux sections — une pastille orpheline ne lève ni au type-check ni au
   * chargement du registre.
   *
   * GABARITS. *Tonalité* est une `paire` : deux bornes d'une même plage, dont
   * l'une sans l'autre ne veut rien dire — même gabarit et même titre que
   * `gradientMap`, qui nomme déjà cet effet parmi les quatre où ces deux points
   * sont deux curseurs plats. *Encres* reste une `liste` malgré ses sept
   * paramètres : elle ne rend que TROIS contrôles (un curseur et deux
   * pastilles), et c'est le nombre de contrôles qu'une grille réduit, pas celui
   * des paramètres.
   */
  sections: [
    { id: "trame", label: "Trame", layout: "liste", params: ["style", "size", "amount"] },
    { id: "quantification", label: "Quantification", layout: "liste", params: ["levels", "distribution"] },
    {
      id: "encres",
      label: "Encres",
      layout: "liste",
      params: ["mono", "inkHue", "inkSaturation", "inkLightness", "paperHue", "paperSaturation", "paperLightness"],
    },
    { id: "tonalite", label: "Tonalité", layout: "paire", params: ["blackPoint", "whitePoint"] },
  ],
  wgsl: `
${LINEAR_TO_SRGB_WGSL}${LINEAR_TO_SRGB_VEC3_WGSL}${SRGB_TO_LINEAR_WGSL}${SRGB_TO_LINEAR_VEC3_WGSL}${HSL_TO_RGB_WGSL}${BAYER4_WGSL}${BAYER8_WGSL}${HASH_WGSL}${INK_TEXTURE_WGSL}
const DITHER_LUMA = vec3<f32>(0.2126, 0.7152, 0.0722);

/** Interleaved gradient noise (Jimenez, SIGGRAPH 2014) — approximation de bruit
 *  bleu à trois multiplications. Rendue dans [-0.5, 0.5), comme les seuils de
 *  Bayer, pour que les trois styles soient interchangeables sans facteur. */
fn ditherBlue(p: vec2<f32>) -> f32 {
  return fract(52.9829189 * fract(0.06711056 * p.x + 0.00583715 * p.y)) - 0.5;
}

/** Seuil du pixel selon le style. Le \`if\` est sûr : le style vient d'un
 *  UNIFORME, donc le branchement est uniforme sur toute la passe — même
 *  raisonnement que \`input_driver\`.
 *
 *  TOUS RENDENT DANS [-0,5, 0,5) ET DE MOYENNE NULLE. Ce n'est pas une
 *  coquetterie d'échelle : un seuil de moyenne non nulle déplace TOUTE l'image
 *  d'une fraction de niveau, donc changer de style changerait l'exposition. Les
 *  constantes ci-dessous (1,307 pour le disque, 2,0 pour les lignes) sont
 *  calculées pour ça, pas choisies. */
fn ditherThreshold(cell: vec2<f32>, style: f32, size: f32) -> f32 {
  let s = i32(style + 0.5);
  if (s == ${STYLE_BAYER}) {
    return bayerThreshold8(vec2<u32>(vec2<i32>(floor(cell)) & vec2<i32>(7)));
  }
  if (s == ${STYLE_BLUE}) {
    return ditherBlue(floor(cell));
  }
  if (s == ${STYLE_BAYER_FIN}) {
    // La 4x4 d'origine (celle de \`posterize\`). Seize seuils au lieu de
    // soixante-quatre : sa grille est plus grosse à taille de cellule égale,
    // ce qui est un LOOK et non une régression — c'est le dither d'un écran
    // 8 bits, pas celui d'une presse.
    return bayerThreshold(vec2<u32>(vec2<i32>(floor(cell)) & vec2<i32>(3)));
  }
  if (s == ${STYLE_BRUIT_BLANC}) {
    // Bruit BLANC, à ne pas confondre avec le bleu au-dessus : son spectre est
    // plat, donc il fait des paquets et l'œil y voit du grain plutôt qu'une
    // trame. C'est le rendu filmique, et c'est exactement ce que le bruit bleu
    // est conçu pour éviter — les deux sont là pour ça.
    return hash(floor(cell)) - 0.5;
  }
  if (s == ${STYLE_LIGNES}) {
    // Trame de LIGNES : le seuil ne dépend que d'un axe, donc le motif croît en
    // épaisseur de trait au lieu de se disperser.
    //
    // ⚠️ LE PROFIL TRIANGULAIRE ÉVIDENT EST FAUX, et la mesure l'a dit. Avec
    // \`abs(fract(y) - 0.5)\`, deux rangées SYMÉTRIQUES reçoivent le même seuil
    // et s'allument donc ensemble : une cellule de quatre rangées ne rend que
    // trois densités au lieu de quatre. Relevé sur la rampe, en huit bandes :
    // 1 · 1 · 0,5 · 0,5 · 0,5 · 0,5 · 0 · 0 — un escalier à trois marches là où
    // Bayer donnait une gradation continue.
    //
    // Ce qu'il faut est une BIJECTION rangée -> rang, qui grossisse quand même
    // la ligne autour de son axe. La voici : on classe par distance au centre,
    // et on départage les deux côtés par \`step\` — d'où des rangs tous
    // distincts, et un ordre d'allumage qui alterne de part et d'autre.
    //   4 rangées : rangs 3, 1, 0, 2   (le centre d'abord, puis en alternance)
    //   5 rangées : rangs 4, 2, 0, 1, 3
    let rangee = floor(fract(cell.y) * size);
    let signe = rangee - (size - 1.0) * 0.5;
    // clamp : à une seule rangée, \`step\` retirerait 1 à un rang déjà nul.
    let rang = clamp(2.0 * abs(signe) - step(0.0, signe), 0.0, size - 1.0);
    return (rang + 0.5) / size - 0.5;
  }
  if (s == ${STYLE_POINTS}) {
    // POINTS GROUPÉS : le seuil croît avec la distance au centre de la cellule,
    // donc le point apparaît au centre et grossit — c'est la trame de presse.
    //
    // 1,307 n'est pas un réglage : la distance moyenne au centre d'un carré
    // unité vaut 0,3826, et 0,3826 x 1,307 = 0,5. C'est la valeur qui annule la
    // moyenne du seuil, donc la seule qui ne déplace pas l'exposition.
    //
    // LE TERME D'INCLINAISON répond au même défaut que celui des lignes, en
    // plus discret : un disque a une symétrie d'ordre quatre, donc quatre
    // positions équidistantes du centre partagent leur seuil et s'allument
    // ensemble. Un déplacement infime du centre, différent sur les deux axes,
    // les départage sans que la forme du point change à l'œil — les
    // coefficients sont petits devant un pas de cellule et premiers entre eux
    // pour ne recréer aucune symétrie.
    //
    // À NE PAS CONFONDRE AVEC \`halftone\`, qui est un autre effet et le reste :
    // celui-là porte la rosette CMJN, ses quatre angles d'écran et sa rotation.
    // Ici c'est une matrice de seuil parmi d'autres, en monochrome ou par canal.
    let f = fract(cell) - vec2<f32>(0.5);
    let d = length(f + vec2<f32>(0.021, 0.013));
    return clamp(d * 1.307 - 0.5, -0.5, 0.5);
  }
  // Seuil nu : aucun motif. Le témoin.
  return 0.0;
}

/** Quantification d'un canal, seuil déjà choisi. \`v\` et le résultat sont sur
 *  l'axe PERCEPTUEL — voir le point 1 de l'en-tête. */
fn ditherQuantize(v: f32, levels: f32, seuil: f32) -> f32 {
  let pas = 1.0 / max(levels - 1.0, 1.0);
  return clamp(floor(v / pas + 0.5 + seuil) * pas, 0.0, 1.0);
}

fn fs_main(uv: vec2<f32>, color: vec4<f32>) -> vec4<f32> {
  let style = params[0];
  let size = max(params[1], 1.0);
  let levels = max(params[2], 2.0);
  let mono = clamp(params[3], 0.0, 1.0);
  let blackPoint = clamp(params[4], 0.0, 0.95);
  // Un point blanc sous le point noir inverserait la réponse en silence, avec
  // un dénominateur négatif. Borné juste au-dessus — l'inversion se fait en
  // échangeant les deux curseurs, là où elle se voit.
  let whitePoint = max(params[5], blackPoint + 0.001);

  // Cellule de trame, en pixels de l'IMAGE et non en UV : une trame doit avoir
  // la même finesse sur les deux axes, ce qu'un pas en UV ne donne pas dès que
  // la photo n'est pas carrée.
  let px = uv * vec2<f32>(textureDimensions(srcTexture));
  let cell = px / size;
  // \`amount\` à 0 annule le motif : la frontière entre deux niveaux redevient
  // FRANCHE, ce qui est le rendu sérigraphie — celui de \`posterize\`. C'est le
  // second des deux contrôles qui font de cet effet son surensemble.
  // \`size\` est PASSÉE et non lue depuis fs_main : la trame de lignes en a
  // besoin pour compter ses rangées. Elle avait d'abord été référencée
  // directement dans \`ditherThreshold\`, hors de sa portée — le shader a échoué
  // en SILENCE (une erreur de validation WebGPU est asynchrone, elle ne lève
  // pas) et la référence est sortie uniforme. Même piège que le pool de cibles
  // de \`gooeyMerge\`, et c'est le garde de signal qui l'a attrapé, pas le
  // compilateur.
  // BAVURE D'ENCRE : le SEUIL se froisse, ce qui rend le bord du motif de trame
  // irregulier — une encre reelle ne bascule pas exactement la ou la matrice le
  // dit. A force nulle, ink_froisse rend sa valeur inchangee, donc le rendu par
  // defaut est identique au bit pres.
  //
  // AUCUN BACKTICK NI ACCENT DANS CE BLOC : il est dans un template literal JS,
  // et un backtick de commentaire le FERME (CLAUDE.md, piege paye 4 fois).
  let encreForce = clamp(params[15], 0.0, 1.0);
  let encreEchelle = max(params[16], 0.05);
  let seuilNet = ditherThreshold(cell, style, size) * clamp(params[13], 0.0, 1.0);
  let seuil = ink_froisse(seuilNet, uv, encreEchelle, encreForce);

  // AXE DE RÉPARTITION. \`color.rgb\` est LINÉAIRE (format de texture -srgb).
  // En Perceptuel (défaut) on quantifie sur l'axe perceptuel puis on redescend ;
  // en Linéaire on quantifie la lumière telle quelle. Le couple encode/décode
  // encadre la SEULE quantification — aucun gamma ne s'échappe vers la suite de
  // la chaîne, même contrat que le \`transferSpace\` de channelMixer.
  let perceptuel = f32(i32(params[12] + 0.5) == ${DISTRIB_PERCEPTUEL});
  let src = mix(color.rgb, linear_to_srgb3(color.rgb), perceptuel);
  let etendue = whitePoint - blackPoint;

  // VOIE COULEUR : chaque canal tramé séparément, ce qui donne les teintes
  // croisées du rendu rétro — un pixel peut sortir cyan ou magenta sans que
  // l'image ait jamais eu ces couleurs.
  let etale = clamp((src - vec3<f32>(blackPoint)) / etendue, vec3<f32>(0.0), vec3<f32>(1.0));
  let couleur = vec3<f32>(
    ditherQuantize(etale.r, levels, seuil),
    ditherQuantize(etale.g, levels, seuil),
    ditherQuantize(etale.b, levels, seuil)
  );

  // VOIE DEUX ENCRES : on trame la LUMINANCE, et le niveau obtenu choisit où
  // l'on se trouve entre le papier et l'encre. Le mélange se fait en LINÉAIRE
  // (les deux couleurs sont décodées d'abord), comme partout ailleurs ici.
  // La luminance suit le MÊME axe de répartition que les canaux : les deux voies
  // doivent quantifier sur la même échelle, sinon le curseur « Deux encres »
  // changerait aussi la répartition en passant de l'une à l'autre.
  let luma = dot(color.rgb, DITHER_LUMA);
  let tone = clamp((mix(luma, linear_to_srgb(luma), perceptuel) - blackPoint) / etendue, 0.0, 1.0);
  let niveau = ditherQuantize(tone, levels, seuil);
  let encre = srgb_to_linear3(hsl2rgb(params[6] / 360.0, params[7], params[8]));
  let papier = srgb_to_linear3(hsl2rgb(params[9] / 360.0, params[10], params[11]));
  let deuxEncres = mix(encre, papier, niveau);

  // Retour en linéaire pour la voie couleur, symétrique de l'encodage ci-dessus.
  let couleurLin = mix(couleur, srgb_to_linear3(couleur), perceptuel);
  return vec4<f32>(mix(couleurLin, deuxEncres, mono), color.a);
}
`,
};
