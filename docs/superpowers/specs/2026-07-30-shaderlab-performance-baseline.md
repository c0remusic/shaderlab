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

## P0 — mesure en build de PRODUCTION (2026-07-30, après-midi)

> Les chiffres des §1 à §7 ci-dessus ne bougent pas : ils sont la ligne de base,
> mesurée sur le serveur de dev. Cette section les complète, elle ne les corrige
> pas. Aucun fichier de `src/` n'a été modifié pour l'obtenir.

### P0.1 Verdict

**La cible est tenue en production. Oui, sans réserve.** Condition de sortie §7 :
médian < 16,7 ms, p95 < 33 ms. Le pire des trois gestes coûte **6,9 ms de CPU par
événement souris**, soit **2,4× sous la cible**, et **aucune tâche longue > 50 ms
n'a été observée** sur les six mesures de geste en production.

La limite §6 — « une mesure en build de production reste à faire » — est levée.

**Conséquence pour le plan** : la boucle d'optimisation P1-P5 n'a plus de
justification par la cible. Les gaspillages de §3 restent réels et prouvés, mais
ce sont désormais des gaspillages, pas un problème de fluidité. À rouvrir
seulement si Antoine ressent encore la lenteur — et alors avec la condition
manquante nommée (§0), pas en optimisant à l'aveugle.

### P0.2 Montage — comment la production a été rendue mesurable

**Build** : `npm run tauri build -- --no-bundle` → `src-tauri/target/release/shaderlab.exe`
(profil `release`, 2 min 14 s ; `--no-bundle` évite les installeurs, sans effet
sur le binaire). C'est le vrai produit, pas un `dist/` servi en statique : les
commandes Rust restent jointes par leur chemin normal. Lancé avec
`WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222` — cet argument
va à la WebView2 elle-même, il ne dépend d'aucune option Tauri et fonctionne donc
en `release`.

**Preuve que c'est bien une production** : `typeof window.__shaderlabDebug` rend
`"undefined"` (il rend `"object"` en dev) et l'URL est `http://tauri.localhost/`
et non `http://localhost:1420/`. Ce pont est gardé par `import.meta.env.DEV`
(`src/App.tsx:567`) : son absence prouve que le drapeau valait `false` à la
compilation — le même drapeau qui sélectionne React de production, donc ni
`jsxDEV`, ni double rendu de `StrictMode`.

**Le point dur, et sa solution.** Sans ce pont, ni `openByPath` ni
`importPhotoByPath`. Deux chemins ont été trouvés, tous deux hors `src/` :

1. **Ouvrir un document** — `DragEvent` HTML5 synthétique sur `.canvas-stage`
   (`src/components/Canvas.tsx:166`), avec un `File` construit à partir des octets
   rendus par la commande Rust `read_image_file`, appelée directement via
   `window.__TAURI_INTERNALS__.invoke` — présente en production, ce n'est pas du
   code de debug. Les photos sont donc les VRAIES, pas des images de synthèse.
2. **Importer les calques photo 2 à 5** — menu Fichier → « Importer une 2e photo »,
   qui ouvre le dialogue natif `rfd`. Ce dialogue est une fenêtre `#32770` du
   process `shaderlab.exe` : on y écrit par `WM_SETTEXT` dans son champ `Edit`,
   puis on valide par `BM_CLICK` sur `IDOK`. Script :
   `scratchpad/p0-type.ps1`.

