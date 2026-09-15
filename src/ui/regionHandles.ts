import type { OverlayRect } from "./transform";

/**
 * Géométrie du manipulateur de RÉGION — le disque qu'on pose sur la toile pour
 * dire à un effet OÙ agir.
 *
 * D'OÙ ÇA VIENT. Verdict d'usage d'Antoine sur `pixelStretch` : « difficile à
 * positionner correctement ». La région existe depuis le 2026-08-01
 * (`regionX`/`regionY`/`regionRadius`/`regionFeather`) mais ne se règle qu'aux
 * curseurs, là où la référence Figma pose un cercle sur la toile — « place the
 * on-canvas circle over the area you want to stretch ». Le §6bis l'avait écrit
 * (« le nôtre a angle + position + portée, SANS MANIPULATEUR DIRECT ») sans que
 * ça devienne du travail : c'est le même manque qui avait fait ajouter la
 * région, traité à moitié.
 *
 * ─── LES DEUX UNITÉS NE SONT PAS LES MÊMES, ET C'EST TOUT LE PIÈGE ───────────
 *
 * Le centre est en **UV** (0..1 du cadre) : `regionCenter` est lu tel quel par
 * le shader, qui en retranche 0,5. Le rayon, lui, est en unités de l'espace
 * **ISOTROPE** de `uvSpace` — celui où `q = (uv - 0.5) * aspectScale(dims)`,
 * c'est-à-dire des pixels divisés par `sqrt(W*H)`.
 *
 * Traiter le rayon comme une fraction d'UV donnerait un cercle juste sur une
 * image carrée (où `aspectScale` vaut exactement (1,1)) et faux partout
 * ailleurs — donc juste sur la mire de test et faux sur toutes les photos
 * d'Antoine, qui sont en 3:2. C'est la raison d'être de ce module : la
 * conversion est écrite UNE fois, et testée en Node.
 *
 * Ce fichier ne touche à aucun DOM : il prend des rectangles MESURÉS et rend
 * des nombres, exactement comme `ui/transform.ts` dont il reprend `OverlayRect`.
 */

/** Centre en UV (0..1 du cadre), tel que le shader le lit. */
export interface RegionCenter {
  x: number;
  y: number;
}

/** Le disque tel qu'il doit être DESSINÉ, en pixels CSS de l'overlay. */
export interface RegionOverlayCircle {
  cx: number;
  cy: number;
  r: number;
}

/**
 * Pixels d'ÉCRAN par unité d'espace isotrope.
 *
 * Un rayon `r` vaut `r * sqrt(W*H)` pixels de l'image (par définition de `q`),
 * et l'image est affichée à `rect.width / bgSize.width` pixels d'écran par
 * pixel d'image. Le produit des deux est le seul facteur dont tout le reste a
 * besoin.
 *
 * Le canvas conserve son rapport d'aspect à l'affichage (il est lettreboxé, pas
 * étiré), donc l'échelle est la même sur les deux axes et un disque reste un
 * disque. On lit quand même `width` plutôt qu'une moyenne : si cette hypothèse
 * tombait, un cercle visiblement décalé du rendu serait un symptôme lisible,
 * là qu'une moyenne masquerait l'erreur en la répartissant.
 */
export function isotropicToScreen(bgSize: { width: number; height: number }, rect: OverlayRect): number {
  const ref = Math.sqrt(bgSize.width * bgSize.height);
  return (ref * rect.width) / bgSize.width;
}

/** Le disque à dessiner, depuis les valeurs de paramètres. */
export function regionToOverlay(
  center: RegionCenter,
  radius: number,
  bgSize: { width: number; height: number },
  rect: OverlayRect,
): RegionOverlayCircle {
  return {
    cx: rect.left + center.x * rect.width,
    cy: rect.top + center.y * rect.height,
    r: radius * isotropicToScreen(bgSize, rect),
  };
}

/** Centre en UV depuis une position de pointeur, déjà ramenée au repère de
 *  l'overlay. Non borné ici : les bornes appartiennent au paramètre, et
 *  `clampRegionCenter` les applique en un seul endroit. */
export function centerFromOverlayPoint(x: number, y: number, rect: OverlayRect): RegionCenter {
  return {
    x: (x - rect.left) / rect.width,
    y: (y - rect.top) / rect.height,
  };
}

/**
 * Rayon isotrope depuis la position du pointeur sur la poignée de bord.
 *
 * La distance est mesurée à l'écran puis reconvertie, et NON calculée en UV :
 * une distance UV n'est pas isotrope, donc tirer la poignée à l'horizontale et
 * à la verticale donnerait deux rayons différents pour le même geste de la
 * main.
 */
export function radiusFromOverlayPoint(
  x: number,
  y: number,
  center: RegionCenter,
  bgSize: { width: number; height: number },
  rect: OverlayRect,
): number {
  const cx = rect.left + center.x * rect.width;
  const cy = rect.top + center.y * rect.height;
  return Math.hypot(x - cx, y - cy) / isotropicToScreen(bgSize, rect);
}

/**
 * Position de la poignée de RAYON, ramenée dans la vue.
 *
 * TROUVÉ AU CHECKPOINT SUR LA VRAIE FENÊTRE (2026-08-02), et invisible aux
 * tests : au rayon PAR DÉFAUT de `pixelStretch` (1,5), le cercle fait deux fois
 * la demi-diagonale de la toile. La poignée, posée sur l'anneau, tombait donc
 * très largement hors de l'écran — on ne voyait que le point du centre, et il
 * n'existait AUCUN geste pour réduire la zone. Le manipulateur était inutile
 * exactement dans l'état où l'effet arrive.
 *
 * La poignée est donc rabattue au bord de la vue quand l'anneau en sort. Elle
 * cesse alors d'indiquer le rayon — mais un repère hors écran n'indiquait rien
 * non plus, et lui, on ne pouvait pas l'attraper. Le geste, lui, reste exact :
 * le rayon vient de la DISTANCE du pointeur au centre, pas de la position de la
 * poignée.
 */
export function radiusHandlePosition(
  circle: RegionOverlayCircle,
  rect: OverlayRect,
  inset = 12,
): { x: number; y: number } {
  const minX = rect.left + inset;
  const maxX = rect.left + rect.width - inset;
  const minY = rect.top + inset;
  const maxY = rect.top + rect.height - inset;
  return {
    x: Math.min(maxX, Math.max(minX, circle.cx + circle.r)),
    y: Math.min(maxY, Math.max(minY, circle.cy)),
  };
}

/** Bornes du centre — celles de `regionX`/`regionY`, qui laissent volontairement
 *  sortir du cadre (une coulure peut partir d'un centre hors champ). */
const REGION_CENTER_MIN = -0.5;
const REGION_CENTER_MAX = 1.5;

export function clampRegionCenter(center: RegionCenter): RegionCenter {
  const clamp = (v: number) => Math.min(REGION_CENTER_MAX, Math.max(REGION_CENTER_MIN, v));
  return { x: clamp(center.x), y: clamp(center.y) };
}

/** Borne le rayon aux valeurs déclarées par le paramètre. Prend les bornes en
 *  argument plutôt que de les redéclarer : le paramètre reste la seule source,
 *  et un effet qui exposerait une autre plage marcherait sans toucher ici. */
export function clampRegionRadius(radius: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, radius));
}
