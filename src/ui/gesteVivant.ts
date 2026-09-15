import type { LayerState } from "../layers/types";
import type { DevelopSettings } from "../layers/developSettings";

/**
 * CE QU'EST UN GESTE VIVANT — la séquence, en un seul endroit.
 *
 * Un geste vivant est une frame de glissement : on pose un état sur la session,
 * SANS entrée d'historique, et l'écran doit suivre. Ce n'est pas un commit : le
 * commit vient au relâchement, et seulement si quelque chose a bougé.
 *
 * POURQUOI CE MODULE EXISTE. `DocumentSession.replaceLiveLayers` ne fait qu'un
 * QUART du geste — elle pose l'état vivant, rien de plus — et son docblock
 * demande à l'appelant d'en faire trois autres : salir le drapeau de commit,
 * planifier la synchronisation React, redemander un rendu. Quatorze sites
 * récitaient cette séquence à la main, trois en omettaient un membre, et le
 * seul filet était HUIT commentaires portant le mot « appairer ».
 *
 * Ce n'est pas théorique : le défaut est daté. Aperçu de mode de fusion au
 * survol, 2026-08-21 — le modèle changeait, l'écran ne repeignait pas, « le
 * survol ne faisait rien de visible ». Relevé par Antoine devant l'app, parce
 * qu'aucun test ne peut voir un `requestRender` manquant : il n'y a pas de
 * pixel à comparer, et `frameSignature` re-rend la pile lui-même, donc il
 * mesure ce qu'il produit.
 *
 * CE QUE LA FORME ACHÈTE. L'appelant fournit la pile suivante et dit si quelque
 * chose a bougé ; il ne récite plus rien. Le prochain outil sur la toile hérite
 * de la séquence au lieu de la redériver. Et la séquence devient observable
 * sans monter React — c'est tout l'objet des ports ci-dessous.
 *
 * ⚠️ Ce module ne DÉCIDE pas si quelque chose a bougé. Les appelants comparent
 * des choses différentes (une valeur, une transformation, cinq champs d'une
 * photo), et plier ça de force ferait un prédicat qui ment pour la moitié
 * d'entre eux. Ils passent `salit`.
 */

/** Les quatre prises d'un geste vivant. Chacune est un effet de bord que
 *  l'appelant possède déjà ; les rassembler ici est ce qui rend la SÉQUENCE
 *  vérifiable, pas les effets eux-mêmes. */
export interface PortsGesteVivant {
  /** Pose la pile vivante sur la session. `geometrie` gèle les paramètres
   *  spatiaux d'un calque verrouillé en position — voir `fusionnerSousVerrous`. */
  poserPile(layers: LayerState[], geometrie?: ReadonlyMap<string, readonly string[]>): void;
  /** Pose l'étage de développement vivant sur la session. */
  poserEtage(develop: DevelopSettings): void;
  /** Pile COMPLÈTE de la session, pour le rendu — jamais la projection
   *  d'affichage, qui n'a pas les rasters de masque. */
  pileComplete(): LayerState[];
  /** Synchronisation React, coalescée sur rAF. */
  planifierSynchro(): void;
  /** Projection React de l'étage. Elle remplace la synchronisation générale
   *  pour ce chemin-là : l'étage a son propre état. */
  projeterEtage(develop: DevelopSettings): void;
  /** Pose l'étage sur le renderer, avant le rendu. */
  renduEtage(develop: DevelopSettings): void;
  /** Redemande un rendu. `null` quand aucun renderer n'est monté. */
  redemanderRendu(layers: LayerState[]): void;
  /** Marque qu'un commit sera dû au relâchement. */
  salir(): void;
}

export interface OptionsGesteVivant {
  /** Quelque chose a-t-il bougé ? Décide de l'entrée d'historique au
   *  relâchement, jamais du rendu — un geste qui ne change rien doit quand même
   *  repeindre, ne serait-ce que pour défaire un aperçu. */
  salit?: boolean;
  geometrie?: ReadonlyMap<string, readonly string[]>;
  /**
   * Synchroniser l'état React de la pile. Vrai par défaut.
   *
   * ⚠️ Le DÉCLARER est tout l'objet de cette option. Trois des quatorze sites
   * d'origine sautaient cette étape et rien ne disait si c'était voulu — or
   * pour deux d'entre eux ça l'est : l'APERÇU DE MODE DE FUSION AU SURVOL
   * recompose la toile sans que le sélecteur du panneau change de valeur, parce
   * que survoler une option n'est pas la choisir. Synchroniser y ferait afficher
   * au panneau un mode que l'utilisateur n'a pas engagé.
   *
   * La régle reste : un geste vivant repeint TOUJOURS. C'est la projection
   * React qui peut se taire, jamais le rendu.
   */
  synchroniseReact?: boolean;
}

/**
 * Une frame de geste vivant sur la PILE.
 *
 * L'ordre n'est pas indifférent : l'état est posé AVANT la synchronisation et
 * le rendu, sinon les deux liraient la pile précédente.
 */
export function gestePileVivante(
  ports: PortsGesteVivant,
  layers: LayerState[],
  options: OptionsGesteVivant = {},
): void {
  if (options.salit) ports.salir();
  ports.poserPile(layers, options.geometrie);
  if (options.synchroniseReact !== false) ports.planifierSynchro();
  ports.redemanderRendu(layers);
}

/**
 * Une frame de geste vivant sur l'ÉTAGE de développement.
 *
 * Elle ne planifie PAS la synchronisation générale, et ce n'est pas un oubli :
 * l'étage a son propre état React, que `projeterEtage` pose directement. Le
 * rendu part sur la pile COMPLÈTE de la session, l'étage s'appliquant au
 * composite de toute la pile.
 */
export function gesteEtageVivant(
  ports: PortsGesteVivant,
  develop: DevelopSettings,
  options: Pick<OptionsGesteVivant, "salit"> = {},
): void {
  if (options.salit) ports.salir();
  ports.poserEtage(develop);
  ports.projeterEtage(develop);
  ports.renduEtage(develop);
  ports.redemanderRendu(ports.pileComplete());
}
