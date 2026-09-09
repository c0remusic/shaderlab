# 28 — Menu contextuel (clic droit) sur la pile et la toile

**What to build:** Antoine, 2026-09-09, après la livraison d'Aplatir (ticket 27) :
« on a pas de click droit dans notre app pour faire toutes ces choses ».
Mesuré sur disque : **zéro `onContextMenu` dans `src/`**, et WebView2 sert
donc son menu de navigateur par défaut (« Actualiser », « Inspecter »…) partout
où l'on clique droit. Photoshop et Lightroom ont un menu contextuel sur chaque
objet : la ligne d'un calque (Dupliquer, Supprimer, Fusionner avec le calque
inférieur, Pixelliser, Aplatir l'image, Verrouiller…), la toile (sous l'outil
Déplacement : la liste des calques sous le curseur), la vignette (Lightroom).
Chez nous, les actions de calque vivent TOUTES dans la zone de contrôles fixe de
la pile (ADR-0001) — le clic droit n'en déplace aucune, il en donne un SECOND
accès, là où le pointeur est déjà.

**Blocked by:** None.

**Status:** ready-for-agent
**Type:** task

## Périmètre — tranche 1 (ce ticket)

1. **Menu contextuel sur une LIGNE de calque** (`LayerPanel`, la ligne d'effet
   ET la ligne photo ; le clic droit sélectionne d'abord la ligne, comme
   Photoshop). Entrées, dans cet ordre, TOUTES branchées sur les handlers que
   `LayerPanel` reçoit déjà (`onToggle`, `onDuplicate`, `onRemove`, `onStamp`,
   `onMergeDown`, `onToggleLock`, …) — aucune logique neuve, aucun handler
   inventé :
   - Masquer / Afficher (selon `enabled`)
   - Dupliquer
   - Aplatir en nouveau calque
   - Fusionner avec le dessous (désactivé avec la raison en infobulle, comme
     le bouton — même verdict `mergeDownVerdict`, jamais une copie)
   - séparateur
   - Verrous ▸ sous-menu à cases (les mêmes verrous que la ligne « Verrous : »,
     lus dans `layerLocks.ts` ; « Tout » implique les autres, l'état coché doit
     le refléter)
   - séparateur
   - Supprimer le calque (désactivé si verrouillé, avec la raison)
   S'il existe déjà un mécanisme de RENOMMAGE de calque, l'ajouter en tête ;
   sinon, hors périmètre — ne pas en inventer un ici.
2. **Menu contextuel sur le VIDE de la pile** (sous la dernière ligne) :
   « Ajouter un effet… » qui ouvre le sélecteur existant (`onAdd` / le
   `EffectPicker`), rien d'autre.
3. **Le menu de WebView2 n'apparaît plus** : `contextmenu` intercepté au niveau
   de l'app (`preventDefault`) SAUF sur les champs de saisie (`input`,
   `textarea`, `contenteditable`), où le menu natif copier/coller reste utile.
   En dev, garder « Inspecter » accessible autrement (F12 / le port CDP) — ne
   pas conditionner le comportement à `import.meta.env.DEV` : un menu qui
   diffère entre dev et prod est un défaut qu'on ne voit qu'en prod.

## Hors périmètre (tranche 2, autre ticket si Antoine le demande)

- Clic droit sur la TOILE : la liste des calques sous le curseur (Photoshop,
  outil Déplacement) — s'appuie sur le hit-test du ticket 26 ; à charter à
  part, avec lui.
- Clic droit sur les vignettes de la galerie d'effets, sur un masque.

## Contraintes

- **Primitive** : `src/components/ui/` n'a que `dropdown-menu.tsx` (Base UI
  `Menu`). Base UI porte un `ContextMenu` — ajouter la primitive shadcn
  `context-menu` (style `base-nova`, `components.json`) via
  `npx shadcn add context-menu`, puis vérifier qu'elle ne redéfinit aucun
  token (`npm run lint:tokens`) et qu'elle compose bien `dropdown-menu`
  visuellement (mêmes tokens de surface, de bordure, de hauteur d'item —
  ADR-0001 : un item de menu n'est pas plus haut qu'une ligne de liste).
- **Frontières** : `components/` ne porte aucune logique — le menu APPELLE
  les handlers reçus ; les verdicts (grisé + raison) sont ceux de
  `layers/flatten.ts` et `layers/layerLocks.ts`, importés, jamais recopiés.
- **Clavier** : `Maj+F10` et la touche Menu ouvrent le menu sur la ligne
  focalisée (Base UI le fait si le trigger est l'élément focalisable de la
  ligne — vérifier, ne pas supposer).
