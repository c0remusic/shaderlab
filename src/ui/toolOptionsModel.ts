import type { ToolId } from "./tools";

/**
 * BARRE D'OPTIONS — les réglages appartiennent à l'OUTIL, pas au calque.
 *
 * Arbitrage d'Antoine du 2026-08-18 (ticket 27), et c'est la réponse de
 * Photoshop : « le prochain rectangle sera bleu ». Elle résout le défaut
 * d'origine — aujourd'hui on trace un rectangle NOIR, puis on va chercher sa
 * couleur dans le dock ; régler AVANT de tracer est impossible.
 *
 * ── CE QUE CE MODULE FAIT DE LA TENSION AVEC ADR-0001 ───────────────────────
 *
 * Le ticket la nomme et ne la dissout pas : deux surfaces pour une même valeur,
 * la barre pour le prochain tracé, le dock pour le calque posé. C'est ce
 * qu'ADR-0001 refuse en général.
 *
 * Ce qu'un modèle peut faire, et fait ici, c'est rendre la frontière
 * INEXPRIMABLE autrement : **il ne connaît aucun calque.** Il ne reçoit ni pile,
 * ni sélection, ni identifiant, et son seul canal vers un calque est
 * `paramsPourNouveauCalque`, appelé à la CRÉATION. Un réglage de barre ne peut
 * donc pas atteindre un calque existant — pas par discipline, par typage.
 *
 * ── POURQUOI PAR OUTIL, ET PERSISTANT ───────────────────────────────────────
 *
 * Par outil, parce que la taille du pinceau et la couleur d'une forme n'ont
 * rien à se dire : un état partagé ferait qu'ouvrir un outil écrase les réglages
 * du précédent. Persistant à travers les changements d'outil, parce que c'est
 * exactement ce que « le prochain rectangle sera bleu » veut dire — sinon le
 * réglage ne survit pas au premier aller-retour vers le pinceau, et la barre
 * redevient un doublon du dock.
 *
 * Module PUR, même convention que `tools.ts`, `canvasMode.ts` et
 * `layerControlsModel.ts` : aucune dépendance React/DOM, testable en env Node.
 * Toutes les fonctions rendent un NOUVEL état, aucune ne mute son entrée.
 */

/** Réglages d'un outil : les mêmes noms que les `EffectParam` qu'ils sèment. */
export type OptionsOutil = Readonly<Record<string, number>>;

/** L'état complet de la barre : un jeu de réglages par outil. */
export type ToolOptions = Readonly<Partial<Record<ToolId, OptionsOutil>>>;

/** Aucun outil n'a de réglage tant que personne n'en a posé : un défaut écrit
 *  ici serait un second endroit où vit la valeur par défaut d'un paramètre, à
 *  côté de `EffectParam.default` qui est déjà sa source de vérité. */
export function optionsInitiales(): ToolOptions {
  return {};
}

export function optionsDe(options: ToolOptions, outil: ToolId): OptionsOutil {
  return options[outil] ?? {};
}

export function reglerOption(
  options: ToolOptions,
  outil: ToolId,
  nom: string,
  valeur: number,
): ToolOptions {
  return { ...options, [outil]: { ...optionsDe(options, outil), [nom]: valeur } };
}

/**
 * Ce qu'un calque CRÉÉ par cet outil reçoit — le seul canal du modèle vers un
 * calque, et il ne part qu'à la création.
 *
 * Rend une copie FRAÎCHE à chaque appel : le calque va vivre sa vie dans le dock,
 * et partager l'objet ferait qu'éditer un calque déplacerait les réglages de
 * l'outil — c'est-à-dire l'autre réponse à la question du ticket, arrivée par
 * accident.
 */
export function paramsPourNouveauCalque(
  options: ToolOptions,
  outil: ToolId,
): Record<string, number> {
  return { ...optionsDe(options, outil) };
}
