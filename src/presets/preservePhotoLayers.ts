import type { LayerState } from "../layers/types";

/**
 * Pile résultant de l'application d'un preset : les calques PHOTO du document
 * courant, suivis des calques du preset.
 *
 * Pourquoi cette fonction existe (design 2026-07-28 §2.3, CRITIQUE).
 * `applyPreset` remplace la pile ENTIÈRE (`App.tsx` : `const stack = new
 * LayerStack(); stack.layers = newLayers;`). Tant que la photo de fond vivait
 * hors du modèle, ce remplacement total était sans danger pour elle. Depuis la
 * tranche T1 elle EST un calque : appliquer un preset ferait disparaître la
 * photo du document — l'écran deviendrait le damier de la toile vide, en un
 * clic et sans avertissement.
 *
 * Un preset ne contient JAMAIS de calque photo (`presetDocument.ts` les exclut
 * à la capture, avec un `SkipNotice`) : la concaténation ne peut donc pas
 * produire de doublon de source, et le compte de calques photo du document ne
 * peut que rester constant ou diminuer — jamais franchir `MAX_PHOTO_LAYERS`.
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
  return [...currentLayers.filter((layer) => layer.imageSource !== undefined), ...presetLayers];
}
