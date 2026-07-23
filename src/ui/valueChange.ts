/**
 * Compare la valeur AVANT/APRÈS d'une interaction de contrôle (slider,
 * molette, échantillon colorRange) pour décider si une entrée d'historique
 * doit être créée — invariant projet : "une interaction qui ne change aucune
 * valeur ne crée pas d'entrée d'historique" (design.md §UI runtime hygiene).
 *
 * Cas réel corrigé par cette fonction : LabeledSlider.handleWheel appelait
 * `onChange`/marquait l'historique "dirty" à CHAQUE cran de molette, même à
 * la borne min/max où `wheelTickValue` clampe déjà au même nombre — un
 * scroll qui ne bouge rien créait quand même une entrée vide.
 */
export function hasValueChanged(previous: number | number[], next: number | number[]): boolean {
  const prevArr = Array.isArray(previous) ? previous : [previous];
  const nextArr = Array.isArray(next) ? next : [next];
  if (prevArr.length !== nextArr.length) return true;
  return prevArr.some((value, index) => value !== nextArr[index]);
}
