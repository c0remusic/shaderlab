# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> Nom provisoire (placeholder, jamais tranché). Repo local `C:\dev\shaderlab`,
> remote origin : `github.com/c0remusic/shaderlab`. Branche courante : se mesure
> (`git rev-parse --abbrev-ref HEAD`), ne s'écrit pas ici.
> Historique complet des chantiers/sessions (2026-07-12 → 2026-07-21) archivé
> dans `docs/archive/claude-md-history-pre-2026-07-22.md` — statut courant des
> tranches/checkpoints dans `docs/INDEX.json` (source de vérité, pas ce
> bandeau). Invariant durable hérité de cet historique : garder les gros
> buffers/textures de masque HORS du state React (cause du crash OOM peinture
> 24MP, résolu `e3c7584` — voir `src/layers/displayProjection.ts`).

## Langage partagé

Glossaire de domaine du projet : `CONTEXT.md` (racine). Le lire avant tout travail
qui manipule le vocabulaire métier ; le maintenir via le skill `interview`.

## Quoi

App desktop **Windows** (Tauri v2) d'effets visuels "shader" temps réel sur
photos JPEG : effets empilables en calques (glow, chromatic bleed, warp,
grain), masque au pinceau par calque, undo/redo en session. Le projet est né
comme **éditeur externe Lightroom** (round-trip type Dehancer : Lightroom
exporte une copie → lance l'app avec le chemin en argument → l'app écrase ce
même fichier → Lightroom réimporte).

**Ce positionnement est abandonné** ([ADR-0002](.claude/decisions/ADR-0002-abandon-round-trip-lightroom.md),
2026-07-27) : shaderlab est un **éditeur autonome**. Décision exécutée en code le
2026-07-30 — `isLaunchFile` et `roundTripActive` n'existent plus, et
`resolveExportTargetAsync` n'a plus de paramètre pour demander un écrasement
(`src/export/exportImage.ts`). Tout export est une copie.

Deux pièces survivent, et ni l'une ni l'autre n'est le round-trip :
- `get_launch_path` (`src/launch.ts`, `src-tauri/src/lib.rs`) ouvre un fichier
  passé en argument de lancement — « Ouvrir avec » de Windows. Ouvrir reste
  ouvrir ; c'est écraser qui est parti.
- `hasImportedPhotoLayer` (`src/layers/photoLayer.ts`) : né en garde du
  round-trip, il a depuis un SECOND appelant sans rapport avec l'export —
  `presets/presetDocument.ts:capture` s'en sert comme frontière de l'avis
  « calque photo exclu » d'un preset (T5). Ne pas le supprimer en croyant
  finir la dépose.

Née d'une frustration : aucun plugin Lightroom natif ne peut faire d'effets
shader GPU (pipeline RAW fermé). C'est cette origine qui explique la barre de
qualité ci-dessous. Positionnement outil perso vs produit partageable : pas
encore tranché.

**Exigence qualité explicite** : pas de rendu "filtre Photoshop 2005".
Chaque effet a une version pipeline (naïve) puis un upgrade qualité
obligatoire (dual-filter bloom, aberration radiale, warp FBM, grain
luminance-dépendant) — un effet qui marche mais rend cheap n'est pas terminé.

## Stack

Tauri v2 (coquille Rust minimale, lib = `shaderlab_lib`) · React 19 + TS ·
Vite · **WebGPU/WGSL brut** (pas de lib de rendu) · Vitest (deux projets :
`unit` en env Node, `storybook` en navigateur Playwright).

**UI** : Tailwind v4 (`@tailwindcss/vite`) + `shadcn/ui` (style `base-nova`,
PAS Radix — `components.json`). Tokens de marque = `src/design/{primitives,
semantic,components}.css`, mappés dans `src/design/tailwind-theme.css`
(jamais redéfinis). Migration en cours composant par composant : `ErrorBanner`/
`Toolbar`/`BrushToolbar` migrés (2026-07-20) ; `LayerPanel`/`ParamPanel`/
`Canvas` encore en CSS classique. `Inspector.tsx` (aside dockée fixe)
supprimé le 2026-07-20, remplacé par `FloatingPanel`
(panneaux déplaçables/repliables/dockables), lui-même **supprimé le
2026-07-20/21** et remplacé par `PanelColumn`/`DockedPanelCard`
(`src/components/dockedPanel/`, dock fixe **content-sized**, sans splitter —
`react-resizable-panels` a ete RETIRE le 2026-07-21 par `0efdfe4` : chaque carte
prend la hauteur de son contenu et c'est la colonne qui defile
— voir `docs/superpowers/specs/2026-07-20-shaderlab-docked-panels-design.md`)
— ne plus citer `FloatingPanel`/`src/components/floatingPanel/` comme
composant existant ou à migrer, le dossier n'existe plus. Voir aussi
`docs/superpowers/specs/2026-07-20-shadcn-migration-design.md`.

