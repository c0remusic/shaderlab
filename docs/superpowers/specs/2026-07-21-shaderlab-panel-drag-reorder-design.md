# Drag-to-reorder des cartes du dock (Calques/Réglages) — design

**Statut** : validé par Antoine (architecture, composants, mockup interactif, gestion d'erreur/tests) + 3 trous corrigés après relecture adverse du 2026-07-21 (voir § Décisions de cadrage et § Composants) — prêt pour `writing-plans`.

## Contexte et origine

Suite au chantier "panneaux dockés" (`2026-07-20-shaderlab-docked-panels-design.md`, plan `2026-07-20-shaderlab-docked-panels.md`, 8 tâches implémentées et review-clean le 2026-07-20) : les cartes Calques/Réglages sont désormais fixes dans une colonne dockée à droite, avec un splitter vertical entre elles (`react-resizable-panels`). Au checkpoint visuel humain, Antoine a signalé vouloir pouvoir réorganiser l'ORDRE des cartes par glisser-déposer — un comportement jamais conçu ni dans l'ancien `FloatingPanel` (drag libre + magnétisme, supprimé) ni dans le nouveau système (cartes fixes, ordre figé).

Deux chantiers connexes signalés au même moment restent hors scope de ce design (traités séparément, en tâches plus simples, après celui-ci) :
- Redimensionnement en largeur de la colonne (splitter horizontal, bornes `--inspector-width-min`/`--inspector-width-max` déjà existantes).
- Reskin visuel "Photoshop web" via les valeurs de `@adobe/spectrum-tokens` (déjà décidé comme source canonique dans le design doc docked-panels).

## Décisions de cadrage

- **Conçu pour N cartes dès maintenant**, pas seulement 2 — le panneau Masques (Tranche 4 du chantier calques/masquage, déjà cadré mais pas implémenté) s'ajoutera dans la même colonne ; le mécanisme de réordonnancement doit l'accueillir sans redesign.
- **Feedback visuel pendant le drag** : les deux à la fois — un fantôme (clone visuel de la carte) suit le curseur, ET un **chip ovale minimal** (pas une barre pleine largeur — révisé le 2026-07-21, esprit Photoshop web) apparaît centré sur la couture entre deux cartes pour indiquer où la carte se posera au relâchement. Validé sur mockup interactif après 3 itérations (voir § Mockup) : **20×8px, plein (pas de tiret intérieur), fond `--border-selection` (blanc cassé, déjà le token de sélection neutre du projet — pas de couleur d'accent), opacité 0.9 à l'affichage**, `box-shadow: 0 1px 3px rgba(8,7,6,.35)`.
- **Poignée de drag** : toute la barre de titre de la carte (comme l'ancien `FloatingPanel`), hors le bouton chevron qui garde son `stopPropagation` actuel.
- **Approche technique** : généraliser le pattern maison déjà existant et testé dans `LayerPanel.tsx` (pointer events + `computeInsertIndex`) plutôt qu'ajouter une librairie de drag-and-drop — cohérent avec la décision précédente sur `react-resizable-panels`/React Spectrum (une dépendance doit se justifier par un vrai besoin non couvert, pas par la commodité). Le DnD HTML5 natif reste écarté : confirmé peu fiable dans ce WebView2 (`dragover`/`drop` jamais relayés, preuve CDP existante, voir commentaire `LayerPanel.tsx:141-149`).
- **Accessibilité clavier du reorder — lacune héritée, acceptée explicitement** : `LayerPanel.tsx` (dont ce design réutilise le pattern) n'a lui-même aucune alternative clavier au drag-reorder (vérifié sur pièce, aucun `onKeyDown`/`ArrowUp` dans ce fichier). Ce design n'introduit donc pas de régression, mais étend cette même lacune à un nouveau composant sans la corriger. Décision : accepter la lacune ici (hors scope de ce chantier, qui porte sur le comportement de reorder, pas sur un rattrapage a11y transversal touchant aussi `LayerPanel`) — à traiter dans un chantier a11y dédié qui couvrirait les deux composants ensemble, pas un correctif isolé ici qui laisserait `LayerPanel` en retard.

## Architecture

Le pattern de `LayerPanel.tsx` (pointer events + `computeInsertIndex`, lignes ~140-249) est extrait en utilitaire générique partagé : `src/ui/dragReorder.ts`. `LayerPanel` migre vers ce même utilitaire (comportement identique, zéro régression fonctionnelle attendue) — une seule logique de réordonnancement dans tout le projet, pas deux copies qui pourraient diverger avec le temps.

`PanelColumn` gagne une notion d'ORDRE des cartes qu'elle affiche, pilotée par le parent (`App.tsx`) — même niveau de responsabilité que `layersCollapsed`/`paramsCollapsed` aujourd'hui : `PanelColumn` reste un composant contrôlé, sans état de position/ordre qui lui soit propre.

## Composants et flux de données

- **`src/ui/dragReorder.ts`** (nouveau, extrait de `LayerPanel.tsx`) :
  - `computeInsertIndex(fromIndex, hoverIndex, position)` — inchangé, déplacé tel quel (déjà testé).
  - `usePointerReorder<T>(items: T[], onReorder: (fromIndex: number, newIndex: number) => void, itemAttribute: string)` — hook générique encapsulant `dragState` et les 4 handlers pointer (`onGripPointerDown/Move/Up/Cancel`), paramétré par l'attribut `data-*` utilisé pour le hit-test DOM (`data-layer-row-index` devient un paramètre, ex. `data-reorder-index` pour les cartes du dock). Retourne l'état de drag courant (pour styliser la carte en cours de déplacement et positionner la ligne d'insertion) et les handlers à attacher à la poignée.
- **`LayerPanel.tsx`** : migre vers ce hook — même comportement, mêmes garde-fous (2e pointeur ignoré, `pointercancel` annule sans réordonner, position no-op ne déclenche pas `onReorder`).
- **`PanelColumn.tsx`** :
  - La titlebar de chaque `DockedPanelCard` porte les handlers du hook (poignée = toute la barre, hors bouton chevron).
  - **Trou corrigé le 2026-07-21 — interaction avec `react-resizable-panels`** : `PanelColumn.tsx:51-71` (déjà implémenté, Task 4 du plan docked-panels) encapsule chaque carte dans un `<Panel>` de `react-resizable-panels`, avec `defaultSize`/`minSize`/`maxSize` posés PAR SLOT (le 1er `Panel` a 45%, le 2e 55%) et **sans `id` ni `key` React sur les `Panel`** — un reorder naïf du JSX casserait la réconciliation React (mauvais nœud DOM réutilisé) et la persistance de layout interne du package (qui s'appuie sur un `id` de `Panel` selon son `.d.ts`). Décisions :
    - Chaque `<Panel>` reçoit un `id` stable dérivé de l'identité de la carte (`id="layers"`/`id="params"`, pas de la position), ET une `key` React identique — pour que le reorder du JSX ne fasse jamais réutiliser le mauvais nœud DOM.
    - **La taille suit le SLOT (la position), pas la carte** : après un reorder, la carte qui se retrouve en 1ère position hérite de 45%, celle en 2e position de 55% — cohérent avec la décision déjà actée "la colonne remplit toute la hauteur disponible, répartie par position" (design doc docked-panels, § révisé post-choix librairie). Alternative écartée (la taille suivrait la carte, pas le slot) : ajouterait un état de taille par carte à maintenir dans `App.tsx` sans bénéfice utilisateur clair — YAGNI.
  - Réutilise la même classe de ligne d'insertion que `LayerPanel` (généralisée en indicateur "chip ovale", voir § Décisions de cadrage — ex. `.reorder-insert-chip`, actuellement une ligne pleine largeur dupliquée par rôle dans `LayerPanel.css` — à factoriser dans un fichier de styles partagé plutôt que redéfinie ici. `LayerPanel` migre lui aussi vers le chip pour cohérence visuelle inter-composants, pas seulement `PanelColumn`).
  - Le fantôme (nouveau composant, n'existait pas dans `LayerPanel` qui n'avait qu'une ligne d'insertion) : élément positionné en `fixed`, `transform: translate()`, `pointer-events: none`, cloné visuellement depuis la carte source (titre + contenu, pas seulement la titlebar — corrigé après un premier essai de mockup jugé "goofy" par Antoine). Les tokens de couleur/thème doivent être accessibles depuis la racine du DOM où le fantôme est monté (bug rencontré et corrigé dans le mockup : des tokens scopés à un conteneur parent ne cascadent pas jusqu'à un élément `position: fixed` sorti de ce sous-arbre — dans l'app réelle les tokens sont déjà déclarés à `:root` dans `src/design/primitives.css`/`semantic.css`, donc ce bug spécifique ne se reproduira pas ; vigilance conservée comme rappel, pas comme correctif à appliquer).
  - **Trou corrigé le 2026-07-21 — z-index** : ni le fantôme ni le chip n'avaient de valeur assignée (le mockup utilisait `100` en dur). Les deux réutilisent `--z-popover` (40, `src/design/primitives.css:103`) — au-dessus de `--z-floating-panel` (15, utilisé par `.panel-column` elle-même) et de `--z-sticky` (20), sans introduire de nouveau token : ce sont des éléments temporairement élevés pendant une interaction, même famille que le reste de cette tranche de l'échelle.
- **`App.tsx`** : nouvel état `panelOrder: string[]` (ex. `["layers", "params"]`), passé à `PanelColumn`, mis à jour via le callback `onReorder` exposé par le hook. Pas d'entrée d'historique (undo/redo) — c'est de la disposition d'interface, pas une donnée de calque, comme le repli/dépli existant.

## Gestion d'erreur

- `pointercancel` (perte de capture, interruption tactile) annule le drag sans réordonner — même garde que `LayerPanel` aujourd'hui, portée par le hook généralisé.
- 2e pointeur pendant un drag déjà en cours : ignoré (même garde qu'aujourd'hui).
- Position no-op (déposer une carte juste avant son voisin immédiat suivant, ou après son voisin immédiat précédent) : aucune ligne d'insertion affichée, aucun appel à `onReorder` — validé explicitement sur le mockup interactif après un premier essai qui permettait ce cas invalide.

## Tests

- `computeInsertIndex` : déjà testé, réutilisé tel quel (aucun nouveau test nécessaire pour cette fonction).
- Logique de calcul index/position depuis les rects DOM (hit-test, avant/après) : à extraire en fonction(s) pures testables, séparées du hook `usePointerReorder` lui-même (convention du projet : pas de test de rendu React, seule la logique pure se teste unitairement).
- Pas de nouveau test pour `LayerPanel` au-delà de la migration — le comportement ne change pas, seule l'implémentation sous-jacente est partagée.

## Mockup

Prototype interactif validé par Antoine (drag réel dans le navigateur, tokens shaderlab réels — `#2c2c2c`, `rgba(242,242,242,.11)` etc.) : `.superpowers/brainstorm/507829-1784587337/content/drag-to-reorder-v5.html` (fichier de session brainstorming, pas destiné à rester dans le repo — à ne pas confondre avec un wireframe `docs/wireframes/`; v1 initiale et itérations v2-v4 dans le même dossier et dans `.superpowers/brainstorm/506209-1784586011/content/`, conservées comme trace des itérations). Itérations correctives pendant la session :
1. Le fantôme ne montrait que la titlebar, pas un vrai miroir de la carte — corrigé (v2).
2. Le fantôme n'avait pas accès aux tokens de couleur car ceux-ci étaient scopés à un conteneur parent dont le fantôme (rendu `position: fixed`) sortait — corrigé en remontant les tokens à `:root` (v2).
3. Indicateur d'insertion : barre pleine largeur → chip ovale bleu (v3) → chip blanc discret avec tiret (v4) → chip minimal 20×8px plein sans tiret (v5, validé).

Ces corrections sont documentées dans la section Composants pour ne pas être reperdues au moment de l'implémentation réelle.

## Ce qui ne change pas

- Le splitter vertical entre Calques/Réglages (`react-resizable-panels`, Task 4 du plan docked-panels) — inchangé, le drag-to-reorder change l'ORDRE des cartes, pas leur partage de hauteur.
- La largeur fixe de la colonne (320px) — traitée séparément (chantier largeur, hors scope).
- Le thème visuel actuel — traité séparément (chantier Photoshop web / `@adobe/spectrum-tokens`, hors scope).
- Le comportement replié/déplié (chevron, instantané) — inchangé.

## Moyen de preuve

Checkpoint visuel humain CDP (Playwright headless inadapté sur ce projet, canvas WebGPU réel) — même convention que le reste du projet.
