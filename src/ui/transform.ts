import type { LayerTransform } from "../layers/types";

export interface PixelSize {
  width: number;
  height: number;
}

export interface UvPoint {
  u: number;
  v: number;
}

export interface PixelPoint {
  x: number;
  y: number;
}

export interface TransformHandleGeometry {
  /** Les 4 coins RÉELS de la photo transformée (rotation comprise), en
   *  coordonnées PIXELS du fond, ordre TL, TR, BR, BL. Ce n'est PAS une boîte
   *  englobante alignée aux axes : dès que `rotation != 0`, l'englobante est
   *  strictement plus grande que la photo, et l'overlay qui la dessinait
   *  affichait un cadre droit trop grand avec les pastilles flottant dedans. */
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  rotationHandle: PixelPoint;
}

/** Index des 4 coins dans l'ordre de `TransformHandleGeometry.corners`.
 *  Exporté pour que l'overlay itère dessus SANS cast depuis un `number` :
 *  `transformFromCornerDrag` dépend de cet ordre pour trouver le coin opposé,
 *  un index hors bornes n'a pas de sens et ne doit pas être représentable. */
export const CORNER_INDICES = [0, 1, 2, 3] as const;
export type CornerIndex = (typeof CORNER_INDICES)[number];

/** Signes (x, y) de chaque coin en repère local, MÊME ordre que
 *  `CORNER_INDICES`. Table unique partagée par le calcul de géométrie et par
 *  l'ancrage au coin opposé — dupliquer l'ordre laisserait les deux se
 *  désynchroniser en silence, et l'ancre partirait sur le mauvais coin. */
const CORNER_SIGNS: Record<CornerIndex, PixelPoint> = {
  0: { x: -1, y: -1 },
  1: { x: 1, y: -1 },
  2: { x: 1, y: 1 },
  3: { x: -1, y: 1 },
};

/** Point d'ancrage d'un drag de coin. `oppositeCorner` = comportement
 *  Photoshop par défaut ; `center` = touche Alt maintenue. */
export type ScaleAnchor = "oppositeCorner" | "center";

/** Rectangle en pixels CSS, relatif à l'élément positionné qui porte l'overlay. */
export interface OverlayRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Rectangle minimal d'un `getBoundingClientRect()` — assez pour ce calcul,
 *  et assez peu pour que la fonction reste testable en Node sans DOM. */
export interface ClientRectLike {
  left: number;
  top: number;
  width: number;
  height: number;
}

/**
 * Boîte que l'overlay de poignées doit occuper : le rectangle RÉELLEMENT
 * AFFICHÉ du canvas, exprimé dans le repère de l'élément positionné qui porte
 * l'overlay (son `offsetParent`).
 *
 * Existe parce que l'overlay était posé en `inset: 0` sur `.workspace` et
 * mappait `bgSize` sur 100 % de CE conteneur, alors que le canvas y est à la
 * fois plus petit (lettreboxé par `max-width/height: 100%`) et décalé vers la
 * gauche (`padding-right` de compensation du dock, `Canvas.css`). Les poignées
 * étaient donc trop grandes et décalées même à rotation 0 — pendant que
 * `screenToImagePixels`, qui lit le rect du canvas, restait juste : on
 * attrapait une poignée là où la photo n'était pas.
 *
 * Deux rects MESURÉS en entrée, aucune hypothèse de mise en page : un zoom
 * appliqué au canvas par transform CSS est déjà pris en compte par
 * `getBoundingClientRect()`, donc l'overlay le suit sans rien savoir du zoom.
 */
export function overlayRectFromClientRects(canvasRect: ClientRectLike, parentRect: ClientRectLike): OverlayRect {
  return {
    left: canvasRect.left - parentRect.left,
    top: canvasRect.top - parentRect.top,
    width: canvasRect.width,
    height: canvasRect.height,
  };
}

/** Comparaison exacte de deux boîtes d'overlay — sert à ne PAS reposer d'état
 *  React quand une mesure rend les mêmes valeurs, sinon la mesure faite à
 *  chaque rendu se rappellerait elle-même sans fin. */
export function sameOverlayRect(a: OverlayRect, b: OverlayRect): boolean {
  return a.left === b.left && a.top === b.top && a.width === b.width && a.height === b.height;
}

/** Échelle minimale non nulle — empêche une box de collapser à zéro ou de
 *  s'inverser (division par une échelle nulle dans `compositeUvToPhotoUv`). */
export const MIN_TRANSFORM_SCALE = 0.02;

const ROTATION_HANDLE_OFFSET_PX = 32;

export function clampTransformScale(scale: number): number {
  return scale > MIN_TRANSFORM_SCALE ? scale : MIN_TRANSFORM_SCALE;
}

/**
 * Convertit une UV composite (0..1 sur la photo de fond) en UV dans la
 * photo A elle-même (0..1), par la transform INVERSE de son placement
 * (translation `(transform.x, transform.y)`, échelle uniforme
 * `transform.scale`, rotation `transform.rotation` radians autour de son
 * propre centre). Retourne `null` quand le point composite tombe HORS des
 * bornes de la photo A — le renderer traite `null`/hors-bornes comme
 * transparent, jamais un repeat/clamp de bord visible (design doc, PRD).
 */
