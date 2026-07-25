# ARCHITECTURE — shaderlab

> Document d'architecture racine. Décrit **l'état réel du système** (vérifié sur
> disque le 2026-07-25) et **les frontières de modules visées** pour les deux
> features cadrées au `PRD.md` : **Presets** et **Double exposure**.
>
> Ce n'est PAS un plan d'implémentation (tranches, ordre, tâches → étape
> suivante `superpowers:writing-plans`, après validation humaine de ce document).
>
> Sources d'autorité, dans l'ordre : `PRD.md` (le QUOI) >
> `docs/superpowers/specs/2026-07-25-shaderlab-double-exposure-design.md` (le
> COMMENT de la double exposure, **validé par Antoine** — ce document s'y aligne)
> > `CLAUDE.md` / `CONTEXT.md` (invariants et vocabulaire) > ce document (les
> frontières de modules et les points laissés ouverts par les précédents).
>
> Convention de durabilité : les `fichier:ligne` cités ici sont des **preuves
> d'état observé le 2026-07-25**, pas des instructions « éditer ici plus tard ».
> Les contrats sont décrits par comportement/interface, pas par emplacement.

---

## 0. Portée et limites de cette analyse

- Forensics git (`git log --name-only`, co-changement) **non réalisée** : l'agent
  qui a produit ce document n'avait pas d'outil shell disponible. La structure de
  dépendances décrite au §1 est dérivée du **graphe d'imports réel lu sur
  disque**, pas d'un historique de co-changement. Les regroupements de modules
  proposés s'appuient donc sur les dépendances statiques + les commentaires de
  décision présents dans le code, pas sur une fréquence de co-modification
  mesurée. Trigger de réouverture : si un doute subsiste sur une frontière
  proposée au §3/§4, relancer une passe `git log --name-only -- src/render/
  src/layers/` avant de trancher.
- Le chantier `2026-07-24-shaderlab-contextual-panels-design.md` (rail d'icônes +
  `useContextualPanel`) est **en attente de relecture, non implémenté**. Ce
  document en tient compte comme d'une contrainte de séquencement (§6), jamais
  comme d'un état livré.

---

## 1. Vue d'ensemble — les couches réelles

Six couches, dépendances **strictement descendantes** (aucun cycle observé) :

```
                      ┌─────────────────────────────────────┐
      Coquille Rust   │ src-tauri/src/lib.rs                │  IPC : 9 commandes
      (Tauri v2)      │ get_launch_path, read/write_image_  │  (aucun plugin fs/
                      │ file, pick_image_file, path_exists, │   dialog — commandes
                      │ default_export_dir, pick_export_    │   maison, cf. §7)
                      │ folder, join_export_target, …       │
                      └──────────────▲──────────────────────┘
                                     │ invoke()
                      ┌──────────────┴──────────────────────┐
      Frontière IPC   │ src/launch.ts  (wrappers typés)     │  module plat, une
                      └──────────────▲──────────────────────┘  fonction = une cmd
                                     │
   ┌─────────────────────────────────┴───────────────────────────────────┐
   │  src/App.tsx  — COMPOSITION ROOT (727 lignes, cf. §7 dette)          │
   │  détient : refs GPU/renderer/session, state UI, tous les handlers    │
   └───┬───────────────┬──────────────────┬───────────────┬──────────────┘
       │               │                  │               │
  ┌────▼─────┐   ┌─────▼──────┐   ┌───────▼──────┐  ┌─────▼─────────┐
  │ applica- │   │  render/   │   │   mask/      │  │  export/      │
  │  tion/   │   │            │   │              │  │               │
  │ Document │   │  Renderer  │   │ MaskPainter  │  │ exportImage   │
  │ Session  │   │  (façade)  │   │ sources/*    │  │ + résolution  │
  └────┬─────┘   └─────┬──────┘   │ foldPlan     │  │   de chemin   │
       │               │          └──────┬───────┘  └─────┬─────────┘
       │               │                 │                │
  ┌────▼───────────────▼─────────────────▼────────────────▼─────────────┐
  │  src/layers/  — LayerStack · History · displayProjection · types     │
  │  MODÈLE DE DONNÉES PARTAGÉ : dépend de mask/types, de rien d'autre   │
  └──────────────────────────────────────────────────────────────────────┘
```

### 1.1 `layers/` — le modèle, socle de tout

`LayerState` (`src/layers/types.ts`) est le **type pivot du projet** : il est
consommé par `render/`, `mask/`, `export/`, `components/` et `application/`. Il
ne dépend que de `mask/types`. Sa forme est donc le point d'architecture le plus
structurant — les deux features neuves l'étendent toutes les deux (§3, §4).

- `LayerStack` : mutateurs à **sémantique de résultat** (`boolean` = « quelque
  chose a réellement changé »), pour qu'un no-op ne crée pas d'entrée
  d'historique. `clone()` est `O(métadonnées)` : les `raster` de masque sont
  partagés par référence, jamais copiés — invariant d'immutabilité documenté dans
  `layerStack.ts:228-233`.
- `History` : pile undo/redo de session, bornée, partage les rasters.
- `displayProjection.toDisplayLayers()` : **projection d'affichage** qui vide les
  `raster` avant que les calques n'entrent dans le state React. C'est le fix du
  crash OOM 24MP (`e3c7584`) généralisé à N sources de masque. Invariant reconduit
  au §2.

### 1.2 `application/DocumentSession` — la façade sans framework

`DocumentSession` (`src/application/documentSession.ts`, 83 lignes) encapsule
`LayerStack` + `History` + sélection courante. **Interface étroite** (14 méthodes
courtes), **implémentation qui porte une vraie règle** (normalisation de la
sélection, clone au commit, deux vues distinctes : `layers()` = complet pour le
GPU, `displayLayers()` = projection sans raster pour React). C'est déjà un module
profond au sens Ousterhout, et c'est **le bon point d'entrée pour toute opération
document-level** — y compris « appliquer un preset » et « ajouter un calque
photo » (§3.4, §4.4).

### 1.3 `render/` — une façade mince sur cinq collaborateurs

Point important, **différent de ce que suggèrent les listes « fichiers touchés »
des design docs** : `Renderer` n'est plus le module qui encode le rendu. C'est un
assembleur de cycle de vie (créer/charger/disposer, coalescing, overlay). Le
travail réel est réparti :

| Module | Responsabilité réelle | Preuve |
|---|---|---|
| `Renderer` | cycle de vie, ordonnancement (`FrameScheduler`), overlay tick, readback export | `renderer.ts:61-299` |
| `ImageFrameResources` | textures persistantes de l'image (source, ping-pong ×2, export) | `imageFrameResources.ts:4-71` |
| `FramePipelineExecutor` | **boucle par calque**, ping-pong, ordre des passes, destruction des ressources de frame | `framePipelineExecutor.ts:132-263` |
| `EffectPassRunner` | encodage d'UNE passe : uniforms, bind group, cache de pipelines | `effectPassRunner.ts:147-208` |
| `shaderCompose` | composition de la chaîne WGSL — **la chaîne EST la clé de cache** | `shaderCompose.ts:47-96` |
| `MaskTextureResolver` | résidence + résolution des textures de masque (fold, refine edge, edge-aware) | `renderer.ts:169-176` |

Les trois interfaces `FrameResourcesPort` / `EffectPassesPort` / `MaskTexturesPort`
(`framePipelineExecutor.ts:9-57`) sont des **ports explicites** : l'exécuteur de
frame est testable en isolation avec des doubles
(`test/render/framePipelineExecutor.test.ts` existe). C'est la frontière de test
la plus utile de la couche rendu — toute extension du pipeline doit la préserver.

**Contrat de bindings du groupe 0** (état actuel, `shaderCompose.ts:79-84`) :

| binding | ressource | conditionnel ? |
|---|---|---|
| 0 | `srcTexture` (composite des calques du dessous) | non |
| 1 | `srcSampler` (bilinéaire) | non |
| 2 | `params: array<f32, 11>` | non |
| 3 | `maskTexture` | `applyMask` |
| 4 | `prevPass` | `hasPrevPass` |
| 5 | `compositing: vec4<f32>` (x = opacité) | `applyMask` |

### 1.4 `mask/` — sources combinables + peinture

`MaskPainter` alloue son buffer aux **dimensions de l'image de base**
(`maskPainter.ts:29-32`, appelé avec `imageSize` dans `App.tsx`). Conséquence
architecturale majeure pour la double exposure : **l'espace de coordonnées du
masque est celui de la photo de fond**, jamais celui d'une source d'image
transformée (§4.5).

### 1.5 `components/` — UI, aucune logique métier

Contrat du dock stabilisé : `PanelColumn` reçoit un **tableau `panels`** de
`{ id, title, collapsed, onCollapsedChange, content }` + un `DockLayout` + une
largeur. Tous les handlers viennent d'`App.tsx`. Aucun composant ne connaît
`LayerStack` ni le renderer. Cette frontière est saine et **ne doit pas bouger**
pour ajouter une carte (§6).

### 1.6 `export/` + `launch.ts` — ports d'IO déjà propres

`exportImage.ts` définit ses propres **ports d'entrée/sortie** (`FrameRenderer`,
`ImageWriter`, `PathAvailability` — `exportImage.ts:4-11,44-46`) et est testé avec
des doubles. C'est le **patron à reproduire** pour la persistance des presets
(§3.3), pas à réinventer.

