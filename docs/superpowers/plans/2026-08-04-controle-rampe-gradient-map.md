# Contrôle de rampe Gradient Map — plan d'implémentation

> Source : `../specs/2026-08-04-controle-rampe-gradient-map-design.md`.
> Tranche 3 du plan global des contrôles d'effets.

## État au 2026-08-04

- Tasks 1 à 5 : **implémentées et review-clean techniquement**.
- Gates : 1 742 tests unitaires, 301 tests Storybook, 154 compositions WGSL,
  type-check/build et lint tokens verts.
- WebView2 réelle : rampe affichée, extrémités non rognées, sélecteur couleur,
  clavier, historique et absence de double scroll vérifiés.
- Checkpoint humain final : en attente.

## Task 1 — Modèle pur

- Définir les rôles `midPosition`, `blackPoint`, `whitePoint` et leur clamp.
- Tester drag, clavier, non-croisement et restauration sur cancel.

## Task 2 — Contrat déclaratif

- Ajouter `ColorRampControl` aux types d'effet et à `validateEffect`.
- Déclarer la rampe trois arrêts dans `gradientMap`.
- Vérifier que chaque paramètre cité existe une seule fois.

## Task 3 — Composant

- Construire `ColorRampControl.tsx/.css` avec tokens existants.
- Réutiliser `ColorPickerPanel` via le callback de `ParamPanel`.
- Ajouter stories identité visuelle, positions modifiées, verrou et cancel.

## Task 4 — Intégration

- Rendre la déclaration dans `ParamPanel` et exclure les douze paramètres des
  contrôles génériques.
- Vérifier live/commit, historique, presets et absence de doublon React.

## Task 5 — Preuve

- Unit, Storybook, type-check, tokens, build et shaders.
- Vraie WebView2 : couleurs, trois poignées, clavier, undo/redo et console.
- Checkpoint humain avant clôture de la tranche.
