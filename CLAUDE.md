# shaderlab — CLAUDE.md

> Nom provisoire (placeholder, jamais tranché). Repo local `C:\dev\shaderlab`,
> remote origin : `github.com/c0remusic/shaderlab`. Branche de dev active : `feature/design-system`.
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
grain), masque au pinceau par calque, undo/redo en session. Fait aussi
office d'**éditeur externe Lightroom** (round-trip type Dehancer : Lightroom
exporte une copie → lance l'app avec le chemin en argument → l'app écrase ce
même fichier → Lightroom réimporte).

Née d'une frustration : aucun plugin Lightroom natif ne peut faire d'effets
shader GPU (pipeline RAW fermé). Positionnement outil perso vs produit
partageable : pas encore tranché, faisabilité d'abord.

**Exigence qualité explicite** : pas de rendu "filtre Photoshop 2005".
Chaque effet a une version pipeline (naïve) puis un upgrade qualité
obligatoire (dual-filter bloom, aberration radiale, warp FBM, grain
luminance-dépendant) — un effet qui marche mais rend cheap n'est pas terminé.

## Stack

Tauri v2 (coquille Rust minimale, lib = `shaderlab_lib`) · React 19 + TS ·
Vite · **WebGPU/WGSL brut** (pas de lib de rendu) · Vitest (Node env, aucun
test ne rend de composant React — même convention que track-finder).

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
  — en ajouter un = un nouveau fichier ; un effet à paramètres groupés (voir
  `EffectParam.colorGroup`) touche aussi `ParamPanel.tsx` et peut élargir
  `MAX_EFFECT_PARAMS` (`shaderCompose.ts`) si nécessaire.
- Modes de fusion = modules autonomes dans `src/render/blend/registry.ts`
  (même principe, Tranche 1 2026-07-19) — chaque calque a `opacity`/
  `blendMode` sur `LayerState`.

## Commandes

- Dev : `npm run tauri dev` (lance Vite + la fenêtre native, tout-en-un)
- Build frontend seul : `npm run build` (tsc + vite build)
- Tests : `npm run test` (Vitest)
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

## Moyen de preuve (UI) — déclaré (règle CLAUDE.md global)
**Playwright headless est INADAPTÉ ici** : le canvas WebGPU en WebView2 rend noir
en headless (aucun rendu GPU) — un screenshot Playwright serait un œil aveugle qui
dit « vu ». **Preuve UI = CDP sur la vraie fenêtre WebView2** (`--remote-debugging-port=9222`,
voir Méthode ci-dessus) + checkpoint visuel humain. Le screenshot Playwright vaut
seulement pour un futur écran web pur sans canvas GPU.

## Risques ouverts / gates

- **Task 2 = go/no-go WebGPU dans WebView2** : code revu et approuvé, en
  attente de confirmation visuelle humaine (fenêtre = canvas rose/rouge uni
  `rgb(0.8, 0.2, 0.4)`). Si ça ne rend pas → toute l'archi est à revoir,
  STOP.
- Contrat round-trip Lightroom = hypothèse documentée (écrasement même
  chemin), à valider empiriquement en Task 3 avec un vrai Lightroom.
- VRAM : ~96 Mo par texture RGBA 24MP, multiplié par ping-pong + masques —
  à mesurer à l'usage réel, pas de budget théorique figé.

## Index des documents docs/

`docs/INDEX.json` (référence, ~280 lignes) — À LIRE À LA DEMANDE (Read tool)
quand tu cherches le statut d'un chantier/plan spécifique, PAS importé
automatiquement : un `@import` charge le fichier entier à chaque session,
quel que soit le besoin réel du tour (doublait le poids de ce CLAUDE.md).

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
