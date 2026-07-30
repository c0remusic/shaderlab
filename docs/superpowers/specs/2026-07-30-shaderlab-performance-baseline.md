# Performance — ligne de base mesurée, 2026-07-30

> **Statut : MESURÉE, avant toute optimisation.** Ce document est la RÉFÉRENCE
> contre laquelle tout gain de performance se juge. Aucun chiffre ici n'est
> estimé : chacun vient d'un instrument nommé, sur la vraie fenêtre WebView2.
> Un chiffre qui bouge sans que ce document soit mis à jour est un chiffre qui
> ment.
>
> Déclencheur : Antoine, 2026-07-30 — « l'appli est super lente avec 5 photos ».

## 0. Le fait le plus important : la plainte n'a PAS été reproduite telle quelle

Le profil GPU n'a **jamais vu l'app devenir le limiteur** pendant un déplacement
d'image à 5 calques photo — le geste que la plainte désigne. Deux chemins
réellement saturés ont été trouvés, et ce ne sont pas celui-là :

1. la boucle d'overlay qui tourne **au repos** (§3.1) ;
2. la peinture de masque, seule à saturer (~93 % d'occupation, §3.4).

**Conséquence de méthode : si la lenteur ressentie survient hors de ces deux cas,
une condition manque au montage** — masque à filtre edge-aware actif, toile plus
grande que 26 Mpx, autre machine. À demander à Antoine au moment où il la
ressent, plutôt qu'à la deviner. Ne pas traiter les optimisations ci-dessous
comme « la réponse à la plainte » : ce sont des gaspillages prouvés, ce qui est
autre chose.

## 1. Machines et instruments

RTX 2060 6144 Mo, écran 164 Hz, canvas **6240 × 4160 = 26 Mpx**, 5 photos
distinctes vérifiées par MD5.

| Grandeur | Instrument | Fiabilité connue |
|---|---|---|
| Temps GPU par passe | Timestamp queries WebGPU, feature ajoutée par patch runtime de `requestDevice` (injecté avant le code de l'app, `src/` non modifié) | Quantification Chromium ~0,066 ms |
| Occupation GPU | `\GPU Engine(pid_<gpu process>…engtype_3D)\Utilization Percentage` | Second instrument, concordant |
| VRAM de l'app | `\GPU Process Memory(pid_<gpu process>)\Total Committed` | Voir le piège `nvidia-smi` en `2026-07-28-shaderlab-fond-comme-calque-design.md` §4.5 |
| Temps CPU JS | CDP `Profiler`, échantillonnage 100 µs | Témoin au repos à 97 % d'idle |
| Comptage de rendus React | CDP `Profiler.startPreciseCoverage` | Comptage d'appels V8, exact |
| RAM du process | `Get-Process` WorkingSet64 / PrivateMemorySize64 | Chaque palier mesuré 2× sur état figé, écart < 1 Mo |

**Le `StrictMode` de développement double chaque rendu React** (`src/main.tsx:8`) :
tous les comptages de rendus ci-dessous sont donnés APRÈS division par 2.

## 2. Ligne de base

### 2.1 GPU, déplacement d'une image

| calques photo | passes/frame | GPU p50 | GPU p95 |
|---|---|---|---|
| 1 | 3 | 2,56 ms | 3,34 ms |
| 3 | 7 | 4,78 ms | 6,29 ms |
| 5 | 11 | **6,82 ms** | **9,11 ms** |

**+1,07 ms par calque photo, strictement linéaire.** Structure `2N+1` passes
(pré-passe + composite par calque photo, plus la présentation), recoupée par une
pile mixte 2 photos + 4 Grain = 9 passes. **Le coût n'est PAS quadratique** —
confirmé indépendamment par la lecture d'architecture (aucune boucle imbriquée
sur la pile dans le chemin de frame).

Répartition à 5 calques, 227 frames : composites 3,733 ms (52 %), pré-passes
photo 2,933 ms (41 %), présentation 0,489 ms (7 %). **Aucune passe unique ne
domine** — 10 passes plein canvas de 0,5 à 0,9 ms chacune.

⚠️ L'intervalle rAF mesuré (~19,8 ms) **n'est pas** le temps de frame de l'app :
en faisant varier la cadence d'injection d'entrée, la cadence de frame la suit
sans plafonner (25 Hz → 24 fps ; 47 → 39 ; 65 → 45 ; 103 → 61). Le pilote de
mesure était le limiteur, pas l'app.

### 2.2 CPU, par geste

| geste | ms CPU / pointermove | tâches longues > 50 ms |
|---|---|---|
| curseur de paramètre | **34,2** | 13 |
| déplacer une image | **21,9** | 7 |
| peindre un masque | 7,9 | 2 |

Attribution : **React = 75 % du JS actif** ; le code de `src/` = 2 à 3 %. Aucune
fonction de `src/` dans le top 20 d'un drag ou d'un slider.

**Le chiffre qui décrit la sensation** : 200 événements souris envoyés mettent
**3562 ms** à être absorbés, là où une souris à 125 Hz les produit en 1600 ms.
La file grossit ~2,2× plus vite que le temps réel — ce n'est pas de la lenteur,
c'est un retard qui s'accumule tant que le geste dure.

### 2.3 Mémoire

| | 0 calque | 1 | 3 | 5 |
|---|---|---|---|---|
| Private Bytes (process) | 448 Mo | 1033 | 1346 | **1546** |
| Heap JS | 11,7 Mo | 12,3 | 13,9 | **14,5** |
| VRAM app (`Total Committed`) | 98 Mo | 962 | — | **1504** (+ masque) |

~100 Mo par calque photo au-delà du premier. **Le heap JS reste plat : +2,8 Mo
pour 5 photos.** L'invariant du projet tient — les gros buffers ne passent pas
par le state React (cause du crash OOM résolu en `e3c7584`).

**Anomalie non expliquée** : une session de peinture prolongée (480 échantillons)
fait croître le working set de **+477 Mo, dont un GC forcé ne rend que 82 Mo**,
avec un heap JS immobile (+1,3 Mo). La croissance est donc native/GPU, pas JS.
Non diagnostiquée à ce jour.

## 3. Gaspillages PROUVÉS, classés par temps récupérable

### 3.1 La boucle d'overlay tourne au repos — le seul qui coûte quand on ne fait rien

Après avoir peint un masque, **sans aucune interaction** : 579 puis 581 frames en
3 s (**~193 fps**), 2 passes plein canvas à 1,31 ms chacune, soit **~253 ms de
GPU par seconde d'inactivité**. Second instrument concordant : 25-29 %
d'occupation GPU « au repos ».

Origine : `src/render/overlayAnimationLoop.ts:23`, démarrée en
`src/App.tsx:1343-1346` → `src/render/renderer.ts:439-460`.

Pour l'échelle : une frame complète de geste à 5 calques coûte 6,8 ms. Cette
boucle brûle en permanence l'équivalent d'un tiers d'un geste continu.

### 3.2 Aucun cache de préfixe de pile — hypothèse CONFIRMÉE par la mesure

Pile 1 photo + 5 Grain, glissement du curseur du calque du **haut** vs du **bas** :
**9,90 ms contre 10,42 ms**, 8 passes dans les deux cas. Aucun écart — toute
modification repart de la toile (`src/render/framePipelineExecutor.ts:360`,
boucle `:362-493`).

**L'information d'invalidation existe pourtant déjà** : `computeGuideEpochs`
(`framePipelineExecutor.ts:236-250`) calcule exactement « à partir de quelle
position la chaîne a divergé ». Elle sert au cache SAT du filtre guidé et à rien
d'autre.

⚠️ Précaution nommée avant d'implémenter : le point de coupe ne doit pas tomber
**entre une base photo et les calques écrêtés qui la consomment** — la couverture
est retenue d'itération en itération (`framePipelineExecutor.ts:358, 438-448`) et
n'est pas reconstructible depuis un composite. Coût : +1 texture pleine taille, à
confronter au budget VRAM (le pire cas mesuré est déjà à ~84 %).

### 3.3 Les pré-passes photo re-projettent des transformations inchangées

Test direct : 4 calques photo + un Grain au-dessus, geste = glissement du curseur
de Grain, **aucune photo ne bouge**. Résultat : 10 passes/frame quand même, dont
**5,78 ms sur 7,86 ms (74 %) à re-rendre des calques photo inchangés**, dont
**2,30 ms (29 %) de pure re-projection**.

Aucun test de fraîcheur : `framePipelineExecutor.ts:430` →
`photoLayerInput.ts:190` (passe plein canvas, `loadOp: "clear"`, systématique).

⚠️ **Mettre en cache le RÉSULTAT est explicitement interdit** — la cible est
unique et partagée par tous les calques photo de la frame, et c'est l'ordre des
passes qui rend le partage correct (`photoLayerInput.ts:88-105`, invariant tenu
par un test). La voie n'est donc pas de mémoriser cette passe mais de **ne pas la
produire** : elle n'est nécessaire que si la photo doit exister comme texture
(effet à passes multiples, ou masque edge-aware actif). Sinon, échantillonner la
photo transformée directement dans la passe de composite. Bénéfice secondaire :
le chemin nominal cesse de dépendre de cet invariant.

### 3.4 Un rendu React de l'arbre ENTIER par pointermove

Comptage exact sur 30 `pointermove` (drag prouvé effectif), après division par le
`StrictMode` : **1 rendu complet de l'arbre par événement souris** — ~22
`IconButton` + `Tooltip`, 6 panneaux, 5 cartes dockées.

Trois maillons :
1. `src/hooks/usePhotoLayer.ts:203` — `syncSession()` sur chaque `pointermove`
   BRUT, alors que `requestRender` juste en dessous (`:204`) est coalescé par
   `FrameScheduler`. **Le GPU se protège, React non.**
2. `src/App.tsx:212` — `setLayers(sessionRef.current.displayLayers())`.
3. `src/layers/displayProjection.ts:29` — `toDisplayLayers` réalloue le tableau à
   chaque appel même sans changement. Nouvelle identité → tout consommateur rend.

**Le remède existe déjà dans le repo, à 20 lignes de là** :
`src/components/Canvas.tsx:118` (`schedulePaint` → rAF). C'est la raison mesurée
pour laquelle peindre coûte 7,9 ms/move contre 21,9 au drag.

`LayerRow` est mémoïsé (`src/components/LayerPanel.tsx:144`) et **sa mémoïsation
tient** — zéro rendu de ligne pendant un drag. Le coût est dans le chrome des
panneaux, pas dans la liste.

### 3.5 Le masque entier est retéléversé à chaque frame

Pendant la peinture : `writeTexture` = **24,76 Mo/frame** (le raster 6240×4160
r8unorm complet), à 125 fps ≈ **3,1 Go/s** de transfert CPU→GPU. Seul cas mesuré
où l'app est saturée : intervalle 8,1 ms pour 7,54 ms de GPU, **~93 %
d'occupation** (relevé 2×).

### 3.6 Secondaires, gain plus faible, risque quasi nul

- **Churn d'allocations** : 15 buffers + 11 bind groups créés par frame à 5
  calques (`effectPassRunner.ts:166,181,231`). Les pipelines, eux, sont
  correctement cachés. Le projet a déjà tranché ce type de churn ailleurs
  (`effectPassRunner.ts:65-69`, `timeBuffer` rendu persistant).
- **Clé de cache de pipeline = la source WGSL entière**, recomposée à chaque passe
  (`effectPassRunner.ts:177, 186` ; `shaderCompose.ts:76-185`).
- **Vignette à l'import** : `convertToBlob` ~99 ms sur le fil principal. Le
  décodage JPEG, lui, est bien hors fil principal (`createImageBitmap`).

## 4. Sur-invalidation de cache — LU, non encore mesuré

`maskTextureResolver.ts:259-263` incrémente la révision dès que le `guideEpoch`
change. Or `refine()` (morphologie : feather/contract/smooth, `:922-929`) **ne
consomme pas le guide** ; seul `edge()` le consomme (`:671`), et seulement si
`edgeAware && edgeStrength > 0` — dont le défaut est `false` (`src/mask/types.ts:18`).

`hypothèse:` tout calque à `feather > 0` situé au-dessus du calque manipulé
rejoue sa chaîne de morphologie pleine résolution à chaque frame pour rien.

**Test qui tranche, NON EXÉCUTÉ à ce jour** : 5 calques, un calque du haut à
`feather > 0` et `edgeAware = false`, drag d'un curseur sur un calque du bas,
compter les exécutions de `refine()` par frame (attendu ≥1 par calque concerné
aujourd'hui, 0 après correction). Non exécuté parce que poser cet état demandait
un pilotage du panneau Masque que CDP n'a pas rendu fiable ; **délibérément pas
approximé**.

## 5. Ce qui est propre — à ne pas toucher

- **Coalescing rAF du rendu GPU** (`src/render/frameScheduler.ts:19-28`).
- **Coalescing du pinceau** (`src/components/Canvas.tsx:118`) — c'est le modèle.
- **Granularité des epochs de guide** (`framePipelineExecutor.ts:229-273`) et
  `photoGuideKey` comparant des valeurs et non des identités
  (`src/layers/photoLayer.ts:104-127`).
- **Caches par identité** de `resident`/`parametric` et du fold
  (`maskTextureResolver.ts:367, 399, 280-283`) ; **cache à deux paliers** du
  filtre guidé (`:749-757`).
- **L'overlay qui rejoue une passe sur `lastOverlayFrame`** au lieu de re-résoudre
  les masques (`renderer.ts:439-461`) — bonne décision, ne pas l'annuler en
  corrigeant §3.1.
- **`toDisplayLayers` préservant l'identité des calques** (`displayProjection.ts:26-28`)
  et `projectIsolation` (`src/layers/isolation.ts:72-79`) — sans eux, §3.2 et §3.4
  seraient morts d'avance.
- **`PresentPass` écrivain unique** de la surface finale ; **`PhotoSourceStore`**
  point unique d'allocation.

**`maskTextureResolver.ts` (1023 l) n'est PAS un module shallow** malgré sa
taille : son interface publique est étroite (4 membres) et légitime. C'est un
agrégat de quatre sous-systèmes sans dépendance mutuelle, couplés par un unique
compteur de révision partagé — et ce couplage est exactement §4. La seule
extraction qui gagnerait du temps est celle du filtre guidé ; le reste serait du
rangement.

## 6. Limites de cette ligne de base

- **Tout est mesuré sur le serveur de dev Vite.** Les fonctions dev-only de React
  (`jsxDEV`, double exécution `StrictMode`) pèsent 20 à 30 % du JS actif et
  disparaîtront en production. **Le défaut structurel de §3.4 ne disparaîtra
  pas ; seule son amplitude est surestimée ici.** Une mesure en build de
  production reste à faire.
- **Souris synthétique.** Les événements CDP ne sont jamais coalescés par le
  navigateur ; une souris physique produirait des lots coalescés, donc peut-être
  moins de handlers. Le coût PAR handler (18-34 ms) est identique, et c'est lui
  qui décide.
- **Instance d'app partagée** entre deux agents de mesure pendant la session :
  chaque mesure retenue a été validée dans son propre tour (drag prouvé par
  déplacement de la box, peinture par cible vérifiée, slider par changement de
  valeur). Trois tentatives ont été jetées avant d'aboutir.
- **Le temps GPU du `writeTexture` de §3.5 n'est pas mesuré** — seulement son
  volume. Une copie n'est pas une passe et n'apparaît pas dans les timestamps.
- **La latence entrée→pixel n'est pas mesurée**, et c'est peut-être ce que
  « super lente » décrit réellement.

## 7. Cible de la boucle d'optimisation

Condition de sortie posée le 2026-07-30 : temps de frame médian **< 16,7 ms** et
p95 **< 33 ms** en geste interactif à 5 calques photo, **sans régression de
rendu** (`npm run test:render`, 10 scénarios).

⚠️ La ligne de base GPU (6,82 ms p50 / 9,11 p95) **passe déjà cette cible**. Ce
qui ne la passe pas est le CPU : 21,9 à 34,2 ms par événement souris. La cible
porte donc, de fait, sur le fil principal — et §3.1 conditionne tout le reste,
puisqu'un GPU occupé à 25-29 % au repos pénalise chaque frame.

**Ce que « comme Photoshop » ne peut pas vouloir dire ici.** Vérification sur
sources faite le 2026-07-30 : le traitement par tuiles de Photoshop est documenté
(SDK plug-in, préférence Cache Tile Size), et un cache d'image à 8 niveaux est
documenté par Adobe **comme accélérateur de redraw écran**. En revanche, « le
composite est calculé à la résolution d'affichage » ne repose sur AUCUNE source
Adobe (seulement un message de forum d'un ex-ingénieur identifié), et « ne
recalcule que la région visible » n'a **aucune source du tout**. Ce qui est
documenté chez les voisins : Capture One règle explicitement l'aperçu sur la
résolution écran, Krita assume un aperçu réduit avec un « pop » en fin de tracé,
Lightroom réserve netteté et réduction de bruit aux aperçus 1:1. **Adopter ce
compromis se paierait en fidélité de l'aperçu — ce que le projet a explicitement
refusé (un seul pipeline, résolution native).** À ne rouvrir qu'avec un chiffre :
« il manque X ms, les voilà ».
