import type { LayerState } from "./types";

/** Plafond de calques photo par document — la photo de FOND en fait
 *  DÉSORMAIS partie (tranche T1 du design 2026-07-28 : c'est un `LayerState`
 *  ordinaire portant `imageSource`, `countPhotoLayers` la compte comme les
 *  autres). Garde applicative NOMMÉE et vérifiable, jamais codée en dur dans
 *  `LayerStack` ou le shader — voir ARCHITECTURE.md §5 "N sources d'image".
 *
 *  Valeur retenue : **5**, portée de 4 à 5 par l'arbitrage n°3 du 2026-07-28
 *  (§7) — « 4 imports + le fond », pour ne retirer aucune capacité existante.
 *  Laisser 4 aurait ramené l'utilisateur à 3 imports du jour au lendemain.
 *  L'estimation associée (~41,5 % de VRAM au plafond, §4.2) est une
 *  ARITHMÉTIQUE sur des deltas mesurés, pas une mesure : la tranche T4 la
 *  re-mesure au protocole existant et fait descendre ce plafond si la mesure
 *  dément.
 *
 *  Base factuelle antérieure (design
 *  `2026-07-26-shaderlab-photo-layer-parity-design.md` §3.5) : la seule
 *  mesure disponible est ~1280 Mo avec 2 photos 26 MP et 3 calques dont un
 *  calque photo (`.claude/learning-log.md:1060-1072`), sans
 *  `device.lost`, et elle n'est PAS décomposée — aucune extrapolation
 *  linéaire n'est légitime. Ce que le code permet d'affirmer : chaque calque
 *  photo supplémentaire ajoute UNE texture source
 *  (`photoW × photoH × 4` ≈ 96 Mo à 24 MP, `render/photoSourceStore.ts`) et
 *  ZÉRO cible pleine taille supplémentaire, la cible de résolution étant
 *  partagée (`render/photoLayerInput.ts`, invariant d'ordre des passes).
 *  4 est donc un pas mesurable (≈ +3 textures sources sur la mesure
 *  existante), pas une limite théorique.
 *
 *  ⚠️ CRITÈRE DE RÉVISION — mesure VRAM RÉELLE à 5 × 24 MP encore À FAIRE
 *  (elle exige une vraie fenêtre WebView2 avec GPU : impossible en session
 *  headless / test Node). C'est la tranche T4. Réviser cette valeur, ET
 *  `MAX_REGISTERED_PHOTO_SOURCES` qui en dérive, dès que la mesure est
 *  relevée, ou si un `device.lost` est observé sous ce plafond. */
export const MAX_PHOTO_LAYERS = 5;

export function countPhotoLayers(layers: LayerState[]): number {
  return layers.filter((layer) => layer.imageSource !== undefined).length;
}

export function canAddPhotoLayer(layers: LayerState[]): boolean {
  return countPhotoLayers(layers) < MAX_PHOTO_LAYERS;
}

/**
 * `sourceId` du calque photo le PLUS BAS de la pile, ou `null` si la pile n'en
 * contient aucun.
 *
 * Existe pour les masques PARAMÉTRIQUES (luminosité, plage de couleur,
 * dégradé), qui doivent échantillonner une IMAGE (design 2026-07-28 §2.1,
 * CRITIQUE). Ils lisaient la texture d'entrée du pipeline ; depuis la tranche
 * T1 cette texture est la toile, vide — un masque de luminosité y lirait du
 * noir partout et deviendrait aveugle, en silence, sans qu'aucune erreur ne
 * soit levée.
 *
 * « Le plus bas » et pas « le fond » : rien ne distingue le fond des autres
 * photos dans le modèle, et c'est voulu (§1.1). Tant que la photo d'ouverture
 * est en bas de pile — le cas nominal — cette fonction rend exactement la
 * texture qu'on échantillonnait avant, donc le comportement des masques
 * paramétriques est inchangé au pixel près.
 *
 * Fonction PURE, ici et pas dans `render/` : c'est une décision sur le modèle
 * de calques, et c'est ce qui la rend vérifiable sans GPU. `render/renderer.ts`
 * n'en est que l'adaptateur (`sourceId` -> texture via `PhotoSourceStore`).
 */
export function bottomPhotoSourceId(layers: LayerState[]): string | null {
  for (const layer of layers) {
    if (layer.imageSource !== undefined) return layer.imageSource.sourceId;
  }
  return null;
}

/**
 * Prédicat pur : le document contient-il une photo AUTRE que sa photo
 * d'ouverture ? Désactive le round-trip Lightroom pour cet export
 * (ARCHITECTURE.md §4.6, PRD "Double exposure"). Vit ici (pas dans
 * export/exportImage.ts) pour rester une seule source de vérité réutilisée par
 * la limite d'import ET par la bascule d'export.
 *
 * REDÉFINI en tranche T1 (design 2026-07-28 §2.8). Il s'écrivait
 * `countPhotoLayers(layers) > 0` et s'appelait `hasPhotoLayer` : depuis que la
 * photo de fond est un calque, cette forme est TOUJOURS vraie sur un document
 * ouvert, donc `roundTripActive` serait toujours faux — le prédicat serait
 * devenu un mensonge silencieux plutôt qu'une décision.
 *
 * La forme retenue — « exactement une photo, et c'est `layers[0]` » — est ce
 * que le garde protégeait réellement : écraser le fichier exporté par
 * Lightroom n'est légitime que si le document est encore une retouche de CETTE
 * photo-là. Dès qu'une photo est importée, que le fond est supprimé, ou qu'un
 * autre calque photo est passé sous lui, l'export est un composite : copie,
 * jamais écrasement. Un document sans aucun calque (pile vidée à la main) n'a
 * plus de photo d'ouverture identifiable — donc plus de round-trip non plus.
 */
export function hasImportedPhotoLayer(layers: LayerState[]): boolean {
  if (layers.length === 0) return true;
  return countPhotoLayers(layers) !== 1 || layers[0].imageSource === undefined;
}
