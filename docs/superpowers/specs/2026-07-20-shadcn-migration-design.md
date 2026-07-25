# Migration shadcn/ui — design

> Cadré via `interview` (`docs/prd-shadcn-migration.md`, ex-`PRD.md` racine —
> déplacé le 2026-07-24 quand `PRD.md` est devenu le PRD projet-entier) puis
> `brainstorming` le 2026-07-20.
> QUOI : `docs/prd-shadcn-migration.md`. COMMENT : ce document.

## Contexte

`docs/prd-shadcn-migration.md` fixe le QUOI : migrer shaderlab vers `shadcn/ui` composant par
composant, palette actuelle conservée, fenêtre de coupure acceptée. Ce document
fixe le COMMENT.

**Correction de constat (vérifiée sur disque, pas supposée)** : shaderlab n'a
PAS Tailwind installé aujourd'hui (aucun `tailwind.config`/`postcss.config`,
rien dans `package.json`) — contrairement à ce que le PRD supposait ("déjà
React+Tailwind"). shadcn/ui suppose Tailwind par construction ; Antoine a
tranché : on l'ajoute (tranche 1), pas de contournement sans Tailwind.

**Constat Canvas** : `Canvas.tsx` (rendu WebGPU) n'a pas de "chrome" shadcn-isable
au sens composants UI — c'est un wrapper canvas + curseur pinceau custom en
manipulation DOM directe, pas de boutons/panels dedans. La bordure/l'ombre déjà
tokenisées (`Canvas.css`, cette session) restent en CSS classique. Hors-scope
de ce chantier, pas un choix arbitraire — juste rien à migrer là.

## Architecture

- **Tailwind v4 + `@tailwindcss/vite`** (intégration Vite native, pas de
  PostCSS séparé — moins de pièces mobiles que Tailwind v3).
- **`shadcn/ui` CLI** (`npx shadcn@latest init` puis `add <primitive>`) —
  génère `components.json` + `src/components/ui/*.tsx` (code source copié dans
  le repo, pas une dépendance npm classique — c'est le modèle shadcn).
- **Thème mappé, pas dupliqué** : les valeurs Tailwind/shadcn (couleurs, radius,
  spacing) lisent `src/design/primitives.css`/`semantic.css` comme source —
  aucune palette Tailwind par défaut, aucune resynchronisation manuelle entre
  deux systèmes de tokens.
- **Storybook `preview.ts`** importe le CSS Tailwind compilé EN PLUS de
  `src/design/index.css` déjà importé (retour d'expérience de l'article
  polipo.io — le seul point actionnable qu'il apportait).

## Tranches (verticales, chacune démontrable seule)

1. **Fondation** — installer Tailwind v4 + init shadcn (`components.json`),
   mapper le thème sur `src/design/*.css`. Aucun composant migré. Démontrable :
   Storybook + app tournent à l'identique visuellement (screenshot avant/après
   comparé), `npm run lint:tokens` toujours vert.
2. **ErrorBanner → shadcn `Alert`** — composant le plus simple, déjà storyé
   (2 états : warning/danger). Démontrable : story rendue identique visuellement,
   props/interface publique inchangées côté appelants.
3. **Toolbar → shadcn `Button` + `ToggleGroup`** — états déjà storyés
   (undo/redo, erase mode). Démontrable : mêmes états, mêmes interactions
   clavier/souris, story + app vérifiées.
4. **BrushToolbar → shadcn `Button` + `Slider`** — dernier composant storyé
   cette session. Démontrable : mêmes états (2 storyés), slider fonctionnel.

Chaque tranche = 1 commit distinct, vérifié avant de passer à la suivante.

## Hors-scope explicite

- `Inspector`, `LayerPanel`, `ParamPanel`, `Canvas` — non touchés, non storyés
  actuellement, pas demandés dans ce chantier.
- Sift, Tuple — traités séparément (Sift : planification seulement, voir son
  propre document ; Tuple : exclu, cf. `docs/prd-shadcn-migration.md`).
- Chromatic / outil de commentaire visuel — explicitement écarté.

## Erreurs / limites

- Si un composant migré introduit une régression visuelle ou comportementale
  détectée en vérification (Storybook, app, ou lint), la tranche n'est pas
  déclarée terminée tant que ce n'est pas corrigé — pas de "migré avec bug
  connu".
- Si `npm run lint:tokens` régresse (nouvelle valeur en dur introduite par un
  composant shadcn généré), corriger avant de committer la tranche.

## Vérification (par tranche)

1. Storybook (`npm run storybook`) — rendu visuel du/des composant(s) concernés.
2. `npm run lint:tokens` — vert ou régressions expliquées.
3. `npm run dev` — lancement réel de l'app, vérification manuelle rapide.
4. 1 commit par tranche, pathspec explicite.

## Test

Pas de suite de tests automatisés existante pour ces composants UI
(`vitest` est configuré côté projet mais aucun test actuel ne couvre
`Toolbar`/`BrushToolbar`/`ErrorBanner`). Vérification = visuelle (Storybook)
et manuelle (app), pas de nouveaux tests unitaires exigés par ce chantier —
cohérent avec l'état actuel du repo, pas une régression introduite ici.

---

**Design validé par Antoine (2026-07-20).** Prochaine étape :
`superpowers:writing-plans` pour transformer ces 4 tranches en plan d'exécution
détaillé.