---

## 2. Décisions verrouillées — invariants à respecter

Un changement qui viole l'un de ces points est un défaut, pas un arbitrage.

1. **Pipeline linéaire strict / sRGB.** Toutes les textures couleur au format
   `navigator.gpu.getPreferredCanvasFormat() + "-srgb"` ; conversion automatique
   par le format ; **jamais de gamma manuel en WGSL**. Les helpers
   `srgb2lin`/`lin2srgb` (`shaderCompose.ts:34-45`) n'existent que pour les modes
   de fusion définis-gamma, pas pour corriger une texture. → **La seconde source
   d'image de la double exposure se charge avec `ctx.srgbFormat`, comme
   `ImageFrameResources.loadImage`.**
2. **Un seul pipeline, résolution native.** Pas de distinction preview/export ;
   `exportFrame()` réexécute exactement `runPipeline` sur une cible hors-écran.
3. **Registry pour les extensions du moteur.** Un effet = un fichier dans
   `render/effects/` enregistré dans `registry.ts` ; un mode de fusion = un
   fichier dans `render/blend/`. Zéro modification du moteur ni de l'UI. Un effet
   est une **transformation de couleur pure** (`fs_main(uv, color) -> vec4`)
   bornée à `MAX_EFFECT_PARAMS = 11` floats. → C'est précisément pourquoi la
   double exposure n'est **pas** un effet (approche (A) écartée au design doc).
