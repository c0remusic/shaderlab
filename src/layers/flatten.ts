import type { LayerState } from "./types";
import { MAX_PHOTO_LAYERS, countPhotoLayers } from "./photoLayer";
import { isStructureLocked } from "./layerLocks";

/**
 * Logique PURE de l'APLATISSEMENT d'un calque (ticket 27, geste « Aplatir » de
 * Photoshop). Deux gestes, un seul raster commun :
 *
 * - **Tampon** (« Aplatir en nouveau calque », `Ctrl+Alt+Maj+E`) : un NOUVEAU
 *   calque photo opaque, posé AU-DESSUS du sélectionné, portant le composite de
 *   tout ce qui est en dessous PLUS le sélectionné lui-même. Rien n'est détruit.
 * - **Fusionner** (« Fusionner avec le dessous ») : le MÊME raster REMPLACE le
 *   sélectionné et tout ce qui est en dessous. Destructif, annulable.
 *
 * Un effet lit ce qui est SOUS lui : ses « pixels » sont donc le composite
 * jusqu'à lui, pas sa contribution seule — d'où `flattenComposite`, partagé par
 * les deux gestes.
 *
 * Ce module ne connaît ni le GPU, ni React, ni le registre d'effets : il ne
 * décide QUE quels calques entrent dans le composite et si le geste est
 * permis. La rastérisation (`exportFrame` → bitmap → `PhotoSourceStore`) et le
 * nom affiché du calque créé vivent dans le hook qui l'orchestre
 * (`hooks/usePhotoLayer.ts`), pour la même raison que `duplicateLayer` sépare
 * sa garde pure de ses effets de bord. `layers/` ne dépend que de
 * `layers/*` — d'où l'import de `photoLayer` et `layerLocks`, jamais de
 * `render/`.
 *
 * SENS DE LA PILE (ADR-0004) : `layers[0]` est le calque appliqué EN PREMIER,
 * c'est-à-dire le plus BAS (le fond) ; `framePipelineExecutor` compose du
 * premier au dernier. « En dessous du sélectionné » = les index INFÉRIEURS.
 * Le composite est donc `layers[0 .. idx]` inclus.
 */

/** Les calques composités par un Tampon ou une Fusion, du fond (`layers[0]`)
 *  jusqu'au sélectionné INCLUS. `null` si `selectedId` ne désigne aucun calque
 *  (sélection périmée, pile vide) — jamais une exception : une sélection
 *  périmée est un état ordinaire, comme partout ailleurs dans ce paquet. */
export function flattenComposite(layers: LayerState[], selectedId: string | null): LayerState[] | null {
  if (selectedId === null) return null;
  const idx = layers.findIndex((l) => l.id === selectedId);
  if (idx === -1) return null;
  return layers.slice(0, idx + 1);
}

/** Verdict d'un geste d'aplatissement : permis, ou refusé AVEC sa raison —
 *  reprise telle quelle en infobulle du bouton désactivé, jamais un booléen nu.
 *  Un contrôle inerte doit DIRE pourquoi (échec silencieux proscrit). */
export type FlattenVerdict = { ok: true } | { ok: false; reason: string };

/** Message de refus commun au plafond de calques photo. Exporté pour que les
 *  tests et l'UI citent la MÊME chaîne, jamais une copie. */
export function photoCapMessage(action: string): string {
  const plural = MAX_PHOTO_LAYERS > 1;
  return `Limite de ${MAX_PHOTO_LAYERS} calque${plural ? "s" : ""} photo atteinte : ${action} crée un calque photo. Fusionne ou supprime une photo d'abord.`;
}

/**
 * Le TAMPON est-il permis sur `selectedId` ?
 *
 * Aucune restriction de verrou : le Tampon LIT le composite et ajoute un calque
 * À CÔTÉ, il ne mute aucun calque existant (comme « Dupliquer », qui reste actif
 * sur un calque verrouillé). Il crée en revanche un calque photo, donc il est
 * borné par `MAX_PHOTO_LAYERS` — refusé quand le plafond est atteint.
 *
 * Autorisé sur un calque PHOTO (son composite jusqu'à lui a un sens, ticket 27).
 */
export function stampVerdict(layers: LayerState[], selectedId: string | null): FlattenVerdict {
  if (flattenComposite(layers, selectedId) === null) {
    return { ok: false, reason: "Sélectionne un calque à aplatir." };
  }
  if (countPhotoLayers(layers) >= MAX_PHOTO_LAYERS) {
    return { ok: false, reason: photoCapMessage("le Tampon") };
  }
  return { ok: true };
}

/**
 * La FUSION avec le dessous est-elle permise sur `selectedId` ?
 *
 * Refusée quand :
 * - rien n'est sélectionné (idem Tampon) ;
 * - le sélectionné est DÉJÀ au bas de la pile (`idx === 0`) : « fusionner avec
 *   le dessous » n'a pas de dessous. Décision ticket 27 (choix laissé ouvert) :
 *   plutôt refuser proprement qu'autoriser un no-op visuel — c'est le
 *   comportement de « Fusionner avec le calque inférieur » de Photoshop, grisé
 *   sur le calque du fond ;
 * - un calque du LOT (sélectionné + tout ce qui est en dessous) est
 *   entièrement verrouillé : la fusion le supprime, et `LayerStack.removeLayer`
 *   refuse un calque verrouillé (`isStructureLocked` = verrou « Tout »). On le
 *   dit AVANT le geste plutôt que de produire une fusion partielle ;
 * - le plafond de calques photo serait dépassé APRÈS retrait : la fusion retire
 *   le lot puis ajoute UN raster, donc le compte se calcule sur les calques qui
 *   RESTENT au-dessus (cas quasi impossible — le lot contient d'ordinaire le
 *   fond —, mais la garde est exacte plutôt qu'optimiste).
 */
export function mergeDownVerdict(layers: LayerState[], selectedId: string | null): FlattenVerdict {
  const composite = flattenComposite(layers, selectedId);
  if (composite === null) {
    return { ok: false, reason: "Sélectionne un calque à fusionner." };
  }
  if (composite.length < 2) {
    return { ok: false, reason: "Rien en dessous : ce calque est déjà au bas de la pile." };
  }
  if (composite.some((layer) => isStructureLocked(layer))) {
    return { ok: false, reason: "Un calque du lot est verrouillé (Tout) : déverrouille-le pour fusionner." };
  }
  const idx = composite.length - 1;
  const above = layers.slice(idx + 1);
  if (countPhotoLayers(above) >= MAX_PHOTO_LAYERS) {
    return { ok: false, reason: photoCapMessage("la fusion") };
  }
  return { ok: true };
}

/** Plan d'exécution d'une fusion : le composite à rastériser (fond → sélectionné)
 *  et les ids à retirer (le LOT). `null` si la fusion n'est pas permise — même
 *  verdict que `mergeDownVerdict`, pour que l'orchestrateur n'ait qu'un point de
 *  décision. Les ids retirés SONT exactement ceux du composite : la fusion
 *  remplace le lot par son propre raster. */
export interface MergeDownPlan {
  composite: LayerState[];
  removedIds: string[];
}

export function mergeDownPlan(layers: LayerState[], selectedId: string | null): MergeDownPlan | null {
  if (!mergeDownVerdict(layers, selectedId).ok) return null;
  const composite = flattenComposite(layers, selectedId)!;
  return { composite, removedIds: composite.map((l) => l.id) };
}
