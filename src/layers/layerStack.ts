import type { LayerState, LayerTransform } from "./types";
import { defaultLayerMask, createBrushSource, createParametricSource } from "../mask/types";
import type { MaskSourceType, CombineMode, RefineEdgeParams, MaskSourceParams } from "../mask/types";
import { getMaskSourceModule } from "../mask/sources/registry";

let nextId = 0;
/** Exported so `presetDocument.apply()` (src/presets/) can inject the SAME
 *  counter instead of running a second, independently-seeded id sequence —
 *  two separate generators could otherwise both produce "layer-3" and
 *  silently collide once a preset-applied layer and a manually-added layer
 *  coexist in the same document. */
export function freshId(): string {
  nextId += 1;
  return `layer-${nextId}`;
}

/** Shallow value equality for a params-like record, used by the mutators
 *  below to detect a genuine no-op (same keys, same values) so App.tsx can
 *  skip creating an empty history entry (Task 3). Array values (e.g.
 *  color-range `samples`) are compared element-wise — `Object.is` alone
 *  would treat two structurally identical but distinct arrays as different,
 *  which would defeat the no-op check on every call since callers always
 *  spread into a fresh object/array. */
function paramsEqual(a: object, b: object): boolean {
  const ar = a as Record<string, unknown>;
  const br = b as Record<string, unknown>;
  const aKeys = Object.keys(ar);
  const bKeys = Object.keys(br);
  if (aKeys.length !== bKeys.length) return false;
  return aKeys.every((key) => {
    const av = ar[key];
    const bv = br[key];
    if (Array.isArray(av) && Array.isArray(bv)) {
      return av.length === bv.length && av.every((v, i) => Object.is(v, bv[i]));
    }
    return Object.is(av, bv);
  });
}

export class LayerStack {
  layers: LayerState[] = [];

  /** Index d'insertion d'un NOUVEAU calque, pour `addLayer`/`addPhotoLayer`.
   *
   *  Parité Photoshop : un calque créé se place JUSTE AU-DESSUS du calque
   *  sélectionné. Dans ce projet l'indice SUPÉRIEUR du tableau est le calque du
   *  DESSUS (`framePipelineExecutor.run` itère `layers` du premier au dernier,
   *  chaque calque composite par-dessus le résultat du précédent), donc
   *  « au-dessus de la sélection » = `index + 1` — exactement le calcul que
   *  `duplicateLayer` fait déjà.
   *
   *  **Aucune sélection (`null`/omis) -> haut de pile** (fin de tableau).
   *  C'est l'ancre par défaut la plus proche de Photoshop, où un document a
   *  toujours un calque actif : sans ancre, le nouveau calque coiffe la pile.
   *  C'est aussi, par construction, l'ancien comportement de ce fichier — un
   *  document neuf (pile vide) et un import sans sélection restent identiques
   *  à avant.
   *
   *  **Id introuvable -> même traitement que « aucune sélection ».** Ce n'est
   *  pas un état exceptionnel mais un id périmé (calque supprimé, undo), déjà
   *  traité en no-op par le reste du fichier (`removeLayer`, `toggleLayer`…) ;
   *  ces deux constructeurs rendent un id et n'ont pas de canal d'échec. */
  private insertIndexAfter(afterId: string | null | undefined): number {
    if (afterId === undefined || afterId === null) return this.layers.length;
    const index = this.layers.findIndex((l) => l.id === afterId);
    return index === -1 ? this.layers.length : index + 1;
  }