- **Stories** : le menu ouvert sur une ligne d'effet, sur une ligne photo, sur
  le fond de pile, et l'état grisé de Fusionner sur le calque du fond ;
  `test-storybook` EN ENTIER (CLAUDE.md : un changement de la pile se voit à
  trois échelles).
- Le clic droit ne doit PAS déclencher le glisser-déposer de la ligne
  (`onGripPointerDown` n'écoute que le bouton principal — vérifier `button === 0`).

- [x] Primitive `context-menu` ajoutée (base-nova sur Base UI), tokens verts.
- [x] Menu sur une ligne de calque, entrées ci-dessus, branchées sur les handlers existants, verdicts partagés.
- [x] Menu sur le vide de la pile : « Ajouter un effet… ».
- [x] Menu natif de WebView2 supprimé hors champs de saisie.
- [x] Stories + `test-storybook` entier, `npm run test`, lint, tokens, `test:render` zéro écart.
- [ ] Validé en gestes par Antoine : clic droit sur un light leak → Aplatir → clic droit sur l'aplati → Fusionner. (Le parcours a été piloté par CDP dans la vraie fenêtre — voir Livraison — mais le JUGEMENT en gestes reste à faire par Antoine.)

## Livraison (tranche 1, 2026-09-09)

Fait :
- **Primitive écrite à la main** `src/components/ui/context-menu.tsx`, copiée
  classe pour classe de `dropdown-menu.tsx` (mêmes tokens de surface, bordure,
  rayon, padding, hauteur d'item — ADR-0001), sur `@base-ui/react/context-menu`
  (Base UI 1.6 le porte). Choix vs `npx shadcn add` : la copie garantit des
  classes identiques et `lint:tokens` vert sans dépendre du réseau. Seule
  divergence voulue : pas de `w-(--anchor-width)` (le déclencheur est une ligne
  entière, le menu se dimensionne sur son contenu).
- **Menu de ligne** dans `LayerPanel` : chaque `<li>` est un `ContextMenuTrigger`
  (via `render`). Entrées Masquer/Afficher · Dupliquer · Aplatir · Fusionner ·
  Verrous (sous-menu à cases) · Supprimer. Aucune logique : appelle les handlers
  reçus (mêmes que `LayerControls`), verdicts `stampVerdict`/`mergeDownVerdict`
  importés de `layers/flatten.ts`, cases du sous-menu lues via les helpers de
  `layerLocks.ts` (« Tout » implique les trois autres). Clic droit sélectionne
  d'abord (`onContextMenu` → `onSelect` + `stopPropagation`, ce dernier empêchant
  l'ouverture du menu du vide par-dessus).
- **Menu du vide de la pile** : la `<ul>` est un `ContextMenuTrigger` séparé,
  « Ajouter un effet… » ouvre le sélecteur existant (`EffectPicker` rendu
  contrôlable par `open`/`onOpenChange`). Grisé sans image.
- **Menu natif WebView2 supprimé** : écouteur `contextmenu` unique dans
  `main.tsx`, `preventDefault` sauf sur `input`/`textarea`/`[contenteditable]`.
  Pas de condition `import.meta.env.DEV`.
- **Garde drag** : la poignée ignore désormais le bouton non principal
  (`e.button !== 0`) — un clic droit sur la poignée n'ouvre plus un glissement.

Prémisse du ticket corrigée : les handlers `onDuplicate/onRemove/onStamp/
onMergeDown/onToggleLock` N'étaient PAS reçus par `LayerPanel` (ils vivent sur
`LayerControlsProps`, composant `LayerControls` séparé). Ajoutés en props
optionnelles à `LayerPanel`/`LayerRow` et câblés depuis `App.tsx` (pur câblage).

Gates : `tsc` vert · `lint` vert · `test` 2182 · `test-storybook` 363 (5 stories
neuves) · `test:render` aucune régression · `lint:tokens` 0.

Vérifié par CDP dans la vraie fenêtre : clic droit sur Light leak → menu (6
entrées, un seul menu) → Aplatir → « Aplati — Light leak » apparaît au-dessus →
clic droit dessus → Fusionner → lot fusionné, reste [fusionné, Grain]. Fusionner
grisé sur le fond avec sa raison en `title`. Suppression WebView2 : `preventDefault`
sur le corps, pas sur un `input`.

Reste : validation en gestes par Antoine ; tranche 2 (clic droit sur la TOILE :
liste des calques sous le curseur, s'appuie sur le hit-test du ticket 26) — hors
périmètre, à charter à part.