Décisions techniques verrouillées (voir design.md pour les preuves) :
- **Chaîne de couleur en sRGB par le FORMAT, jamais par un gamma manuel en
  WGSL.** Sans ça, glow/grain/blur sont mathématiquement faux (constat
  d'audit). Détail d'implémentation à ne pas approximer : `context.configure()`
  n'accepte PAS de variante `-srgb` — on configure le canvas avec
  `navigator.gpu.getPreferredCanvasFormat()` et on déclare la variante srgb en
  `viewFormats`, la vue srgb servant à la passe finale (`gpuContext.ts:64-78`).
  Ne jamais coder `rgba8unorm-srgb` en dur : c'est `bgra8unorm` sur
  Windows/D3D12. L'ordre des canaux est transparent en WGSL via `textureSample`.
- **Pas de distinction preview/export** — un seul pipeline, résolution
  native, toujours (décision utilisateur explicite, pas de downscale).
- JPEG traité comme sRGB, pas de lecture de profil ICC en v1 (limitation
  documentée, pas silencieuse).
- Effets = modules autonomes enregistrés dans `src/render/effects/registry.ts`
  — en ajouter un = un nouveau fichier ; un effet à paramètres groupés (voir
  `EffectParam.colorGroup`) touche aussi `ParamPanel.tsx` et peut élargir
  `MAX_EFFECT_PARAMS` (`shaderCompose.ts`, **24** depuis le 2026-08-01) si
  nécessaire.
  Registre réel au 2026-08-03 (soir), dans l'ordre : `glow`, `halation`,
  `anamorphicStreak`, `lensBlur`, `motionBlur`, `chromaticBleed`,
  `warp`, `grain`, `duotone`, `hatching`, `halftone`, `dither`, `gooeyMerge`,
  `channelMixer`, `outlines`, `echoOutlines`, `isolines`,
  `pixelStretch`, `sliceShift`, `gradientMap` — **vingt**.
  **Trois départs le 2026-08-03**, tous sur arbitrage d'Antoine : `surfaceBlur`
  (ADR-0011, verdict d'usage sur la famille des flous), `posterize` (ADR-0012,
  couvert par `dither` — couverture PROUVÉE avant le retrait, le scénario
  sérigraphie porté mot pour mot rend les mêmes 32 valeurs distinctes), et
  `coloredEdges` **absorbé par `outlines`** (ADR-0013, mode d'encre : Encre
  unique ou Roue d'orientation). Retirer un effet ne casse pas les presets qui le
  citent : `presetDocument.ts` ignore le calque et pousse un avertissement,
  jamais une exception.
  **`echoOutlines` doit lui aussi être absorbé par `outlines`** (même arbitrage),
  mais c'est BLOQUÉ sur une capacité du pipeline : il porte neuf passes de
  pyramide quand `outlines` n'en a aucune, et `effectPassRunner.runInternalPasses`
  les exécute sans condition. Fusionner avant de savoir sauter des passes ferait
  payer la pyramide au mode Contours, qui n'en lit rien.
  `echoOutlines` (2026-08-03) est l'effet que la fiche Figma appelle `Outlines`
  et que notre `outlines` n'est pas — l'un mesure une DISTANCE à une forme,
  l'autre détecte un gradient. `isolines` trace des courbes de niveau du ton.
  Six sont arrivés le 2026-08-01 et AUCUN ne vient du backlog Figma d'origine
  (épuisé le 2026-07-31) : ils sortent du cahier de références
  `docs/superpowers/specs/2026-08-01-references-effets.md` et de demandes
  directes d'Antoine.
- **La famille des flous est CLOSE, et RÉDUITE À DEUX** depuis le 2026-08-03 :
  `lensBlur` est un noyau d'OBJECTIF (intégration sur la surface de l'ouverture —
  pondération des hautes lumières + diaphragme à N lames, plus quatre géométries
  de champ qui couvrent Iris et Tilt-Shift) ; `motionBlur` intègre le long d'une
  TRAJECTOIRE (directionnelle, rotation, zoom — Path et Spin de la galerie).
  `surfaceBlur` (bilatéral) a été **retiré** (ADR-0011) — ne pas le citer comme
  existant. Le **gaussien reste volontairement dehors** : la référence dit qu'il
  lave l'image, et un test du registre le vérifie — ce garde a déménagé dans
  `registry.test.ts` le jour du retrait, précisément parce qu'il vivait dans le
  fichier de test de l'effet retiré.
  Noyaux de flou pyramidal partagés par glow/halation : `effects/blurChain.ts`.
  Les deux flous ci-dessus n'en sont PAS : un noyau pyramidal ne sait produire
  ni bord franc, ni polygone, ni poids de valeur.
- **Trois familles closes**, chacune par un découpage qui ne se devine pas
  depuis les noms. **Halos** : `glow` étale sans colorer (diffusion),
  `halation` réexpose en rouge sur fond sombre (film), `anamorphicStreak` tire
  un trait bleu sur un seul axe (optique cylindrique) — ils s'empilent.
  **Impression** : `dither` (aplats ET trames — il a absorbé `posterize`,
  ADR-0012 : sa `Force du tramage` à 0 EST le rendu sérigraphie), `hatching`
  (taille-douce), `halftone` (trame CMJN et sa rosette). **Flous** : voir
  ci-dessus.
- **Garde de câblage** : `test/render/effects/parametresCables.test.ts` vérifie
  que chaque paramètre déclaré est lu à SON index par le shader, sur tous les
  effets du registre. Elle naît d'un défaut réel — `warp` avait quatre contrôles sur sept
  morts ou décalés, invisibles pour le compilateur comme pour le verrou de
  pixels (un curseur mort ne bouge aucun pixel, précisément parce qu'il est
  mort).
- **Détecteur de contours partagé** : `effects/edgeGradient.ts` (Scharr 3x3,
  huit taps, ton perceptuel + chromaticité), utilisé par `outlines` et
  `echoOutlines`. La différence « jeter la DIRECTION du gradient pour une encre
  unique, ou la garder pour en faire une teinte » n'est plus celle de deux
  effets : c'est le paramètre `inkMode` d'`outlines` depuis ADR-0013.
  Les autres fichiers de `effects/` sont des helpers (`bayer`, `hsl`, `hash`,
  `oklab`, `blendSpace`, `inputMode`, `srgbTransfer`, `uvSpace`, `validate`,
  `types`) : la présence d'un fichier n'est pas la présence d'un effet, vérifier
  `registry.ts`.
- **Deux contrôles TRANSVERSAUX**, posés le 2026-08-01 d'après le §6bis du
  cahier de références (ils sont récurrents chez Figma et étaient absents
  partout ici) : `effects/blendSpace.ts` (espace de mélange — sRGB, Linéaire,
  OKLab, OKLCH ; plus un vocabulaire restreint aux deux courbes de transfert
  pour les opérateurs qui ne sont pas une interpolation, comme la matrice de
  `channelMixer`) et `effects/inputMode.ts` (mode d'entrée — Luminance,
  Luminance inversée, Alpha). Un effet qui les adopte garde son rendu au bit
  près sur son défaut. ⚠️ L'index d'un choix est PERSISTÉ dans les presets :
  on ajoute une entrée à la FIN de la liste, jamais au milieu.
  `passthrough` (`PASSTHROUGH_EFFECT`) est résolu par `getEffect` mais
  volontairement HORS du registre — c'est l'effectId par défaut d'un calque
  photo, pas un effet choisissable.
- Modes de fusion = modules autonomes dans `src/render/blend/registry.ts`
  (même principe, Tranche 1 2026-07-19) — chaque calque a `opacity`/
  `blendMode` sur `LayerState`.

## Commandes

- Dev : `npm run tauri dev` (lance Vite + la fenêtre native, tout-en-un)
- Build frontend seul : `npm run build` (tsc + vite build)
- Tests unitaires : `npm run test` (Vitest, projet `unit` uniquement)
- **Un seul fichier / un seul test** : `npx vitest run --project=unit test/ui/transform.test.ts`
  · filtrer par nom : `npx vitest run --project=unit -t "nom du test"`.
  Toujours passer `--project=unit` (sinon les deux projets démarrent, dont le
  navigateur Playwright).
- Tests de stories : `npm run test-storybook` (Vitest + Playwright chromium, projet `storybook`) · `npm run test:all` pour les deux · `npm run coverage` (v8, projet storybook)
- Shaders GPU : `npm run test:gpu-shaders` (`scripts/gpu-shader-check.mjs`) — prouve que les shaders COMPILENT
- Non-régression du **rendu** : `npm run test:render` (`scripts/render-check.mjs`) — prouve que le pipeline produit les MÊMES PIXELS qu'avant. Prérequis : l'app tourne avec le port CDP 9222, ET un Vite du worktree courant sur 1421 (`npx vite --port 1421`). Références versionnées dans `test/render-refs/` ; `--update` les réécrit (les relire à l'œil avant de committer), `--diagnostic` mesure la dépendance à l'horloge de la surface de présentation. Lit les pixels de `Renderer.exportFrame()`, jamais une capture d'écran — voir l'en-tête du script pour pourquoi.
- Type-check : `npx tsc --noEmit`
- Lint : `npm run lint` (eslint, couvre `src/**/*.{ts,tsx}`)
- Lint tokens design : `npm run lint:tokens` (détecte couleurs/z-index/spacing en dur qui contournent un token existant, `scripts/lint-tokens.mjs`)
- Rust : `cd src-tauri && cargo check`
- Storybook (composants React isolés, tokens réels via `src/design/index.css`) : `npm run storybook` (dev, port 6006) · `npm run build-storybook` (static)

**CI** (`.github/workflows/test.yml`, ubuntu) : `npm ci` → `npx playwright
install --with-deps chromium` → `npm run test` → `npm run test-storybook`. Les
tests GPU/rendu ne tournent PAS en CI (pas de GPU) — ce sont des gates locales.

**Hook pre-commit** : source versionnée dans `scripts/hooks/pre-commit`, à
installer à la main après un clone (`cp` vers `$(git rev-parse
--git-common-dir)/hooks/`, instructions en tête du fichier). Aujourd'hui
**non bloquant** (`BLOCKING=0`) : il affiche les erreurs ESLint et laisse
passer. Les worktrees partagent `.git/hooks`, une seule installation couvre
tout le dépôt.

## Architecture

**`ARCHITECTURE.md` (racine) est la carte détaillée** — couches réelles, module maps Presets et Double exposure, ports de
test, risques ouverts. La lire avant toute modification structurelle plutôt que
de redécouvrir depuis les fichiers. Elle signale elle-même ses sections
périmées (ex. la table des bindings du groupe 0, à recompter dans
`shaderCompose.ts`).

Six couches, dépendances strictement descendantes :

```
src-tauri/src/lib.rs      coquille Rust, ~17 commandes IPC maison
        ▲                 (aucun plugin fs/dialog — voir bug plugin-dialog)
src/launch.ts             wrappers typés, une fonction = une commande
        ▲
src/App.tsx               COMPOSITION ROOT — refs GPU/renderer/session,
        │                 state UI, tous les handlers
   ┌────┴────┬──────────┬──────────┐
application/  render/    mask/      export/
DocumentSession Renderer MaskPainter exportImage
   └────┬────┴──────────┴──────────┘
src/layers/               MODÈLE PARTAGÉ — LayerStack · History ·
                          displayProjection · types
```

Points structurants qu'on ne devine pas en lisant un fichier isolé :
- **`LayerState` (`src/layers/types.ts`) est le type pivot** : consommé par
  `render/`, `mask/`, `export/`, `components/`, `application/`. Il ne dépend que
  de `mask/types`.
- **`Renderer` n'encode plus le rendu** — c'est un assembleur de cycle de vie.
  Le travail réel est chez `FramePipelineExecutor` (boucle par calque,
  ping-pong), `EffectPassRunner` (une passe), `shaderCompose` (la chaîne WGSL
  **est** la clé de cache), `ImageFrameResources`, `MaskTextureResolver`. Les
  trois ports de `framePipelineExecutor.ts` sont la frontière de test la plus
  utile de la couche rendu — toute extension du pipeline doit la préserver.
- **`DocumentSession`** (`src/application/`) est le bon point d'entrée pour
  toute opération document-level, y compris presets et calque photo. Il expose
  deux vues : `layers()` (complet, pour le GPU) et `displayLayers()`
  (projection sans raster, pour React — c'est l'invariant anti-OOM).
- **L'espace de coordonnées du masque est celui de la photo de fond**
  (`MaskPainter` alloue aux dimensions de l'image de base), jamais celui d'une
  source d'image transformée.
- **`components/` ne contient aucune logique métier** : aucun composant ne
  connaît `LayerStack` ni le renderer, tous les handlers viennent d'`App.tsx`.
  Cette frontière ne doit pas bouger pour ajouter une carte au dock.
- `exportImage.ts` définit ses propres ports d'IO et se teste avec des doubles :
  **c'est le patron à reproduire** pour toute nouvelle persistance, pas à
  réinventer.

## Décisions (ADR)

`.claude/decisions/INDEX.md` — une ligne par ADR avec son statut. Un ADR
`superseded` (ADR-0003, renversé par ADR-0004) n'est PAS une contrainte active.
Actifs au 2026-08-03 : densité UI (0001), abandon round-trip (0002), sens causal
de la pile (0004), rattachement par proximité (0005), fond d'export blanc
(0006), format de toile à la création + `MAX_CANVAS_PIXELS = 64 Mpx` (0007),
un effet ne se pose jamais sur un calque photo (0008), déplacement libre du
viewport (0009), le gaussien reste hors du registre (0010, ⚠️ sa 3ᵉ conséquence
est caduque), retrait de `surfaceBlur` (0011), retrait de `posterize` (0012),
`outlines` absorbe `coloredEdges` (0013).
Les décisions du
projet vivent là, pas dans les docs de design.

## Méthode

- Exécution en cours via `superpowers:subagent-driven-development` : un
  sous-agent frais par tâche du plan, revue spec+qualité après chaque tâche,
  fixes puis re-revue, ledger dans `.superpowers/sdd/progress.md`. **Vérifier
  le ledger avant de (re)dispatcher quoi que ce soit.**
  ⚠️ **Les skills `superpowers:*` ne sont PAS forcément installées** — elles
  étaient absentes le 2026-07-31 (seuls `caveman` et `claude-plugins-official`
  dans `~/.claude/plugins/cache`). Le ledger et `docs/superpowers/` restent
  lisibles, mais la méthode n'est pas exécutable dans cet état : le vérifier
  avant de s'y référer, plutôt que de découvrir l'absence en plein dispatch.
  Sans elles, annoncer le découpage et le faire valider à la main — une tranche
  qui touche le modèle jusqu'au shader mérite un plan, skill ou pas.
- **Avant tout dispatch `subagent-driven-development`, lancer `git worktree
  list`** : plusieurs sessions concurrentes ont déjà collisionné sur ce repo
  (2026-07-13, Task 7 du plan design system — un implémenteur bloqué en
  pleine tâche par une mutation filesystem d'une autre session active sur la
  même branche). Le fix a été d'isoler chaque ligne de travail dans son
  propre worktree (`git worktree add`) — vérifier ceci en amont plutôt que
  de le découvrir après coup. Voir la mémoire projet
  `design-system-branch-reconciliation` pour l'état des lignes en cours.
- **Les sous-agents sont headless** : ils ne peuvent PAS vérifier
  visuellement une fenêtre (leçon Task 1 : un implémenteur a pris la ligne
  "Waiting for frontend dev server" pour une preuve de compilation Rust).
  Toute vérification visuelle passe par un checkpoint humain (décision
  utilisateur : c'est lui qui juge, pas de capture computer-use).
  ⚠️ Essayé et confirmé inefficace (2026-07-13) : `computer-use` ne peut pas
  cibler `shaderlab.exe` car ce n'est pas une app enregistrée au menu
  Démarrer (build dev) — créer un raccourci `.lnk` temporaire dans le menu
  Démarrer ne suffit pas, le résolveur d'apps de computer-use ne le détecte
  pas. Ne pas retenter cette piste ; le checkpoint humain reste la seule
  voie fiable.
- Leçon Task 1 : scaffold Tauri écrit à la main = risque élevé de mélange
  v1/v2 (`shell-open` n'existe plus en v2 ; structure officielle =
  main.rs shim + lib.rs run(), pas l'inverse ; `tauri-build` exige
  `icons/icon.ico` même pour un simple `cargo check`).
- `tauri::generate_context!()` exige que `frontendDist` (`../dist`) existe
  sur disque même pour `cargo check` — lancer `npm run build` d'abord si
  dist/ manque.
- Même philosophie que Sift/track-finder : détective, fail-fast, pas de
  fallback silencieux ; TDD sur la logique pure ; le rendu GPU se vérifie
  visuellement, pas unitairement.
- **Raccourci** : `npm run dev:debug` (= `scripts/dev.ps1`) tue le process
  `shaderlab.exe` restant (sinon `cargo build` échoue avec "Accès refusé"),
  lance `tauri dev` en arrière-plan via PowerShell, active CDP et écrit les
  sorties dans `.dev-logs/`. L'agent lance ensuite `npm run dev:monitor` pour
  suivre Tauri, Vite, `console.*` et les exceptions WebView2. La variante
  `npm run dev:debug:follow` combine lancement et suivi interactif.
  ⚠️ Ce script tue TOUT process nommé `shaderlab` sur la machine
  (`Get-Process -Name shaderlab | Stop-Process -Force`), pas seulement celui
  du worktree courant — si une autre session/worktree a sa propre instance
  en cours, ce script la tue aussi sans prévenir. Vérifier
  `Get-Process -Name shaderlab` avant de lancer `dev:debug` si plusieurs
  lignes de travail sont actives en parallèle (voir la note worktree
  ci-dessus).
  ⚠️ `Get-Process -Name shaderlab` absent ne suffit PAS à garantir une
  fenêtre fraîche : tuer le process Vite (port 1420, souvent `node.exe`,
  pas `shaderlab.exe`) d'une session concurrente ne tue pas forcément la
  fenêtre WebView2 elle-même — elle peut rester vivante, connectable en CDP,
  avec un état de session antérieur (document/calques chargés) intact.
  Vérifier `Get-NetTCPConnection -LocalPort 1420` ET l'état réel de la page
  via CDP (`document.body.innerText`) avant de relancer `dev:debug`/`tauri
  dev`, et confirmer avec Antoine avant d'écraser un état qu'on n'a pas
  soi-même produit (2026-07-25, session double exposure).
- **Autonomie terminal de Claude** : Claude est autorisé à lancer lui-même les
  commandes PowerShell nécessaires au développement, aux tests, au diagnostic
  et au monitoring dans ce repo. Ne pas demander à l'utilisateur de recopier
  une commande ou de lire une console lorsque l'agent peut le faire localement.
  Les opérations destructrices ou extérieures au repo gardent les règles de
  confirmation normales.
- **Boucle de monitoring obligatoire** : après lancement, vérifier le PID et
  lire la sortie réelle avec `npm run dev:monitor`. Ne pas conclure au succès
  sur la seule présence du processus. En cas d'erreur, citer le log pertinent,
  corriger, relancer puis surveiller à nouveau.
- **Logs de `npm run tauri dev` en tâche de fond vides tant que le process
  tourne** (bug de buffering stdout sur ce Git Bash Windows, rencontré aussi
  sur d'autres projets) : ne pas insister à relire le fichier de log avec
  `tail`/`cat`, passer directement à une vérification par liste de process
  (`Get-Process shaderlab`) ou par CDP (ci-dessous).
- **Debug console/DOM sans computer-use** (technique reprise de Sift) :
  lancer `tauri dev` avec `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
  en variable d'env (jamais dans `tauri.conf.json` — fuiterait en prod et
  casserait les args par défaut de wry), puis se connecter en WebSocket brut
  (Node a un `WebSocket` global, pas besoin du package `ws`) à
  `ws://localhost:9222/devtools/page/<id>` (liste des cibles sur
  `http://localhost:9222/json`). Permet `Runtime.evaluate` (état DOM, clic
  de bouton réel via `document.querySelector`, invoke direct de
  `window.__TAURI_INTERNALS__.invoke('cmd')`) et capture des
  `Runtime.consoleAPICalled`/`Runtime.exceptionThrown`. A servi à diagnostiquer
  précisément un invoke qui restait bloqué sans throw ni log (voir bug
  `@tauri-apps/plugin-dialog` ci-dessous) — bien plus fiable que deviner
  depuis des captures d'écran. Outil prêt : `scripts/cdp-console.mjs`.
  ⚠️ Limite connue (2026-07-13) : `Input.dispatchMouseEvent` (CDP) ne peut
  PAS déclencher un vrai drag HTML5 natif — `dragstart` ne se lève que sur
  un vrai geste OS de drag, pas sur des événements souris synthétiques.
  Deux tentatives d'agent ont conclu à tort "non reproductible" sur un bug
  de drag-and-drop réel à cause de cette limite. Pour observer un vrai drag
  sans le simuler : injecter un listener passif
  (`document.addEventListener(type, handler, true)` poussant dans une
  variable globale) via `Runtime.evaluate`, demander à l'humain de faire le
  geste réel, puis relire la variable après coup.
- **`@tauri-apps/plugin-dialog` bug connu** : son `open()` peut rester
  bloqué indéfiniment (jamais résolu ni rejeté, aucune fenêtre native ne
  s'ouvre) — classe de bug IPC connue de l'écosystème Tauri
  (tauri-apps/plugins-workspace#571). Contourné en appelant `rfd`
  directement via notre propre commande Rust (`pick_image_file`), même
  pattern que `get_launch_path`/`read_image_file` qui, eux, marchaient déjà.
  Si un futur besoin de dialogue (dossier, sauvegarde...) refait surface,
  ne PAS reprendre `tauri-plugin-dialog` sans revalider ce point d'abord.

## Moyen de preuve (UI) — déclaré (règle CLAUDE.md global)
**Playwright headless est INADAPTÉ ici** : le canvas WebGPU en WebView2 rend noir
en headless (aucun rendu GPU) — un screenshot Playwright serait un œil aveugle qui
dit « vu ». **Preuve UI = CDP sur la vraie fenêtre WebView2** (`--remote-debugging-port=9222`,
voir Méthode ci-dessus) + checkpoint visuel humain. Le screenshot Playwright vaut
seulement pour les stories sans canvas GPU (projet `storybook`, qui lui tourne
bien en headless chromium).

## Moyen de preuve (EFFETS) — un verrou aveugle ne verrouille rien

**Un verrou de pixels (`npm run test:render`) ne vaut que si sa mire peut
MONTRER la propriété que l'effet prétend porter.** Avant d'écrire la référence
d'un effet, se demander ce qui le distingue de sa version naïve, puis vérifier
que la mire peut le montrer. Si elle ne le peut pas, **écrire la mire d'abord**.

Cette règle a été payée le 2026-08-01 : `lensBlur` avait **dix-sept tests
unitaires verts** en floutant au DOUBLE du rayon réglé et en rendant des nuées
granuleuses au lieu d'hexagones. Son premier scénario était posé sur la mire
commune, qui n'a aucun point lumineux isolé — or une tache de bokeh ne se lit
que sur un petit point brillant contre du sombre. Sous un damier, un lens blur
rend exactement ce que rendrait un gaussien : le verrou verrouillait du bruit.
Trois mires ont dû être écrites dans la journée (`mireBokeh`, `mireRampe`,
`mireBruit` — voir `scripts/render-check.mjs`), et les trois ont trouvé un
défaut à leur première exécution.

Corollaire : **le verrou sert aussi à rendre un refactor prouvable**. `outlines`
n'avait aucune référence ; en poser une AVANT d'extraire son gradient de Scharr
vers `effects/edgeGradient.ts` a transformé « ça devrait être neutre » en
`aucun écart`. Poser la preuve avant le geste, pas après.

## Risques ouverts / gates

- VRAM : ~96 Mo par texture RGBA 24MP, multiplié par ping-pong + masques —
  à mesurer à l'usage réel, pas de budget théorique figé. Instrument : mesurer
  le *Total Committed* du process GPU de WebView2, pas `nvidia-smi` (qui compte
  tout le GPU). `MAX_CANVAS_PIXELS = 64 Mpx` (ADR-0007) est calibré sur ces
  mesures.

La dépose du round-trip Lightroom figurait ici comme dette ouverte ; elle a été
faite le 2026-07-30 (voir § Quoi).

Deux gates de la phase MVP ont été retirées d'ici le 2026-07-29 : le go/no-go
WebGPU dans WebView2 (Task 2) est levé depuis longtemps — le pipeline rend, les
shaders compilent (`npm run test:gpu-shaders`) et le rendu est verrouillé au
pixel (`npm run test:render`) ; « valider le round-trip avec un vrai
Lightroom » (Task 3) est sans objet, puisqu'on le retire au lieu de le valider.

## Index des documents docs/

`docs/INDEX.json` (référence, ~280 lignes) — À LIRE À LA DEMANDE (Read tool)
quand tu cherches le statut d'un chantier/plan spécifique, PAS importé
automatiquement : un `@import` charge le fichier entier à chaque session,
quel que soit le besoin réel du tour (doublait le poids de ce CLAUDE.md).
⚠️ `docs/INDEX.json` et `.superpowers/sdd/progress.md` ont déjà été pris en
défaut (statuts optimistes vs état réel du code) : vérifier sur disque avant
de conclure qu'une tranche est faite.

`AGENTS.md` (racine) est le document frère, plus long, à destination des agents
en général : il porte l'historique détaillé des tranches et des bugs. Ce
CLAUDE.md est l'entrée courte ; en cas de contradiction, c'est le CODE qui
tranche, puis `ARCHITECTURE.md`.

## Densité de l'UI — règle permanente (ADR-0001)

**Tout élément d'interface ajouté doit passer la checklist de densité AU MOMENT
où il est ajouté**, jamais dans un lot de rattrapage : `.claude/decisions/ADR-0001-densite-ui-controles-repetes.md`.

Résumé : un contrôle qui se répète sur chaque ligne d'une liste devient UN
contrôle unique dans une zone de contrôles fixe, agissant sur l'élément
sélectionné — avec son corollaire indissociable (zone fixe **en-tête OU pied**,
hors du conteneur défilant + liste défilante DANS le panneau + hauteur de
panneau bornée ; jamais un défilement de colonne). La position de la zone n'est
pas contrainte, son unicité et son hors-scroller le sont (amendement
2026-07-28 : la carte Effets la pose en pied). Ligne au-dessus de 56 px hors
sélection = à justifier par écrit ou à réduire.

Cette règle existe parce qu'elle a été enfreinte le jour même où elle a été
posée : le panneau Photo a été livré avant le lot de densité, portant la colonne
à 1613 px pour 1345 px disponibles avec **deux** calques.

## Wireframe & tokens
Source de tokens canonique (à viser pour tout wireframe `interface-design`) :
`src/design/primitives.css` + `src/design/semantic.css` + `src/design/components.css`
(vraies valeurs CSS dans `:root`). _Éviter_ comme source de valeurs :
`docs/design-system/tokens.md` et `.interface-design/system.md` (contrat/résumé
d'intention, peut retarder sur le CSS — ex. `--outline-contrast` existe dans
semantic.css mais pas dans tokens.md). Wireframes de feature → `docs/wireframes/<feature>.html`.

## Outillage / routage skills

⚠️ La règle de routage skills (`~/.claude/CLAUDE.md`) et l'inventaire généré
(`~/.claude/skills-view.md`) ont **tous deux été supprimés** par le reset vanilla
du 2026-07-31 (récupérables au tag `pre-reset-vanilla`). Plus de règle globale
opposable ni d'inventaire : s'en tenir aux skills réellement listées par le
harnais. Packs de contexte (sizing) :
`.claude/rules/context-packs.md`. Décisions d'outillage : cycle complet
`superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` ;
audits de spec via sous-agent `general-purpose` adverse ; recherches
techniques via WebSearch avec vérification des licences (webgpu-image-filter
n'a PAS de licence — inspiration seulement, jamais de copie verbatim).

Verdicts projet uniques (delta du registre supprimé, non déjà dans § Méthode) :
- **Modèles par rôle (sizing)** : haiku = transcription de plan / fixes
  mécaniques ; sonnet = spike / intégration / review (haiku a écrit le scaffold
  main de travers en Task 1 → 2 passes de fix ; sonnet clean du premier coup).
- **`interface-design`** : utilisée en mode « direct et concret », PAS l'exercice
  créatif complet (l'exploration de domaine/signature a été jugée hors-sujet le
  2026-07-13 ; reprise directe sur palette/typo calées sur références validées,
  tokens dans `.interface-design/system.md`).
