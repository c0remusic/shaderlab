import type { LayerLocks, LayerState } from "./types";

/**
 * Lecture des QUATRE verrous d'un calque — modèle Photoshop, posé le 2026-08-19.
 *
 * POURQUOI DES HELPERS ET PAS UNE LECTURE DIRECTE DE `layer.locks`. Chaque
 * verrou partiel doit répondre « oui » quand `all` est posé, et écrire
 * `locks?.position === true || locks?.all === true` sur chacun des dix-huit
 * sites de garde de `LayerStack` garantissait qu'un site finirait par oublier
 * la seconde moitié — silencieusement, puisqu'un verrou qui ne verrouille pas
 * ne fait rien échouer. C'est exactement le défaut corrigé le 2026-08-18 sur
 * `replaceLiveLayers`, à ceci près qu'il serait ici multiplié par quatre.
 *
 * Ce module ne dépend que de `layers/types` : il est lisible depuis `mask/`
 * (où vit le verrou de transparence) sans créer de cycle.
 */

/** Aucun verrou posé — la valeur d'un calque neuf. */
const AUCUN: LayerLocks = {};

function locksOf(layer: Pick<LayerState, "locks">): LayerLocks {
  return layer.locks ?? AUCUN;
}

/** TOUT est verrouillé. C'est l'état que le cadenas PLEIN annonce sur la ligne. */
export function isFullyLocked(layer: Pick<LayerState, "locks">): boolean {
  return locksOf(layer).all === true;
}

/** La GÉOMÉTRIE est gelée : paramètres cités par `canvasControls`, et le
 *  `transform` d'un calque photo. */
export function isPositionLocked(layer: Pick<LayerState, "locks">): boolean {
  const locks = locksOf(layer);
  return locks.all === true || locks.position === true;
}

/** CE QUE LE CALQUE COUVRE est gelé : masque sous toutes ses formes, et l'image
 *  source d'un calque photo. */
export function isMaskLocked(layer: Pick<LayerState, "locks">): boolean {
  const locks = locksOf(layer);
  return locks.all === true || locks.mask === true;
}

/**
 * Le pinceau ne peut plus ÉTENDRE le masque.
 *
 * ⚠️ Ne PAS s'en servir pour refuser une opération : ce verrou écrête, il ne
 * refuse pas. Un `if (isTransparencyLocked) return false` sur le pinceau
 * interdirait aussi d'affiner DEDANS, ce qui est précisément ce que ce verrou
 * existe pour permettre.
 *
 * ⚠️ `mask` l'implique : ne plus pouvoir toucher au masque du tout couvre a
 * fortiori ne plus pouvoir l'étendre. L'inverse est faux.
 */
export function isTransparencyLocked(layer: Pick<LayerState, "locks">): boolean {
  const locks = locksOf(layer);
  return locks.all === true || locks.mask === true || locks.transparency === true;
}

/** Au moins un verrou est posé, quel qu'il soit. */
export function hasAnyLock(layer: Pick<LayerState, "locks">): boolean {
  const locks = locksOf(layer);
  return locks.all === true || locks.position === true || locks.mask === true || locks.transparency === true;
}

/**
 * Verrouillé, mais pas entièrement — l'état que le cadenas CREUX annonce.
 *
 * Défini par `hasAnyLock && !all` et non par « au moins un des trois partiels » :
 * les deux coïncident aujourd'hui, mais la première formulation reste juste si
 * un cinquième verrou apparaît, là où la seconde l'oublierait en silence.
 */
export function isPartiallyLocked(layer: Pick<LayerState, "locks">): boolean {
  return hasAnyLock(layer) && !isFullyLocked(layer);
}

/**
 * Les OPÉRATIONS DE STRUCTURE — changer l'effet, réordonner, supprimer — que
 * seul « Tout » refuse.
 *
 * Alias explicite de `isFullyLocked` plutôt qu'un appel direct : le site de
 * garde dit ainsi POURQUOI il consulte ce verrou-là, et non qu'il a choisi le
 * plus fort par prudence.
 */
export function isStructureLocked(layer: Pick<LayerState, "locks">): boolean {
  return isFullyLocked(layer);
}

/**
 * Pose un verrou et rend l'objet résultant, ou `null` si rien ne change.
 *
 * `null` et pas l'objet inchangé : les appelants (`LayerStack.setLayerLock`,
 * puis `App`) doivent pouvoir sauter l'entrée d'historique quand un clic ne
 * change rien, et comparer deux objets pour le savoir invite à l'égalité de
 * référence, qui serait fausse ici.
 *
 * ⚠️ Poser `all` n'écrase PAS les trois autres, et ne pas le faire est
 * délibéré : chez Adobe, relâcher « Lock All » rend au calque les verrous
 * partiels qu'il avait avant. Les écraser ici les perdrait sans que rien ne le
 * dise.
 */
export function withLock(
  locks: LayerLocks | undefined,
  which: keyof LayerLocks,
  value: boolean,
): LayerLocks | null {
  const courant = locks ?? AUCUN;
  if ((courant[which] ?? false) === value) return null;
  const suivant: LayerLocks = { ...courant };
  if (value) suivant[which] = true;
  else delete suivant[which];
  return suivant;
}
