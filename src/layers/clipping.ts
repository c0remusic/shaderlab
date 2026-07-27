import type { LayerState } from "./types";

/**
 * ÉCRÊTAGE (clipping) d'un calque d'effet sur le calque photo situé en dessous
 * — design `docs/superpowers/specs/2026-07-27-shaderlab-panneau-photo-et-ecretage-design.md` §3.2.
 *
 * Une OPTION par calque (`LayerState.clipToBelow`), jamais un changement de
 * régime : absent/false = comportement linéaire historique (l'effet s'applique
 * au composite complet en dessous).
 *
 * Deux étapes, deux responsabilités, volontairement séparées :
 *  - `clipBaseId` — ATTACHEMENT, purement STRUCTUREL. Ne regarde jamais
 *    `enabled`, donc **invariant par projection** : basculer un œil ou entrer
 *    en isolation ne change jamais À QUOI un calque est écrêté, seulement s'il
 *    rend. Sans cette invariance, l'isolation changerait le sens du document,
 *    ce que `isolation.ts` interdit explicitement.
 *  - `resolveClipping` — EFFECTIVITÉ, qui dépend de ce qui est réellement
 *    encodé cette frame.
 */

/**
 * Id du calque auquel `layerId` est attaché par son écrêtage, ou `null`.
 *
 * En descendant depuis le calque : on traverse les calques écrêtés consécutifs
 * et on s'arrête au premier calque qui est SOIT une photo (`imageSource`
 * présent — TERMINAL quoi qu'il porte lui-même comme `clipToBelow`), SOIT un
 * calque non écrêté. Retourne `null` si le bas de pile est atteint, si `layerId`
 * est introuvable, ou si le calque ne porte pas `clipToBelow`.
 *
 * La terminalité de la photo n'est pas cosmétique : c'est elle qui garantit
 * qu'entre une base photo et le calque écrêté qui la consomme, la pile ne peut
 * contenir que des calques écrêtés NON photo — donc qu'aucun `resolve()` de
 * `PhotoLayerInputResolver` (cible persistante PARTAGÉE, re-`clear`ée à chaque
 * appel) ne peut s'intercaler. Garde complémentaire dans le mutateur :
 * `LayerStack.setLayerClip` refuse un calque photo.
 */
export function clipBaseId(layers: LayerState[], layerId: string): string | null {
  const index = layers.findIndex((l) => l.id === layerId);
  if (index === -1) return null;
  if (!layers[index].clipToBelow) return null;
  for (let i = index - 1; i >= 0; i--) {
    const candidate = layers[i];
    if (candidate.imageSource !== undefined || !candidate.clipToBelow) return candidate.id;
  }
  return null;
}

/** Effectivité de l'écrêtage d'un calque pour la frame en cours. */
export type ClipResolution =
  /** `clipToBelow` absent/false — rendu linéaire, chemin historique. */
  | { kind: "none" }
  /** Base photo attachée ET rendue : le poids de compositing est multiplié par
   *  la couverture de cette base. */
  | { kind: "active"; baseLayerId: string }
  /** Aucune base PHOTO (bas de pile, ou base non-photo après un
   *  réordonnancement) : le calque rend LINÉAIREMENT, comme avant. Perdre
   *  l'attribut ou lever au rendu seraient tous deux pires — l'état est
   *  signalé dans la pile, pas silencieux. */
  | { kind: "inert" }
  /** Base photo attachée mais absente du rendu de cette frame : le calque ne
   *  contribue pas (sémantique de groupe — masquer la base masque ce qui lui
   *  est écrêté). */
  | { kind: "suppressed"; baseLayerId: string };

/**
 * Résolution de l'écrêtage de TOUS les calques de la pile.
 *
 * `renderedIds` = les calques que la boucle de frame va effectivement encoder,
 * donc APRÈS le filtre `enabled` ET après la projection d'isolation. C'est la
 * seule entrée qui dépend de la frame ; l'attachement, lui, ne dépend que de la
 * structure de la pile.
 */
export function resolveClipping(
  layers: LayerState[],
  renderedIds: ReadonlySet<string>,
): Map<string, ClipResolution> {
  const byId = new Map(layers.map((l) => [l.id, l] as const));
  const resolutions = new Map<string, ClipResolution>();
  for (const layer of layers) {
    if (!layer.clipToBelow) {
      resolutions.set(layer.id, { kind: "none" });
      continue;
    }
    const baseId = clipBaseId(layers, layer.id);
    const base = baseId === null ? undefined : byId.get(baseId);
    if (base === undefined || base.imageSource === undefined) {
      resolutions.set(layer.id, { kind: "inert" });
      continue;
    }
    resolutions.set(
      layer.id,
      renderedIds.has(base.id)
        ? { kind: "active", baseLayerId: base.id }
        : { kind: "suppressed", baseLayerId: base.id },
    );
  }
  return resolutions;
}