export function compositeUvToPhotoUv(
  compositeUv: UvPoint,
  bgSize: PixelSize,
  transform: LayerTransform,
  photoSize: PixelSize,
): UvPoint | null {
  const px = compositeUv.u * bgSize.width;
  const py = compositeUv.v * bgSize.height;
  const dx = px - transform.x;
  const dy = py - transform.y;
  const cos = Math.cos(-transform.rotation);
  const sin = Math.sin(-transform.rotation);
  const rx = dx * cos - dy * sin;
  const ry = dx * sin + dy * cos;
  const scale = clampTransformScale(transform.scale);
  const lx = rx / scale;
  const ly = ry / scale;
  const photoPx = lx + photoSize.width / 2;
  const photoPy = ly + photoSize.height / 2;
  if (photoPx < 0 || photoPx >= photoSize.width || photoPy < 0 || photoPy >= photoSize.height) {
    return null;
  }
  return { u: photoPx / photoSize.width, v: photoPy / photoSize.height };
}

/** Pas de snap d'angle, en DEGRÉS — valeur de Photoshop, référence explicite
 *  du chantier calque photo (design 2026-07-26 §3.4, tranché avec sa raison).
 *  Le *déclencheur* retenu est `Shift` maintenu pendant le drag de rotation
 *  (voir `TransformHandles`) : la saisie au clavier dans le panneau Photo
 *  reste littérale, un angle tapé n'est jamais réécrit. */
export const ANGLE_SNAP_DEGREES = 15;

/** Cale un angle (RADIANS) sur le multiple de `stepDegrees` le plus proche.
 *  Fonction pure — aucune connaissance du geste qui l'appelle. */
export function snapAngle(rotation: number, stepDegrees: number = ANGLE_SNAP_DEGREES): number {
  const step = (stepDegrees * Math.PI) / 180;
  if (step <= 0) return rotation;
  return Math.round(rotation / step) * step;
}

/** Transform d'un calque photo fraîchement importé : centrée sur le fond,
 *  échelle 1, aucune rotation. MÊME expression que celle posée à l'import
 *  (`usePhotoLayer.handleImportPhotoLayer`) — « Réinitialiser » doit rendre
 *  exactement l'état initial, pas une approximation. */
export function resetTransform(bgSize: PixelSize): LayerTransform {
  return { x: bgSize.width / 2, y: bgSize.height / 2, scale: 1, rotation: 0 };
}

/** Recentre sur le fond sans toucher à l'échelle ni à la rotation. */
export function centerTransform(transform: LayerTransform, bgSize: PixelSize): LayerTransform {
  return { ...transform, x: bgSize.width / 2, y: bgSize.height / 2 };
}

/**
 * « Ajuster à la toile » = *contain* (design 2026-07-26 §3.4) : toute la
 * photo tient dans le fond, bandes autour si les ratios diffèrent — jamais
 * *cover*. La rotation est ignorée dans le calcul (l'ajustement porte sur la
 * box non tournée, comme l'ajustement de Photoshop) mais conservée.
 * Cas « photo plus grande que le fond » : c'est précisément celui que cette
 * action rend exploitable en un clic — la pré-passe rend dans une cible
 * bgWidth × bgHeight, donc tout ce qui dépasse est perdu par construction.
 * Une photo de taille dégénérée (0) laisse l'échelle inchangée plutôt que de
 * produire un `Infinity`/`NaN` silencieux.
 *
 * ARBITRAGE OUVERT, SIGNALÉ ET NON TRANCHÉ (design 2026-07-29 §11.5, §4.6).
 * Depuis la tranche T2, la toile peut être PLUS GRANDE que la photo. Sur une
 * telle toile, ce *contain* AGRANDIT la photo au-delà de sa résolution native —
 * un upscale, contraire à la barre de qualité du projet. Jusqu'à T2 le cas
 * n'existait pas : la toile valait la photo, donc l'échelle rendue valait au
 * plus 1.
 *
 * Le comportement est laissé INCHANGÉ, délibérément : le borner à 100 % ferait
 * de « Ajuster à la toile » un bouton sans effet sur une toile plus grande,
 * c'est-à-dire une autre décision produit, et personne ne l'a tranchée. Les deux
 * options sont réelles :
 *   - borner à `Math.min(1, ...)` : jamais d'upscale, le bouton ne fait rien
 *     quand la photo est déjà plus petite que la toile ;
 *   - laisser tel quel : le bouton tient son nom, au prix d'un upscale.
 * À reposer à Antoine avec un rendu (une photo agrandie 1,5× sur une toile
 * carrée) — c'est une question de goût autant que de règle.
 */
export function fitToCanvas(transform: LayerTransform, bgSize: PixelSize, photoSize: PixelSize): LayerTransform {
  if (photoSize.width <= 0 || photoSize.height <= 0) return { ...transform };
  const scale = clampTransformScale(Math.min(bgSize.width / photoSize.width, bgSize.height / photoSize.height));
  return { ...transform, x: bgSize.width / 2, y: bgSize.height / 2, scale };
}

