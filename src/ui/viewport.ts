/**
 * Viewport du canvas : zoom et déplacement (PRD
 * `2026-07-18-shaderlab-canvas-pan-zoom-prd.md`, MUST du gate v1
 * `2026-07-13-shaderlab-standalone-v1-design.md:107`).
 *
 * Module PUR : aucune dépendance React/DOM/WebGPU, testable en env Node —
 * même convention que `ui/transform.ts` et `ui/canvasMode.ts`.
 *
 * ## Ce que ce module NE fait PAS, et pourquoi ça compte
 *
 * Il ne touche pas au pipeline de rendu. Le canvas garde la résolution NATIVE
 * du document (`App.tsx` pose `canvas.width/height` = taille du document) et le
 * zoom s'applique en TRANSFORM CSS sur l'élément affiché. Deux raisons :
 *
 *  1. Le projet interdit explicitement tout aperçu à résolution réduite
 *     (CLAUDE.md « Pas de distinction preview/export », plan performance
 *     2026-07-30 § « Ce qu'on ne fera PAS »). Zoomer dans un rendu pleine
 *     résolution est l'inverse de rendre à résolution réduite : ce module ne
 *     franchit pas cet interdit, il le rend enfin observable.
 *  2. `getBoundingClientRect()` reflète DÉJÀ les transforms CSS. Toutes les
 *     conversions écran→pixels image du projet ont la forme
 *     `(clientX - rect.left) * (canvas.width / rect.width)` — `Canvas.toImageCoords`,
 *     `TransformHandles.screenToImagePixels`, la géométrie du curseur de
 *     pinceau. Elles restent donc JUSTES sans modification tant que la
 *     transform est une pure translation + homothétie. N'y introduis jamais de
 *     rotation ni de `skew` sans reprendre ces trois sites.
 *
 * ## Conventions de coordonnées
 *
 * - `content` : taille du document en PIXELS IMAGE (= `canvas.width/height`).
 * - `view`    : taille de la zone visible en PIXELS CSS (le conteneur).
 * - `scale`   : pixels CSS par pixel image. `scale = 1` ⇒ 1 pixel image occupe
 *               1 pixel CSS, ce que le PRD appelle « 100 % ».
 * - `offsetX/offsetY` : position en pixels CSS du coin haut-gauche du contenu
 *               dans le repère de la vue.
 */

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ViewportState {
  scale: number;
  offsetX: number;
  offsetY: number;
}

/** Pas multiplicatif des boutons zoom +/- de l'UI. */
export const ZOOM_STEP_FACTOR = 1.25;

/**
 * Marge laissée autour de l'image à l'ajustement, en pixels CSS.
 *
 * Sans elle, « ajuster » colle la photo aux bords de la zone visible : en plein
 * écran l'image touchait le haut et le bas sans un pixel de respiration, ce qui
 * se lit comme une image coupée plutôt que comme une image entière. Tous les
 * éditeurs posent ce liseré, et c'est aussi lui qui rend visible le fait qu'on
 * voit bien la photo COMPLÈTE.
 */
export const FIT_MARGIN = 24;

/** Sensibilité de la molette : `deltaY` d'un cran de molette standard vaut
 *  ~100, ce coefficient le convertit en un facteur d'échelle proche du pas des
 *  boutons pour que les deux gestes se ressemblent. */
const WHEEL_ZOOM_SENSITIVITY = 0.0022;

/** Taille dégénérée (document pas encore chargé, conteneur pas encore mesuré) :
 *  toute la géométrie divise par ces valeurs, donc on les refuse en amont
 *  plutôt que de propager des `Infinity`/`NaN` dans un style CSS. */
function isDegenerate(size: Size): boolean {
  return !(size.width > 0) || !(size.height > 0);
}

/**
 * Échelle « ajuster à l'écran » : toute l'image tient dans la vue, bandes
 * autour si les ratios diffèrent (*contain*, jamais *cover*). C'est exactement
 * le comportement qu'avait le canvas AVANT ce module, quand `max-width` et
 * `max-height: 100%` le réduisaient — le viewport au repos doit donc être
 * visuellement identique à l'ancien affichage.
 */
