/**
 * SENS D'AFFICHAGE de la pile de calques — conversion pure affichage ↔ modèle.
 *
 * Le MODÈLE est inchangé et le reste : `layers[0]` est le calque appliqué EN
 * PREMIER, directement sur la photo de fond (`framePipelineExecutor.ts` part de
 * `readTexture = sourceTexture` puis boucle sur la pile dans l'ordre du
 * tableau). `layers[0]` est donc le BAS de la pile.
 *
 * L'AFFICHAGE, lui, suit la convention de tous les éditeurs (Photoshop en
 * tête) : le bas de pile est en BAS de la liste, juste au-dessus de la ligne
 * d'arrière-plan qui l'alimente. La liste est donc le miroir du tableau.
 *
 * Ces trois fonctions sont le SEUL endroit où cette inversion existe. Rien
 * d'autre ne bouge : ni le pipeline, ni `LayerStack`, ni les presets, ni
 * l'historique. Elles sont ici, pures et testées, parce que le glisser-déposer
 * en dépend : une conversion dispersée dans le composant est la façon la plus
 * sûre de faire atterrir un calque au mauvais endroit.
 */

/** Le tableau du modèle, dans l'ordre où la LISTE doit le rendre. Copie : le
 *  tableau d'origine n'est jamais muté (`reverse` est destructif). */
export function toDisplayOrder<T>(layers: readonly T[]): T[] {
  return layers.slice().reverse();
}

/**
 * Index de MODÈLE de la ligne affichée en position `displayRow`.
 *
 * Bijection sur la pile entière : `displayRow` ∈ [0, length-1].
 */
export function displayRowToModelIndex(displayRow: number, length: number): number {
  return length - 1 - displayRow;
}

/**
 * Index d'INSERTION côté modèle correspondant à un index d'insertion côté
 * affichage (sémantique « retire `fromIndex`, puis insère à `newIndex` DANS LE
 * TABLEAU DÉJÀ AMPUTÉ » — celle de `computeInsertIndex`/`reorderById`,
 * `src/ui/dragReorder.ts`).
 *
 * Le tableau amputé compte `length - 1` éléments, donc les positions
 * d'insertion valides vont de 0 à `length - 1` des DEUX côtés. Insérer en
 * position `d` d'un tableau affiché (= miroir de l'amputé) place l'élément à la
 * position `d` en partant du haut de la liste, donc à `length - 1 - d` en
 * partant du bas de la pile : la formule est la même que pour une ligne, mais
 * son domaine ne l'est pas — d'où deux fonctions nommées séparément plutôt
 * qu'une seule que l'appelant pourrait appliquer au mauvais index.
 */
export function displayInsertToModelInsert(displayInsert: number, length: number): number {
  return length - 1 - displayInsert;
}