4. **Aucun gros buffer dans le state React.** Cause racine du crash OOM 24MP
   (`e3c7584`) : ~26 Mo de `maskData` traversant `setLayers()`. Le state React ne
   reçoit que `toDisplayLayers()`. → **Généralisation obligatoire : toute donnée
   pixel/GPU (raster, `ImageBitmap`, `GPUTexture`) est interdite dans le state
   React ET, par extension, dans les snapshots d'historique** (§4.2).
5. **Pas de fallback silencieux.** Une erreur est visible (`ErrorBanner`) ou
   remonte ; jamais un état qui se dit fini sans l'être. Le pipeline détruit ses
   ressources en `catch` puis **relance** (`framePipelineExecutor.ts:115-129`).
6. **Une interaction = une entrée d'historique**, pas une par frame de drag ; un
   no-op ne crée aucune entrée (sémantique `boolean` des mutateurs).
7. **Barre de qualité.** Version pipeline puis upgrade qualité obligatoire.
   S'applique aussi au rendu d'un calque photo (échantillonnage, bords).
8. **Preuve UI = CDP sur la vraie fenêtre WebView2** + checkpoint humain.
   Playwright headless est aveugle sur un canvas WebGPU.

---

## 3. Module map — Presets

Statut : **pas de design doc dédié** ; ce qui suit reste au niveau que le `PRD.md`
autorise (annexe « Choix techniques déduits »). Les points marqués **[à trancher]**
sont explicitement laissés à `brainstorming`/`writing-plans`.

### 3.1 Contrainte fondatrice découverte

Un preset est un **fichier JSON sérialisant `LayerState[]` sans les masques**.
Cela impose que `LayerState` reste une **donnée simple sérialisable** : pas de
handle GPU, pas de `ImageBitmap`, pas de fonction. Cette contrainte, née de
Presets, **contraint aussi la double exposure** (§4.2) — les deux features
convergent sur le même invariant. C'est la décision structurante n°1 de ce
document.

### 3.2 `src/presets/presetDocument.ts` — module PUR (profond)

Interface visée, étroite (2 entrées, aucune IO, aucun React) :

```
capture(layers: LayerState[]): { preset: PresetDocument; skipped: SkipNotice[] }
apply(preset: PresetDocument, opts): { layers: LayerState[]; warnings: Warning[] }
```

Profondeur derrière ces deux fonctions (implémentation riche) :
- versionnement de schéma (`schemaVersion`) et refus explicite d'un fichier de
  version inconnue — jamais un parse permissif ;
