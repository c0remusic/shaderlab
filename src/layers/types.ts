import type { LayerMask } from "../mask/types";

/** Référence sérialisable vers la texture GPU d'une photo importée (double
 *  exposure, ARCHITECTURE.md §4.2) — ne contient JAMAIS la texture
 *  elle-même. `sourceId` est résolu par `PhotoSourceStore` (src/render/),
 *  hors state React et hors historique. */
export interface ImageSourceRef {
  sourceId: string;
}

/** Rectangle de recadrage d'un calque photo, en PIXELS de la photo SOURCE
 *  (entiers, origine haut-gauche de la photo). Introduit en T1 parce que
 *  `CanvasMode` (src/ui/canvasMode.ts) doit pouvoir mémoriser le crop
 *  d'entrée de son mode ; le champ `crop` de `LayerTransform` et la
 *  géométrie associée arrivent en T4 (design
 *  `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.1). */
export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Position/échelle/rotation d'un calque de photo, en coordonnées PIXELS
 *  de la photo de FOND (origine haut-gauche), pas de la photo elle-même —
 *  `(x, y)` est le centre de la photo transformée. `rotation` en radians.
 *
 *  **DEUX échelles et non une** (2026-07-31). Le champ unique `scale` rendait
 *  le redimensionnement HOMOTHÉTIQUE par construction : aucun geste, aucun
 *  champ de saisie ne pouvait étirer une photo sur un seul axe. Ce n'était pas
 *  un choix de design tranché, seulement la forme la plus courte du modèle.
 *
 *  Les deux axes sont ceux de la photo AVANT rotation : `scaleX` étire toujours
 *  la photo dans sa propre largeur, quelle que soit son orientation à l'écran.
 *  C'est la seule convention qui rende les poignées de côté prévisibles sur une
 *  photo tournée — un axe écran donnerait une poignée dont l'effet change selon
 *  l'angle.
 *
 *  Aucune migration à prévoir : les presets excluent explicitement `transform`
 *  (`presetTypes.ts`) et le projet n'a pas de format de document sur disque. Ce
 *  type ne vit qu'en session. */
