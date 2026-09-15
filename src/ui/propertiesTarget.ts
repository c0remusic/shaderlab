import type { LayerState } from "../layers/types";

/** Cible visible de l'inspecteur Propriétés.
 *
 * `selectedId` reste la sélection de DOCUMENT (calque actif, raccourcis,
 * renderer). Cette valeur précise quelle FACETTE de ce calque l'utilisateur a
 * choisie dans la pile. La séparation est intentionnelle : cliquer la vignette
 * de masque ne doit pas inventer un second calque ni changer la pile métier. */
export type PropertiesTarget =
  | { kind: "photo"; layerId: string }
  | { kind: "effect"; layerId: string }
  | { kind: "mask"; layerId: string };

/** La cible principale d'une ligne. Une photo ouvre ses transformations ; tout
 * autre calque ouvre ses paramètres d'effet. */
export function layerTarget(layer: LayerState): PropertiesTarget {
  return {
    kind: layer.imageSource === undefined ? "effect" : "photo",
    layerId: layer.id,
  };
}

/** Clic sur le corps d'une ligne. Un id absent/périmé désélectionne plutôt que
 * de conserver un inspecteur pointant vers un objet qui n'existe plus. */
export function targetForLayerId(
  layers: readonly LayerState[],
  layerId: string | null,
): PropertiesTarget | null {
  if (layerId === null) return null;
  const layer = layers.find((candidate) => candidate.id === layerId);
  return layer ? layerTarget(layer) : null;
}

/** Réconcilie une cible après toute mutation structurelle.
 *
 * - calque supprimé -> aucune cible ;
 * - effet devenu photo (ou inversement) -> la facette principale suit sa
 *   nature réelle ;
 * - masque -> reste masque tant que son calque existe. */
export function reconcilePropertiesTarget(
  target: PropertiesTarget | null,
  layers: readonly LayerState[],
): PropertiesTarget | null {
  if (target === null) return null;
  const layer = layers.find((candidate) => candidate.id === target.layerId);
  if (!layer) return null;
  return target.kind === "mask" ? target : layerTarget(layer);
}

/** Une session de peinture appartient à une cible masque précise. Tout passage
 * vers une autre facette ou un autre calque doit donc la fermer. */
export function targetKeepsMaskSession(
  target: PropertiesTarget | null,
  layerId: string,
): boolean {
  return target?.kind === "mask" && target.layerId === layerId;
}