export function fitScale(content: Size, view: Size): number {
  if (isDegenerate(content) || isDegenerate(view)) return 1;
  const usable = {
    width: Math.max(1, view.width - FIT_MARGIN * 2),
    height: Math.max(1, view.height - FIT_MARGIN * 2),
  };
  return Math.min(usable.width / content.width, usable.height / content.height);
}

/**
 * Plafond de zoom, en pixels écran par pixel image. Valeur de Photoshop
 * (3200 %).
 *
 * Le PRD posait « pas de zoom au-delà du pixel natif », soit un plafond à 1.
 * Cette contrainte est LEVÉE (choix utilisateur, 2026-07-31) : elle rendait
 * inspectable aucun des gestes fins que l'app propose — un bord de masque
 * pinceau, un liseré d'`outlines`, l'accroche d'un coin de photo se jugent
 * au-dessus du pixel natif ou pas du tout.
 *
 * Gratuit côté GPU : le zoom est un TRANSFORM CSS sur le canvas, dont la
 * résolution reste native quoi qu'il arrive (`Canvas.tsx`). Zoomer à 3200 %
 * n'alloue rien et ne relance aucune passe.
 */
export const MAX_ZOOM = 32;

/**
 * Marge de dézoom SOUS l'ajustement. À 8, on peut reculer jusqu'à voir la photo
 * au huitième de sa taille ajustée.
 *
 * Le plancher était l'ajustement lui-même, ce qui interdisait de reculer. C'est
 * exactement le geste qui manque quand on place une photo À CHEVAL sur le bord
 * de la toile (double exposure) : la partie hors cadre était invisible, donc
 * impossible à viser — on déplaçait à l'aveugle un objet dont on ne voyait
 * qu'une moitié.
 */
export const ZOOM_OUT_HEADROOM = 8;

/**
 * Bornes d'échelle.
 *
 * Les deux valeurs REMARQUABLES restent atteignables par construction :
 * l'ajustement (`fit`) et le pixel natif (`1`). C'est ce que les `Math.min` /
 * `Math.max` garantissent — sur une image plus petite que la vue, l'ajustement
 * dépasse déjà 100 %, et un plafond dur à 1 le rendrait inatteignable.
 * Au-delà de ces deux valeurs, les bornes laissent maintenant de la place des
 * deux côtés (voir `MAX_ZOOM` et `ZOOM_OUT_HEADROOM`).
 */
export function scaleBounds(content: Size, view: Size): { min: number; max: number } {
  const fit = fitScale(content, view);
  return {
    min: Math.min(fit, 1) / ZOOM_OUT_HEADROOM,
    max: Math.max(fit, MAX_ZOOM),
  };
}

export function clampScale(scale: number, content: Size, view: Size): number {
  const { min, max } = scaleBounds(content, view);
  if (!Number.isFinite(scale)) return min;
  return Math.min(max, Math.max(min, scale));
}

/**
 * Fraction de l'image qui doit rester dans la vue, quoi qu'on fasse.
 *
 * C'est le garde-fou qui remplace l'ancien clamp « l'image ne sort jamais » :
 * on peut la pousser de côté autant qu'on veut, il en reste toujours de quoi
 * la rattraper à la souris. Sans lui, un déplacement un peu franc laisse une
 * vue vide, sans aucun indice de la direction où l'image est partie.
 */
export const MIN_VISIBLE_FRACTION = 0.25;

/**
 * Combien de pixels d'image doivent rester visibles sur un axe.
 *
 * Deux bornes, chacune pour un cas dégénéré réel :
 * - jamais PLUS que l'image elle-même, sinon une image plus petite que le
 *   minimum deviendrait immobile (le clamp exigerait l'impossible) ;
 * - jamais MOINS que `FIT_MARGIN`, sinon un dézoom fort réduit la prise à une
 *   lichette de quelques pixels — visible en théorie, invisible en pratique.
 */
function minVisible(displayed: number, viewExtent: number): number {
  return Math.min(displayed, Math.max(FIT_MARGIN, MIN_VISIBLE_FRACTION * Math.min(displayed, viewExtent)));
}

