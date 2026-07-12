# shaderlab — CLAUDE.md

> Nom provisoire (placeholder, jamais tranché — même logique que track-finder).
> Repo local `C:\Users\LEETJ\Desktop\shaderlab`, pas encore de remote GitHub.
> Branche de dev active : `feature/mvp-implementation` (master = docs seulement).

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
- **Toutes les textures couleur en `rgba8unorm-srgb`** — conversion
  sRGB↔linéaire automatique par le format, JAMAIS de gamma manuel en WGSL.
  Sans ça, glow/grain/blur sont mathématiquement faux (constat d'audit).
- **Pas de distinction preview/export** — un seul pipeline, résolution
  native, toujours (décision utilisateur explicite, pas de downscale).
- JPEG traité comme sRGB, pas de lecture de profil ICC en v1 (limitation
  documentée, pas silencieuse).
- Effets = modules autonomes enregistrés dans `src/render/effects/registry.ts`
  — en ajouter un = un nouveau fichier, zéro modif moteur/UI.

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
- **Les sous-agents sont headless** : ils ne peuvent PAS vérifier
  visuellement une fenêtre (leçon Task 1 : un implémenteur a pris la ligne
  "Waiting for frontend dev server" pour une preuve de compilation Rust).
  Toute vérification visuelle passe par un checkpoint humain (décision
  utilisateur : c'est lui qui juge, pas de capture computer-use).
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

## Outillage / routage skills

Même règle impérative que tous les projets (`~/.claude/CLAUDE.md`, section
routage skills). Registre projet : `docs/skills-registre.md`. Décisions
d'outillage prises jusqu'ici : cycle complet
`superpowers:brainstorming` → `writing-plans` → `subagent-driven-development` ;
audits de spec via sous-agent `general-purpose` adverse ; recherches
techniques via WebSearch avec vérification des licences (webgpu-image-filter
n'a PAS de licence — inspiration seulement, jamais de copie verbatim).
