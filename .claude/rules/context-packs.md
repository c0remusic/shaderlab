# Packs de contexte (sizing) — shaderlab

Menus de 3-8 fichiers par type de tâche (l'orchestrateur choisit, ne colle pas
tout). Concept de sizing dans `~/.claude/CLAUDE.md` § Sizing. Migré depuis
l'ex-`docs/skills-registre.md` (supprimé 2026-07-16). Chemins vérifiés sur disque.
Référencé par `CLAUDE.md` § Méthode.

## Pack moteur de rendu / effets
- `docs/superpowers/changes/2026-07-12-shaderlab-mvp/design.md` (sections
  Architecture + Barre de qualité).
- Le fichier effet concerné (`src/render/effects/*`).
- `src/render/renderer.ts` · `src/render/gpuContext.ts`.

## Pack UI
- `design.md` (section UI).
- `src/components/*` · `src/App.tsx` · `src/layers/*`.

## Pack export / IPC fichier
- `src/launch.ts` · `src-tauri/src/lib.rs` · `src/export/*`.
- Le round-trip Lightroom que ce pack servait est déposé (ADR-0002, code retiré
  le 2026-07-30) : ne plus charger la section « Contrat de round-trip » de
  `design.md`, elle décrit un mécanisme qui n'existe plus.

## Reprise de session
- `.superpowers/sdd/progress.md` (ledger) + ce fichier + `docs/INDEX.json`.
- Ne jamais re-dispatcher une tâche marquée `complete` dans le ledger.
