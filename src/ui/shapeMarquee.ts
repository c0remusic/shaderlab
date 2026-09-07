import type { LayerState } from "../layers/types";
import { isMaskLocked } from "../layers/layerLocks";
import { createParametricSource, type MaskSource, type MaskSourceParams } from "../mask/types";
import type { ShapeBox } from "./shapeDraw";

/**
 * OUTIL FORME → SÉLECTION GÉOMÉTRIQUE (ticket 12, décision du ticket 10 : « une
 * forme SÉLECTIONNE »). La géométrie du geste vit dans `shapeDraw.ts` ; ce
 * module décide ce que le tracé PRODUIT selon le calque sélectionné, et il est
 * pur (aucun React/DOM) pour que la règle se teste en Node — même découpage que
 * `effectMove.ts` / `autoSelect.ts`.
 *
 * Trois issues, et une seule est neuve :
 * - `marquee` : un calque d'EFFET est sélectionné → le tracé pose (ou met à
 *   jour) une source de masque `shape` sur SON masque. C'est le marquee de
 *   Photoshop : la forme confine l'effet au lieu de créer un calque.
 * - `aplat` : rien de ciblable (aucune sélection, ou un calque PHOTO — qui
 *   n'est pas un effet) → comportement d'avant, un nouveau calque `aplat`
 *   rempli. Le tracé d'aplat « reste ce qu'il est ».
 * - `refused` : le calque visé a son masque VERROUILLÉ → le geste ne fait rien.
 *   Le même refus que `LayerStack.refuseMasque` et que le filtre de
 *   `replaceLiveLayers` (`fusionnerSousVerrous`), porté ici pour que le chemin
 *   vivant ne tente même pas la pose.
 */
export type ShapeGesturePlan = "aplat" | "refused" | "marquee";

export function planShapeGesture(selected: LayerState | null | undefined): ShapeGesturePlan {
  if (!selected) return "aplat";
  // Un calque PHOTO n'est pas un calque d'effet : l'outil ne le marquee pas, il
  // retombe sur la création d'un aplat (ADR-0008 — un effet ne se pose jamais
  // sur un calque photo, donc « le marquee d'un effet » ne le concerne pas).
  if (selected.imageSource) return "aplat";
  if (isMaskLocked(selected)) return "refused";
  return "marquee";
}

/**
 * Sources du masque après pose du marquee : met à jour la PREMIÈRE source
 * `shape` existante (le geste REDESSINE la sélection, comme un marquee qui
 * remplace la précédente), ou en ajoute une neuve avec les défauts du module
 * plus la boîte tracée.
 *
 * ⚠️ On REMPLACE la boîte et on garde le reste (`feather`, `invert`, `mode`) :
 * l'utilisateur peut avoir réglé la source en ellipse ou adouci son bord dans
 * le panneau Masque, et retracer ne doit pas le perdre — même esprit que
 * gradient qui partage ses points entre linéaire et radial.
 *
 * `newSourceId` n'est lu que dans la branche « ajout ». L'appelant le fige pour
 * toute la durée d'un geste vivant (un `freshId()` unique), sinon chaque
 * mouvement rebâti depuis l'état committé ajouterait une source d'id différent.
 */
export function applyShapeMarquee(
  sources: readonly MaskSource[],
  box: ShapeBox,
  defaultParams: MaskSourceParams,
  newSourceId: string,
): MaskSource[] {
  const idx = sources.findIndex((s) => s.type === "shape");
  if (idx === -1) {
    return [...sources, createParametricSource(newSourceId, "shape", { ...defaultParams, ...box })];
  }
  return sources.map((s, i) =>
    i === idx && s.type !== "brush" ? { ...s, params: { ...s.params, ...box } } : s,
  );
}