export interface LayerTransform {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

export interface LayerState {
  id: string;
  effectId: string;
  params: Record<string, number>;
  enabled: boolean;
  /** Opacité du calque (0..1). 1 = effet à pleine force. */
  opacity: number;
  /** Id du mode de fusion (registry blend). "normal" = remplacement (compat). */
  blendMode: string;
  /** Masque non-destructif du calque (design.md §3). Les rasters qu'il
   *  contient sont IMMUABLES par convention (toujours REMPLACÉS, jamais
   *  mutés en place) — clone() et l'historique partagent ces références. */
  mask: LayerMask;
  /** Double exposure (2026-07-25). Présent ssi ce calque porte une photo
   *  importée (silhouette) plutôt que de traiter la photo de base du
   *  document. `imageSource`/`transform` sont TOUJOURS présents ensemble ou
   *  absents ensemble (posés une seule fois par `LayerStack.addPhotoLayer`,
   *  jamais l'un sans l'autre). */
  imageSource?: ImageSourceRef;
  transform?: LayerTransform;
  /** Nom affiché du calque (parité calque photo, T1). Générique — pas
   *  réservé aux calques photo : l'affichage retombe sur le nom de l'effet
   *  quand il est absent (`LayerPanel`). Alimenté par le basename du fichier
   *  à l'import d'une photo. Champ SCALAIRE, donc présent dans chaque
   *  snapshot d'historique par construction (survie à l'undo automatique) et
   *  sans risque pour l'invariant OOM. */
  name?: string;
  /** Écrêtage (clipping, 2026-07-27) : cet effet ne s'applique QUE là où le
   *  calque photo situé en dessous couvre l'image. Absent/false =
   *  comportement linéaire (défaut historique : l'effet s'applique au
   *  composite complet en dessous). INTERDIT sur un calque portant
   *  `imageSource` — la garde vit dans `LayerStack.setLayerClip`, unique
   *  chemin d'écriture. Résolution : `layers/clipping.ts`.
   *  Champ SCALAIRE : présent par construction dans chaque snapshot
   *  d'historique, aucun risque pour l'invariant OOM. */
  clipToBelow?: boolean;
  /** VERROUS du calque (arbitrage n°2 du design « le fond devient un calque »,
   *  2026-07-28 ; passé de UN booléen à QUATRE le 2026-08-19). Propriété de
   *  calque ORDINAIRE, posable sur n'importe quel calque — ce n'est PAS un
   *  statut d'arrière-plan : c'est précisément ce qui évite de réintroduire un
   *  cas particulier par l'UI tout en gardant le garde-fou contre la
   *  modification accidentelle.
   *
   *  Absent = rien n'est verrouillé (défaut à la création). Le respect des
   *  verrous vit dans `LayerStack` — chaque mutateur bloqué y porte sa garde,
   *  sur le modèle de `setLayerClip` — ET dans `MaskPainter` pour le seul qui
   *  écrête au lieu de refuser (voir `LayerLocks.transparency`).
   *  Champ d'objet à champs SCALAIRES : présent par construction dans chaque
   *  snapshot d'historique, aucun raster, aucun risque pour l'invariant OOM. */
  locks?: LayerLocks;
}

/**
 * Les QUATRE verrous, modèle Photoshop.
 *
 * Adobe expose Lock Transparent Pixels, Lock Image Pixels, Lock Position et
 * Lock All, et marque la ligne d'un cadenas **plein quand tout est verrouillé,
 * creux quand ça l'est partiellement**
 * (`.scratch/hybride-lightroom-photoshop/research/01-conventions-adobe.md`).
 *
 * ⚠️ **Le faux ami se lève par une lecture de domaine, pas par une analogie.**
 * « Un calque d'effet n'a pas de pixels » est vrai des pixels et rate ce qu'il
 * possède : **le MASQUE d'un calque d'effet EST son canal alpha.** Là où
 * Photoshop distingue pixels transparents et pixels d'image, nous distinguons
 * le masque à ZÉRO et le masque tout court. La correspondance est exacte, et
 * c'est ce qui évite d'inventer un vocabulaire.
 *
 * Les quatre drapeaux sont INDÉPENDANTS et `all` n'en dérive pas : c'est un
 * cinquième geste chez Adobe (un bouton « Lock All » distinct), et le fusionner
 * avec « les trois autres sont vrais » rendrait impossible de tout verrouiller
 * puis de relâcher un seul cran. Lire l'état passe donc TOUJOURS par les
 * helpers de `layers/layerLocks.ts`, jamais par un champ nu.
 */
export interface LayerLocks {
  /** Gèle la GÉOMÉTRIE : `centreX`, `centreY`, `largeur`, `hauteur`,
   *  `rotation` — c'est-à-dire les paramètres qu'un `canvasControls` cite — et
   *  le `transform` d'un calque photo.
   *
   *  C'est le seul des quatre qui se transpose sans débat, et le cas d'usage
   *  est nommé par Adobe : garder la bonne transparence et les bons styles
   *  pendant qu'on hésite encore sur le placement. Chez nous : « je tiens le
   *  placement, je cherche encore la couleur ». */
  position?: boolean;
  /** Gèle CE QUE LE CALQUE COUVRE : pinceau, sources de masque, affinage de
   *  bord, inversion, et l'image source d'un calque photo. L'équivalent de
   *  Lock Image Pixels, une fois admis que le masque est notre canal alpha. */
  mask?: boolean;
  /** Le pinceau ne peut plus ÉTENDRE le masque, seulement l'affiner dedans.
   *
   *  ⚠️ **Il n'est PAS de la même nature que les trois autres, et c'est la
   *  seule chose à ne pas approximer en l'implémentant.** Les trois autres
   *  REFUSENT une opération — un test, un `return false`. Celui-ci la laisse
   *  passer en modifiant son résultat : le pinceau écrit, mais borné aux texels
   *  déjà non nuls. Il ne peut donc pas vivre au même endroit dans
   *  `LayerStack`, et il doit s'exprimer AUSSI dans `MaskPainter`, qui est le
   *  chemin réel du pinceau vivant — même piège que `replaceLiveLayers`, la
   *  porte que les gardes ne couvraient pas. */
  transparency?: boolean;
  /** TOUT. Implique les trois autres, plus ce qu'aucun ne couvre : changer
   *  l'effet, écrêter, réordonner, supprimer.
   *
   *  Le déverrouillage et la visibilité restent TOUJOURS autorisés, quel que
   *  soit le verrou : un verrou irréversible, ou qui empêche de masquer, est
   *  hostile. */
  all?: boolean;
}
