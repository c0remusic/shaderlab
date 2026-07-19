# shaderlab — PRD : migration vers shadcn/ui

> Cadré via `interview` le 2026-07-20, en session croisée avec Sift (voir
> `C:\dev\sift\docs\superpowers\changes\2026-07-20-shadcn-react-migration\design.md`
> pour le pendant Sift, planification seulement). Le QUOI et le POURQUOI ; le
> COMMENT détaillé (ordre des composants, découpage en tâches) se conçoit via
> `superpowers:brainstorming` à partir de ce document.

## Contexte

shaderlab a déjà son propre design system CSS (`src/design/primitives.css`,
`semantic.css`, `components.css`) construit et documenté cette session
(z-index, tokens couleur/spacing, lint automatique via `scripts/lint-tokens.mjs`).
Le maintenir en parallèle du design system de Sift (tokens différents, mêmes
catégories de composants à recoder à chaque projet) coûte trop cher à faire
évoluer. shaderlab est déjà React + Vite + Tailwind — c'est le projet où
`shadcn/ui` s'installe directement, sans migration de framework au préalable
(contrairement à Sift, cf. document lié ci-dessus).

## Objectif

Adopter `shadcn/ui` comme base de composants pour shaderlab, en conservant
l'identité visuelle propre du projet (palette actuelle mappée dans le thème
shadcn, pas de fusion avec shaderlab/Sift/Tuple).

## Comportements (quand X → Y)

- Quand un nouveau composant UI est nécessaire (dialog, dropdown, table,
  select, etc.) → il est installé via la CLI shadcn (`npx shadcn@latest add
  <composant>`) plutôt qu'écrit à la main.
- Quand un composant existant (`Toolbar`, `BrushToolbar`, `ErrorBanner` —
  déjà storyés cette session) est migré → son comportement observable reste
  identique (mêmes états, mêmes interactions), seule l'implémentation change.
- Quand un token de couleur/spacing/radius change → la modification se fait
  une seule fois (thème shadcn/Tailwind + `src/design/*.css` comme source de
  valeurs de marque), sans resynchronisation manuelle composant par composant.
- Quand Storybook tourne (`npm run storybook`) → les stories reflètent les
  composants shadcn migrés au fur et à mesure, avec les vrais tokens du projet
  (déjà branché via `preview.ts` → `src/design/index.css`).

## Hors-scope explicite

- Unifier visuellement shaderlab avec Sift ou Tuple — chaque projet garde sa
  propre palette par-dessus la même base de composants.
- Migrer Sift dans ce chantier — traité séparément, planification seulement
  pour l'instant (voir document lié).
- Toucher Tuple — exclu, aucun chemin d'intégration shadcn possible (device
  Max/jweb).
- Ajouter un outil de commentaire/review visuel (Chromatic ou équivalent) —
  explicitement écarté à cette étape par Antoine ; Storybook reste une
  visionneuse seule.
- Toucher au code Rust/Tauri (`src-tauri/`) ou au travail en cours d'une autre
  session sur ce repo (masking tranche 2, `TECH_DEBT_AUDIT.md`,
  `src/layers/`, `src/mask/`) — ce chantier se limite à `src/design/`,
  `src/components/`, config Tailwind/shadcn.

## Contraintes d'inacceptable

**Fenêtre de coupure acceptée** (décision Antoine) : la migration peut se
faire en une fois par composant, sans exiger que chaque composant reste
utilisable pendant sa propre transition. Mais :
- Aucune régression fonctionnelle constatée sans être corrigée avant de
  déclarer un composant migré.
- Le lint de tokens existant (`npm run lint:tokens`) doit rester vert (ou ses
  violations expliquées) après migration — pas de retour en arrière sur la
  discipline de tokens déjà mise en place cette session.

## Terminé = démontrable

shadcn/ui installé et opérationnel (`components.json` en place), au moins les
composants déjà storyés cette session (`Toolbar`, `BrushToolbar`,
`ErrorBanner`) migrés et fonctionnels, vérifiés visuellement (Storybook +
lancement réel de l'app) et par le lint de tokens.

## Annexe — Choix techniques déduits

- **shadcn/ui + `components.json`** — CLI officielle, s'installe directement
  sur la stack React 19 + Vite 6 + Tailwind déjà en place, confirmé compatible
  (peer deps déjà vérifiées pour Storybook cette session, même stack).
- **`src/design/primitives.css`/`semantic.css` comme source de valeurs de
  marque** — mappées dans la config Tailwind/thème shadcn plutôt que
  redécidées ; pas de nouvelle palette.
- **Migration composant par composant**, pas big-bang sur tout `src/components/`
  — réduit le risque, chaque composant migré est vérifiable indépendamment via
  Storybook.
- **Storybook existant réutilisé tel quel** comme preuve visuelle de chaque
  composant migré (déjà branché sur les vrais tokens, addon a11y installé
  cette session).

---

**PRD prêt.** Prochaine étape : `superpowers:brainstorming` pour découper la
migration en tranches verticales (quel composant en premier, comment gérer les
composants qui n'ont pas d'équivalent shadcn direct comme le canvas WebGPU) —
à lancer quand Antoine valide ce document.
