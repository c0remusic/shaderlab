/**
 * L'APERÇU DE MODE DE FUSION, réduit à deux décisions PURES.
 *
 * Survoler une option du sélecteur de fusion POSE sa valeur sur le calque vivant
 * sans l'engager : c'est ce qui rend l'aperçu visible. La valeur engagée est
 * mémorisée au premier survol, et rétablie quand le survol finit. Tout le reste
 * du mécanisme vit dans `App.tsx` (refs, rendu, historique) et n'est donc pas
 * testable — convention du dépôt, aucun test ne rend de composant React.
 *
 * Ce module extrait les deux seuls endroits où ce mécanisme DÉCIDE quelque chose,
 * pour qu'ils soient éprouvés. Il ne connaît ni React, ni la pile, ni le rendu.
 *
 * ⚠️ POURQUOI IL EXISTE : une revue adverse a montré que la décision de
 * restauration était écrite « si l'aperçu vise CE calque », ce qui laisse
 * échapper l'aperçu posé sur un AUTRE calque — le commit gravait alors dans le
 * document une valeur que personne n'avait engagée. C'est l'inverse exact du
 * défaut de l'aperçu muet (2026-08-21), où le rendu montrait ce que le document
 * ne portait pas. Non atteignable avec un seul popup (fermer celui du calque A
 * termine son aperçu avant d'ouvrir celui de B), mais rien ne l'interdisait, et
 * la forme « ça ne peut pas arriver aujourd'hui » est celle que ce dépôt paie le
 * plus souvent.
 */

/** Un aperçu en cours : le calque survolé, et la valeur qu'il portait AVANT. */
export interface ApercuFusion {
  readonly layerId: string;
  readonly committed: string;
}

/** Ce qu'il faut défaire avant d'engager une valeur, ou `null` s'il n'y a rien.
 *
 *  Rend l'aperçu TEL QUEL, sans regarder quel calque on engage : un aperçu posé
 *  sur un autre calque doit être défait lui aussi, sinon il part dans le commit.
 *  C'est une fonction d'une ligne, et c'est la ligne qui manquait. */
export function restaurationAvantEngagement(apercu: ApercuFusion | null): ApercuFusion | null {
  return apercu;
}

/** L'aperçu à garder APRÈS une tentative d'engagement.
 *
 *  Engagement APPLIQUÉ : plus rien à défaire — la pile modifiée a été commitée,
 *  aperçu compris s'il visait un autre calque. Garder l'aperçu ici ferait défaire
 *  après coup la valeur qu'on vient d'engager.
 *
 *  Engagement REFUSÉ (calque verrouillé) ou SANS EFFET (on réengage la valeur
 *  déjà en place) : la pile modifiée est jetée, donc le modèle vivant porte
 *  ENCORE l'aperçu. Le garder est ce qui permet à la fin de survol de rétablir
 *  l'état et de repeindre. */
export function apercuApresEngagement(
  apercu: ApercuFusion | null,
  applique: boolean,
): ApercuFusion | null {
  return applique ? null : apercu;
}
