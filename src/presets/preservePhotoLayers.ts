import type { LayerState } from "../layers/types";
import { isStructureLocked } from "../layers/layerLocks";

/**
 * Pile résultant de l'application d'un preset : les calques PRÉSERVÉS du
 * document courant — les photos, et les calques verrouillés « Tout » (voir
 * `estPreserve`) — suivis des calques du preset.
 *
 * Pourquoi cette fonction existe (design 2026-07-28 §2.3, CRITIQUE).
 * `applyPreset` remplace la pile ENTIÈRE (`App.tsx` : `const stack = new
 * LayerStack(); stack.layers = newLayers;`). Tant que la photo de fond vivait
 * hors du modèle, ce remplacement total était sans danger pour elle. Depuis la
 * tranche T1 elle EST un calque : appliquer un preset ferait disparaître la
 * photo du document — l'écran deviendrait le damier de la toile vide, en un
 * clic et sans avertissement.
 *
 * CE QUI EST PRÉSERVÉ ICI N'EST PAS CAPTURÉ LÀ-BAS, et c'est ce qui interdit le
 * doublon. `presetDocument.capture` exclut exactement les deux mêmes genres —
 * les photos et les calques verrouillés « Tout » — chacun avec son
 * `SkipNotice`. La concaténation ne peut donc pas produire de doublon, et le
 * compte de calques photo du document ne peut que rester constant ou diminuer,
 * jamais franchir `MAX_PHOTO_LAYERS`.
 *
 * ⚠️ Cette phrase n'a parlé QUE des photos jusqu'au 2026-09-15, et elle est
 * devenue fausse le jour même où les calques verrouillés ont rejoint la
 * préservation : `capture` ne les excluait pas, donc réappliquer un preset pris
 * sur SON PROPRE document dupliquait le calque — préservé une fois, reconstruit
 * une fois. Un test le reproduit maintenant. La leçon vaut au-delà : **ces deux
 * fonctions sont un couple**, et toute clause ajoutée à l'une se pose à
 * l'autre.
 *
 * TOUS les calques photo sont préservés, pas seulement le plus bas : le design
 * dit « au minimum le plus bas », et distinguer le fond des autres photos
 * réintroduirait exactement le statut spécial que cette tranche supprime.
 *
 * Ils sont regroupés EN BAS, dans leur ordre relatif d'origine. C'est la seule
 * position qui garde le sens du preset : ses effets s'appliquent au-dessus de
 * la matière, comme au moment où il a été capturé. Les intercaler à leurs index
 * d'origine découperait la chaîne d'effets du preset en morceaux séparés par
 * des photos, ce qui ne correspond à rien de ce qui a été enregistré.
 */
export function withPhotoLayersPreserved(
  currentLayers: LayerState[],
  presetLayers: LayerState[],
): LayerState[] {
  return [...currentLayers.filter(estPreserve), ...presetLayers];
}

/**
 * Ce qu'un preset ne peut pas emporter : une PHOTO, et un calque verrouillé
 * « Tout ».
 *
 * Le second a été ajouté le 2026-09-15 (arbitrage d'Antoine), et c'était un
 * défaut : le filtre ne regardait que `imageSource`, donc appliquer un preset
 * SUPPRIMAIT un calque d'effet portant `locks.all` — là où `removeLayer` et
 * `mergeDownVerdict` le refusent tous les deux, en citant le même prédicat.
 * `src/presets/` ne contenait pas une seule occurrence de `locks`, et le
 * dialogue de confirmation n'en disait rien.
 *
 * Les deux genres gardent leur ORDRE RELATIF d'origine, mêlés : un calque
 * verrouillé qui se trouvait entre deux photos y reste. Les regrouper par genre
 * réordonnerait des calques que le verrou existe précisément pour figer.
 */
function estPreserve(layer: LayerState): boolean {
  return layer.imageSource !== undefined || isStructureLocked(layer);
}

/** Combien de calques d'EFFET verrouillés « Tout » un preset va préserver —
 *  les photos ne comptent pas, elles sont préservées à un autre titre et
 *  annoncées séparément. Sert la phrase du dialogue de confirmation. */
export function lockedEffectLayerCount(currentLayers: LayerState[]): number {
  return currentLayers.filter((l) => l.imageSource === undefined && isStructureLocked(l)).length;
}