function rotatePoint(local: PixelPoint, transform: LayerTransform): PixelPoint {
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    x: transform.x + local.x * cos - local.y * sin,
    y: transform.y + local.x * sin + local.y * cos,
  };
}

/** Géométrie écran (coordonnées pixels du fond) des poignées de
 *  `TransformHandles` : 4 coins pour l'échelle uniforme, 1 poignée dédiée
 *  au-dessus de la box pour la rotation — jamais de déformation
 *  non-uniforme (hors-scope v1, design doc). */
export function computeHandleGeometry(transform: LayerTransform, photoSize: PixelSize): TransformHandleGeometry {
  const halfH = (photoSize.height * transform.scale) / 2;
  const corners = CORNER_INDICES.map((index) =>
    rotatePoint(scaledCornerOffset(index, photoSize, transform.scale), transform),
  ) as TransformHandleGeometry["corners"];
  const rotationHandle = rotatePoint({ x: 0, y: -halfH - ROTATION_HANDLE_OFFSET_PX }, transform);
  return { corners, rotationHandle };
}

/** Décalage d'un coin par rapport au centre, AVANT rotation, à l'échelle
 *  donnée. Le coin opposé est exactement son opposé vectoriel — c'est cette
 *  symétrie qui rend l'ancrage au coin opposé calculable en une ligne. */
function scaledCornerOffset(index: CornerIndex, photoSize: PixelSize, scale: number): PixelPoint {
  const sign = CORNER_SIGNS[index];
  return { x: (sign.x * photoSize.width * scale) / 2, y: (sign.y * photoSize.height * scale) / 2 };
}

/**
 * Drag d'un coin : nouvelle transform (échelle ET position) telle que le point
 * d'ancrage reste RIGOUREUSEMENT immobile, rotation comprise.
 *
 * L'ancre par défaut est le coin OPPOSÉ à celui qu'on tire (Photoshop) — on
 * tire le coin bas-droit, le haut-gauche ne bouge pas. Ancrer le coin opposé
 * déplace forcément le centre : `x`/`y` doivent donc changer EN MÊME TEMPS que
 * `scale`, sinon la photo grossit symétriquement dans les 4 directions et
 * l'ancre dérive. `Alt` maintenu rebascule sur `center` (ancrage symétrique).
 *
 * L'échelle vient du RATIO des distances à l'ancre (pas d'une projection
 * signée) : traverser l'ancre pendant le drag ne peut donc ni inverser la box
 * ni produire de discontinuité. Clampée par `clampTransformScale`, et la
 * position est calculée avec l'échelle CLAMPÉE pour que l'ancre tienne aussi
 * au plancher.
 *
 * Point fixe par construction : recalculer l'ancre depuis la transform rendue
 * donne le même point, donc réappliquer la fonction pendant le drag (un appel
 * par `pointermove`, chacun repartant de la transform précédente) ne dérive pas.
 */
export function transformFromCornerDrag(
  transform: LayerTransform,
  photoSize: PixelSize,
  pointer: PixelPoint,
  cornerIndex: CornerIndex,
  anchor: ScaleAnchor = "oppositeCorner",
): LayerTransform {
  const baseHalfDiagonal = Math.hypot(photoSize.width / 2, photoSize.height / 2);
  if (baseHalfDiagonal === 0) return { ...transform };

  if (anchor === "center") {
    const distance = Math.hypot(pointer.x - transform.x, pointer.y - transform.y);
    return { ...transform, scale: clampTransformScale(distance / baseHalfDiagonal) };
  }

  // Ancre = position ÉCRAN du coin opposé à l'échelle courante, donc là où sa
  // pastille est dessinée — pas une position théorique recalculée autrement.
  const draggedOffset = scaledCornerOffset(cornerIndex, photoSize, transform.scale);
  const anchorPoint = rotatePoint({ x: -draggedOffset.x, y: -draggedOffset.y }, transform);

  // L'ancre et le coin tiré sont diamétralement opposés : leur écart vaut la
  // DIAGONALE complète (2 × demi-diagonale), pas la demi-diagonale.
  const distance = Math.hypot(pointer.x - anchorPoint.x, pointer.y - anchorPoint.y);
  const scale = clampTransformScale(distance / (2 * baseHalfDiagonal));

  const nextOffset = scaledCornerOffset(cornerIndex, photoSize, scale);
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    ...transform,
    x: anchorPoint.x + nextOffset.x * cos - nextOffset.y * sin,
    y: anchorPoint.y + nextOffset.x * sin + nextOffset.y * cos,
    scale,
  };
}

/**
 * Nouvel angle de rotation (radians) tel que la poignée de rotation pointe
 * vers `pointer` — mesuré depuis le HAUT de la box (angle 0 = poignée
 * directement au-dessus du centre), pour matcher l'orientation visuelle de
 * la poignée dédiée plutôt que l'axe X mathématique standard.
 */
export function rotationFromPointer(transform: LayerTransform, pointer: PixelPoint): number {
  const dx = pointer.x - transform.x;
  const dy = pointer.y - transform.y;
  return Math.atan2(dx, -dy);
}