/**
 * Borne le déplacement.
 *
 * UN SEUL RÉGIME depuis le 2026-08-01 (choix utilisateur) : l'image peut se
 * poser où on veut dans la vue, à tous les zooms, tant qu'il en reste
 * `minVisible` sur chaque axe.
 *
 * Ce que ça remplace, et pourquoi. Il y avait deux régimes, dont le second
 * n'était pas un clamp mais un CENTRAGE : dès que le contenu affiché tenait
 * dans la vue, l'offset était écrasé par le centre. Conséquence non voulue —
 * au zoom d'ajustement, qui est le zoom par défaut, le geste de déplacement ne
 * pouvait RIEN faire, et rien ne le disait. Arbitrage d'Antoine : « ajuster à
 * l'écran, c'est pour la position par défaut, pas pour un geste délibéré de
 * déplacement ». Le centrage reste donc, mais là où il appartient — dans
 * `fitViewport`, qui est cette position par défaut.
 *
 * Le MUST du PRD (`2026-07-18-shaderlab-canvas-pan-zoom-prd.md`) disait
 * « impossible de faire sortir l'image entièrement de la vue ». Il est tenu à
 * la lettre : `MIN_VISIBLE_FRACTION` garantit qu'elle n'en sort jamais
 * entièrement. C'est le clamp qui allait au-delà de ce que le PRD demandait.
 */
export function clampOffset(state: ViewportState, content: Size, view: Size): ViewportState {
  if (isDegenerate(content) || isDegenerate(view)) return state;
  const axis = (offset: number, displayed: number, viewExtent: number): number => {
    const keep = minVisible(displayed, viewExtent);
    // Bord DROIT au moins à `keep` du bord gauche de la vue, et bord GAUCHE au
    // plus à `keep` du bord droit : les deux inégalités du même garde-fou.
    return Math.min(viewExtent - keep, Math.max(keep - displayed, offset));
  };
  return {
    scale: state.scale,
    offsetX: axis(state.offsetX, content.width * state.scale, view.width),
    offsetY: axis(state.offsetY, content.height * state.scale, view.height),
  };
}

/**
 * État au repos : ajusté à la vue et centré.
 *
 * Le centrage est CALCULÉ ICI, explicitement. Il venait avant du second régime
 * de `clampOffset`, qui recentrait toute image tenant dans la vue — un effet
 * de bord dont dépendait cette fonction sans le dire. En le rapatriant, le
 * centrage devient ce qu'il est : la position de DÉPART du document, et non
 * une contrainte permanente sur tous les déplacements ultérieurs.
 */
export function fitViewport(content: Size, view: Size): ViewportState {
  const scale = fitScale(content, view);
  if (isDegenerate(content) || isDegenerate(view)) return { scale, offsetX: 0, offsetY: 0 };
  return {
    scale,
    offsetX: (view.width - content.width * scale) / 2,
    offsetY: (view.height - content.height * scale) / 2,
  };
}

/** Point du repère IMAGE sous un point du repère VUE. */
export function viewToImage(state: ViewportState, point: Point): Point {
  return {
    x: (point.x - state.offsetX) / state.scale,
    y: (point.y - state.offsetY) / state.scale,
  };
}

/** Position dans le repère VUE d'un point du repère IMAGE. */
export function imageToView(state: ViewportState, point: Point): Point {
  return {
    x: point.x * state.scale + state.offsetX,
    y: point.y * state.scale + state.offsetY,
  };
}

/**
 * Zoom ancré : le point de l'image qui se trouve sous `anchor` (repère VUE) y
 * reste après le changement d'échelle. C'est la propriété que le PRD exige du
 * zoom molette — « le point sous le curseur reste sous le curseur » — et elle
 * se calcule AVANT le clamp de déplacement, sinon l'ancrage serait faux au
 * moment précis où l'image bute sur un bord.
 *
 * L'ancre est reprojetée avec l'échelle CLAMPÉE et non celle demandée : sans
 * ça, continuer à pousser la molette au plafond de zoom ferait dériver l'image
 * sous un curseur immobile.
 */
export function zoomAt(
  state: ViewportState,
  anchor: Point,
  targetScale: number,
  content: Size,
  view: Size,
): ViewportState {
  const scale = clampScale(targetScale, content, view);
  const imagePoint = viewToImage(state, anchor);
  return clampOffset(
    {
      scale,
      offsetX: anchor.x - imagePoint.x * scale,
      offsetY: anchor.y - imagePoint.y * scale,
    },
    content,
    view,
  );
}

