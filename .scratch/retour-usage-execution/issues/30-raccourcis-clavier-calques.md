# 30 — Raccourcis clavier des gestes de calque

**What to build:** Les gestes de calque livrés hier (tickets 27/28/29 — Tampon,
Fusionner, Dupliquer, Supprimer) n'ont AUCUN raccourci clavier. Photoshop les
porte tous ; on reprend ses touches, sur Windows donc `Ctrl`, jamais `Cmd` :

- `Ctrl+Alt+Maj+E` — Aplatir en nouveau calque (Tampon, « stamp visible »).
- `Ctrl+E` — Fusionner avec le dessous.
- `Ctrl+J` — Dupliquer.
- `Suppr` / `Retour arrière` — Supprimer le calque sélectionné, SEULEMENT quand
  le focus n'est pas dans un champ de saisie ni sur la toile en mode pinceau (un
  trait de pinceau ne doit pas se muer en suppression de calque).

Chaque raccourci appelle le MÊME handler que le bouton / l'item de menu — aucun
chemin d'exécution neuf — et respecte le même verdict : un raccourci REFUSÉ
(plafond photo, fond sans dessous, calque verrouillé) affiche la raison dans la
bannière d'erreur existante (`setError`), comme `handleStamp` le fait déjà. Un
bouton grisé DIT pourquoi en infobulle ; un raccourci n'a pas d'état grisé, donc
il DIT pourquoi dans la bannière.

Les infobulles des boutons de la zone de contrôles ET les items du menu
contextuel affichent le raccourci (`ContextMenuShortcut`, primitive déjà présente
dans `context-menu.tsx`).

**Blocked by:** None — les handlers et les verdicts existent (tickets 27/28/29).

**Status:** ready-for-agent
**Type:** task

## Ce qui existe déjà (mesuré sur disque le 2026-09-10)

- DEUX écouteurs `keydown` sur `window` dans `App.tsx` : celui des OUTILS
  (`ui/tools.ts` : V/B/E/U + Échap, garde champ-de-saisie robuste
  `isTextEntryTarget`) et celui des commandes Ctrl (Ctrl+Z/Y/I, pattern
  « latest ref » `shortcutsRef`). On RÉUTILISE le second — pas de troisième
  écouteur.
- Verdicts PURS partagés : `stampVerdict` / `mergeDownVerdict`
  (`layers/flatten.ts`), `isFullyLocked` (`layers/layerLocks.ts`), la garde de
  plafond photo de `duplicateLayer.ts`.
- `isTextEntryTarget` (`ui/tools.ts`) : un `input[type=range]` GARDE le focus
  après un réglage souris — la garde large est nécessaire (bug « V ne marche
  pas » du 2026-08-27).

## Décisions prises en implémentant (2026-09-10)

- **Module pur `src/ui/shortcuts.ts`** (`layerActionFromShortcut`,
  `LAYER_SHORTCUT_LABELS`, type `LayerAction`) — même convention que `tools.ts`
  (frappe en données extraites, testable en Node). Décode par `code` PHYSIQUE
  pour les lettres (`KeyE`/`KeyJ`, stable AZERTY — `Ctrl+Alt` EST AltGr) et par
  `key` pour les touches nommées (`Delete`/`Backspace`). Modificateur principal =
  `ctrlKey || metaKey` (parité avec Ctrl+Z/Y/I).
- **Câblé dans le SECOND écouteur** (celui des Ctrl) : un bloc en tête décode la
  commande de calque avec la garde robuste `isTextEntryTarget`, puis retombe sur
  le bloc Ctrl+Z/Y/I inchangé. `Suppr`/`Retour arrière` se taisent quand l'outil
  actif est pinceau/gomme (mode peinture).
- **Refus → `setError`** : `handleStamp` et `duplicateLayer` affichent déjà leur
  raison ; pour Fusionner et Supprimer, le dispatcher lit le verdict PUR et
  appelle `setError` avec la MÊME chaîne que l'infobulle du bouton, jamais une
  copie.
- **Affichage du raccourci** : infobulles des boutons (`LayerControls`) et items
  de menu (`layerActionsMenu.tsx`, `ContextMenuShortcut` posé `aria-hidden` — le
  nom accessible de l'item reste l'action, le raccourci est une aide VISUELLE
  doublée par l'infobulle du bouton).

- [x] Module pur `src/ui/shortcuts.ts` + tests unit (`test/ui/shortcuts.test.ts`, 11 cas).
- [x] Câblage dans l'écouteur `keydown` existant (le second, celui des Ctrl) — aucun troisième mécanisme.
- [x] `Suppr`/`Retour arrière` inertes en champ de saisie (`isTextEntryTarget`) et en mode pinceau/gomme.
- [x] Refus → bannière d'erreur avec la raison du verdict (verdict PUR partagé).
- [x] Raccourci affiché en infobulle de bouton (`LayerControls`) et en item de menu (`ContextMenuShortcut`).
- [x] Stories mises à jour + gates : `tsc` vert, `lint` vert, `test` 2202, `test-storybook` 366 — tous VÉRIFIÉS EN WORKTREE ISOLÉ (arbre principal pollué par une session concurrente, voir note).
- [ ] `test:render` zéro écart : NON EXÉCUTÉ — bloqué par l'environnement (CDP 9222 = projet Tuple, vite 1421 = session concurrente shaderlab active) ; mais le commit ne contient AUCUN fichier du graphe de rendu, donc les pixels sont inchangés par construction (le harnais n'importe aucun de mes fichiers). À lancer par le parent une fois l'app relancée.
- [ ] Vérifié par CDP : `Ctrl+Alt+Maj+E`/`Ctrl+E` — NON FAIT, même blocage (aucune app shaderlab en cours ; 9222 occupé par Tuple, 1421 par la session concurrente ; relancer collisionnerait sur les deux ports). À lancer par le parent.

## Note environnement (2026-09-10)

Prémisse du brief fausse sur pièce : aucune app shaderlab ne tournait sur CDP 9222
(c'est le projet **Tuple**, `C:\dev\tuple`) et le vite 1421 appartient à une SESSION
CONCURRENTE shaderlab qui édite activement `src/render/*`, `scripts/render-check.mjs`,
`test/scripts/renderRefs.test.mjs`, et ajoute `cadreProjection.ts`/`aquarelle.ts`
(features « recadrage de toile » ticket 32 + aquarelle). Gates lancés dans un
worktree isolé sur HEAD + mes seuls fichiers pour ne pas mêler leur travail. Commit
`git add` par chemins explicites — jamais `-A`.


## Vérifié live par CDP (2026-09-10, session parent)

App sur CDP 9223, photo-1 + Light leak sélectionné : `keydown` `Ctrl+Alt+Maj+E` dispatché sur `document` → la pile passe à `[photo-1.jpg, Light leak, Aplati — Light leak]`. Le mécanisme de touches réel (second écouteur `keydown` d'`App.tsx`) est éprouvé dans la vraie fenêtre. Reste : validation en gestes par Antoine.
