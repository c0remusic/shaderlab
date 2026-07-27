import type { LayerStack } from "./layerStack";
import { MAX_PHOTO_LAYERS, canAddPhotoLayer } from "./photoLayer";

/** Effets de bord d'une duplication de calque, injectés par l'appelant
 *  (App.tsx). Extraits ici pour la même raison que `changeLayerEffect` : ce
 *  qui doit être protégé, c'est l'ORDRE entre la garde et les effets de bord,
 *  et un handler React n'est pas testable dans ce projet (aucun rendu de
 *  composant, cf. test/App.test.ts). */
export interface LayerDuplicationEffects {
  /** Sévère le lien au preset actif : la pile a divergé de son snapshot —
   *  même raison que `handleAdd`/`handleRemove` (la liste des calques fait
   *  partie de la projection capturée par un preset). */
  clearActivePreset: () => void;
  /** Pousse une entrée d'historique pour la pile mutée. */
  commit: (stack: LayerStack) => void;
  /** Sélectionne le duplicata : c'est lui que l'utilisateur vient de créer et
   *  qu'il va éditer (comportement de `handleAdd` et de l'import photo). */
  selectLayer: (id: string) => void;
  /** Message d'erreur du bandeau — `null` efface. */
  setError: (message: string | null) => void;
}

/** Message de refus quand la duplication ferait dépasser `MAX_PHOTO_LAYERS`.
 *  Exporté pour que le test assertionne la chaîne réellement affichée plutôt
 *  qu'une copie. */
export function photoLayerLimitMessage(): string {
  const plural = MAX_PHOTO_LAYERS > 1;
  return `Limite atteinte : au plus ${MAX_PHOTO_LAYERS} calque${plural ? "s" : ""} photo (double exposure) par document — duplication impossible.`;
}

/** Duplique un calque avec ses effets de bord d'orchestration (Ctrl+J).
 *
 *  **La garde photo passe AVANT toute mutation.** `MAX_PHOTO_LAYERS` plafonne
 *  les calques photo PRÉSENTS DANS LA PILE (`countPhotoLayers` compte les
 *  calques qui portent un `imageSource`, pas les imports) : un duplicata de
 *  calque photo compte donc, et sans cette garde la duplication serait un
 *  contournement silencieux d'un plafond que l'import respecte déjà
 *  (`hooks/usePhotoLayer.ts:88`). La duplication ne réenregistre en revanche
 *  AUCUNE source : elle partage le `sourceId` de l'original, donc elle ne
 *  consomme pas de jeton `MAX_REGISTERED_PHOTO_SOURCES` et n'ajoute pas de
 *  texture de photo en VRAM — c'est bien le plafond de CALQUES, et lui seul,
 *  qui la borne.
 *
 *  Un calque sans `imageSource` n'est soumis à aucune limite (aucun plafond de
 *  calques d'effet n'existe dans ce projet).
 *
 *  Returns l'id du duplicata, ou `null` si rien n'a été dupliqué (id absent,
 *  ou plafond photo atteint) — dans ce cas aucun effet de bord n'a lieu, donc
 *  pas d'entrée d'historique vide ni de lien au preset cassé pour rien. */
export function duplicateLayer(
  stack: LayerStack,
  id: string,
  { clearActivePreset, commit, selectLayer, setError }: LayerDuplicationEffects,
): string | null {
  const layer = stack.layers.find((l) => l.id === id);
  if (!layer) return null;
  if (layer.imageSource && !canAddPhotoLayer(stack.layers)) {
    setError(photoLayerLimitMessage());
    return null;
  }
  const copyId = stack.duplicateLayer(id);
  if (copyId === null) return null;
  clearActivePreset();
  commit(stack);
  selectLayer(copyId);
  setError(null);
  return copyId;
}
