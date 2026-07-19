# shaderlab — AGENTS.md

> Nom provisoire (placeholder, jamais tranché — même logique que track-finder).
> Repo local `C:\dev\shaderlab`, pas encore de remote GitHub. (Déplacé depuis
> `C:\Users\LEETJ\Desktop\shaderlab` — l'ancien chemin n'existe plus ; une
> relocalisation d'un repo Tauri exige un `cargo clean` COMPLET : le cache
> `target/` contient des chemins absolus périmés qui cassent le build-script.)
> Branche de dev active : `feature/design-system` (MVP mergé sur master ;
> `feature/archi-remediation` mergé le 2026-07-16). ✅ Le crash de peinture au
> masque à 24MP est RÉSOLU le 2026-07-18 (`e3c7584`) : la cause n'était NI le
> GPU NI le driver mais le buffer `maskData` r8 de ~26 Mo transitant par le
> state React, qui fait hanger WebView2 au re-render de `setLayers()` en fin
> de stroke (les 3 fix précédents — dirty-rect, GPU-copy, wait-for-idle —
> ciblaient tous le GPU/timing, d'où leur échec). Fix : `maskData` hors du
> state React (`src/layers/displayProjection.ts`, `toDisplayLayers`). Règle
> héritée : garder les gros buffers/textures de masque HORS du state React.
> Tranche 1 (blend + opacité par calque, `src/render/blend/`) livrée le
> 2026-07-19. Détails : `.claude/learning-log.md` et la mémoire projet
> `design-system-branch-reconciliation`.

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

Décisions techniques verrouillées (voir design.md pour les preuves) :
- **Toutes les textures couleur au format sRGB préféré de la plateforme**
  (`${navigator.gpu.getPreferredCanvasFormat()}-srgb` — donc `bgra8unorm-srgb`
  sur Windows/D3D12, `rgba8unorm-srgb` ailleurs ; voir `gpuContext.ts:68-69`) —
  conversion sRGB↔linéaire automatique par le format, JAMAIS de gamma manuel en
  WGSL. Sans ça, glow/grain/blur sont mathématiquement faux (constat d'audit).
  Ne jamais coder `rgba8unorm-srgb` en dur — c'est faux sur Windows.
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
- Tests : `npm run test` (Vitest)
- Type-check : `npx tsc --noEmit`
- Rust : `cd src-tauri && cargo check`

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
  specs/2026-07-13-shaderlab-standalone-v1-design.md — spec (source de vérité)
  plans/2026-07-13-shaderlab-design-system.md        — plan design system en cours
  changes/2026-07-12-shaderlab-mvp/design.md         — historique, remplacé le 2026-07-13
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

@docs/INDEX.json

## Wireframe & tokens
Source de tokens canonique (à viser pour tout wireframe `interface-design`) :
`src/design/primitives.css` + `src/design/semantic.css` + `src/design/components.css`
(vraies valeurs CSS dans `:root`). _Éviter_ comme source de valeurs :
`docs/design-system/tokens.md` et `.interface-design/system.md` (contrat/résumé
d'intention, peut retarder sur le CSS — ex. `--outline-contrast` existe dans
semantic.css mais pas dans tokens.md). Wireframes de feature → `docs/wireframes/<feature>.html`.

## Outillage / routage skills

Même règle impérative que tous les projets (`~/.Codex/AGENTS.md`, section
routage skills). Inventaire = la vue générée `~/.claude/skills-view.md`
(remplace l'ex-`docs/skills-registre.md`, supprimé). Packs de contexte (sizing) :
`.claude/rules/context-packs.md`. Décisions d'outillage prises jusqu'ici : cycle complet
`superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` ;
audits de spec via sous-agent `general-purpose` adverse ; recherches
techniques via WebSearch avec vérification des licences (webgpu-image-filter
n'a PAS de licence — inspiration seulement, jamais de copie verbatim).