⚠️ **Deux instruments cassés rencontrés en chemin, notés pour ne pas les refaire**
(cas d'école de NG90 — vérifier l'instrument avant le sujet) :
- `SendKeys` a échoué **deux fois** : les frappes partent dans l'application qui a
  le focus (elles sont parties dans Chrome, puis dans la fenêtre de l'agent), et
  même focus obtenu elles n'atterrissaient pas dans le champ « Nom du fichier ».
  `WM_SETTEXT` ne dépend d'aucun focus et n'a pas cette course.
- `GetWindowText` rend une chaîne **vide** pour un contrôle appartenant à un AUTRE
  process (comportement documenté) : le témoin « le champ est-il rempli ? » a
  déclaré échouée une écriture parfaitement réussie. Le bon appel est
  `SendMessage(WM_GETTEXT)`, qui est marshallé entre processus.
- Trajectoire de drag en multiple ENTIER de 2π : l'image revient exactement à son
  point de départ et le témoin « la box a-t-elle bougé ? » déclare « SANS EFFET »
  un drag qui a bel et bien eu lieu. Utiliser 1,75π ou 5,75π.

**Protocole** : identique à §2.2 (`Profiler` CDP à 100 µs, `PerformanceObserver`
longtask, 60 `pointermove` injectés à ~16 ms), 5 calques photo, 5 photos
DISTINCTES vérifiées par MD5 (`DSCF5152` à `5156`, empreintes toutes différentes),
toile 6240×4160 = 26,0 Mpx, même machine, même session, `Page.reload` avant chaque
run pour partir d'un état identique. Script : `scratchpad/p0-mesure.mjs`.

### P0.3 Résultats — dev contre production

Le **contrôle dev** est une reprise des trois gestes avec le harnais ci-dessus
(donc le MÊME instrument que la colonne production), tourné dans la même session,
juste avant/après les runs de production.

| geste | dev, §2.2 après correctifs | dev, contrôle même harnais | **prod, run 1** | **prod, run 2** |
|---|---|---|---|---|
| déplacer une image | 20,4 ms · 0 longue | 30,8 ms · 3 longues | **6,9 ms · 0** | **7,6 ms · 0** |
| curseur de paramètre | 21,3 ms · 0 à 1 | 28,4 ms · 4 longues | **5,8 ms · 0** | **6,0 ms · 0** |
| peindre un masque | 6,0 à 6,7 ms · 1 | 10,5 ms · 2 longues | **4,9 ms · 0** | **4,5 ms · 0** |
| témoin au repos, JS actif sur 2 s | — | 145,8 ms | **48,5 ms** | **27,4 ms** |

Sorties brutes : `scratchpad/p0-PROD.log`, `p0-PROD2.log`, `p0-DEV5.log`.

**Facteur 4,2× sur le drag, 4,7× sur le curseur, 2,3× sur la peinture** contre le
contrôle dev. Contre la ligne de base publiée (colonne 1), le facteur est de 3,0×
et 3,6× — le verdict ne dépend pas de laquelle des deux colonnes dev on retient.

⚠️ **Le contrôle dev est plus lourd que la ligne de base publiée** (30,8 contre
20,4 sur le drag). Les deux sont du dev et le harnais diffère sur la mise en place
(dialogue natif au lieu du pont de debug, calque photo du HAUT sélectionné par le
clic au centre). Cet écart n'est pas expliqué et n'a pas été poursuivi : il ne
change rien à la conclusion, qui tient des deux côtés.

**Le rapport 3 à 4× est cohérent avec la cause attendue.** §2.2 attribuait 75 % du
JS actif à React ; §6 estimait les fonctions dev-only et le double rendu de
`StrictMode` à 20-30 % du JS actif. Le profil de production le confirme par
absence : `jsxDEV` (187 à 222 ms) et `createElement` (71 à 79 ms) dominaient le
top 6 de chaque geste en dev, et **aucun des deux n'apparaît en production**, où
le premier poste est `(program)` puis, pour la peinture, `paintStroke` et
`writeTexture` — c'est-à-dire du travail réel.

**Le défaut structurel de §3.4 n'a pas disparu**, conformément à ce que §6
annonçait : un rendu React de l'arbre entier par `pointermove` existe toujours.
Il ne coûte simplement plus assez pour menacer la cible.

### P0.4 GPU en production

Même instrument que §2.1 (timestamp queries, `instrument.js` injecté avant le code
de l'app par `Page.addScriptToEvaluateOnNewDocument`, `src/` non modifié), drag de
220 échantillons à 5 calques photo :

| | ligne de base dev §2.1 | **production** |
|---|---|---|
| passes par frame | 11 | **11** (médiane, 221 frames actives) |
| GPU p50 | 6,82 ms | **6,82 ms** |
| GPU p95 | 9,11 ms | **7,60 ms** |
| occupation GPU au repos | 2,4 % | **2,0 %** (moy., min 1,7 max 2,2, 14 échantillons) |

**Le GPU est inchangé, et c'était attendu** : le WGSL et la structure `2N+1` sont
les mêmes binaires de shader des deux côtés — seul le bundle JS diffère. Ce
tableau vaut comme contrôle de non-régression du montage, pas comme un gain.
Intervalle rAF mesuré p50 19,3 ms / p95 31,0 ms — même réserve qu'en §2.1 : c'est
la cadence d'injection du pilote, pas un plafond de l'app.

### P0.5 Ce qui n'a PAS pu être mesuré, et pourquoi

- **Comptage de rendus React par composant.** `Profiler.startPreciseCoverage` rend
  des noms minifiés (`Nf`, `wT` apparaissent dans les tops de production) : la
  correspondance avec `LayerRow`, `IconButton`, `DockedPanelCard` est perdue. Cette
  difficulté était nommée d'avance par le plan ; le comptage n'a pas été forcé.
  Le temps CPU par événement et les tâches longues suffisent à trancher, et ils
  tranchent largement.
- **Distribution p95 du CPU par événement.** L'instrument rend le JS actif TOTAL
  divisé par le nombre d'événements, donc une moyenne, pas une distribution. Le
  compteur de tâches longues en est le substitut : **0 tâche > 50 ms** sur les six
  mesures de production, contre 2 à 4 par geste en dev. C'est un p95 par le haut,
  pas un p95 chiffré.
- **Latence entrée→pixel.** Toujours non mesurée (limite §6, inchangée) — et
  c'est peut-être toujours ce que « super lente » décrit.
- **Souris synthétique.** Les événements CDP ne sont jamais coalescés et sont
  injectés à ~16 ms, donc un événement par frame. Cette limite est IDENTIQUE des
  deux côtés du tableau ; c'est le coût PAR événement qui décide, et il est
  comparable.
- **L'anomalie mémoire de §2.3** (+477 Mo natifs pendant une peinture) n'a pas été
  réinstruite : hors du périmètre de P0.

### P0.6 Validité des gestes

Chaque geste retenu a été validé DANS SON PROPRE TOUR, la sortie collée dans les
logs : drag prouvé par déplacement de `.transform-handles__box` (213 → 180),
curseur prouvé par changement de valeur (0,12 → 0,34), peinture prouvée par cible
vérifiée `CANVAS[canvas-stage__canvas--paint]` et mode peinture actif. La pile de
départ est affichée avant chaque mesure — 5 calques nommés `DSCF5152` à `DSCF5156`.
Un run de mise au point où les imports avaient échoué (1 calque au lieu de 5) a été
JETÉ et n'apparaît pas dans le tableau.
