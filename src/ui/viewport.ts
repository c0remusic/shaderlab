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
  return Math.min(view.width / content.width, view.height / content.height);
}

/**
 * Bornes d'échelle. Le PRD borne le zoom « du fit-to-screen jusqu'à 100 %
 * maximum (1 pixel image = 1 pixel écran) — pas de zoom au-delà du pixel
 * natif ».
 *
 * Le cas que cette formulation ne couvre pas : une image PLUS PETITE que la
 * vue, où l'ajustement agrandit déjà au-delà de 100 %. Prendre `1` comme
 * plafond dur rendrait alors « ajuster » inatteignable, et prendre `fit` comme
 * plancher dur rendrait 100 % inatteignable. Les bornes encadrent donc les
 * deux valeurs remarquables au lieu d'en sacrifier une.
 */
export function scaleBounds(content: Size, view: Size): { min: number; max: number } {
  const fit = fitScale(content, view);
  return { min: Math.min(fit, 1), max: Math.max(fit, 1) };
}

export function clampScale(scale: number, content: Size, view: Size): number {
  const { min, max } = scaleBounds(content, view);
  if (!Number.isFinite(scale)) return min;
  return Math.min(max, Math.max(min, scale));
}

/**
 * Borne le déplacement (PRD : « impossible de faire sortir l'image entièrement
 * de la vue »).
 *
 * Deux régimes, et le second n'est pas un clamp mais un CENTRAGE : quand le
 * contenu affiché est plus petit que la vue sur un axe, il n'y a rien à
 * explorer sur cet axe. Le laisser libre entre 0 et `view - displayed`
 * autoriserait une image collée en haut de la zone après un dézoom, ce qui se
 * lit comme un bug d'alignement et non comme un déplacement voulu.
 */
export function clampOffset(state: ViewportState, content: Size, view: Size): ViewportState {
  if (isDegenerate(content) || isDegenerate(view)) return state;
  const displayedWidth = content.width * state.scale;
  const displayedHeight = content.height * state.scale;
  const axis = (offset: number, displayed: number, viewExtent: number): number => {
    if (displayed <= viewExtent) return (viewExtent - displayed) / 2;
    return Math.min(0, Math.max(viewExtent - displayed, offset));
  };
  return {
    scale: state.scale,
    offsetX: axis(state.offsetX, displayedWidth, view.width),
    offsetY: axis(state.offsetY, displayedHeight, view.height),
  };
}

/** État au repos : ajusté à la vue et centré. */
export function fitViewport(content: Size, view: Size): ViewportState {
  const scale = fitScale(content, view);
  return clampOffset({ scale, offsetX: 0, offsetY: 0 }, content, view);
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

/** Vrai ssi le contenu déborde de la vue sur au moins un axe — c'est-à-dire
 *  s'il y a quelque chose à explorer au déplacement. Sert à ne pas afficher un
 *  curseur de préhension là où le geste ne ferait rien. */
export function isPannable(state: ViewportState, content: Size, view: Size): boolean {
  if (isDegenerate(content) || isDegenerate(view)) return false;
  return content.width * state.scale > view.width + 0.5 || content.height * state.scale > view.height + 0.5;
}
