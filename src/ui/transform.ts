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
  /** Milieux des 4 côtés (rotation comprise), ordre haut, droite, bas, gauche.
   *  Ce sont les poignées d'échelle MONO-AXE. */
  edges: [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
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

/** Index des 4 poignées de CÔTÉ, dans l'ordre haut, droite, bas, gauche.
 *  Elles n'existaient pas tant que l'échelle était unique : sans second axe,
 *  une poignée de côté aurait fait exactement ce que fait un coin. */
export const EDGE_INDICES = [0, 1, 2, 3] as const;
export type EdgeIndex = (typeof EDGE_INDICES)[number];

/** Normale sortante de chaque côté en repère LOCAL (avant rotation), même
 *  ordre qu'`EDGE_INDICES`. Un seul des deux termes est non nul : c'est ce qui
 *  fait qu'une poignée de côté ne touche QU'UN axe. */
const EDGE_NORMALS: Record<EdgeIndex, PixelPoint> = {
  0: { x: 0, y: -1 },
  1: { x: 1, y: 0 },
  2: { x: 0, y: 1 },
  3: { x: -1, y: 0 },
};

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
  const lx = rx / clampTransformScale(transform.scaleX);
  const ly = ry / clampTransformScale(transform.scaleY);
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
  return { x: bgSize.width / 2, y: bgSize.height / 2, scaleX: 1, scaleY: 1, rotation: 0 };
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
  // « Ajuster » reste HOMOTHÉTIQUE, y compris depuis une photo étirée : le
  // bouton dit qu'il fait tenir la photo dans la toile, pas qu'il la déforme
  // pour la remplir. C'est aussi le seul geste qui redresse une photo étirée
  // sans passer par la saisie au clavier.
  const scale = clampTransformScale(Math.min(bgSize.width / photoSize.width, bgSize.height / photoSize.height));
  return { ...transform, x: bgSize.width / 2, y: bgSize.height / 2, scaleX: scale, scaleY: scale };
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
 *  `TransformHandles` : 4 coins (échelle des DEUX axes), 4 milieux de côté
 *  (échelle d'UN axe), 1 poignée dédiée au-dessus de la box pour la rotation. */
export function computeHandleGeometry(transform: LayerTransform, photoSize: PixelSize): TransformHandleGeometry {
  const halfH = (photoSize.height * transform.scaleY) / 2;
  const corners = CORNER_INDICES.map((index) =>
    rotatePoint(scaledCornerOffset(index, photoSize, transform), transform),
  ) as TransformHandleGeometry["corners"];
  const edges = EDGE_INDICES.map((index) =>
    rotatePoint(scaledEdgeOffset(index, photoSize, transform), transform),
  ) as TransformHandleGeometry["edges"];
  const rotationHandle = rotatePoint({ x: 0, y: -halfH - ROTATION_HANDLE_OFFSET_PX }, transform);
  return { corners, edges, rotationHandle };
}

/** Décalage d'un coin par rapport au centre, AVANT rotation, aux échelles
 *  données. Le coin opposé est exactement son opposé vectoriel — c'est cette
 *  symétrie qui rend l'ancrage au coin opposé calculable en une ligne. */
function scaledCornerOffset(index: CornerIndex, photoSize: PixelSize, scale: AxisScale): PixelPoint {
  const sign = CORNER_SIGNS[index];
  return { x: (sign.x * photoSize.width * scale.scaleX) / 2, y: (sign.y * photoSize.height * scale.scaleY) / 2 };
}

/** Décalage du MILIEU d'un côté par rapport au centre, avant rotation. */
function scaledEdgeOffset(index: EdgeIndex, photoSize: PixelSize, scale: AxisScale): PixelPoint {
  const n = EDGE_NORMALS[index];
  return { x: (n.x * photoSize.width * scale.scaleX) / 2, y: (n.y * photoSize.height * scale.scaleY) / 2 };
}

/** Les deux facteurs d'échelle, seuls — assez pour toute la géométrie
 *  ci-dessus, et acceptable depuis un `LayerTransform` entier par
 *  structuralité. */
export interface AxisScale {
  scaleX: number;
  scaleY: number;
}

/** Ramène un vecteur du repère du FOND vers le repère LOCAL de la photo
 *  (rotation inverse).
 *
 *  C'est la pièce qui rend l'échelle par axe possible : tant qu'une seule
 *  échelle existait, un simple RATIO DE DISTANCES suffisait et se moquait de
 *  l'orientation. Deux axes obligent à savoir quelle part du déplacement va
 *  dans la largeur de la photo et quelle part dans sa hauteur — ce que seule
 *  la rotation inverse répond. */
function toLocal(delta: PixelPoint, rotation: number): PixelPoint {
  const cos = Math.cos(-rotation);
  const sin = Math.sin(-rotation);
  return { x: delta.x * cos - delta.y * sin, y: delta.x * sin + delta.y * cos };
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
  proportional = false,
): LayerTransform {
  if (photoSize.width <= 0 || photoSize.height <= 0) return { ...transform };

  if (anchor === "center") {
    // Depuis le CENTRE, le coin est à une demi-largeur et une demi-hauteur.
    const local = toLocal({ x: pointer.x - transform.x, y: pointer.y - transform.y }, transform.rotation);
    const free = {
      scaleX: clampTransformScale(Math.abs(local.x) / (photoSize.width / 2)),
      scaleY: clampTransformScale(Math.abs(local.y) / (photoSize.height / 2)),
    };
    return { ...transform, ...constrainRatio(free, transform, proportional) };
  }

  // Ancre = position ÉCRAN du coin opposé à l'échelle courante, donc là où sa
  // pastille est dessinée — pas une position théorique recalculée autrement.
  const draggedOffset = scaledCornerOffset(cornerIndex, photoSize, transform);
  const anchorPoint = rotatePoint({ x: -draggedOffset.x, y: -draggedOffset.y }, transform);

  // VALEUR ABSOLUE et non projection signée : traverser l'ancre pendant le drag
  // ne peut donc ni retourner la box ni produire de discontinuité. C'est
  // l'invariant que tenait déjà le ratio de distances de la version à échelle
  // unique — il est conservé, axe par axe.
  const local = toLocal({ x: pointer.x - anchorPoint.x, y: pointer.y - anchorPoint.y }, transform.rotation);
  const free = {
    scaleX: clampTransformScale(Math.abs(local.x) / photoSize.width),
    scaleY: clampTransformScale(Math.abs(local.y) / photoSize.height),
  };
  const scale = constrainRatio(free, transform, proportional);

  const nextOffset = scaledCornerOffset(cornerIndex, photoSize, scale);
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    ...transform,
    x: anchorPoint.x + nextOffset.x * cos - nextOffset.y * sin,
    y: anchorPoint.y + nextOffset.x * sin + nextOffset.y * cos,
    ...scale,
  };
}

/**
 * Contrainte de proportions (`Maj` maintenu) : garde le rapport d'axes COURANT
 * plutôt que de forcer un carré.
 *
 * Une photo déjà étirée à 2:1 et qu'on redimensionne avec `Maj` doit rester à
 * 2:1 — c'est ce que « contraindre les proportions » veut dire partout
 * ailleurs. Forcer `scaleY = scaleX` réparerait la déformation sans qu'on l'ait
 * demandé, et rendrait impossible d'agrandir une photo étirée sans la
 * redresser.
 *
 * L'axe qui MÈNE est celui qui a le plus bougé en proportion : sans ce choix,
 * un drag surtout horizontal serait piloté par le résidu vertical et la box
 * suivrait mal le curseur.
 */
function constrainRatio(free: AxisScale, current: LayerTransform, proportional: boolean): AxisScale {
  if (!proportional) return free;
  const ratio = current.scaleX > 0 ? current.scaleY / current.scaleX : 1;
  const changeX = current.scaleX > 0 ? Math.abs(free.scaleX / current.scaleX - 1) : 0;
  const changeY = current.scaleY > 0 ? Math.abs(free.scaleY / current.scaleY - 1) : 0;
  if (changeX >= changeY) {
    return { scaleX: free.scaleX, scaleY: clampTransformScale(free.scaleX * ratio) };
  }
  const inverse = ratio > 0 ? 1 / ratio : 1;
  return { scaleX: clampTransformScale(free.scaleY * inverse), scaleY: free.scaleY };
}

/**
 * Drag d'une poignée de CÔTÉ : une seule échelle change, l'autre est intacte.
 *
 * Même contrat d'ancrage que le drag de coin — le côté OPPOSÉ reste
 * rigoureusement immobile, `Alt` rebascule sur le centre — et même point fixe :
 * réappliquer la fonction pendant le drag ne dérive pas.
 *
 * L'axe touché est celui de la NORMALE du côté, en repère local : tirer la
 * poignée droite d'une photo tournée à 30° étire toujours sa largeur à elle, et
 * jamais une largeur écran qui n'a aucun sens pour la photo.
 */
export function transformFromEdgeDrag(
  transform: LayerTransform,
  photoSize: PixelSize,
  pointer: PixelPoint,
  edgeIndex: EdgeIndex,
  anchor: ScaleAnchor = "oppositeCorner",
): LayerTransform {
  if (photoSize.width <= 0 || photoSize.height <= 0) return { ...transform };
  const normal = EDGE_NORMALS[edgeIndex];
  const horizontal = normal.x !== 0;

  if (anchor === "center") {
    const local = toLocal({ x: pointer.x - transform.x, y: pointer.y - transform.y }, transform.rotation);
    return horizontal
      ? { ...transform, scaleX: clampTransformScale(Math.abs(local.x) / (photoSize.width / 2)) }
      : { ...transform, scaleY: clampTransformScale(Math.abs(local.y) / (photoSize.height / 2)) };
  }

  const draggedOffset = scaledEdgeOffset(edgeIndex, photoSize, transform);
  const anchorPoint = rotatePoint({ x: -draggedOffset.x, y: -draggedOffset.y }, transform);
  const local = toLocal({ x: pointer.x - anchorPoint.x, y: pointer.y - anchorPoint.y }, transform.rotation);

  const scale: AxisScale = horizontal
    ? { scaleX: clampTransformScale(Math.abs(local.x) / photoSize.width), scaleY: transform.scaleY }
    : { scaleX: transform.scaleX, scaleY: clampTransformScale(Math.abs(local.y) / photoSize.height) };

  const nextOffset = scaledEdgeOffset(edgeIndex, photoSize, scale);
  const cos = Math.cos(transform.rotation);
  const sin = Math.sin(transform.rotation);
  return {
    ...transform,
    x: anchorPoint.x + nextOffset.x * cos - nextOffset.y * sin,
    y: anchorPoint.y + nextOffset.x * sin + nextOffset.y * cos,
    ...scale,
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