/** Zoom par pas multiplicatif autour d'une ancre (boutons +/- de l'UI : ancre
 *  = centre de la vue ; molette : ancre = curseur). */
export function zoomByFactor(
  state: ViewportState,
  anchor: Point,
  factor: number,
  content: Size,
  view: Size,
): ViewportState {
  return zoomAt(state, anchor, state.scale * factor, content, view);
}

/**
 * Zoom molette. `deltaY` suit la convention DOM (positif = molette vers le bas
 * = dézoom). L'exponentielle rend le geste indépendant du découpage des
 * évènements : dix petits crans produisent exactement le même zoom qu'un gros,
 * ce qui n'est pas vrai d'un facteur additif.
 */
export function zoomByWheel(
  state: ViewportState,
  anchor: Point,
  deltaY: number,
  content: Size,
  view: Size,
): ViewportState {
  const factor = Math.exp(-deltaY * WHEEL_ZOOM_SENSITIVITY);
  return zoomByFactor(state, anchor, factor, content, view);
}

/** Déplacement relatif, en pixels CSS. */
export function panBy(state: ViewportState, dx: number, dy: number, content: Size, view: Size): ViewportState {
  return clampOffset({ scale: state.scale, offsetX: state.offsetX + dx, offsetY: state.offsetY + dy }, content, view);
}

/** Zoom 100 % (1 pixel image = 1 pixel CSS) ancré au centre de la vue. */
export function zoomToActualSize(state: ViewportState, content: Size, view: Size): ViewportState {
  const center = { x: view.width / 2, y: view.height / 2 };
  return zoomAt(state, center, 1, content, view);
}

/**
 * Réajuste un viewport existant après un changement de taille de la VUE
 * (fenêtre redimensionnée, dock élargi/replié).
 *
 * L'échelle est conservée puis re-clampée plutôt que réinitialisée : le
 * redimensionnement d'une fenêtre n'est pas une demande de dézoom, et perdre le
 * zoom en élargissant le dock serait une surprise. Seul un document dégénéré
 * ramène à l'ajustement.
 *
 * `previousView` n'est PAS un paramètre de confort : sans elle, la fonction ne
 * peut pas savoir quel point de l'image se trouvait au centre avant le
 * redimensionnement, et « conserver ce qu'on regarde » devient une promesse
 * qu'elle ne peut pas tenir (elle reprojetterait le centre de la NOUVELLE vue
 * sur lui-même, c'est-à-dire ne ferait rien). L'appelant garde la taille
 * précédente ; c'est lui qui la détient, pas ce module.
 */
export function reconcileViewport(
  state: ViewportState,
  content: Size,
  previousView: Size,
  nextView: Size,
): ViewportState {
  if (isDegenerate(content) || isDegenerate(nextView)) return fitViewport(content, nextView);
  if (isDegenerate(previousView)) return fitViewport(content, nextView);
  const scale = clampScale(state.scale, content, nextView);
  // Le centre visé est conservé : c'est ce qu'on regarde, et c'est ce qui doit
  // survivre au redimensionnement — pas le coin haut-gauche.
  const centerBefore = viewToImage(state, { x: previousView.width / 2, y: previousView.height / 2 });
  return clampOffset(
    {
      scale,
      offsetX: nextView.width / 2 - centerBefore.x * scale,
      offsetY: nextView.height / 2 - centerBefore.y * scale,
    },
    content,
    nextView,
  );
}

/** Pourcentage affiché dans l'UI (le PRD demande que « le pourcentage courant
 *  soit visible »). Arrondi à l'entier : un « 66,7 % » n'aide personne. */
export function zoomPercent(state: ViewportState): number {
  return Math.round(state.scale * 100);
}

// `isPannable` a été RETIRÉ le 2026-08-01. Il répondait « y a-t-il quelque
// chose à explorer au déplacement ? » en testant si le contenu débordait de la
// vue — une question qui n'a plus de réponse négative depuis que le
// déplacement est libre à tous les zooms (voir `clampOffset`). Il n'avait
// aucun appelant de production : le curseur de préhension est posé en CSS par
// `Canvas.tsx` sur la seule foi du geste, jamais de cette fonction. Le garder
// aurait laissé traîner un prédicat qui ment.
