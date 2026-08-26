# ARCHITECTURE — shaderlab

> Document d'architecture racine. Décrit **l'état réel du système** et **les
> frontières de modules visées** pour les deux features cadrées au `PRD.md` :
> **Presets** et **Double exposure**.
>
> ⚠️ **DÉCISION PRODUIT DU 2026-07-31 (Antoine)** : *un effet ne se pose JAMAIS
> sur un calque photo ; un effet est un calque à part, écrêté à la photo.* Elle
> répond à la confirmation que le § 4.3 attendait, en sens inverse de ce qu'il
> recommandait, et clôt **R4** (§ 7) et le **point 1 du § 8**. Encadré daté en
> tête du § 4.3 — texte d'origine conservé. La pré-passe (C2) n'est PAS déposée.
>
> ⚠️ **AMENDEMENT DU 2026-08-21 — L'ÉCRÊTAGE N'EXISTE PLUS**
> ([ADR-0020](.claude/decisions/ADR-0020-retrait-de-l-ecretage.md), retrait sec).
> La décision ci-dessus reste ACTIVE (c'est ADR-0008) ; seule sa formulation
> vieillit : un effet est un calque à part **posé AU-DESSUS** de la photo. Partout
> où ce document dit « écrêté à la photo », lire cela. Et partout où il dit que le
> **binding 6** (`coverageTexture`) est partagé entre le calque photo et
> l'écrêtage — § 1.3 et § 9.2 point 3 — il n'a plus qu'un fournisseur, le calque
> photo lui-même : l'exclusion mutuelle levée en erreur par `composeShader` est
> partie avec l'option. Rien d'autre du § 4.3 ne bouge.
>
> ⚠️ **Le § 9 AUTO-VÉRIFICATION a été RÉ-EXÉCUTÉ EN ENTIER le 2026-07-31** sur
> l'arbre de `ba81271` : chaque fichier qu'il cite est recompté, chaque plage de
> lignes rouverte, et trois de ses affirmations sont tombées (§ 9.3). Le § 4.6
> (2026-07-30, dépose du round-trip) et R6 (2026-07-30, compte de lignes réel)
> avaient été revus avant.
>
> **Tout le reste du corps date encore du 2026-07-25 et n'a PAS été
> revérifié** — en particulier la table de bindings du § 1.3 et les défauts (a)
> et (b) du § 4.3, que le § 9 signale désormais comme périmés. Un chiffre ou un
> chemin cité hors du § 9 peut avoir dérivé : R6 annonçait 727 lignes pour un
> fichier qui en faisait 1953, soit un facteur 2,7, et rien ne le signalait.
> Avant de fonder une décision sur une valeur de ce document, la recompter, et
> rejouer le § 9 EN ENTIER à la prochaine passe qui touche ce fichier — pas
> seulement le paragraphe édité.
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
      Coquille Rust   │ src-tauri/src/lib.rs                │  IPC : 17 commandes
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
   │  src/App.tsx  — COMPOSITION ROOT (compte de lignes : §7 R6)          │
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
| `EffectPassRunner` | encodage d'UNE passe : uniforms, bind group, cache de pipelines — **et pool des cibles de passe interne** (2026-08-02) | `effectPassRunner.ts` (`runEffectPass`, `acquirePassTarget`, `releaseFrameTargets`) |
| `shaderCompose` | composition de la chaîne WGSL — **la chaîne EST la clé de cache** | `shaderCompose.ts:47-96` |
| `MaskTextureResolver` | résidence + résolution des textures de masque (fold, refine edge, edge-aware) | `renderer.ts:169-176` |

Les trois interfaces `FrameResourcesPort` / `EffectPassesPort` / `MaskTexturesPort`
(`framePipelineExecutor.ts:9-57`) sont des **ports explicites** : l'exécuteur de
frame est testable en isolation avec des doubles
(`test/render/framePipelineExecutor.test.ts` existe). C'est la frontière de test
la plus utile de la couche rendu — toute extension du pipeline doit la préserver.

⚠️ **`EffectPassesPort` porte `releaseFrameTargets()` depuis le 2026-08-02**, et
la propriété qu'il faut connaître avant d'y toucher : les cibles de passe interne
sont **prêtées par un pool**, plus créées par frame. L'exécuteur ne doit donc
JAMAIS détruire la texture que `runInternalPasses` lui rend — il la remettrait au
pool morte, et la frame suivante la réutiliserait.

Ce défaut a été livré puis corrigé le même jour, et la façon dont il a échappé
aux 27 scénarios de `npm run test:render` est à retenir : une erreur de
validation WebGPU est **asynchrone**, elle ne lève pas et n'échoue aucun test —
le GPU jette le travail et le canvas reste figé. Surtout, **le harnais rend
chaque scénario sur un renderer NEUF** : il n'exerce jamais la réutilisation
d'une frame à la suivante, la seule situation où le bug existe. Toute mécanique
de réutilisation inter-frame se teste donc sur le PORT (qui détruit quoi), pas
sur les pixels.

**Contrat de bindings du groupe 0** — ⚠️ **table de l'état du 2026-07-25,
PÉRIMÉE.** Recomptée le 2026-07-31 (§ 9.2) : un **binding 6** (`coverageTexture`,
calque photo — et l'écrêtage jusqu'au 2026-08-21, ADR-0020) existe depuis, et la
formule de compositing ne se contente plus de mélanger le RGB. Lire `shaderCompose.ts:77-107` et `:166-172`
avant de s'appuyer sur ce qui suit ; la table n'a pas été réécrite ici, cette
passe ne couvrait que le § 9.

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

> ⚠️ **DÉPASSÉ SUR SON MOTIF par la décision produit du 2026-07-31 (Antoine).**
> Rien n'est effacé ci-dessous : le texte d'origine (2026-07-25) reste lisible
> tel quel, c'est l'ajout daté qui porte la correction.
>
> **La confirmation demandée par la dernière ligne de cette section est
> arrivée, et elle va dans l'autre sens.** Ce que cette section cherchait à
> rendre possible — « un effet appliqué à un calque photo » — est désormais
> **interdit par le produit** : *un effet ne se pose JAMAIS sur un calque photo ;
> un effet est un calque à part, écrêté à la photo.* L'affordance inverse
> existait dans l'UI et rendait un **écran noir**, constaté en usage réel.
>
> **Ce que ça ne change PAS : la pré-passe (C2) reste nécessaire et reste en
> place.** Elle ne sert pas seulement à « faire marcher un effet sur une
> photo » : elle répond à la question « quelle est la texture d'ENTRÉE de ce
> calque photo ? », et cette question se pose pour la fusion, le masque, et la
> double exposition par empilement de calques photo. `PhotoLayerInputResolver`
> alimente le compositing et la couverture par `imageSourceView`
> (`render/framePipelineExecutor.ts` : `resolve()`, puis `imageSourceView`
> passé à `runEffectPass`) — aucune ligne n'en est retirée.
>
> **La seule conséquence de code**, signalée et NON déposée : sur un calque
> photo, `effect.passes?.length` est désormais toujours faux (`passthrough`
> n'a pas de passes internes), donc la branche `runInternalPasses` n'est plus
> atteignable par ce chemin et l'affectation
> `effectInputSourceView = resolved.createView()` n'a plus de consommateur pour
> un calque photo. Le défaut (a) ci-dessous — « un glow flouterait le fond au
> lieu de la silhouette » — devient donc sans objet par le PRODUIT, après
> l'avoir été par (C2). Rien n'est supprimé : l'invariant d'ordre des passes et
> la variable elle-même restent utilisés par les calques d'effet.
>
> Où vit la décision, dans le code : `LayerStack.setLayerEffect` refuse un
> calque portant `imageSource` (`src/layers/layerStack.ts`), en miroir exact de
> `setLayerClip` qui refuse déjà le symétrique ; l'interface ne propose plus le
> sélecteur (`layerControlsModel.effectSelectable`, `LayerControls`).
>
> Conséquence sur le reste de ce document : **R4** (§ 7) et le **point 1 du
> § 8** sont clos par cette décision, dans un sens que ni l'un ni l'autre
> n'anticipait.

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

### 4.6 Round-trip Lightroom — DÉPOSÉ (2026-07-30)

Cette section décrivait le point de bascule écrasement-vs-copie de l'export : un
drapeau `isLaunchFile`, posé quand le document venait d'un argument de
lancement, croisé avec un prédicat sur `LayerState[]` pour désactiver le
round-trip sur un composite.

Le mécanisme est **retiré**, décision [ADR-0002](.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md).
Ce qu'il faut en retenir aujourd'hui :

- **L'export n'a plus qu'un seul mode.** `resolveExportTargetAsync` rend
  TOUJOURS un chemin libre dérivé de la source (`export/exportImage.ts`) ; il
  n'a plus de paramètre pour demander autre chose. La règle copie-seulement n'a
  plus de cas particulier, donc plus de point de bascule à centraliser.
- **Ouvrir un fichier passé en argument survit** (`get_launch_path`,
  `src/launch.ts`) — c'est « Ouvrir avec » de Windows, une affordance de
  n'importe quelle app de bureau. Ce qui est déposé est la sémantique
  d'ÉCRASEMENT de ce fichier, pas la capacité de l'ouvrir. Un document ouvert
  ainsi est un document comme un autre.
- **`hasImportedPhotoLayer` (`src/layers/photoLayer.ts`) NE part pas avec.** Il
  est né pour ce croisement, mais il a acquis un second appelant depuis, et
  celui-ci n'a rien à voir avec l'export : `presets/presetDocument.ts:capture`
  décide par ce prédicat quand l'exclusion des calques photo d'un preset mérite
  d'être signalée (T5, design 2026-07-28 §2.3). Le prédicat porte la définition
  « ce document est-il encore la retouche de CETTE photo-là ? », qui survit à
  l'export ; ses tests aussi. Le supprimer en croyant achever la dépose
  casserait la frontière de l'avis des presets.

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

- **N sources d'image.** La limite dure sur le nombre de photos est une règle
  **produit** (PRD : 2 photos max ; portée à `MAX_PHOTO_LAYERS = 5` calques
  photo **fond compris**, soit 4 imports + le fond, `src/layers/photoLayer.ts:66`
  — cette ligne a porté « = 4 calques photo + le fond » jusqu'au 2026-08-11,
  formulation devenue fausse quand `26ab0ed` a fait du fond un calque
  ordinaire), pas une
  contrainte du modèle : `imageSource.sourceId` + un store indexé
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
| R1 | **VRAM à N photos** (rédigé à 2 photos ; plafond à `MAX_PHOTO_LAYERS = 5` calques photo **fond compris**, soit 4 imports + le fond). Un document tient déjà 4 textures pleine taille persistantes (source + ping-pong ×2 + cible d'export paresseuse) ≈ 96 Mo/texture à 24MP, **plus** les textures de masque résidentes par calque. Une 2ᵉ photo ajoute sa propre texture, et la variante (C2) une texture transitoire par calque photo par frame. | ✅ **MESURÉ**, deux fois — et c'est la mesure qui a FIXÉ le plafond. Re-mesuré le 2026-07-30 avec une toile de 64 Mpx (le plafond de `MAX_CANVAS_PIXELS`) : **6 calques a été essayé pour de vrai et écarté** — nominal bon marché (+82 Mo, aucun `device.lost`), mais le pire cas des sources, qui est celui qui décide parce que `MAX_REGISTERED_PHOTO_SOURCES` en dérive, monte à **~89 % de la VRAM** (4386 Mo à 23 sources) contre **~84 %** à 5 calques (4108 Mo), au-delà du seuil de 80 %. ⚠️ Cette cellule a porté « **Non mesuré** » jusqu'au 2026-08-11. | Le critère de révision et le protocole vivent sur la constante elle-même (`src/layers/photoLayer.ts`, en-tête) — les y lire, pas les réinventer ici. Deux pièges y sont écrits : une mesure qui n'atteint que le nouveau plafond de CALQUES ne prouve rien, elle doit saturer les SOURCES au plafond dérivé ; et ce plafond ne peut monter qu'en même temps que `MAX_CANVAS_PIXELS` descend, les deux étant couplées par le même pire cas. La mesure exige une vraie fenêtre WebView2 avec GPU. |
| R2 | **Invariant OOM étendu à `imageSource`.** Toute régression qui remettrait un handle GPU / un `ImageBitmap` dans `LayerState` ou dans un snapshot d'historique rouvre la classe de bug de `e3c7584`. | Traité par conception (§4.2). | Un test de la logique pure garantissant qu'un calque photo survit à un undo/redo **en ne transportant qu'un `sourceId`** est le meilleur filet (déjà listé au design doc). |
| R3 | **Alpha / couverture du calque photo.** La formule de compositing actuelle ignore l'alpha de l'effet — « hors bornes = transparent » rendrait du noir si on s'appuie sur l'alpha. | Identifié, non traité. | Le terme de couverture doit être **explicite dans le poids du mix**. À valider visuellement (CDP) sur une silhouette plus petite que le fond. |
| R4 | **Effets multi-passes sur calque photo** (§4.3a). | ~~Identifié, non traité.~~ **CLOS le 2026-07-31 — sans objet.** | ~~Tranché par le choix (C1) + cas particulier vs (C2). À confirmer avec Antoine.~~ La confirmation est arrivée et retire le cas d'usage : **un effet ne se pose jamais sur un calque photo** (décision produit, voir l'encadré du §4.3). Un calque photo est `passthrough` de bout en bout, garde posée dans `LayerStack.setLayerEffect`. Il n'y a donc plus d'effet multi-passe à faire tenir sur une photo. La pré-passe (C2) reste en place pour l'entrée du calque photo — elle n'était pas là que pour ce risque. |
| R5 | **Espace de coordonnées du masque d'un calque photo** (§4.5). | Non documenté au PRD ni au design. | Décision produit à poser avant implémentation (assumer, ou hors-scope explicite). |
| R6 | **`App.tsx` = composition root de 1823 lignes** (mesuré `wc -l` le 2026-07-30 ; **727 au moment où cette ligne a été écrite le 2026-07-25** — la dette a été multipliée par 2,7 en cinq jours, ce que le chiffre périmé masquait), portant ~25 handlers, tous les états UI et tout le câblage. | **Dette réelle, aggravée, partiellement traitée.** L'audit pré-release du 2026-07-30 l'a mesurée à 1953 lignes ; l'extraction de `usePresetWorkflow` en a retiré 130. Le fichier n'a AUCUNE couverture unitaire (`test/App.test.ts` = placeholder, par convention projet), donc ces ~1800 lignes n'ont pour filet que le checkpoint visuel humain. | **Chaque feature apporte son propre hook module** (`usePhotoLayer`, `usePresets`, `usePresetWorkflow`) qui possède ses handlers et parle à `DocumentSession`, pour qu'`App.tsx` gagne quelques lignes de câblage et non ~150. **Le remède n'a pas suffi seul** : il ne s'applique qu'aux features neuves et ne rembourse pas l'existant. Prochains candidats à l'extraction, par volume : les cinq `<Dialog>`, l'échantillonnage colorimétrique, l'application de preset (`applyPreset`/`requestApplyPreset`). |
| R7 | **Nouvelle surface IPC pour les presets** (lecture/écriture de fichiers non-image). | Nécessaire (§3.3, vérifié : rien d'existant ne le permet). | Commandes maison confinées au dossier de config app (résolution + vérification de préfixe), dialogues natifs pour les chemins choisis par l'humain. Ne pas réintroduire `tauri-plugin-dialog`. |
| R8 | **Fichier de preset = entrée non fiable** (partagé par email/USB, éditable à la main). | À traiter dans `presetDocument.apply`. | Validation de schéma + version + bornes de params, dégradation gracieuse avec avertissement visible. Jamais de parse permissif, jamais d'échec silencieux. |

---

## 8. Ce que ce document ne tranche pas (renvoi explicite)

1. ~~Variante **(C1) vs (C2)** pour l'entrée de la photo A dans le pipeline — §4.3,
   recommandation (C2), **confirmation Antoine requise** (refine un design validé).~~
   **CLOS le 2026-07-31.** (C2) était déjà implémentée (§ 9.3 point 2) ; la
   confirmation demandée est arrivée et porte plus loin que la variante : *un
   effet ne se pose jamais sur un calque photo, un effet est un calque à part
   écrêté à la photo.* Voir l'encadré du § 4.3 pour ce que ça retire (le cas
   d'usage) et ce que ça garde (la pré-passe de résolution d'entrée).
2. Comportement du **masque d'un calque photo face au transform** — §4.5.
3. **Presets × calques photo** : exclusion à la capture (recommandé) ou autre —
   §3.2, non couvert par le PRD.
4. Ordre d'exécution Presets / rail d'icônes — §6 : libre, aucune contrainte
   architecturale.
5. Tout le découpage en tranches et l'ordre des tâches → `superpowers:writing-plans`.

---

## 9. AUTO-VÉRIFICATION

**Ré-exécuté EN ENTIER le 2026-07-31**, sur l'arbre de travail du commit
`ba81271` (`git log -1 --format=%H` → `ba8127128dbea82fb341ab1190a9c231b2ef1d29` ;
`git status --short` vide au moment de la mesure, donc les fichiers mesurés sont
bien ceux de ce commit — le commit qui porte ce texte ne touche que ce fichier-ci).

La passe précédente datait du 2026-07-25. **Aucune de ses plages de lignes n'a
survécu intacte** et trois de ses affirmations sont tombées (§ 9.3). Chaque plage
ci-dessous a été ROUVERTE, pas seulement décalée.

### 9.1 Taille réelle des fichiers cités par ce paragraphe

```
$ wc -l src/render/renderer.ts src/render/framePipelineExecutor.ts \
        src/render/shaderCompose.ts src/render/effectPassRunner.ts \
        src/render/effects/glow.ts src/render/imageFrameResources.ts \
        src/mask/maskPainter.ts src/layers/displayProjection.ts \
        src/layers/layerStack.ts src/application/documentSession.ts \
        src/export/exportImage.ts src/App.tsx \
        src-tauri/src/lib.rs src-tauri/Cargo.toml \
        docs/superpowers/specs/2026-07-24-shaderlab-contextual-panels-design.md \
        docs/superpowers/specs/2026-07-25-shaderlab-double-exposure-design.md
  585 src/render/renderer.ts
  573 src/render/framePipelineExecutor.ts
  185 src/render/shaderCompose.ts
  238 src/render/effectPassRunner.ts
   99 src/render/effects/glow.ts
  130 src/render/imageFrameResources.ts
  119 src/mask/maskPainter.ts
   74 src/layers/displayProjection.ts
  581 src/layers/layerStack.ts
   83 src/application/documentSession.ts
  201 src/export/exportImage.ts
 1823 src/App.tsx
  499 src-tauri/src/lib.rs
   24 src-tauri/Cargo.toml
  220 docs/…/2026-07-24-shaderlab-contextual-panels-design.md
  175 docs/…/2026-07-25-shaderlab-double-exposure-design.md
 5609 total
```

Deux comptes de lignes seulement sont écrits ailleurs dans ce document, et les
deux sont justes : `DocumentSession` = **83 lignes** (§ 1.2) et `App.tsx` =
**1823** (R6, § 7). Le schéma du § 1 ne porte plus de compte du tout — il renvoie
à R6, pour qu'il n'existe qu'un seul endroit à mettre à jour. C'est la
duplication, pas la mesure, qui avait laissé « 727 » vivre cinq jours de trop.

### 9.2 Affirmations et preuves recomptées

| Affirmation | Preuve, rouverte le 2026-07-31 |
|---|---|
| `Renderer` est une façade sur 5+ collaborateurs | `src/render/renderer.ts:1-19` (imports — 19, pas 12). Assemblage en DEUX endroits, plus un seul : `:147-181` (constructeur → `ImageFrameResources`, `PresentPass`) et `:287-344` (`allocateDocument` → `EffectPassRunner`, `MaskTextureResolver`, `PhotoSourceStore`, `PhotoLayerInputResolver`, `FramePipelineExecutor`) |
| Le pipeline par calque vit dans `FramePipelineExecutor`, pas dans `Renderer` | `src/render/framePipelineExecutor.ts:275-553` (`runFrame`) ; la boucle par calque elle-même est `:362-493` |
| Le groupe 0 va jusqu'au binding **6**, 3/4/5/6 conditionnels | `src/render/shaderCompose.ts:166-172` (header émis), `:77-107` (construction conditionnelle, dont `coverageBinding` `:105-107`) ; côté layout GPU `src/render/effectPassRunner.ts:189-197` |
| La chaîne WGSL est la clé du cache de pipelines | `src/render/shaderCompose.ts:70-75` (contrat, en toutes lettres), `src/render/effectPassRunner.ts:177` (composition) et `:186-206` (get/set du cache sur cette chaîne) |
| `glow` est multi-passe | `src/render/effects/glow.ts:63` (`passes:`) |
| `MaskPainter` est dimensionné à l'image de base | `src/mask/maskPainter.ts:29-32` (plage inchangée). Unique site de construction : `src/mask/maskPainterSync.ts:43` — ce n'est plus `App.tsx`, contrairement à ce qu'écrit le § 1.4 |
| `toDisplayLayers` vide les rasters avant le state React | `src/layers/displayProjection.ts:46-62` (`stripRasters`) et `:64-74` (`toDisplayLayers`). Mémoïsé par `WeakMap` depuis le 2026-07-30 : la projection est stable PAR IDENTITÉ, ce que le § 1.1 ne dit pas |
| `clone()` partage les rasters (immuables par convention) | `src/layers/layerStack.ts:562-580` |
| `DocumentSession` sépare `layers()` (complet) et `displayLayers()` (projection) | `src/application/documentSession.ts:17-23` |
| `exportImage` définit déjà des ports testables | `src/export/exportImage.ts:19-33` (`ExportedFrame`, `FrameRenderer`, `ImageWriter`), `:66-68` (`PathAvailability`) |
| `write_image_file` refuse tout chemin non-JPEG | `src-tauri/src/lib.rs:20-23` (`is_jpeg_path`), `:74-78` (le refus lui-même) |
| Aucun plugin `fs`/`dialog` en dépendance Rust | `src-tauri/Cargo.toml:15-20` (plage inchangée : `serde_json`, `serde`, `tauri` sans features, `rfd`, `percent-encoding`) |
| `pick_image_file` filtre jpg/jpeg | `src-tauri/src/lib.rs:117-123` |
| `App.tsx` = **1823 lignes** et porte tout le câblage | `src/App.tsx:76-1823` — `export default function App()` ouvre en 76 et le fichier se ferme sur son accolade |
| La surface IPC compte **17** commandes, pas 9 | `src-tauri/src/lib.rs:327-345` (`generate_handler!`) ; 17 occurrences de `#[tauri::command]` dans le fichier |
| Le design contextual-panels ne touche pas `PanelColumn`/`dockLayout` | `docs/…/2026-07-24-shaderlab-contextual-panels-design.md:48-54` (§ Périmètre, « Hors scope ») et `:193-194` (§ Fichiers touchés, « Non touchés »). Le titre « § Hors scope » cité en 2026-07-25 n'existe pas comme section : c'est un intertitre DANS § Périmètre |
| Approche (C) validée pour la double exposure | `docs/…/2026-07-25-shaderlab-double-exposure-design.md:19-54` (§ Architecture) |

### 9.3 Affirmations du 2026-07-25 qui NE TIENNENT PLUS

Elles ne sont pas corrigées en silence : elles sont écrites comme tombées, avec
ce qui les a démenties.

1. **« Le compositing ignore l'alpha de l'effet »** (preuve d'alors :
   `shaderCompose.ts:66-74`, « commentaire explicite »). **Faux depuis.** Le
   compositing fait un source-over Porter-Duff complet — `srcAlpha` = opacité ×
   masque peint × couverture, puis `outAlpha = srcAlpha + backdropAlpha × (1 −
   srcAlpha)` (`shaderCompose.ts:130-160`). Le commentaire `:137-141` déclare en
   toutes lettres que le court-circuit précédent est retiré. Conséquence :
   **R3** (§ 7) est traité, plus seulement identifié, et le raisonnement du
   § 4.3 (b) ne porte plus sur le code courant.

2. **« Les passes internes prennent le composite du dessous en entrée »**
   (preuve d'alors : `framePipelineExecutor.ts:198-206`). **Vrai uniquement pour
   un calque SANS `imageSource`.** La variante (C2) recommandée au § 4.3 a été
   implémentée : un calque photo reçoit la texture de la pré-passe
   (`PhotoLayerInputResolver`) comme entrée d'effet et de passes internes —
   `framePipelineExecutor.ts:411-433` puis `:450-458` — tandis que l'entrée du
   composite reste le composite du dessous (`:460-468`, commentaire explicite).
   Conséquence : **R4** est tranché en faveur de (C2), et le § 4.3 continue de
   présenter ses défauts (a) et (b) comme « prouvés sur le code actuel » alors
   qu'ils ne le sont plus.

3. **« Bindings 0-5, 3/4/5 conditionnels »**. Un **binding 6**
   (`coverageTexture`) existe. Il était PARTAGÉ par le calque photo et
   l'écrêtage, avec une exclusion mutuelle levée en erreur par `composeShader` ;
   depuis ADR-0020 (2026-08-21) il n'a plus qu'un fournisseur, le calque photo,
   et la levée est partie avec l'option. La
   table du § 1.3 n'a PAS été réécrite : cette passe ne couvrait que le § 9, donc
   la table porte un avertissement de péremption et renvoie ici.

Un quatrième point, hors table mais découvert par le recompte de `lib.rs` : le
§ 3.3 affirme « aucun mécanisme existant ne permet d'écrire un fichier texte ».
**C'était vrai le 2026-07-25 et ne l'est plus** — `write_preset`, `read_preset`,
`export_preset`, `import_preset` existent (`src-tauri/src/lib.rs:220-292`,
confinement d'id `:180-196`). La décision du § 3.3 a donc été exécutée ; sa
justification, elle, se lit maintenant au passé.

### 9.4 Ce que cette passe n'a PAS vérifié

- Le corps des §§ 0 à 8, en dehors des seules plages citées par ce paragraphe.
  Le § 1.3 et le § 4.3 sont explicitement signalés comme périmés ci-dessus ; les
  autres n'ont été ni confirmés ni infirmés.
- Forensics de co-changement git (§ 0) — toujours non réalisée.
- Consommation VRAM réelle (R1) — toujours non mesurée.
- Comportement visuel de la couverture hors-bornes (R3) : le CODE a changé
  (point 1 ci-dessus), la vérification à l'œil sur GPU n'a pas été refaite ici.
