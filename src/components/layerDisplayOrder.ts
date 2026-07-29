/**
 * SENS D'AFFICHAGE de la pile de calques — conversion pure affichage ↔ modèle.
 *
 * Le MODÈLE est inchangé et le reste : `layers[0]` est le calque appliqué EN
 * PREMIER, directement sur la TOILE (`framePipelineExecutor.ts` part de
 * `readTexture = canvasTexture` puis boucle sur la pile dans l'ordre du
 * tableau). Depuis la tranche T1 `layers[0]` est en général la photo de fond
 * elle-même, devenue un calque ordinaire.
 *
 * L'AFFICHAGE suit depuis l'ADR-0004 (2026-07-28) le SENS CAUSAL : la liste se
 * lit de haut en bas dans l'ordre du TRAITEMENT. La photo vient d'abord, puis
 * les effets qui s'appliquent dessus — « la photo ne traite rien, c'est les
 * effets qui traitent la photo », la matière avant l'opération. La liste est
 * donc l'ordre DIRECT du tableau, la photo de fond en tête : c'est elle que les
 * effets suivants traitent.
 *
 * Ces trois fonctions restent le SEUL endroit où le sens d'affichage existe.
 * Elles sont aujourd'hui l'IDENTITÉ, et ce n'est pas une raison de les
 * supprimer : elles sont la frontière nommée par laquelle passent le
 * glisser-déposer et l'arbre de rattachement. Les inliner rendrait un futur
 * changement de sens (celui-ci est le second en deux jours) dispersé dans le
 * composant — exactement le défaut que l'ADR-0003 interdisait et que l'ADR-0004
 * reconduit. Un `reverse()` ou un calcul d'index ailleurs dans le code est un
 * bug, pas une simplification.
 */

/** Le tableau du modèle, dans l'ordre où la LISTE doit le rendre. Copie
 *  défensive : l'appelant ne doit jamais pouvoir muter `layers` à travers la
 *  valeur rendue, quel que soit le sens en vigueur. */
export function toDisplayOrder<T>(layers: readonly T[]): T[] {
  return layers.slice();
}

/**
 * Index de MODÈLE de la ligne affichée en position `displayRow`.
 *
 * Bijection sur la pile entière : `displayRow` ∈ [0, length-1]. `length` reste
 * dans la signature bien qu'inutilisé dans le sens direct : c'est la donnée dont
 * dépend toute inversion, et la retirer ferait retoucher tous les appelants au
 * prochain changement de sens.
 */
export function displayRowToModelIndex(displayRow: number, _length: number): number {
  return displayRow;
}

/**
 * Index d'INSERTION côté modèle correspondant à un index d'insertion côté
 * affichage (sémantique « retire `fromIndex`, puis insère à `newIndex` DANS LE
 * TABLEAU DÉJÀ AMPUTÉ » — celle de `computeInsertIndex`/`reorderById`,
 * `src/ui/dragReorder.ts`).
 *
 * Le tableau amputé compte `length - 1` éléments, donc les positions
 * d'insertion valides vont de 0 à `length - 1` des DEUX côtés. La liste étant
 * l'ordre direct du tableau, insérer en position `d` de la liste affichée place
 * l'élément en position `d` du tableau amputé. Le domaine reste distinct de
 * celui d'une LIGNE — d'où deux fonctions nommées séparément plutôt qu'une
 * seule que l'appelant pourrait appliquer au mauvais index.
 */
export function displayInsertToModelInsert(displayInsert: number, _length: number): number {
  return displayInsert;
}