  /** Le calque `id` est-il VERROUILLÉ ? Unique lecture du champ `locked` dans
   *  ce fichier : chaque mutateur bloqué appelle CETTE fonction, jamais
   *  `layer.locked` en direct, pour que la liste des opérations refusées se
   *  lise en un seul `grep isLocked`.
   *
   *  **Opérations REFUSÉES sur un calque verrouillé** (toutes rendent le
   *  même no-op `false` que le reste du fichier — donc aucune entrée
   *  d'historique vide côté `App.tsx`) : `setLayerEffect`, `setLayerClip`,
   *  `setLayerImageSource`, `updateLayerTransform`, `removeLayer`,
   *  `reorderLayer`, `updateParams`,
   *  `updateBrushMask`, et toute la famille masque (`removeMaskSource`,
   *  `updateMaskSourceParams`, `setMaskSourceCombineMode`,
   *  `setMaskSourceEnabled`, `updateRefineEdge`, `setMaskInvert`,
   *  `setMaskEnabled`). `addMaskSource` refuse aussi, mais en LEVANT — il n'a
   *  pas de canal d'échec (il rend un id) et lève déjà sur un calque
   *  introuvable ; un calque verrouillé est la même classe de cible invalide.
   *
   *  **Opérations AUTORISÉES, et pourquoi.**
   *  - `setLayerLocked` : sinon le verrou serait irréversible.
   *  - `toggleLayer` (visibilité) : masquer n'est pas modifier — c'est un
   *    confort de lecture de la pile, réversible et sans effet sur le travail
   *    du calque. Le verrouiller rendrait le verrou hostile.
   *  - `duplicateLayer` : ne mute PAS la source, il la lit. La copie hérite du
   *    verrou (`...source` la recopie comme tout autre champ scalaire) : un
   *    garde-fou ne doit pas disparaître silencieusement à la duplication, et
   *    le déverrouillage de la copie reste à un clic.
   *  - `addLayer`/`addPhotoLayer` : insèrent À CÔTÉ, ne touchent pas le calque
   *    verrouillé.
   *
   *  **Limite assumée** : `reorderLayer` empêche de déplacer LE calque
   *  verrouillé, pas de déplacer un AUTRE calque au travers de lui — ce
   *  second geste est une mutation de l'autre calque, dont l'index du calque
   *  verrouillé n'est qu'une conséquence. */
  private isLocked(id: string): boolean {
    return this.layers.find((l) => l.id === id)?.locked === true;
  }

