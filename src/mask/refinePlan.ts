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
  | { kind: "boxFilter"; axis: "H" | "V"; radius: number }
  /** Feather par table de sommes cumulées : UNE passe de lookup, dont le coût
   *  ne dépend pas du rayon. Remplace les deux `boxFilter` H/V que le feather
   *  encodait jusqu'au 2026-08-13, dont le coût y était proportionnel — mesuré
   *  en production sur 26 Mpx : 164 images par seconde à petit rayon contre 48
   *  à rayon 50, un facteur 3,4 que l'utilisateur signalait sans voir de
   *  chiffre. La construction de la table, elle, reste à la charge de
   *  l'encodeur, qui la met en cache tant que son entrée ne change pas.
   *  Depuis le 2026-08-19 le lookup n'est plus un box simple mais quatre
   *  fenêtres pondérées (profil en S — voir `FEATHER_WINDOWS`,
   *  mask/refineEdgeWgsl.ts) : toujours UNE passe, même table, même cache. */
  | { kind: "featherSat"; radius: number };

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
/** Décompose un rayon de morphologie en élément OCTOGONAL séparable :
 *  `axial` est le rayon des passes H/V (le carré), `diagonal` celui des
 *  passes D1/D2, compté en PAS de texel diagonaux (un pas = √2 px).
 *
 *  Contrat, dans l'ordre où il a été choisi :
 *  - l'extension sur les AXES vaut exactement `radius` px
 *    (`axial + 2·diagonal === radius`) — c'est la promesse du curseur ;
 *  - l'extension sur les DIAGONALES vaut `(axial + diagonal)·√2` px
 *    euclidiens, au plus proche de `radius` (k = round(r·(1−1/√2))) — le
 *    coin d'un masque dilaté suit un arc approché au lieu de pousser en
 *    carré. Mesuré chez Affinity (audit 2026-08-19) : leur grow est un
 *    disque euclidien ; notre carré débordait de 41 % à 45°. L'octogone
 *    borne l'écart au disque à ~8 % aux directions intermédiaires (22,5°),
 *    écart balayé et verrouillé par test/mask/refinePlan.test.ts.
 *  - r=1 dégénère en carré (k=0), r=2 en losange (a=0) : aux tout petits
 *    rayons la quantification ne laisse pas mieux. */
export function octagonRadii(radius: number): { axial: number; diagonal: number } {
  const diagonal = Math.round(radius * (1 - Math.SQRT1_2));
  return { axial: radius - 2 * diagonal, diagonal };
}

export function planRefine(x: RefineEdgeParams): RefinePass[] {
  const passes: RefinePass[] = [];
  if (x.contract !== 0) {
    const mode = x.contract < 0 ? "erode" : "dilate";
    const { axial, diagonal } = octagonRadii(Math.abs(x.contract));
    if (axial > 0)
      for (const axis of MORPHOLOGY_PASS_AXES)
        passes.push({ kind: "morphology", mode, axis, radius: axial });
    if (diagonal > 0)
      for (const axis of ["D1", "D2"] as const)
        passes.push({ kind: "morphology", mode, axis, radius: diagonal });
  }
  if (x.feather > 0) passes.push({ kind: "featherSat", radius: x.feather });
  for (let i = 0; i < x.smooth; i++) {
    passes.push({ kind: "boxFilter", axis: "H", radius: 1 });
    passes.push({ kind: "boxFilter", axis: "V", radius: 1 });
  }
  return passes;
}
