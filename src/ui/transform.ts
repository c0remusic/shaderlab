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
  /** Coins de la box englobante, coordonnées PIXELS du fond, ordre TL, TR, BR, BL. */
  corners: [PixelPoint, PixelPoint, PixelPoint, PixelPoint];
  rotationHandle: PixelPoint;
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
  const halfW = (photoSize.width * transform.scale) / 2;
  const halfH = (photoSize.height * transform.scale) / 2;
  const localCorners: PixelPoint[] = [
    { x: -halfW, y: -halfH },
    { x: halfW, y: -halfH },
    { x: halfW, y: halfH },
    { x: -halfW, y: halfH },
  ];
  const corners = localCorners.map((p) => rotatePoint(p, transform)) as TransformHandleGeometry["corners"];
  const rotationHandle = rotatePoint({ x: 0, y: -halfH - ROTATION_HANDLE_OFFSET_PX }, transform);
  return { corners, rotationHandle };
}

/**
 * Nouvelle échelle uniforme telle que le point sous le pointeur se trouve à
 * la même distance du centre que le coin de la box à cette échelle — basé
 * sur le RATIO des distances au centre (pas la direction), pour ne jamais
 * produire de saut brusque si le pointeur traverse le centre pendant le
 * drag. Clampée par `clampTransformScale`.
 */
export function scaleFromCornerDrag(transform: LayerTransform, photoSize: PixelSize, pointer: PixelPoint): number {
  const dx = pointer.x - transform.x;
  const dy = pointer.y - transform.y;
  const pointerDistance = Math.hypot(dx, dy);
  const baseHalfDiagonal = Math.hypot(photoSize.width / 2, photoSize.height / 2);
  if (baseHalfDiagonal === 0) return clampTransformScale(transform.scale);
  return clampTransformScale(pointerDistance / baseHalfDiagonal);
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