  /** Pose/retire le VERROU d'un calque (arbitrage n°2 du design
   *  `2026-07-28-shaderlab-fond-comme-calque-design.md` §7). Unique chemin
   *  d'écriture de `locked`, sur le modèle de `setLayerClip`.
   *
   *  Contrairement à tous les autres mutateurs, il ne consulte PAS `isLocked` :
   *  un verrou qu'on ne peut pas retirer n'est pas un verrou.
   *
   *  Returns `true` iff `id` existe ET `locked` diffère réellement de la valeur
   *  courante (même discipline no-op que le reste du fichier : pas d'entrée
   *  d'historique vide). */
  setLayerLocked(id: string, locked: boolean): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if ((layer.locked ?? false) === locked) return false;
    layer.locked = locked;
    return true;
  }

  /** `afterId` = calque sélectionné au moment de l'ajout ; le nouveau calque
   *  s'insère juste AU-DESSUS de lui (voir `insertIndexAfter` pour le sens de
   *  l'indice et le traitement de l'absence de sélection). */
  addLayer(effectId: string, afterId?: string | null): string {
    const id = freshId();
    this.layers.splice(this.insertIndexAfter(afterId), 0, {
      id,
      effectId,
      params: {},
      enabled: true,
      opacity: 1,
      blendMode: "normal",
      mask: defaultLayerMask(),
    });
    return id;
  }

  /** Crée un calque de photo (double exposure) : `effectId` par défaut
   *  "passthrough" (résolu par `getEffect`, voir effects/registry.ts —
   *  n'apparaît pas dans le sélecteur "ajouter un effet" de LayerPanel).
   *  L'appelant reste responsable de vérifier `canAddPhotoLayer` (limite
   *  dure, photoLayer.ts) AVANT d'appeler cette méthode — elle ne l'impose
   *  pas elle-même, comme les autres mutateurs de ce fichier qui ne
   *  connaissent pas les règles produit de plus haut niveau.
   *  `name` (T1, parité calque photo) : nom affiché du calque, en pratique
   *  le basename du fichier importé. Omis -> champ `name` absent (et non
   *  `undefined` posé explicitement), l'affichage retombe alors sur le nom
   *  de l'effet.
   *  `afterId` : calque sélectionné au moment de l'import — la photo s'insère
   *  juste AU-DESSUS de lui (voir `insertIndexAfter`). Insérer au MILIEU d'une
   *  chaîne d'écrêtage est autorisé et non exceptionnel : `clipBaseId`
   *  s'arrêtant à la première photo rencontrée en descendant, le calque écrêté
   *  au-dessus voit simplement sa base basculer sur la photo qui vient d'être
   *  insérée (`clipping.ts`, cas couvert par
   *  `test/layers/insertAboveSelection.test.ts`). */
  addPhotoLayer(sourceId: string, transform: LayerTransform, name?: string, afterId?: string | null): string {
    const id = freshId();
    this.layers.splice(this.insertIndexAfter(afterId), 0, {
      id,
      effectId: "passthrough",
      params: {},
      enabled: true,
      opacity: 1,
      blendMode: "normal",
      mask: defaultLayerMask(),
      imageSource: { sourceId },
      transform,
      ...(name === undefined ? {} : { name }),
    });
    return id;
  }

  /** Remplace l'effet d'un calque DÉJÀ créé, en remettant ses params aux
   *  défauts du nouvel effet. Sans ce mutateur, l'`effectId` posé à la
   *  création était définitif : un calque photo (`addPhotoLayer`, ci-dessus)
   *  restait `passthrough` à vie alors que le moteur sait déjà router la
   *  photo transformée comme ENTRÉE d'effet du calque
   *  (`render/framePipelineExecutor.ts`).
   *
   *  Params remis à `{}` — et pas fusionnés ni conservés : les params sont
   *  indexés par NOM côté state mais par POSITION dans l'uniform du shader
   *  (`effectPassRunner.ts` : `layer.params[p.name] ?? p.default`), donc une
   *  valeur héritée de l'ancien effet atterrirait dans un slot qui n'est pas
   *  le sien, hors de ses bornes min/max. `{}` EST le jeu de défauts du
   *  nouvel effet, exactement comme `addLayer` qui pose déjà `params: {}`.
   *  Le masque, l'opacité, le mode de fusion et l'identité photo
   *  (`imageSource`/`transform`) sont conservés : changer d'effet n'est pas
   *  recréer le calque.
   *
   *  Cette méthode ne valide PAS que `effectId` existe dans le registry —
   *  même contrat que `addLayer`, dont elle est le pendant sur un calque
   *  existant ; c'est `getEffect` qui échoue fail-fast à la résolution.
   *
   *  Returns `true` iff `id` existe ET `effectId` diffère réellement de
   *  l'actuel (même discipline no-op que le reste du fichier : pas d'entrée
   *  d'historique vide, et pas de reset de params sur un faux changement). */
  setLayerEffect(id: string, effectId: string): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (this.isLocked(id)) return false;
    if (layer.effectId === effectId) return false;
    layer.effectId = effectId;
    layer.params = {};
    return true;
  }

  /** Bascule l'ÉCRÊTAGE d'un calque d'effet (design 2026-07-27 §3.2) : l'effet
   *  ne s'applique alors qu'à la couverture du calque photo situé en dessous.
   *
   *  **Garde structurante : un calque portant `imageSource` est REFUSÉ.** Elle
   *  vit ICI, dans l'unique chemin d'écriture de `clipToBelow`, et nulle part
   *  ailleurs : un calque écrêté qui serait lui-même une photo casserait
   *  l'invariant d'ordre des passes dont dépend le partage de la cible de
   *  résolution photo (`photoLayerInput.ts`), et rendrait atteignable en un
   *  clic l'exclusion mutuelle que `composeShader` traite en assert. Un calque
   *  ne peut jamais acquérir les deux attributs : `imageSource` n'est écrit
   *  qu'à la création (`addPhotoLayer`) et à la duplication, aucun chemin ne
   *  transforme un calque d'effet existant en photo.
   *
   *  Returns `true` iff `id` existe, n'est PAS un calque photo, et `clip`
   *  diffère réellement de la valeur courante (même discipline no-op que le
   *  reste du fichier : pas d'entrée d'historique vide). */
  setLayerClip(id: string, clip: boolean): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (this.isLocked(id)) return false;
    if (layer.imageSource !== undefined) return false;
    if ((layer.clipToBelow ?? false) === clip) return false;
    layer.clipToBelow = clip;
    return true;
  }

  /** Remplace l'IMAGE d'un calque photo sans rien perdre d'autre (tranche T2
   *  du design `2026-07-28-shaderlab-fond-comme-calque-design.md`). Unique
   *  chemin d'écriture de `imageSource` sur un calque EXISTANT — les deux
   *  autres écritures du champ le POSENT à la naissance du calque
   *  (`addPhotoLayer`, `duplicateLayer`), aucune ne le change après coup.
   *
   *  Vaut pour TOUT calque photo, le fond compris : depuis T1 rien ne le
   *  distingue des autres, et une garde « sauf le fond » réintroduirait le
   *  statut spécial que cette tranche a supprimé.
   *
   *  **Le `transform` n'est PAS touché**, même quand la nouvelle image a
   *  d'autres dimensions. La toile ne dérive plus de la texture source depuis
   *  T1 (`ImageFrameResources.allocateCanvas` prend des dimensions
   *  explicites, posées à l'ouverture du document) : remplacer le contenu
   *  d'un calque ne redimensionne donc jamais le document, et l'image
   *  arrivante se place dans l'espace existant selon le placement déjà réglé
   *  — c'est le comportement attendu d'un montage où plusieurs images
   *  coexistent. `transform.x/y` étant le CENTRE de la photo et `scale` un
   *  facteur, la nouvelle image arrive centrée au même point, à la même
   *  échelle et au même angle ; seule l'étendue couverte change, ce qui est
   *  inhérent à un changement de dimensions et immédiatement visible.
   *  Recentrer ou ré-échelonner d'office écraserait en silence un placement
   *  délibéré, alors que « Centrer » et « Ajuster à la toile » sont à un clic
   *  dans le panneau Photo.
   *
   *  **Objet FRAIS, jamais de mutation en place** (`{ sourceId }` et non
   *  `layer.imageSource.sourceId = …`) : `clone()` copie les calques par
   *  spread shallow, donc `imageSource` est partagé par référence avec toutes
   *  les entrées d'historique. Muter en place réécrirait rétroactivement
   *  chaque snapshot et l'annulation rendrait un calque intact affichant la
   *  NOUVELLE image, sans la moindre erreur. Verrouillé par le témoin de
   *  `test/layers/setLayerImageSource.test.ts`.
   *
   *  Le masque n'est pas touché non plus : il est en coordonnées de DOCUMENT
   *  et la toile ne bouge pas, il reste donc valide tel quel.
   *
   *  `name` (optionnel) : nom affiché du calque, en pratique le basename du
   *  nouveau fichier. Il est posé PAR CE MÊME mutateur et pas par un second
   *  appel, pour deux raisons : le nom affiché décrit l'image, il devient un
   *  mensonge à l'instant où l'image change ; et l'écrire ici garantit qu'il
   *  voyage dans la MÊME entrée d'historique que la source — annuler restaure
   *  l'image et son nom d'un seul geste, jamais l'un sans l'autre. Omis ->
   *  nom inchangé.
   *
   *  Returns `true` iff `id` existe, porte déjà un `imageSource` (un calque
   *  d'effet n'a pas de source à remplacer), n'est pas verrouillé, et
   *  `sourceId` diffère réellement de l'actuel (même discipline no-op que le
   *  reste du fichier : pas d'entrée d'historique vide). */
  setLayerImageSource(id: string, sourceId: string, name?: string): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || layer.imageSource === undefined) return false;
    if (this.isLocked(id)) return false;
    if (layer.imageSource.sourceId === sourceId) return false;
    layer.imageSource = { sourceId };
    if (name !== undefined) layer.name = name;
    return true;
  }

  /** Duplique le calque `id` (équivalent Ctrl+J) et insère la copie JUSTE
   *  AU-DESSUS de l'original, c'est-à-dire à `index + 1` : dans ce projet la
   *  pile est appliquée dans l'ordre du tableau (`framePipelineExecutor.run`
   *  itère `layers` du premier au dernier, chaque calque composite par-dessus
   *  le résultat du précédent), donc l'indice SUPÉRIEUR est le calque du
   *  DESSUS. Retourne l'id du duplicata, ou `null` si `id` est absent (même
   *  discipline no-op que le reste du fichier : pas d'entrée d'historique sur
   *  une cible inexistante).
   *
   *  **Masque : partagé par référence, jamais recopié.** Chaque `raster` de
   *  source est immuable par convention (`updateBrushMask` remplace toujours
   *  la référence) — c'est exactement la politique de `clone()`, et
   *  `History` la refcount déjà par buffer unique (`history.ts:34-59`), donc
   *  un calque dupliqué n'ajoute AUCUN octet de masque au budget
   *  d'historique. Copier le raster (26 Mo à 26 MP) le ferait entrer dans le
   *  state React à chaque duplication — exactement le crash OOM résolu en
   *  `e3c7584`. Les CONTENEURS (LayerMask, tableau `sources`, chaque source)
   *  sont eux frais, pour que peindre/inverser le duplicata ne touche jamais
   *  l'original. Une touche de pinceau sur l'un ou l'autre REMPLACE sa propre
   *  référence de raster : le partage se défait tout seul, il n'est jamais
   *  observable comme une édition croisée.
   *
   *  Les ids de source du duplicata sont FRAIS : les textures GPU de masque
   *  sont indexées `${layerId}:${sourceId}` et balayées par `layerId`
   *  (`render/maskTextureResolver.ts:163-186, 348, 381`), donc l'aliasing
   *  serait déjà inoffensif côté GPU — mais deux calques exposant les mêmes
   *  ids de source dans l'UI (`MaskPanel`, sélection de source courante)
   *  n'aurait aucun sens. La convention `${layerId}-brush` d'`updateBrushMask`
   *  est conservée pour la source pinceau.
   *
   *  `imageSource` est partagé par VALEUR (même `sourceId`) : `PhotoSourceStore`
   *  est un store à durée de vie DOCUMENT, sans refcount et sans libération
   *  par calque (`render/photoSourceStore.ts:148-156`) — deux calques qui
   *  lisent la même source est donc sain, et ne réenregistre aucune texture.
   *  Le duplicata compte en revanche dans `countPhotoLayers` : c'est
   *  l'appelant qui doit vérifier `canAddPhotoLayer` AVANT (même contrat
   *  qu'`addPhotoLayer`, voir `layers/duplicateLayer.ts`).
   *
   *  Nom : `"<nom> copie"` si l'original porte un `name` explicite, sinon
   *  aucun `name` — l'affichage retombe alors sur le nom de l'effet, comme
   *  l'original (`LayerPanel`). `layers/` ne connaît pas le registre d'effets
   *  (dépendance `render/` interdite ici), donc fabriquer « Glow copie » pour
   *  un calque d'effet supposerait de faire remonter ce registre jusqu'ici. */
  duplicateLayer(id: string): string | null {
    const index = this.layers.findIndex((l) => l.id === id);
    if (index === -1) return null;
    const source = this.layers[index];
    const newId = freshId();
    const copy: LayerState = {
      ...source,
      id: newId,
      params: { ...source.params },
      mask: {
        ...source.mask,
        refineEdge: { ...source.mask.refineEdge },
        sources: source.mask.sources.map((s) => ({
          ...s,
          id: s.type === "brush" ? `${newId}-brush` : freshId(),
        })),
      },
      ...(source.imageSource === undefined ? {} : { imageSource: { ...source.imageSource } }),
      ...(source.transform === undefined ? {} : { transform: { ...source.transform } }),
      ...(source.name === undefined ? {} : { name: `${source.name} copie` }),
    };
    this.layers.splice(index + 1, 0, copy);
    return newId;
  }

  /** Returns `true` iff `id` existe, porte un `imageSource` (un calque sans
   *  photo n'a pas de transform à changer), et `transform` diffère
   *  réellement du courant (même discipline no-op que le reste du fichier). */
  updateLayerTransform(id: string, transform: LayerTransform): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer || !layer.imageSource) return false;
    if (this.isLocked(id)) return false;
    if (layer.transform && paramsEqual(layer.transform, transform)) return false;
    layer.transform = transform;
    return true;
  }

  /** Returns `true` iff a layer with `id` existed and was removed. Leaves
   *  `this.layers` as the SAME array reference on a no-op (absent id) — the
   *  same "don't touch the reference unless something actually changed"
   *  discipline as the mask-container setters below. */
  removeLayer(id: string): boolean {
    if (!this.layers.some((l) => l.id === id)) return false;
    if (this.isLocked(id)) return false;
    this.layers = this.layers.filter((l) => l.id !== id);
    return true;
  }

  /** Returns `true` iff `id` exists, `newIndex` is a valid position in the
   *  stack, and it differs from the layer's current index — an absent id,
   *  an out-of-bounds index, or reordering to the same spot are all no-ops
   *  reported as `false` rather than silently clamped or applied as an
   *  empty move (Task 3: the caller uses this to skip an empty history
   *  entry). */
  reorderLayer(id: string, newIndex: number): boolean {
    const from = this.layers.findIndex((l) => l.id === id);
    if (from === -1) return false;
    if (this.isLocked(id)) return false;
    if (newIndex < 0 || newIndex >= this.layers.length) return false;
    if (newIndex === from) return false;
    const [layer] = this.layers.splice(from, 1);
    this.layers.splice(newIndex, 0, layer);
    return true;
  }

  /** Returns `true` iff a layer with `id` existed and was toggled. */
  toggleLayer(id: string): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    layer.enabled = !layer.enabled;
    return true;
  }

  /** Returns `true` iff `id` exists and the merge actually changes at least
   *  one param value. */
  updateParams(id: string, params: Record<string, number>): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (this.isLocked(id)) return false;
    const merged = { ...layer.params, ...params };
    if (paramsEqual(layer.params, merged)) return false;
    layer.params = merged;
    return true;
  }

  /** Peint/actualise LA source pinceau du calque (au plus une en Tranche 2,
   *  voir `getBrushRaster`). Crée la source à la 1ère touche, sinon remplace
   *  son `raster` par une copie fraîche (immuable par convention, comme
   *  `updateMask` avant elle) — jamais de mutation en place. Returns `true`
   *  iff `id` exists (a brush stroke is never a no-op — it always carries
   *  fresh painted pixels). */
  updateBrushMask(id: string, raster: Uint8Array): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (this.isLocked(id)) return false;
    const fresh = new Uint8Array(raster);
    const idx = layer.mask.sources.findIndex((s) => s.type === "brush");
    if (idx === -1) {
      const brush = createBrushSource(`${id}-brush`, fresh);
      layer.mask = { ...layer.mask, sources: [...layer.mask.sources, brush] };
      return true;
    }
    const existing = layer.mask.sources[idx];
    if (existing.type !== "brush") throw new Error("Invariant violé: source pinceau attendue");
    const nextSource = { ...existing, raster: fresh };
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? nextSource : s));
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  addMaskSource(layerId: string, type: Exclude<MaskSourceType, "brush">): string {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) throw new Error(`Calque introuvable: ${layerId}`);
    // Refus par LEVÉE, et non par no-op : cette méthode rend un id, elle n'a
    // pas de canal d'échec — et elle lève déjà juste au-dessus sur un calque
    // introuvable. Un calque verrouillé est la même classe de cible invalide.
    // L'UI ne doit jamais l'atteindre : `MaskPanel` désactive « Ajouter une
    // source » sur un calque verrouillé.
    if (this.isLocked(layerId)) throw new Error(`Calque verrouillé: ${layerId}`);
    const module = getMaskSourceModule(type);
    const id = freshId();
    const source = createParametricSource(id, type, { ...module.defaultParams });
    layer.mask = { ...layer.mask, sources: [...layer.mask.sources, source] };
    return id;
  }

  /** Returns `true` iff `layerId` and `sourceId` both existed and the
   *  source was removed. An absent layer or an absent source id are both
   *  reported as `false` (Task 3: no longer throws — a caller acting on a
   *  stale/already-removed source id is a no-op, not an exceptional state). */
  removeMaskSource(layerId: string, sourceId: string): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (this.isLocked(layerId)) return false;
    const before = layer.mask.sources.length;
    const sources = layer.mask.sources.filter((s) => s.id !== sourceId);
    if (sources.length === before) return false;
    layer.mask = { ...layer.mask, sources };
    return true;
  }

  /** Returns `true` iff `layerId`/`sourceId` both exist, the source isn't
   *  the brush source (which has no params), and `params` actually differs
   *  from the source's current params. */
  updateMaskSourceParams(layerId: string, sourceId: string, params: MaskSourceParams): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (this.isLocked(layerId)) return false;
    const idx = layer.mask.sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) return false;
    const source = layer.mask.sources[idx];
    if (source.type === "brush") return false; // pas de params à comparer/remplacer
    if (paramsEqual(source.params, params)) return false;
    const nextSources = layer.mask.sources.map((s, i) =>
      i === idx && s.type !== "brush" ? { ...s, params } : s
    );
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  /** Returns `true` iff `layerId`/`sourceId` both exist and `mode` actually
   *  differs from the source's current combine mode. */
  setMaskSourceCombineMode(layerId: string, sourceId: string, mode: CombineMode): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (this.isLocked(layerId)) return false;
    const idx = layer.mask.sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) return false;
    if (layer.mask.sources[idx].combineMode === mode) return false;
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? { ...s, combineMode: mode } : s));
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  /** Returns `true` iff `layerId` exists and the patch actually changes at
   *  least one refine-edge field. */
  updateRefineEdge(layerId: string, refineEdge: Partial<RefineEdgeParams>): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (this.isLocked(layerId)) return false;
    const merged = { ...layer.mask.refineEdge, ...refineEdge };
    if (paramsEqual(layer.mask.refineEdge, merged)) return false;
    layer.mask = { ...layer.mask, refineEdge: merged };
    return true;
  }

  /** Returns `true` iff `id` exists and `invert` actually differs from the
   *  mask's current value. */
  setMaskInvert(id: string, invert: boolean): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (this.isLocked(id)) return false;
    if (layer.mask.invert === invert) return false;
    layer.mask = { ...layer.mask, invert };
    return true;
  }

  /** Returns `true` iff `id` exists and `enabled` actually differs from the
   *  mask's current value. */
  setMaskEnabled(id: string, enabled: boolean): boolean {
    const layer = this.layers.find((l) => l.id === id);
    if (!layer) return false;
    if (this.isLocked(id)) return false;
    if (layer.mask.enabled === enabled) return false;
    layer.mask = { ...layer.mask, enabled };
    return true;
  }

  /** Active/désactive UNE source de masque (design.md §3, gap Tranche 3 —
   *  jusqu'ici seul `setMaskEnabled` existait, au niveau du masque entier).
   *  Retourne `true` seulement si la source existait ET que sa valeur a
   *  changé (évite une entrée d'historique vide sur un no-op, cf. `App.tsx`
   *  Task 3). */
  setMaskSourceEnabled(layerId: string, sourceId: string, enabled: boolean): boolean {
    const layer = this.layers.find((l) => l.id === layerId);
    if (!layer) return false;
    if (this.isLocked(layerId)) return false;
    const idx = layer.mask.sources.findIndex((s) => s.id === sourceId);
    if (idx === -1) return false;
    if (layer.mask.sources[idx].enabled === enabled) return false;
    const nextSources = layer.mask.sources.map((s, i) => (i === idx ? { ...s, enabled } : s));
    layer.mask = { ...layer.mask, sources: nextSources };
    return true;
  }

  clone(): LayerStack {
    const copy = new LayerStack();
    copy.layers = this.layers.map((l) => ({
      ...l,
      params: { ...l.params },
      // Chaque `raster` de source est IMMUABLE par convention (updateBrushMask
      // remplace toujours la référence, jamais de mutation in place) — le
      // partager rend clone() O(métadonnées) au lieu de O(pixels), comme
      // l'ancien champ unique de LayerState. Les conteneurs (LayerMask, MaskSource, le tableau
      // sources) sont eux toujours des objets FRAIS, pour que muter le clone
      // (ex. setMaskInvert) ne touche jamais l'original.
      mask: {
        ...l.mask,
        refineEdge: { ...l.mask.refineEdge },
        sources: l.mask.sources.map((s) => ({ ...s })),
      },
    }));
    return copy;
  }
}