- retrait des masques à la capture (`mask` remis à `defaultLayerMask()` à
  l'application) ;
- **effet inconnu du registry → calque ignoré + warning**, jamais un échec total
  ni un silence (exigence PRD, plancher dur) ;
- clamp des params aux bornes déclarées par `EffectParam` du registry courant
  (protège contre une dérive de bornes entre deux versions du code) ;
- régénération des `id` de calque (un preset ne peut pas réimporter les ids d'un
  autre document) ;
- **[à trancher]** traitement d'un calque portant `imageSource` à la capture : la
  piste par défaut recommandée est de **l'exclure du preset avec un avis visible**
  (un `sourceId` n'a aucun sens dans un autre document) — le PRD ne couvre pas
  l'interaction Presets × Double exposure.

Frontière de test unique : `capture`/`apply` sont des fonctions pures sur des
tableaux — testables sans GPU, sans React, sans disque. C'est exactement le
critère « terminé = démontrable » du PRD pour la logique pure.

**Anti-pattern à refuser** : un `presetService` unique qui sérialise ET écrit sur
disque ET pilote un state React. Ce serait un module shallow à interface large, et
il rendrait la logique de capture/application non testable sans IPC.

### 3.3 `src/presets/presetStore.ts` — port d'IO (mince, assumé)

Interface visée, sur le modèle **déjà éprouvé** de `ImageWriter`/`PathAvailability` :

```
interface PresetStore {
  list(): Promise<PresetSummary[]>;
  load(id): Promise<PresetDocument>;
  save(id, doc): Promise<void>;      // écrasement = décision de l'appelant
  rename(id, name): Promise<void>;
  remove(id): Promise<void>;
  exportTo(path, doc): Promise<void>;
  importFrom(path): Promise<PresetDocument>;
}
```

Un port mince est ici **légitime** (faux positif connu de l'audit archi : adapter
explicite de frontière) : il isole Tauri, il permet un double en mémoire pour les
tests, et il ne fuit aucun détail d'implémentation.

**Conséquence côté Rust — vérifiée, non supposée** : aucun mécanisme existant ne
permet d'écrire un fichier texte.
- `write_image_file` **rejette tout chemin non-JPEG** (`lib.rs:17-25`, appelé par
  la commande) ;
- `pick_image_file` filtre `jpg/jpeg` (`lib.rs:114-120`) ;
- ni `tauri-plugin-fs` ni `tauri-plugin-dialog` ne sont en dépendance
  (`src-tauri/Cargo.toml:15-20` — et `plugin-dialog` est **explicitement banni**
  par `CLAUDE.md`, bug IPC bloquant reproduit).

→ **Décision : de nouvelles commandes Rust maison** (lecture/écriture/liste dans
le dossier de config app, dialogues `rfd` filtrés `.json`), suivant exactement le
patron des commandes existantes. Ne pas réintroduire `tauri-plugin-dialog`.
Contrainte de sécurité : les commandes de lecture/écriture de presets doivent être
**bornées au dossier de config app** (résolution + vérification de préfixe),
jamais un accès chemin arbitraire piloté depuis le WebView. Import/export
utilisateur passe par un dialogue natif (chemin choisi par l'humain), pas par une
chaîne fournie par le front.

### 3.4 Câblage document

Appliquer un preset = construire un `LayerStack` depuis `apply()` puis passer par
le chemin de commit existant → l'opération est **undoable gratuitement**. La
confirmation avant remplacement d'une pile non vide reste un **plancher dur**
(PRD), en plus de l'undo — pas à la place.

### 3.5 UI

Une carte dockée « Presets », **première du tableau `panels`** et première du
`DockLayout` par défaut. Aucun changement à `PanelColumn`/`DockedPanelCard`/
`dockLayout`. Voir §6 pour l'articulation avec le rail d'icônes.

### 3.6 Profondeur — récapitulatif

| Module | Interface | Implémentation | Verdict |
|---|---|---|---|
| `presetDocument` | 2 fonctions pures | versionnement, dégradation gracieuse, clamp, ids | **profond** ✔ |
| `presetStore` | 7 méthodes IO | adapter Tauri / double mémoire | mince **assumé** (port) ✔ |
| commandes Rust | 4-5 commandes | confinement de chemin, atomicité | mince, symétrique de l'existant ✔ |
| `PresetPanel` | props + callbacks | rendu seul | UI, aucune logique ✔ |

---

## 4. Module map — Double exposure

Le design doc validé fait autorité : **approche (C)** — champs optionnels sur
`LayerState` + extension ciblée du rendu, pas de nouveau type de calque, pas
d'effet « photoOverlay ». Ce qui suit précise les frontières **sous** cette
décision, sans la rouvrir.

### 4.1 Ce qui ne change pas

Le compositing (`blend` + `opacité` + `masque`), le modèle de masque, l'historique,
le pinceau, `LayerPanel`, le registry d'effets. **Un calque sans `imageSource` se
comporte exactement comme aujourd'hui** — zéro régression est un critère
d'acceptation, pas un souhait.

### 4.2 Décision structurante : `LayerState` porte un **identifiant**, pas une texture

Le design doc écrit `imageSource: { bitmap: GPUTexture; sourceId: string }` en
notant lui-même « ou équivalent GPU, **hors state React** (cf. invariant OOM) ».
Ce document tranche ce point ouvert :

> **`LayerState.imageSource` ne contient QUE des données sérialisables
> (`{ sourceId: string }` + le `transform`). La `GPUTexture` vit dans un store
> séparé, hors state React et hors historique.**

Trois raisons, chacune vérifiable :
1. **Invariant OOM (§2.4)** : `LayerState` transite par `setLayers()`. Un handle
   GPU n'est pas volumineux en soi, mais la règle du projet est « pas de donnée
   GPU/pixel dans le state React » — une exception ouvrirait exactement la porte
   refermée par `e3c7584`.
2. **Durée de vie / propriété.** `LayerStack.clone()` copie les objets calque à
   chaque commit et `History` conserve les snapshots. Une `GPUTexture` référencée
   par N snapshots n'a **aucun propriétaire identifiable** : qui la détruit, et
   quand ? Un calque photo supprimé puis restauré par undo doit retrouver une
   texture vivante. Un store à propriétaire unique résout ça ; un handle dans le
   modèle crée un use-after-free latent.
3. **Convergence avec Presets (§3.1)** : `LayerState` doit rester JSON-sérialisable.

**Module à créer : `PhotoSourceStore`** (nom provisoire), interface étroite :

```
register(bitmap: ImageBitmap): string        // -> sourceId, upload GPU en srgbFormat
get(sourceId): GPUTexture | null
dimensions(sourceId): { width, height } | null
dispose(): void                              // au changement de document
```

Profondeur : validation de taille GPU (réutilise `assertImageFitsGpu`), upload
`copyExternalImageToTexture`, propriété exclusive des textures, destruction avec
le document. Propriétaire naturel : la couche `render/`, aux côtés de
`ImageFrameResources` (même cycle de vie, même règles de format). **Ne pas le
placer dans `layers/`** — ce paquet ne doit jamais dépendre de WebGPU.

### 4.3 Où la photo A entre dans le pipeline — **point à confirmer**

Le design doc propose (C1) : un binding conditionnel `hasImageSource` dans
`composeShader`, l'échantillon de photo A remplaçant `color` en entrée de
`fs_main`. Deux problèmes concrets, tous deux prouvés sur le code actuel :

**(a) Les passes internes des effets multi-passes échantillonneraient le fond, pas
la silhouette.** `runInternalPasses` prend `readTexture` (= composite des calques
du dessous) comme entrée de la première passe (`framePipelineExecutor.ts:198-206`,
`effectPassRunner.ts:83-107`). `glow` EST multi-passe (`glow.ts:62`). Un glow
appliqué à un calque photo flouterait donc le fond puis composerait la silhouette
par-dessus — rendu faux, et « pas de rendu filtre Photoshop 2005 » est un critère
dur.

**(b) « Hors bornes = transparent » n'est pas exprimable par l'alpha.** La formule
de compositing actuelle ignore l'alpha de l'effet et ne mixe que le RGB :
`mix(color.rgb, blended, compositing.x * maskValue)` puis `return vec4(..., color.a)`
(`shaderCompose.ts:66-74`, avec un commentaire explicite disant que ce
court-circuit est valide **tant qu'aucun effet ne produit un alpha différent**).
Une zone hors de la photo A rendrait donc du **noir mélangé**, pas du transparent.

Deux variantes possibles, toutes deux **à l'intérieur de l'approche (C) validée** :

- **(C1) binding conditionnel dans la passe de composite** (littéralement le
  design doc). Exige en plus : un terme de **couverture** (`coverage ∈ {0,1}` ou
  antialiasé) injecté dans le poids du mix — `compositing.x * maskValue * coverage`
  — et un traitement séparé du cas multi-passe.
- **(C2) pré-passe de résolution d'entrée du calque** : pour un calque portant
  `imageSource`, une passe dédiée rend photo A transformée dans une texture pleine
  taille (couverture dans le canal alpha), puis **toute la chaîne existante**
  (passes internes → composite → masque → blend) s'exécute inchangée sur cette
  texture. Le changement se concentre dans un seul endroit (« quelle est la
  texture d'entrée de ce calque ? »), `EffectPassRunner` et `shaderCompose`
  restent intacts, et les effets multi-passes fonctionnent correctement sans cas
  particulier.

**Recommandation : (C2)**, pour trois raisons de profondeur de module : une seule
frontière change (`resolveLayerInput(layer) -> GPUTextureView`, testable), aucun
cas particulier ne se diffuse dans l'encodage des passes, et le coût est une
texture transitoire pleine taille par calque photo par frame (à mesurer, §5). Le
terme de couverture reste nécessaire dans les deux variantes.
**Ce point refine le design doc validé sous le niveau où la décision (C) a été
prise — à confirmer explicitement avec Antoine avant `writing-plans`.**

### 4.4 `src/ui/transform.ts` — module pur (profond)

Interface étroite : conversion UV composite → UV photo A par transform inverse, +
clamp/validation des poignées. Implémentation riche : matrice inverse
(translation/échelle/rotation), test d'appartenance aux bornes, cas limites
(identité, échelle minimale non nulle, box non inversée). Aucun accès GPU, aucun
React → testable en isolation, conformément au design doc.

### 4.5 Espace de coordonnées du masque — **conséquence non documentée ailleurs**

`MaskPainter` est alloué aux dimensions de **l'image de base** et le fold produit
une texture masque à la taille de l'image. Donc le masque d'un calque photo vit
dans **l'espace du fond**, pas dans celui de la silhouette.

Conséquence utilisateur directe : **peindre l'isolation puis déplacer/redimensionner
le calque photo ne fait pas suivre le masque** (le sujet glisse sous un masque
resté immobile). Deux réponses possibles :
- **v1 recommandée** : assumer et documenter ce comportement (poser le transform
  d'abord, peindre ensuite) — coût nul, cohérent avec « isolation manuelle v1 ».
- Faire suivre le masque exigerait un second espace de coordonnées de masque
  traversant tout le modèle `mask/` (sources, fold, refine edge, résolution GPU) :
  hors de proportion avec le v1, et hors-scope PRD.

À trancher au PRD/`brainstorming`, pas ici — mais **ne pas le découvrir en
implémentation**.

### 4.6 Round-trip Lightroom

Prédicat pur sur `LayerState[]` (« au moins un calque porte `imageSource` ») qui
bascule l'export vers « Exporter sous », **avec message explicite**. Le point de
décision existe déjà et est centralisé (le drapeau `isLaunchFile` gouverne seul
écrasement vs copie, cf. `exportImage.ts:57-82`) : l'ajout est un ET logique au
même endroit, pas une nouvelle branche disséminée.

### 4.7 UI transform

`TransformHandles` : overlay canvas à poignées, même famille de gestion pointer
que le pinceau/pan-zoom (`pointerdown`/`pointermove`/`pointerup` +
`setPointerCapture`), aucune nouvelle librairie. Visible seulement quand le calque
photo actif est sélectionné. Le composant ne connaît que `transform` + callbacks —
la géométrie vit dans `ui/transform.ts` (§4.4), pas dans le composant.

### 4.8 Profondeur — récapitulatif

| Module | Interface | Implémentation | Verdict |
|---|---|---|---|
| `PhotoSourceStore` (nouveau, `render/`) | 4 méthodes | upload, validation, propriété/durée de vie | **profond** ✔ |
| `ui/transform` (nouveau) | 2-3 fonctions pures | matrices, bornes, clamps | **profond** ✔ |
| résolution d'entrée de calque (dans `render/`) | 1 fonction | pré-passe conditionnelle | **profond** ✔ (variante C2) |
| `LayerState.imageSource`/`transform` | 2 champs optionnels | — | données pures, sérialisables ✔ |
| `TransformHandles` (nouveau, UI) | props + callbacks | hit-test, drag | UI, géométrie déléguée ✔ |

---

## 5. Portée dans les deux sens — extensibilité anticipée

Ce qui suit est **noté, pas conçu** (YAGNI) : aucune abstraction spéculative n'est
demandée aujourd'hui.

- **N sources d'image.** La limite dure « 2 photos max » est une règle **produit**
  (PRD), pas une contrainte du modèle : `imageSource.sourceId` + un store indexé
  supportent N sources sans changement de forme. Conséquence à retenir : **placer
  la limite dans une garde applicative nommée** (une règle vérifiable et
  supprimable), jamais en la codant en dur dans le modèle ou le shader. Le seul
  vrai plafond est le VRAM (§7).
- **Presets partageant plus que des calques** (v2 hypothétique : réglages de
  masque paramétrique, métadonnées). `schemaVersion` dès la v1 est ce qui rend
  cette évolution possible sans casser les fichiers existants. C'est le seul coût
  d'anticipation accepté ici.
- **Persistance de document (`.shaderlab`).** Non demandée. Mais elle serait
  presque gratuite le jour où on la voudra **si et seulement si** `LayerState`
  reste sérialisable (§3.1/§4.2) — argument supplémentaire pour cet invariant, pas
  une feature à construire.
- **Pipeline 16-bit print / export TIFF** (différés `CONTEXT.md`) : le format des
  textures est déjà centralisé (`ctx.srgbFormat`, un seul point de création par
  module de ressources). Ne pas disperser de format en dur dans les nouveaux
  modules (`PhotoSourceStore` inclus) préserve cette porte.

---

## 6. Séquencement Presets ↔ rail d'icônes (`PanelRail`)

Question posée par le PRD. Réponse d'architecture : **il n'y a pas de dépendance
bloquante ; les deux chantiers sont commutables.**

Preuve : le design des panneaux contextuels déclare explicitement `PanelColumn`,
`DockedPanelCard`, `dockLayout` et `dockWidth` **non touchés** — son mécanisme se
borne à filtrer le tableau `panels` en amont et à ajouter un rail. Le contrat de
carte dockée est donc invariant dans les deux ordres :

- **Presets d'abord** → une 4ᵉ entrée dans le tableau `panels` + `"presets"` en
  tête du `DockLayout` par défaut. Quand le rail arrivera, ajouter un item de rail
  et un `useContextualPanel(conditionMet = true, triggerKey = "static")` — même
  câblage que « Calques », delta de quelques lignes.
- **Rail d'abord** → la carte Presets naît directement avec son item de rail et le
  même hook.

Point de vigilance unique dans les deux cas : le **`DockLayout` par défaut** est
une valeur littérale au niveau de la composition root ; y insérer `"presets"` en
tête est la seule modification partagée par les deux chantiers → risque de conflit
de merge trivial, pas un couplage architectural.

---

## 7. Risques architecturaux ouverts

| # | Risque | État | Ce qui le rend acceptable / trigger |
|---|---|---|---|
| R1 | **VRAM à 2 photos.** Un document tient déjà 4 textures pleine taille persistantes (source + ping-pong ×2 + cible d'export paresseuse) ≈ 96 Mo/texture à 24MP, **plus** les textures de masque résidentes par calque. Une 2ᵉ photo ajoute sa propre texture, et la variante (C2) une texture transitoire par calque photo par frame. | **Non mesuré** (PRD : « à mesurer à l'usage réel, pas de budget théorique figé »). | Mesure sur cas réel 24MP + 24MP **avant** de déclarer la feature terminée. Pas de garde-fou numérique en dur en v1 (décision PRD). Si un garde arrive, il se pose dans `PhotoSourceStore` (point unique d'allocation), pas dispersé. |
| R2 | **Invariant OOM étendu à `imageSource`.** Toute régression qui remettrait un handle GPU / un `ImageBitmap` dans `LayerState` ou dans un snapshot d'historique rouvre la classe de bug de `e3c7584`. | Traité par conception (§4.2). | Un test de la logique pure garantissant qu'un calque photo survit à un undo/redo **en ne transportant qu'un `sourceId`** est le meilleur filet (déjà listé au design doc). |
| R3 | **Alpha / couverture du calque photo.** La formule de compositing actuelle ignore l'alpha de l'effet — « hors bornes = transparent » rendrait du noir si on s'appuie sur l'alpha. | Identifié, non traité. | Le terme de couverture doit être **explicite dans le poids du mix**. À valider visuellement (CDP) sur une silhouette plus petite que le fond. |
| R4 | **Effets multi-passes sur calque photo** (§4.3a). | Identifié, non traité. | Tranché par le choix (C1) + cas particulier vs (C2). À confirmer avec Antoine. |
| R5 | **Espace de coordonnées du masque d'un calque photo** (§4.5). | Non documenté au PRD ni au design. | Décision produit à poser avant implémentation (assumer, ou hors-scope explicite). |
| R6 | **`App.tsx` = composition root de 727 lignes** portant ~25 handlers, tous les états UI et tout le câblage. Les deux features y ajoutent chacune un lot de handlers (import 2ᵉ photo, transform, save/apply/rename/export/import de preset) + des entrées de panneau. | Dette réelle, non bloquante aujourd'hui. | **Chaque feature apporte son propre hook module** (ex. `usePhotoLayer`, `usePresets`) qui possède ses handlers et parle à `DocumentSession`, pour qu'`App.tsx` gagne quelques lignes de câblage et non ~150. Aucun refactor préalable exigé. |
| R7 | **Nouvelle surface IPC pour les presets** (lecture/écriture de fichiers non-image). | Nécessaire (§3.3, vérifié : rien d'existant ne le permet). | Commandes maison confinées au dossier de config app (résolution + vérification de préfixe), dialogues natifs pour les chemins choisis par l'humain. Ne pas réintroduire `tauri-plugin-dialog`. |
| R8 | **Fichier de preset = entrée non fiable** (partagé par email/USB, éditable à la main). | À traiter dans `presetDocument.apply`. | Validation de schéma + version + bornes de params, dégradation gracieuse avec avertissement visible. Jamais de parse permissif, jamais d'échec silencieux. |

---

## 8. Ce que ce document ne tranche pas (renvoi explicite)

1. Variante **(C1) vs (C2)** pour l'entrée de la photo A dans le pipeline — §4.3,
   recommandation (C2), **confirmation Antoine requise** (refine un design validé).
2. Comportement du **masque d'un calque photo face au transform** — §4.5.
3. **Presets × calques photo** : exclusion à la capture (recommandé) ou autre —
   §3.2, non couvert par le PRD.
4. Ordre d'exécution Presets / rail d'icônes — §6 : libre, aucune contrainte
   architecturale.
5. Tout le découpage en tranches et l'ordre des tâches → `superpowers:writing-plans`.

---

## 9. AUTO-VÉRIFICATION

Affirmations de ce document et leur preuve (état lu sur disque le 2026-07-25) :

| Affirmation | Preuve |
|---|---|
| `Renderer` est une façade sur 5+ collaborateurs | `src/render/renderer.ts:1-12` (imports), `:148-183` (assemblage) |
| Le pipeline par calque vit dans `FramePipelineExecutor`, pas dans `Renderer` | `src/render/framePipelineExecutor.ts:132-263` |
| Bindings 0-5 déjà attribués, 3/4/5 conditionnels | `src/render/shaderCompose.ts:79-84` |
| La chaîne WGSL est la clé du cache de pipelines | `src/render/shaderCompose.ts:47-52`, `src/render/effectPassRunner.ts:173-192` |
| Le compositing ignore l'alpha de l'effet | `src/render/shaderCompose.ts:66-74` (commentaire explicite) |
| `glow` est multi-passe | `src/render/effects/glow.ts:62` |
| Les passes internes prennent le composite du dessous en entrée | `src/render/framePipelineExecutor.ts:198-206`, `src/render/effectPassRunner.ts:83-107` |
| `MaskPainter` est dimensionné à l'image de base | `src/mask/maskPainter.ts:29-32` |
| `toDisplayLayers` vide les rasters avant le state React | `src/layers/displayProjection.ts:25-39` |
| `clone()` partage les rasters (immuables par convention) | `src/layers/layerStack.ts:223-241` |
| `DocumentSession` sépare `layers()` (complet) et `displayLayers()` (projection) | `src/application/documentSession.ts:17-24` |
| `exportImage` définit déjà des ports testables | `src/export/exportImage.ts:4-11`, `:41-46` |
| `write_image_file` refuse tout chemin non-JPEG | `src-tauri/src/lib.rs:17-25`, `:59-60` |
| Aucun plugin `fs`/`dialog` en dépendance Rust | `src-tauri/Cargo.toml:15-20` |
| `pick_image_file` filtre jpg/jpeg | `src-tauri/src/lib.rs:114-120` |
| `App.tsx` fait 727 lignes et porte tout le câblage | `src/App.tsx:40-727` |
| Le design contextual-panels ne touche pas `PanelColumn`/`dockLayout` | `docs/superpowers/specs/2026-07-24-shaderlab-contextual-panels-design.md` § Hors scope + § Fichiers touchés |
| Approche (C) validée pour la double exposure | `docs/superpowers/specs/2026-07-25-shaderlab-double-exposure-design.md` § Architecture |

Non vérifié / assumé, explicitement : forensics de co-changement git (§0),
consommation VRAM réelle (R1), comportement visuel de la couverture hors-bornes
(R3) — aucun de ces trois points n'est affirmé comme un fait dans ce document.
