import type { RefineEdgeParams } from "./types";
import { MORPHOLOGY_PASS_AXES, type MorphologyAxis } from "./refineEdgeWgsl";

/** Une passe fullscreen du refine edge, décrite SANS aucune ressource GPU.
 *
 *  `radius` est toujours POSITIF : le signe de `contract` est déjà consommé
 *  par `mode` (voir `planRefine`). L'appelant n'a donc jamais à réinterpréter
 *  un signe — c'est précisément la logique qu'on veut hors de l'encodeur. */
export type RefinePass =
  | {
      kind: "morphology";
      mode: "erode" | "dilate";
      axis: MorphologyAxis;
      radius: number;
    }
  | { kind: "boxFilter"; axis: "H" | "V"; radius: number };

/** Plan d'encodage du refine edge (design.md §4) : la liste ORDONNÉE des
 *  passes fullscreen à encoder pour `x`, morphologie puis feather puis smooth.
 *  Fonction PURE — aucune texture, aucun encodeur, aucun WGSL : l'appelant
 *  (`MaskTextureResolver.refine`) mappe chaque passe vers sa source WGSL et
 *  l'exécute sur son ping-pong.
 *
 *  Pourquoi ce plan existe séparément de l'encodeur : la morphologie carrée a
 *  été SÉPARÉE en deux passes 1D (H puis V, facteur ~50 d'échantillons —
 *  équivalence algébrique prouvée dans test/mask/morphologySeparable.test.ts).
 *  Cette preuve d'équivalence ne dit RIEN du nombre de passes réellement
 *  encodées : tant que le plan vivait dans une boucle au milieu de
 *  l'encodeur GPU (donc intestable en env Node, sans GPU), réduire la
 *  morphologie à UN seul axe laissait toute la suite verte et produisait un
 *  masque érodé sur un seul axe — silencieusement faux. Extrait ici, le
 *  nombre et l'ordre des passes deviennent assertables.
 *
 *  **Plan VIDE == rien à faire** : l'appelant doit rendre la texture d'entrée
 *  telle quelle, sans même la copier. C'est le contrat de sortie du no-op ; il
 *  remplace la garde d'entrée que l'encodeur portait en dur.
 *
 *  Conventions de bord (fidèles au comportement encodé avant l'extraction) :
 *  - `contract === 0` -> AUCUNE passe de morphologie. Un rayon 0 est
 *    l'identité (prouvé morphologySeparable.test.ts), donc encoder deux
 *    passes serait payer deux fullscreen pour ne rien changer.
 *  - `feather <= 0` -> aucune passe de feather. L'encodeur d'avant était
 *    incohérent sur ce point (sa garde d'entrée testait `feather <= 0`, sa
 *    branche testait la véracité de `feather`) : un feather NÉGATIF passait
 *    donc un rayon négatif au box filter s'il était accompagné d'un
 *    `contract`. Inatteignable depuis l'UI (slider min 0, MaskPanel.tsx), et
 *    l'incohérence est tranchée ici du côté de la garde — un rayon négatif
 *    n'a pas de sens pour un box filter.
 *  - `smooth` : même forme de boucle que l'encodeur d'avant (`i < smooth`),
 *    donc même compte de passes y compris pour une valeur non entière. */
export function planRefine(x: RefineEdgeParams): RefinePass[] {
  const passes: RefinePass[] = [];
  if (x.contract !== 0) {
    const mode = x.contract < 0 ? "erode" : "dilate";
    const radius = Math.abs(x.contract);
    for (const axis of MORPHOLOGY_PASS_AXES)
      passes.push({ kind: "morphology", mode, axis, radius });
  }
  if (x.feather > 0) {
    passes.push({ kind: "boxFilter", axis: "H", radius: x.feather });
    passes.push({ kind: "boxFilter", axis: "V", radius: x.feather });
  }
  for (let i = 0; i < x.smooth; i++) {
    passes.push({ kind: "boxFilter", axis: "H", radius: 1 });
    passes.push({ kind: "boxFilter", axis: "V", radius: 1 });
  }
  return passes;
}
