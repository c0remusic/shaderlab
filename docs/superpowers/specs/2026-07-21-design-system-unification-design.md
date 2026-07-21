# Unification du design system

## Objectif

Faire de `src/components/ui/*` l’unique ensemble de primitives interactives,
supprimer `src/ui/*` et ses feuilles de style legacy, puis conserver une seule
chaîne de tokens : primitives, sémantique, composants et thème Tailwind.

## Décisions

- Les composants Base UI/Tailwind restent la destination : `Button`,
  `Toggle`, `Slider`, `DropdownMenu` et `Alert` sont déjà employés par les
  barres d’outils et la bannière d’erreur.
- Les composants manquants sont ajoutés dans `src/components/ui/` avec les
  mêmes besoins métier que leurs équivalents legacy : checkbox contrôlée,
  select de valeur accessible, disclosure, icon button et tooltip.
- Les panneaux gardent leur logique métier. Seuls leurs imports et leur
  composition visuelle changent.
- Les valeurs visuelles sont exposées par les tokens CSS. Les icônes utilisent
  des classes de taille et d’épaisseur basées sur `--icon-size-*` et
  `--icon-stroke`, plutôt que des props numériques dispersées.
- `dragReorder.css` doit être ajouté à la même branche que l’import de
  `PanelColumn.tsx`, pour que le build soit autonome.

## Architecture cible

```
src/design/*                 tokens et mapping Tailwind
src/components/ui/*          primitives interactives uniques
src/components/*             assemblage métier des panneaux et toolbars
src/ui/*                     supprimé après migration complète
```

Les primitives UI ne connaissent pas les calques, les masques ni le rendu.
Elles exposent des props minimales et accessibles. Les panneaux continuent à
traduire les interactions vers les callbacks métier existants.

## Migration

1. Ajouter les primitives manquantes et les tokens/classes d’icônes.
2. Migrer `LayerPanel` et `ParamPanel`, qui consomment encore le système
   legacy, avec des tests de comportement inchangés.
3. Supprimer les imports, composants et CSS legacy une fois les références
   nulles.
4. Ajouter le CSS de réordonnancement manquant au dépôt et vérifier le build.

## Contraintes

- Tauri v2, React 19, TypeScript, Tailwind v4 et Base UI.
- Les tests restent sous Vitest, sans rendu React existant sauf ajout ciblé
  nécessaire à une nouvelle primitive.
- Les couleurs, espacements, z-index, ombres, rayons et durées passent par
  des tokens CSS.
- La preuve visuelle finale reste un checkpoint humain sur la fenêtre WebView2.

## Validation

- Aucun import ne référence `src/ui/*` après migration.
- Aucun fichier legacy ne reste importé par `src/design/index.css`.
- `npx tsc --noEmit`, `npm run lint:tokens`, `npm run test` et
  `npm run build` réussissent.
- Le contrôle statique ne trouve aucune variable CSS indéfinie hors variables
  runtime documentées.
