/**
 * L'OUVERTURE D'UN DOCUMENT, une fois la toile allouée : quelle pile de calques,
 * et à quelles dimensions.
 *
 * POURQUOI CE MODULE EXISTE. Cette décision vivait en clair dans `App.tsx`
 * (`openFile`), et le harnais de rendu la RÉ-IMPLÉMENTAIT sous un commentaire
 * « ce que fait App.tsx » — deux copies dont une seule était exercée. Rebrancher
 * `bitmap.width` à la place de `renderer.canvasSize` dans `App.tsx` ne faisait
 * donc rougir personne : le seul scénario du harnais qui passait par ce chemin
 * avait une toile égale à la photo, donc il était aveugle à l'écart. Relevé le
 * 2026-07-30 (réserve R4 de la revue adverse de la tranche T2).
 *
 * CE QUI FERME LE TROU, ce n'est pas d'avoir extrait une fonction — c'est que
 * cette fonction prenne le RENDERER et non des dimensions. L'appelant ne peut
 * donc plus choisir la dimension du calque de fond ; il ne peut que passer
 * l'objet qui la détient. La divergence n'est plus exprimable, exactement comme
 * `ExportedFrame` a rendu inexprimable « encoder à d'autres dimensions que
 * celles du frame relu » (ADR-0007 §5). Et le harnais de rendu APPELLE
 * maintenant ce chemin au lieu de le reproduire, ce qui le rend enfin réactif à
 * un changement dans `App.tsx`.
 *
 * Module pur : aucune dépendance à React, au DOM ni au GPU. Le paramètre est
 * structurel (`OpeningRenderer`), pas la classe `Renderer` — c'est ce qui le
 * laisse testable en Node avec un double à deux champs.
 */

import { LayerStack } from "./layerStack";
import { resetTransform } from "../ui/transform";
import type { CanvasPixelSize } from "./canvasFormat";

/**
 * Ce que l'ouverture a besoin de savoir d'un renderer fraîchement chargé — et
 * rien de plus. Deux champs, tous deux en lecture seule : la géométrie du
 * document et l'identité de la photo qui l'a ouvert.
 */
export interface OpeningRenderer {
  /** DIMENSIONS DU DOCUMENT, source unique (ADR-0007 §5). C'est ce que
   *  `ImageFrameResources` a réellement alloué, jamais ce qui a été demandé. */
  readonly canvasSize: CanvasPixelSize;
  /** `sourceId` de la photo d'ouverture, enregistrée pendant le chargement. */
  readonly backgroundSourceId: string | null;
}

export interface OpenedDocument {
  /** La pile, avec le calque de fond déjà posé. */
  stack: LayerStack;
  /** Les dimensions du document, relues du renderer — l'appelant les prend ICI
   *  plutôt que d'aller les chercher lui-même, pour qu'il n'existe pas deux
   *  lectures indépendantes de la même vérité dans le même geste. */
  size: CanvasPixelSize;
}

/**
 * Construit la pile d'un document qui vient de s'ouvrir : un unique calque
 * photo, celui du fond.
 *
 * LE CALQUE DE FOND (tranche T1). La photo d'ouverture n'est pas la texture
 * d'entrée du pipeline : c'est un `LayerState` ordinaire portant `imageSource`,
 * donc masquable, déplaçable, supprimable et duplicable comme tout autre calque.
 *
 * TRANSFORM D'OUVERTURE : la photo est CENTRÉE sur la toile, à l'échelle 1 —
 * jamais rééchelonnée. Sur une toile ≡ photo (le défaut) c'est la transform
 * identité, donc un rendu identique au pixel près à celui d'avant la tranche T2.
 * Sur une toile plus grande, la photo est centrée et le reste de la toile n'est
 * couvert par personne : damier à l'écran, blanc dans le fichier exporté
 * (ADR-0006).
 *
 * Lève si la photo d'ouverture n'a pas de source enregistrée : un échec
 * d'enregistrement aurait déjà fait échouer le chargement, donc arriver ici sans
 * id est un invariant rompu et non un cas à absorber.
 */
export function openDocument(renderer: OpeningRenderer, name: string): OpenedDocument {
  const backgroundSourceId = renderer.backgroundSourceId;
  if (backgroundSourceId === null) {
    throw new Error("Document chargé sans source de fond enregistrée — invariant rompu (render/renderer.ts).");
  }
  // `renderer.canvasSize` est lu ICI et nulle part ailleurs sur ce chemin :
  // c'est la seule ligne du produit qui décide de quoi le calque de fond hérite
  // ses dimensions. Un témoin planté ici fait rougir le harnais de rendu.
  const size = renderer.canvasSize;
  const stack = new LayerStack();
  stack.addPhotoLayer(backgroundSourceId, resetTransform(size), name);
  return { stack, size };
}
