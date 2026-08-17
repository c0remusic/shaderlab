import type { CropRect } from "../layers/types";

/**
 * Mode d'interaction EXCLUSIF du canvas (parité calque photo, T1 — design
 * `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.4).
 *
 * Remplace le booléen `maskPaintMode` d'`App.tsx`. Motif : peinture de masque
 * et poignées de transform ne s'excluaient pas — un calque photo sélectionné
 * en mode peinture superposait la boîte de déplacement
 * (`pointerEvents: "auto"` sur toute la boîte, `TransformHandles.tsx`) au
 * geste de pinceau. Un état unique rend les combinaisons incompatibles
 * INEXPRIMABLES au lieu de les interdire par convention.
 *
 * `crop` porte son `layerId` : sans lui, entrer en crop sur A puis
 * sélectionner B (ou supprimer A) laisserait un mode crop dont `Échap`
 * restaurerait le crop de A sur B — restauration silencieuse d'un état
 * arbitraire, hors historique donc non annulable. `reconcileCanvasMode`
 * est le garde qui rend ça impossible.
 *
 * Module PUR : aucune dépendance React/WebGPU, testable en env Node.
 */
export type CanvasMode =
  | { kind: "idle" }
  | { kind: "maskPaint"; layerId: string; sourceId: string | null }
  // TRACÉ D'UNE FORME (2026-08-17). Le seul mode SANS `layerId` : il n'agit pas
  // sur un calque, il en crée un. `reconcileCanvasMode` n'a donc rien à
  // rattraper pour lui — il n'a aucune cible à trahir.
  | { kind: "shapeDraw" }
  | { kind: "crop"; layerId: string; original: CropRect | undefined };

export const IDLE_CANVAS_MODE: CanvasMode = { kind: "idle" };

/** Bascule du mode peinture de masque. Entrer dans un mode sort de l'autre :
 *  depuis `crop`, on entre en peinture (le crop est ABANDONNÉ, jamais
 *  validé — même sémantique que `pointercancel`). */
export function toggleMaskPaint(mode: CanvasMode, layerId: string, sourceId: string | null): CanvasMode {
  return mode.kind === "maskPaint" ? { kind: "idle" } : { kind: "maskPaint", layerId, sourceId };
}

/** Entre en mode recadrage sur `layerId`, en mémorisant le crop d'entrée
 *  pour pouvoir l'annuler. Sort de tout autre mode. */
export function enterCrop(layerId: string, original: CropRect | undefined): CanvasMode {
  return { kind: "crop", layerId, original };
}

/** Vrai ssi le pinceau de masque intercepte les gestes du canvas. */
export function isMaskPaint(mode: CanvasMode): boolean {
  return mode.kind === "maskPaint";
}

/** Vrai ssi les poignées de transform DU CANVAS peuvent s'afficher —
 *  c'est-à-dire en `idle` uniquement (en `crop`, ce sont les poignées de
 *  crop qui prennent la place ; en `maskPaint`, rien ne doit intercepter le
 *  pinceau).
 *
 *  Ne gouverne QUE les poignées : le panneau « Photo » du dock reste visible
 *  et éditable dans les trois modes (un champ numérique n'intercepte aucun
 *  geste de pinceau) — design 2026-07-27 §3.7. La barre contextuelle que
 *  visait la formulation d'origine n'a jamais existé. */
export function showsTransformHandles(mode: CanvasMode): boolean {
  return mode.kind === "idle";
}

/**
 * Ramène le mode à `idle` quand son calque cible n'est plus la cible
 * légitime : changement de sélection, ou disparition du calque (suppression,
 * undo, changement de document). Ne concerne que `crop`, seul mode attaché à
 * un calque précis — `maskPaint` suit la sélection courante et n'a pas de
 * cible mémorisée à trahir.
 *
 * Rend le mode INCHANGÉ PAR IDENTITÉ quand rien ne doit bouger, pour rester
 * utilisable dans un `setState` sans provoquer de re-render superflu.
 */
export function reconcileCanvasMode(
  mode: CanvasMode,
  selectedId: string | null,
  layerIds: readonly string[],
  brushSourceIdsByLayer: ReadonlyMap<string, readonly string[]> = new Map(),
): CanvasMode {
  if (mode.kind === "maskPaint") {
    if (mode.layerId !== selectedId || !layerIds.includes(mode.layerId)) return { kind: "idle" };
    const sourceIds = brushSourceIdsByLayer.get(mode.layerId) ?? [];
    if (mode.sourceId === null && sourceIds.length > 0) return { ...mode, sourceId: sourceIds[0] };
    if (mode.sourceId !== null && !sourceIds.includes(mode.sourceId)) return { kind: "idle" };
    return mode;
  }
  if (mode.kind !== "crop") return mode;
  if (mode.layerId !== selectedId) return { kind: "idle" };
  if (!layerIds.includes(mode.layerId)) return { kind: "idle" };
  return mode;
}
