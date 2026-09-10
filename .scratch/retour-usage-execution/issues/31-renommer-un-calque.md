# 31 — Renommer un calque

**What to build:** `LayerState.name` existe et `LayerStack` le POSE (import photo,
Tampon), mais AUCUN geste ne permet de le CHANGER (constat mesuré le 2026-09-09).
Photoshop : double-clic sur le nom → champ de saisie EN PLACE, `Entrée` valide,
`Échap` annule, clic ailleurs valide. On livre ce geste, plus les accès habituels
(menu contextuel, `F2`).

**Blocked by:** None — `LayerState.name` et son affichage existent (`LayerPanel`).

**Status:** ready-for-agent
**Type:** task

## Ce qui existe déjà (mesuré sur disque le 2026-09-10)

- `LayerState.name?: string` — affiché par `LayerRow` (`layer.name ?? getEffect(
  layer.effectId).name`), posé par `addPhotoLayer` (basename), `setLayerImageSource`
  et le Tampon ; jamais modifié après coup.
- Patron de renommage EN PLACE déjà éprouvé : `PresetPanel` (double-clic →
  `<input autoFocus>`, `select()` au focus, `Entrée` → `blur` → commit, `Échap`
  annule via un `cancelledRef` qui neutralise le piège du `blur` au démontage).
- Menu contextuel partagé `LayerActionsMenuItems` (tickets 28/29) — l'entrée
  « Renommer… » s'y ajoute une fois pour les DEUX menus (pile + toile).
- Mécanisme de raccourcis de la tranche A (`ui/shortcuts.ts`) — `F2` s'y greffe.
- Pas de primitive `src/components/ui/input.tsx` (vérifié) : le champ est un
  `<input>` nu habillé en CSS BEM (`layer-panel__row-rename`).

## Décisions prises en implémentant (2026-09-10)

- **`LayerStack.renameLayer(id, name)`** : nom rogné, vidé → `undefined` (retour au
  nom d'effet), **AUCUN verrou consulté** (renommer n'est pas structurel — Photoshop
  renomme un calque verrouillé), discipline no-op (false si inchangé), mutation
  scalaire en place comme `setLayerEffect`/`setLayerImageSource`. Test unit
  (`test/layers/renameLayer.test.ts`, 10 cas, dont le voyage dans l'historique).
- **Champ EN PLACE** : sous-composant `LayerNameEdit` (`LayerPanel.tsx`), monté
  seulement pendant l'édition. Patron de `PresetPanel` (autoFocus + select, Entrée
  → blur → commit, Échap → annule via `cancelledRef`, commit/annule une seule fois
  via `doneRef`). Prérempli du nom EXPLICITE : un calque d'effet jamais nommé ouvre
  un champ VIDE dont le placeholder est le nom d'effet — valider vide reste alors un
  no-op propre côté modèle. Hauteur `--control-height-sm` < hauteur de ligne : la
  ligne NE GRANDIT PAS (ADR-0001).
- **Un seul champ à la fois** : `renamingId` est un état d'INTERFACE tenu par `App`
  (comme l'ouverture du sélecteur), pas le modèle — rien à annuler à l'ouverture.
  Le double-clic, « Renommer… » (les deux menus) et `F2` l'ouvrent tous.
- **Un pas d'undo par renommage** : le commit passe par `LayerStack.renameLayer`
  + `commit` (`App.handleRename`). Pas de `clearActivePreset` : un preset ne
  capture PAS `layer.name` (`presetDocument.capture`), donc renommer ne diverge
  d'aucun snapshot de preset.
- **Handler dans `App.tsx`** (câblage), aucune logique dans `components/`.

- [x] `LayerStack.renameLayer(id, name)` + test unit (`renameLayer.test.ts`).
- [x] Double-clic sur le nom → `<input>` en place, commit `Entrée`/blur, annule `Échap`.
- [x] Entrée « Renommer… » en TÊTE de `LayerActionsMenuItems` (donc les deux menus).
- [x] `F2` sur la ligne sélectionnée (mécanisme de la tranche A).
- [x] Un pas d'undo par renommage (`commit`).
- [x] Stories (édition, annulation, vide → nom d'effet, double-clic) + gates
      `tsc`/`lint`/`test`/`test-storybook` — vérifiés en worktree isolé.
- [ ] `test:render` zéro écart + CDP live : bloqués par l'environnement (voir
      ticket 30, § Note environnement) ; renommage ne touche AUCUN fichier de
      rendu, pixels inchangés par construction. À lancer par le parent.

## Note environnement (2026-09-10)

Même blocage que le ticket 30 : CDP 9222 = projet Tuple, vite 1421 = session
concurrente shaderlab active sur `src/render/*`. Gates lancés en worktree isolé
sur HEAD + mes seuls fichiers. Commit `git add` par chemins explicites, jamais `-A`.
