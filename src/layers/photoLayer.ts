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
 *  ✅ MESURÉ le 2026-07-29 (tranche T4, RTX 2060 6144 Mo, 5 photos 6240×4160
 *  toutes distinctes, 4 passes) : pic à **2576 Mo = 41,9 % de la VRAM** au
 *  plafond de 5 calques photo, **aucun `device.lost`**. Aucun des quatre
 *  seuils de révision n'est franchi — détail chiffré, écart entre passes et
 *  ce que la mesure ne couvre pas :
 *  `docs/superpowers/specs/2026-07-28-shaderlab-fond-comme-calque-design.md`
 *  §4.4. La valeur 5 n'est donc PAS une estimation.
 *
 *  ✅ RE-MESURÉ le 2026-07-30 (tranche T3, même machine) AVEC UNE TOILE PLUS
 *  GRANDE QUE LES PHOTOS — 8000 × 8000 = 64 Mpx, le plafond de
 *  `MAX_CANVAS_PIXELS`, contre toile ≡ photo en T4. **Le plafond reste à 5, et
 *  6 a été essayé pour de vrai avant d'être écarté** :
 *   - À 6 calques photo, le cas NOMINAL est bon marché : +82 Mo seulement sur le
 *     cas à 5, aucun `device.lost`, la fenêtre rend. Ce n'est PAS ce cas qui
 *     décide, et c'est le piège de ce plafond.
 *   - Ce qui décide est le pire cas des sources, parce que
 *     `MAX_REGISTERED_PHOTO_SOURCES` DÉRIVE de cette valeur : 6 calques ⇒ 24
 *     sources. Mesuré à 23 sources sur 24 (le vivier de photos réellement
 *     distinctes de la machine est épuisé à 23) : **4386 Mo, soit ~89 % de la
 *     VRAM** ligne de base comprise — au-delà du seuil de 80 %. À 5 calques le
 *     même pire cas vaut 4108 Mo, ~84 %.
 *   - Donc monter à 6 franchirait le seuil, alors que rien ne se voit dans le
 *     cas nominal. Mesure = verdict : la valeur reste 5.
 *  Détail des passes : design 2026-07-28 §4.5.
 *
 *  ⚠️ CRITÈRE DE RÉVISION — cette valeur, ET `MAX_REGISTERED_PHOTO_SOURCES`
 *  qui en dérive, se révisent sur une NOUVELLE mesure au NOUVEAU plafond,
 *  jamais par extrapolation, ou si un `device.lost` est observé sous ce
 *  plafond. La mesure exige une vraie fenêtre WebView2 avec GPU (impossible
 *  en session headless / test Node).
 *  PRÉCISION ACQUISE LE 2026-07-30, à ne pas reperdre : une mesure de révision
 *  qui ne fait qu'atteindre le nouveau plafond de CALQUES ne prouve rien —
 *  elle doit aussi saturer les SOURCES au nouveau plafond dérivé, sinon elle
 *  mesure le cas qui ne décide pas. Et le plafond ne peut monter qu'en même
 *  temps que `MAX_CANVAS_PIXELS` descend : les deux sont couplées par ce même
 *  pire cas. */
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
 * Description EXACTE de l'image que la pré-passe photo (`render/photoLayerInput.ts`)
 * rendra pour ce calque : sa source et sa transformation, rien d'autre.
 * `null` pour un calque qui ne porte pas de photo.
 *
 * Sert de clé d'invalidation à l'epoch du guide edge-aware d'un calque photo
 * (`FramePipelineExecutor.computeGuideEpochs`), depuis que ce guide est la
 * photo du calque et non plus le composite en dessous. Deux valeurs égales
 * signifient « la pré-passe rendra les mêmes pixels », donc « le guide n'a pas
 * changé » — la seule chose que le cache SAT a besoin de savoir.
 *
 * Chaîne et non objet : l'identité d'objet ne convient pas ici. `imageSource`
 * et `transform` sont DEUX champs, et une mise à jour immuable de l'un laisse
 * l'autre inchangé — une clé d'identité manquerait donc la moitié des
 * changements. Comparer les VALEURS est ce qui rend la clé exacte.
 *
 * Fonction PURE, ici et pas dans `render/` : c'est une lecture du modèle de
 * calques, vérifiable sans GPU — même raison que `bottomPhotoSourceId`.
 */
export function photoGuideKey(layer: LayerState | undefined): string | null {
  if (!layer?.imageSource || !layer.transform) return null;
  const t = layer.transform;
  return `${layer.imageSource.sourceId}|${t.x}|${t.y}|${t.scale}|${t.rotation}`;
}

/**
 * Prédicat pur : le document contient-il une photo AUTRE que sa photo
 * d'ouverture ? Autrement dit : « ce document est-il encore la retouche de
 * CETTE photo-là ? ». Forme retenue : exactement une photo, et c'est
 * `layers[0]`.
 *
 * SON PREMIER APPELANT A DISPARU. Il est né en garde du round-trip Lightroom
 * (ARCHITECTURE.md §4.6, PRD "Double exposure") : écraser en place le fichier
 * reçu de Lightroom n'était légitime que sur un document non composite. Le
 * round-trip est déposé
 * ([ADR-0002](../../.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md)),
 * `roundTripActive` avec lui, et l'export n'a plus aucun cas particulier.
 *
 * IL SURVIT PARCE QU'UN SECOND APPELANT S'EN SERT, arrivé après lui et sans
 * rapport avec l'export : `presets/presetDocument.ts:capture` (T5, design
 * 2026-07-28 §2.3) décide par ce prédicat QUAND l'exclusion des calques photo
 * d'un preset mérite d'être signalée. Depuis que la photo d'ouverture est un
 * calque, un avis déclenché sur « le document contient une photo » se
 * déclencherait toujours ; la frontière voulue est « une photo AUTRE que celle
 * d'ouverture », ce que ce prédicat dit déjà. Ce n'est donc pas du code mort
 * laissé derrière la dépose : le supprimer casserait la frontière de l'avis.
 *
 * REDÉFINI en tranche T1 (design 2026-07-28 §2.8). Il s'écrivait
 * `countPhotoLayers(layers) > 0` et s'appelait `hasPhotoLayer` : depuis que la
 * photo de fond est un calque, cette forme est TOUJOURS vraie sur un document
 * ouvert — le prédicat serait devenu un mensonge silencieux plutôt qu'une
 * décision.
 *
 * Cas limites, inchangés par la dépose : une photo importée, un fond supprimé,
 * ou un autre calque photo passé sous lui rendent VRAI. Une pile entièrement
 * vidée aussi — il n'y a plus de photo d'ouverture identifiable.
 */
export function hasImportedPhotoLayer(layers: LayerState[]): boolean {
  if (layers.length === 0) return true;
  return countPhotoLayers(layers) !== 1 || layers[0].imageSource === undefined;
}
