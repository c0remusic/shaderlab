# shaderlab — AGENTS.md

> Nom provisoire (placeholder, jamais tranché — même logique que track-finder).
> Repo local `C:\dev\shaderlab`, remote origin `github.com/c0remusic/shaderlab`. (Déplacé depuis
> `C:\Users\LEETJ\Desktop\shaderlab` — l'ancien chemin n'existe plus ; une
> relocalisation d'un repo Tauri exige un `cargo clean` COMPLET : le cache
> `target/` contient des chemins absolus périmés qui cassent le build-script.)
> Branche de dev active : `feature/design-system` (plan design system Tasks
> 1-10, MVP mergé sur master). `feature/archi-remediation` (11-task
> remédiation archi + fix OOM peinture au masque, voir `src/render/maskUpload.ts`)
> a été MERGÉ dans `feature/design-system` le 2026-07-16 (divergence à `0a2e151`,
> jamais reconvergée avant ce merge) — n'est plus un worktree de travail séparé ;
> le worktree `shaderlab-archi-remediation` a été RETIRÉ le 2026-07-16
> (`git worktree remove`, branche `feature/archi-remediation` conservée). Checkpoint
> humain visuel du fix dirty-rect toujours EN ATTENTE de confirmation (voir
> `docs/INDEX.json`). `design-system-mine` : commits superseded (worktree retiré
> le 2026-07-16, branche conservée) — voir la mémoire projet
> `design-system-branch-reconciliation`. ✅ Le crash de peinture au masque à
> 24MP est RÉSOLU le 2026-07-18 (`e3c7584`) : la cause n'était NI le GPU NI le
> driver mais le buffer `maskData` r8 de ~26 Mo transitant par le state React,
> qui fait hanger WebView2 au re-render de `setLayers()` en fin de stroke (les 3
> fix précédents — dirty-rect, GPU-copy, wait-for-idle — ciblaient tous le
> GPU/timing, d'où leur échec). Fix : `maskData` hors du state React —
> `layersRef` = source de vérité complète pour rendu/historique/export, le state
> React n'est qu'une projection d'affichage sans `maskData`
> (`src/layers/displayProjection.ts`, `toDisplayLayers`). Règle héritée : garder
> les gros buffers/textures de masque HORS du state React. `device.lost` reste
> remonté à l'UI (`ErrorBanner`, `src/render/gpuContext.ts`). Détails dans
> `.claude/learning-log.md` (entrée 2026-07-18) et le bandeau RÉSOLU de
> `docs/superpowers/specs/2026-07-17-native-wgpu-decision.md`. Tranche
> panneaux flottants (`FloatingPanel`) TERMINÉE le 2026-07-20 : `Inspector.tsx`
> supprimé, magnétisme entre panneaux uniquement (jamais au bord canvas,
> retiré après test), thème neutre façon Photoshop appliqué (tokens Adobe
> Spectrum réels). 2 checkpoints visuels humains en attente. `PRD-floating-panel-rail.md`
> cadré (rail d'icônes dockable) mais PAS implémenté — brainstorming à faire
> en premier. **Tranche 3 masquage** (Tasks 1-6 : edge-aware guided filter,
> refine edge forme-seule, sources paramétriques dégradé/luminosité/range
> couleur, câblage GPU + UI panneau Masque) **codée et review-clean** au
> 2026-07-20 (`.superpowers/sdd/progress.md`), avec UN gap spec RÉEL non
> détecté par la review Steps 10-12 (verdict "spec ✅" trop optimiste,
> basé sur la section Interfaces du brief Task 6 sans relire le corps du
> Step 10) : le plan
> (`docs/superpowers/plans/2026-07-20-shaderlab-masking-tranche3.md:1616`,
> Step 10 point 2) exigeait une checkbox `enabled` par source de masque dans
> l'UI. **Ce gap est COMBLÉ depuis le 2026-07-21** (`e53ac65`, plan
> `docs/superpowers/plans/2026-07-21-audit-mask-integrity.md`) — mesuré sur
> pièce le 2026-07-30 : `LayerStack.setMaskSourceEnabled(layerId, sourceId,
> enabled): boolean` existe (`src/layers/layerStack.ts:550`, ne commite que
> sur changement réel), `MaskSource` est l'union discriminée
> `BrushMaskSource | ParametricMaskSource` (`src/mask/types.ts:27`, `:41`,
> `:55`), la checkbox est câblée (`src/components/MaskPanel.tsx:249`
> `onMaskSourceEnabledChange`, `src/App.tsx:825`), et six tests la gardent
> (`test/layers/layerStack.test.ts:185-226`, plus la garde de verrou
> `test/layers/layerLock.test.ts:148-153`). Ne pas rouvrir « à trancher » :
> c'est tranché et livré. Le checkpoint visuel
> final (8 points, Task 6 Step 13) est BLOQUÉ : problèmes
> pré-existants sur `FloatingPanel` (thème incohérent, canvas mal centré,
> imbrication panneaux cassée) découverts en tentant ce checkpoint. 2 bugs
> réels déjà corrigés (`3e4f41c` : compensation centrage canvas doublée par
> erreur ; position Réglages suppose Calques toujours à hauteur max). Suite
> à la demande d'Antoine de rapprocher l'UI de Photoshop en ligne, `FloatingPanel`
> (drag libre + magnétisme + nudge clavier) a été **REMPLACÉ** le 2026-07-20/21
> par `PanelColumn`/`DockedPanelCard` (dock fixe à droite ; le splitter vertical
> `react-resizable-panels` de ce plan a ensuite été RETIRÉ le 2026-07-21 par
> `0efdfe4` au profit de cartes dimensionnées par leur contenu) :
> plan `docs/superpowers/plans/2026-07-20-shaderlab-docked-panels.md`
> (8 tâches, review-clean, `src/components/floatingPanel/` entièrement
> supprimé). Le checkpoint visuel humain (Task 8) a été fait via CDP +
> confirmation Antoine EN DIRECT dans la conversation — 3 demandes de suite
> en sont sorties (pas des bugs, des manques identifiés à l'usage) :
> réordonner les cartes par glisser-déposer, redimensionner la colonne en
> largeur, thème visuel encore trop éloigné de Photoshop web. Design doc
> `docs/superpowers/specs/2026-07-21-shaderlab-panel-drag-reorder-design.md`
> + plan combiné `docs/superpowers/plans/2026-07-21-shaderlab-dock-reorder-and-theme-polish.md`
> couvrent 2 des 3 : drag-to-reorder (Tasks 4-7 du plan) et thème réduit à
> une échelle d'ombres nommée (`--shadow-dragging`/`--shadow-popover`, Tasks
> 1-2) + ratio padding boutons (Task 3) — **en cours d'exécution par Codex au
> 2026-07-21** (Tasks 1-5/8 committées au dernier point de contrôle : tokens
> d'ombre, application popovers, padding boutons, extraction
> `src/ui/dragReorder.ts`, migration `LayerPanel` — vérifier `git log` pour
> l'avancement réel avant de repartir dessus). **Redimensionnement en
> largeur de la colonne** (3e demande, 240-400px déjà bornés via
> `--inspector-width-min/max`) : PAS DANS CE PLAN — oublié lors de la
> combinaison des chantiers. Un plan séparé A BIEN été écrit le 2026-07-21
> (`docs/superpowers/plans/2026-07-21-shaderlab-dock-width-resize.md`,
> `2bcae3a`) — ⚠️ ce bandeau affirmait à tort "pas encore écrit" jusqu'au
> 2026-07-21 (trouvé seulement via `git ls-files` complet, jamais relu avant).
> NON exécuté, et maintenant PÉRIMÉ : il cible l'ancienne API
> `panelOrder`/`onReorder` de `PanelColumn`, remplacée le 2026-07-21 par
> `layout`/`onMove` (plan dock-grid, grille 2D) — à réécrire avant toute
> exécution. Un audit clean-code du 2026-07-21 a aussi produit 3 plans dormants
> jamais exécutés (`docs/superpowers/plans/2026-07-21-audit-{mask-integrity,
> document-export-safety,ui-runtime-hygiene}.md` + design
> `docs/superpowers/specs/2026-07-21-audit-remediation-design.md`) — le plan
> mask-integrity Task 3 comble justement le gap checkbox `enabled` par source
> cité plus bas dans ce bandeau. `ADR-0001` (buffers GPU jetables par frame)
> reste valide et appliqué. Le checkpoint Tranche 3 masquage (gap spec
> checkbox `enabled` par source, voir plus haut) reste à refaire une fois
> CE remplacement de panneaux stabilisé — pas encore retenté depuis.
> **MISE À JOUR 2026-07-21 (session checkpoint Task 8)** : `feature/mask-integrity`
> MERGÉ (`769ed60`, gap checkbox `enabled` par source enfin comblé, 3
> worktrees morts nettoyés : `ui-audit-remediation`/`beautiful-wing-eca6ea`/
> `nervous-leakey-2d5e24`). Le checkpoint visuel Task 8 (dock-reorder-and-theme-polish)
> a démarré normalement mais a fait remonter 9 bugs/incohérences réels en
> cours de route (pas de simples ajustements cosmétiques) — tous corrigés
> dans `959d9ed` : hover de "Fichier" totalement cassé (`var(--secondary)`
> inexistant dans une formule `color-mix` Tailwind → transparent au survol),
> `--surface-inset` était le SEUL token resté sur l'ancienne palette chaude
> pré-migration Spectrum (`#141210`, jamais migré le 2026-07-20), Select
> (`src/ui/Select.tsx`) avait 2 bugs d'interaction réels (le listener
   `scroll` capture fermait la liste sur son PROPRE scroll interne ; `scrollIntoView`
> se déclenchait sur `onMouseEnter` et se battait avec un scroll manuel).
> "Masque" extrait de `ParamPanel` en panneau docké séparé (nouveau
> `src/components/MaskPanel.tsx`, 3e carte du dock). Plusieurs rangs de
> padding/espacement corrigés (marge extérieure d'un contrôle plus petite
> que son propre padding interne — violait la règle du socle `rules/ui.md`
> § Espacement). Voir `.claude/learning-log.md` (entrée 2026-07-21) pour le
> pattern méthode extrait de cette session (trop de micro-fixes séquentiels
> — un audit token/CSS large en amont en aurait capturé plusieurs d'un coup).

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
Vite · **WebGPU/WGSL brut** (pas de lib de rendu) · Vitest (Node env, aucun
test ne rend de composant React — même convention que track-finder).

**UI** : Tailwind v4 (`@tailwindcss/vite`) + `shadcn/ui` (style `base-ui`,
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
- **Toutes les textures couleur au format sRGB préféré de la plateforme**
  (`${navigator.gpu.getPreferredCanvasFormat()}-srgb` — donc `bgra8unorm-srgb`
  sur Windows/D3D12, `rgba8unorm-srgb` ailleurs ; voir `gpuContext.ts:68-69`) —
  conversion sRGB↔linéaire automatique par le format, JAMAIS de gamma manuel en
  WGSL. Sans ça, glow/grain/blur sont mathématiquement faux (constat d'audit).
  (Le canal ordre bgra vs rgba est transparent en WGSL via `textureSample` ;
  ne jamais coder `rgba8unorm-srgb` en dur — c'est faux sur Windows.)
- **Pas de distinction preview/export** — un seul pipeline, résolution
  native, toujours (décision utilisateur explicite, pas de downscale).
- JPEG traité comme sRGB, pas de lecture de profil ICC en v1 (limitation
  documentée, pas silencieuse).
- Effets = modules autonomes enregistrés dans `src/render/effects/registry.ts`
  — en ajouter un = un nouveau fichier, zéro modif moteur/UI.
- Modes de fusion = modules autonomes dans `src/render/blend/registry.ts`
  (même principe, Tranche 1 2026-07-19) — chaque calque a `opacity`/
  `blendMode` sur `LayerState`.

## Commandes

- Dev : `npm run tauri dev` (lance Vite + la fenêtre native, tout-en-un)
- Build frontend seul : `npm run build` (tsc + vite build)
- Tests unitaires : `npm run test` (Vitest, projet `unit` uniquement)
- Tests de stories : `npm run test-storybook` (Vitest + Playwright chromium, projet `storybook`) · `npm run test:all` pour les deux
- Shaders GPU : `npm run test:gpu-shaders` (`scripts/gpu-shader-check.mjs`)
- Type-check : `npx tsc --noEmit`
- Lint tokens design : `npm run lint:tokens` (détecte couleurs/z-index/spacing en dur qui contournent un token existant, `scripts/lint-tokens.mjs`)
- Rust : `cd src-tauri && cargo check`
- Storybook (composants React isolés, tokens réels via `src/design/index.css`) : `npm run storybook` (dev, port 6006) · `npm run build-storybook` (static)

## Structure (état réel)

```
src/
  render/
    gpuContext.ts       — init WebGPU (device/context/format srgb)
    effects/            — (Task 5+) registry + un fichier par effet
    blend/              — (Tranche 1, 2026-07-19) registry de modes de fusion
  layers/               — (Task 4+) LayerStack, History (logique pure, testée)
  mask/                 — (Task 9+) MaskPainter (pinceau à falloff radial)
  export/               — (Task 10+) buildCopyPath, exportImage
  components/           — (Task 11+) LayerPanel/ParamPanel/Canvas/Toolbar
  launch.ts             — (Task 3+) wrappers get_launch_path/write_image_file
src-tauri/              — coquille Rust (main.rs shim → lib.rs run())
test/                   — miroir de src/, fixtures réelles
docs/superpowers/
  changes/2026-07-12-shaderlab-mvp/design.md   — spec (source de vérité)
  plans/2026-07-12-shaderlab-mvp.md            — plan 16 tâches
.superpowers/sdd/       — ledger subagent-driven-dev (progress.md, briefs,
                          reports, diffs de review) — scratch git-ignoré
```

## Méthode

- Exécution en cours via `superpowers:subagent-driven-development` : un
  sous-agent frais par tâche du plan, revue spec+qualité après chaque tâche,
  fixes puis re-revue, ledger dans `.superpowers/sdd/progress.md`. **Vérifier
  le ledger avant de (re)dispatcher quoi que ce soit.**
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
- **Autonomie terminal de l'agent** : l'agent est autorisé à lancer lui-même les
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
  depuis des captures d'écran.
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

## Moyen de preuve (UI) — déclaré (règle CLAUDE.md/AGENTS.md global)
**Playwright headless est INADAPTÉ ici** : le canvas WebGPU en WebView2 rend noir
en headless (aucun rendu GPU) — un screenshot Playwright serait un œil aveugle qui
dit « vu ». **Preuve UI = CDP sur la vraie fenêtre WebView2** (`--remote-debugging-port=9222`,
voir Méthode ci-dessus) + checkpoint visuel humain. Le screenshot Playwright vaut
seulement pour un futur écran web pur sans canvas GPU.

## Risques ouverts / gates

- VRAM : ~96 Mo par texture RGBA 24MP, multiplié par ping-pong + masques —
  à mesurer à l'usage réel, pas de budget théorique figé.

La dépose du round-trip Lightroom figurait ici comme dette ouverte ; elle a été
faite le 2026-07-30 (voir § Quoi).

Deux gates de la phase MVP ont été retirées d'ici le 2026-07-29 : le go/no-go
WebGPU dans WebView2 (Task 2) est levé depuis longtemps — le pipeline rend, les
shaders compilent (`npm run test:gpu-shaders`) et le rendu est verrouillé au
pixel (`npm run test:render`) ; « valider le round-trip avec un vrai
Lightroom » (Task 3) est sans objet, puisqu'on le retire au lieu de le valider.

## Index des documents docs/

`docs/INDEX.json` (référence, ~330 lignes) — À LIRE À LA DEMANDE (Read tool)
quand tu cherches le statut d'un chantier/plan spécifique, PAS importé
automatiquement. L'import `@` qui vivait ici collait 71,8 Ko de JSON dans le
contexte à chaque session, en contradiction directe avec CLAUDE.md
§ « Index des documents docs/ » qui déclare ce fichier à lire à la demande ;
retiré le 2026-07-28 pour aligner les deux.

## Wireframe & tokens
Source de tokens canonique (à viser pour tout wireframe `interface-design`) :
`src/design/primitives.css` + `src/design/semantic.css` + `src/design/components.css`
(vraies valeurs CSS dans `:root`). _Éviter_ comme source de valeurs :
`docs/design-system/tokens.md` et `.interface-design/system.md` (contrat/résumé
d'intention, peut retarder sur le CSS — ex. `--outline-contrast` existe dans
semantic.css mais pas dans tokens.md). Wireframes de feature → `docs/wireframes/<feature>.html`.

## Outillage / routage skills

Même règle impérative que tous les projets (`~/.claude/CLAUDE.md`, section
routage skills). Inventaire = la vue générée `~/.claude/skills-view.md`
(remplace l'ex-`docs/skills-registre.md`, supprimé). Packs de contexte (sizing) :
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
