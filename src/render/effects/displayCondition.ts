import type { DisplayCondition } from "./types";

/**
 * Évalue une condition d'affichage (`DisplayCondition`) sur les paramètres
 * RÉSOLUS d'un calque (défauts appliqués), quel qu'en soit le porteur :
 * `CanvasControl.visibleWhen`, `EffectParam.appliesWhen`,
 * `EffectSection.appliesWhen`.
 *
 * UNE FONCTION, PAS TROIS TERNAIRES. La forme
 * `Array.isArray(c.equals) ? c.equals.includes(v) : v === c.equals` vivait en
 * ligne dans le JSX de `ParamPanel` pour le seul `visibleWhen` ; deux porteurs
 * se sont ajoutés le 2026-08-05, et trois copies d'un test de visibilité
 * dérivent sans que rien ne rougisse — un contrôle masqué à tort ne casse aucun
 * rendu, ne bouge aucun pixel, et ne se plaint pas. Même raison que
 * `validerConditionDAffichage` côté `validate.ts` : la validation statique et
 * l'évaluation à l'exécution répondent à la même question, chacune une seule
 * fois.
 *
 * ⚠️ ÉGALITÉ STRICTE, PAS D'ARRONDI. La valeur d'un paramètre à `choices` est un
 * INDEX, et le seul contrôle qui sait l'écrire (la liste déroulante de
 * `ParamPanel`) écrit un entier. Arrondir ici introduirait une tolérance que le
 * shader, lui, n'a pas — il indexe la même valeur à sa façon — et ferait diverger
 * en silence ce qui s'affiche de ce qui se calcule. Un paramètre absent des
 * valeurs rend `false` : masquer sur une cible inconnue est le comportement sûr,
 * et `validateEffect` a déjà refusé au chargement toute condition qui vise un
 * paramètre absent.
 */
export function conditionRemplie(condition: DisplayCondition, valeurs: Record<string, number>): boolean {
  const valeur = valeurs[condition.param];
  if (valeur === undefined) return false;
  return Array.isArray(condition.equals) ? condition.equals.includes(valeur) : valeur === condition.equals;
}
