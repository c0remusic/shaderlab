import type { PixelPoint, PixelSize } from "./transform";

/**
 * TRACÉ D'UNE FORME À LA SOURIS — la géométrie du geste, sans DOM.
 *
 * D'OÙ ÇA VIENT (2026-08-17, signalement d'Antoine). `aplat` est entré au
 * registre avec un rectangle qu'on règle à QUATRE CURSEURS — centre X, centre Y,
 * largeur, hauteur. Son verdict : « tu as construit la pire façon de créer un
 * rectangle, réfère-toi à Photoshop ». Il a raison, et la raison est simple :
 * dans tout éditeur, **on trace un rectangle en tirant dessus**. Les curseurs
 * servent à RETOUCHER une forme existante, jamais à la créer.
 *
 * Ce module ne fait que la géométrie. Le geste (capture du pointeur, bande
 * élastique) vit dans `Canvas`, la création du calque dans `App` — même
 * découpage que `hitTest.ts`, et pour la même raison : la règle se teste en Node,
 * le câblage se regarde à l'écran.
 *
 * ⚠️ CE QUE CE MODULE NE FAIT PAS. Il ne redimensionne pas une forme déjà posée
 * — ça, ce sont les POIGNÉES, et elles demandent un genre de `CanvasControl` qui
 * n'existe pas encore (ticket 25). Créer et retoucher sont deux gestes ; celui-ci
 * est le premier, et c'est celui qui manquait complètement.
 */

/** Rectangle du geste, en pixels de la TOILE — mêmes coordonnées que
 *  `LayerTransform.x/y` et que `hitTestPhotoLayer`, origine haut-gauche. */
export interface DrawnRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Rectangle NORMALISÉ entre deux points du geste.
 *
 * « Normalisé » veut dire que tirer vers le haut ou vers la gauche donne un
 * rectangle valide : on prend le min et l'étendue absolue, jamais la différence
 * signée. Sans ça, un geste vers le haut-gauche rendrait une largeur négative,
 * et tout ce qui suit (couverture, poignées, sérialisation) devrait s'en
 * défendre — un seul endroit vaut mieux que six.
 *
 * `carre` contraint au CARRÉ, sur le plus GRAND côté. C'est la convention de
 * Photoshop, Figma et Illustrator avec Maj : le carré englobe le geste au lieu
 * d'être inscrit dedans, donc la forme ne rétrécit jamais sous le curseur.
 * ⚠️ Le signe est préservé — le carré grandit dans la direction où on tire, pas
 * vers le bas-droite depuis l'origine.
 */
export function rectFromDrag(a: PixelPoint, b: PixelPoint, carre = false): DrawnRect {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (carre) {
    const cote = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx) * cote;
    dy = Math.sign(dy) * cote;
  }
  return {
    x: Math.min(a.x, a.x + dx),
    y: Math.min(a.y, a.y + dy),
    width: Math.abs(dx),
    height: Math.abs(dy),
  };
}

/**
 * Le geste a-t-il assez d'ampleur pour valoir une forme ?
 *
 * Un clic simple, ou un tremblement de deux pixels, ne doit PAS créer un calque
 * — sinon chaque clic manqué en laisse un derrière lui, et il faut l'annuler à
 * la main. Le seuil est en pixels de la TOILE et non de l'écran : à 13 % de
 * zoom, trois pixels d'écran en font vingt-trois sur une photo de 26 Mpx, et
 * un seuil en pixels d'écran laisserait passer des formes invisibles.
 *
 * ⚠️ Il ne remplace pas une valeur minimale sur la forme : une fois créée, elle
 * reste redimensionnable jusqu'à presque rien par ses curseurs. Ce seuil borne
 * le GESTE, pas la forme.
 */
export const MIN_DRAW_SIZE_PX = 8;

export function isDrawnRectUsable(rect: DrawnRect): boolean {
  return rect.width >= MIN_DRAW_SIZE_PX && rect.height >= MIN_DRAW_SIZE_PX;
}

/** Boîte à DEUX COINS d'une source de masque `shape`, en coordonnées image
 *  normalisées [0,1] — l'unité exacte que `mask/sources/shape.ts` sérialise en
 *  `params[0..3]` (`x0,y0,x1,y1`). C'est ce que produit le tracé de l'outil
 *  Forme quand il pose une SÉLECTION géométrique sur un calque d'effet (le
 *  marquee de Photoshop, ticket 12), par opposition à `AplatRectParams` qui
 *  décrit un CALQUE `aplat` en fraction du cadre. */
export interface ShapeBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Traduit le rectangle du geste dans la boîte d'une source de masque `shape`.
 *
 * ⚠️ UNITÉ DIFFÉRENTE D'`aplatParamsFromRect` : ici les quatre nombres sont des
 * coordonnées image [0,1] (les deux coins), pas un centre + demi-dimensions. Le
 * shader de `shape` prend `min`/`max` des deux coins, donc l'ordre est libre —
 * mais `rectFromDrag` a déjà normalisé, donc `x0<=x1` et `y0<=y1` ici.
 *
 * `maskDims` de la source vient du DOCUMENT ; `canvas` est donc la taille du
 * document (mêmes pixels que la TOILE où vit `DrawnRect`), ce qui aligne les
 * deux espaces sans conversion — voir l'en-tête de `mask/sources/shape.ts`.
 *
 * Rend `null` sur une toile dégénérée, même garde qu'`aplatParamsFromRect` :
 * une division par zéro écrirait des NaN dans les params d'une source.
 */
export function shapeBoxFromRect(rect: DrawnRect, canvas: PixelSize): ShapeBox | null {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return null;
  return {
    x0: rect.x / canvas.width,
    y0: rect.y / canvas.height,
    x1: (rect.x + rect.width) / canvas.width,
    y1: (rect.y + rect.height) / canvas.height,
  };
}

/** Paramètres d'`aplat` décrivant ce rectangle, prêts pour `updateParams`. */
export interface AplatRectParams {
  centreX: number;
  centreY: number;
  largeur: number;
  hauteur: number;
}

/**
 * Traduit le rectangle du geste dans les paramètres d'`aplat`.
 *
 * ⚠️ LES DEUX UNITÉS NE SONT PAS LA MÊME, et c'est le seul endroit qui le sait.
 * `centreX`/`centreY` sont en UV du cadre (0 à 1) ; `largeur`/`hauteur` sont en
 * FRACTION du côté correspondant, pas en UV — un rectangle qui couvre la moitié
 * de la largeur a `largeur = 0.5`. Le shader d'`aplat` les redivise par deux
 * pour obtenir ses demi-dimensions ; ne pas anticiper cette division ici.
 *
 * Rend `null` si la toile est dégénérée : sans cette garde, la division rendrait
 * des paramètres NaN, que `updateParams` écrirait tels quels dans le calque —
 * un calque dont la forme n'est plus exprimable et qui ne se répare qu'en le
 * supprimant.
 */
export function aplatParamsFromRect(rect: DrawnRect, canvas: PixelSize): AplatRectParams | null {
  if (!(canvas.width > 0) || !(canvas.height > 0)) return null;
  return {
    centreX: (rect.x + rect.width / 2) / canvas.width,
    centreY: (rect.y + rect.height / 2) / canvas.height,
    largeur: rect.width / canvas.width,
    hauteur: rect.height / canvas.height,
  };
}
