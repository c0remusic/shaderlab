import type { LayerTransform } from "../layers/types";
import { computeHandleGeometry, type PixelPoint, type PixelSize } from "./transform";

/**
 * Magnétisme du placement d'un calque photo.
 *
 * Module PUR (aucune dépendance React/DOM), testable en env Node — même
 * convention que `transform.ts`, `viewport.ts` et `tools.ts`.
 *
 * ## Le seuil est en pixels ÉCRAN, jamais en pixels image
 *
 * C'est la décision qui fait tout le reste. Un seuil exprimé en pixels image
 * vaudrait, sur une photo 6000 px affichée à 20 %, cinq fois moins de course de
 * souris qu'à 100 % : l'accroche serait imperceptible dézoomé et collante
 * zoomé, pour un même geste de la main. L'appelant fournit donc l'échelle
 * d'affichage et le seuil est converti ici — un seul endroit.
 *
 * ## L'accroche porte sur la BOÎTE ENGLOBANTE, pas sur les coins
 *
 * Une photo tournée n'a pas de bord horizontal à aligner. Ce qu'on aligne alors
 * est son englobante alignée aux axes, ce que font tous les éditeurs : c'est la
 * seule quantité qui garde un sens à toute rotation, et elle coïncide avec les
 * coins quand la rotation est nulle — donc le cas courant n'est pas dégradé.
 */

/** Seuil d'accroche, en pixels ÉCRAN. Assez large pour être trouvé sans viser,
 *  assez étroit pour qu'un placement délibérément proche reste possible. */
export const SNAP_THRESHOLD_SCREEN_PX = 8;

/** Ce à quoi une accroche s'est produite — sert à dessiner le guide ET à
 *  expliquer le déplacement, qui sinon se lit comme une saccade. */
export interface SnapGuide {
  axis: "x" | "y";
  /** Position du guide, en pixels du FOND. */
  value: number;
}

export interface SnapCandidate {
  axis: "x" | "y";
  value: number;
}

export interface SnapResult {
  /** Correction à appliquer à la position, en pixels du fond. */
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

/** Boîte englobante alignée aux axes d'un calque photo transformé. */
export function boundingBox(transform: LayerTransform, photoSize: PixelSize): {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  centerX: number;
  centerY: number;
} {
  const { corners } = computeHandleGeometry(transform, photoSize);
  const xs = corners.map((c: PixelPoint) => c.x);
  const ys = corners.map((c: PixelPoint) => c.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return { minX, maxX, minY, maxY, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 };
}

/**
 * Lignes auxquelles s'accrocher : les bords et les médianes de la TOILE, puis
 * les bords et centres des AUTRES calques photo.
 *
 * L'ordre compte — la toile d'abord. À égalité d'écart, c'est elle qui gagne :
 * un alignement sur le cadre est une intention plus probable, et plus lisible
 * une fois posé, qu'un alignement fortuit sur un voisin.
 */
export function buildSnapTargets(
  bgSize: PixelSize,
  others: readonly { transform: LayerTransform; photoSize: PixelSize }[] = [],
): SnapCandidate[] {
  const targets: SnapCandidate[] = [
    { axis: "x", value: 0 },
    { axis: "x", value: bgSize.width / 2 },
    { axis: "x", value: bgSize.width },
    { axis: "y", value: 0 },
    { axis: "y", value: bgSize.height / 2 },
    { axis: "y", value: bgSize.height },
  ];
  for (const other of others) {
    const b = boundingBox(other.transform, other.photoSize);
    targets.push(
      { axis: "x", value: b.minX },
      { axis: "x", value: b.centerX },
      { axis: "x", value: b.maxX },
      { axis: "y", value: b.minY },
      { axis: "y", value: b.centerY },
      { axis: "y", value: b.maxY },
    );
  }
  return targets;
}

/**
 * Correction de position qui accroche la boîte sur les lignes fournies.
 *
 * Les TROIS lignes de la boîte concourent sur chaque axe (bord bas, milieu,
 * bord haut) et la meilleure gagne. N'en tester qu'une — le centre, disons —
 * rendrait impossible de coller un bord au bord de la toile, qui est pourtant
 * le geste le plus courant.
 *
 * `displayScale` = pixels écran par pixel du fond. C'est lui qui convertit le
 * seuil ; à 0 ou négatif, aucune accroche plutôt qu'un seuil infini.
 */
export function snapBox(
  transform: LayerTransform,
  photoSize: PixelSize,
  targets: readonly SnapCandidate[],
  displayScale: number,
): SnapResult {
  if (!(displayScale > 0)) return { dx: 0, dy: 0, guides: [] };
  const threshold = SNAP_THRESHOLD_SCREEN_PX / displayScale;
  const box = boundingBox(transform, photoSize);
  const lines = {
    x: [box.minX, box.centerX, box.maxX],
    y: [box.minY, box.centerY, box.maxY],
  };

  const result: SnapResult = { dx: 0, dy: 0, guides: [] };
  for (const axis of ["x", "y"] as const) {
    let best: { delta: number; value: number } | null = null;
    for (const target of targets) {
      if (target.axis !== axis) continue;
      for (const line of lines[axis]) {
        const delta = target.value - line;
        if (Math.abs(delta) > threshold) continue;
        // `<` STRICT : à égalité d'écart, le premier trouvé gagne, donc la
        // toile (posée en tête par `buildSnapTargets`) l'emporte sur un voisin.
        if (best === null || Math.abs(delta) < Math.abs(best.delta)) {
          best = { delta, value: target.value };
        }
      }
    }
    if (best === null) continue;
    if (axis === "x") result.dx = best.delta;
    else result.dy = best.delta;
    result.guides.push({ axis, value: best.value });
  }
  return result;
}

/** Écart RELATIF sous lequel une échelle s'accroche à une valeur remarquable.
 *  Relatif et non absolu : 2 % d'écart se lit pareil à 20 % qu'à 300 %, alors
 *  qu'un seuil absolu serait collant en bas et inopérant en haut. */
export const SCALE_SNAP_TOLERANCE = 0.02;

/**
 * Accroche les deux échelles sur leurs valeurs remarquables : le pixel natif
 * (100 %) et le RATIO D'ORIGINE de la photo.
 *
 * Le ratio d'origine est ce qui rend « pas déformée » atteignable à la souris.
 * Sans lui, revenir d'un étirement à un rapport exact demanderait de viser au
 * pixel ou de passer par la saisie au clavier — l'utilisateur pourrait étirer
 * une photo, mais plus jamais la redresser d'un geste.
 *
 * Les deux accroches sont INDÉPENDANTES : une photo peut se caler à 100 % sur
 * un axe tout en restant étirée, ce qui est un état légitime et pas une
 * incohérence à corriger d'office.
 */
export function snapScales(scaleX: number, scaleY: number): { scaleX: number; scaleY: number } {
  const nearNative = (s: number) => (Math.abs(s - 1) <= SCALE_SNAP_TOLERANCE ? 1 : s);
  const x = nearNative(scaleX);
  const y = nearNative(scaleY);
  // Ratio d'origine = les deux axes égaux. Testé APRÈS l'accroche au pixel
  // natif : si les deux sont déjà tombés à 1, ils sont égaux et rien ne bouge.
  if (x > 0 && Math.abs(y / x - 1) <= SCALE_SNAP_TOLERANCE) {
    return { scaleX: x, scaleY: x };
  }
  return { scaleX: x, scaleY: y };
}
