# Panneaux dockés (Calques/Réglages) — refonte du conteneur `FloatingPanel`

**Statut** : validé par Antoine (wireframe + audit UX/UI), prêt pour plan d'implémentation.

## Contexte et origine

Tranche "panneaux flottants" (`FloatingPanel`, terminée le 2026-07-20) livrée
avec drag libre, magnétisme entre panneaux, fantôme de drag, nudge clavier.
En tentant le checkpoint visuel final de la Tranche 3 masquage, Antoine a
observé : thème incohérent, canvas mal centré, panneaux à positions
étranges/mal imbriqués. Deux bugs fonctionnels réels ont été corrigés en
session (compensation de centrage canvas doublée par erreur ; position de
Réglages calculée sur une hauteur supposée fixe alors que Calques s'adapte
à son contenu réel) — mais Antoine a ensuite demandé explicitement de
rapprocher visuellement l'app de Photoshop en ligne plutôt que de
simplement corriger les bugs du système existant.

**Inspection en direct de photoshop.adobe.com** (lecture seule, session réelle
d'Antoine, `claude-in-chrome` — voir `docs/design-system/photoshop-web-reference-tokens.md`
pour les valeurs brutes) : les panneaux Calques/Propriétés/Historique sont
des **cartes individuelles empilées verticalement**, chacune avec son propre
fond/radius/en-tête, **fixes** (pas de drag libre ni de magnétisme entre
elles), séparées par un splitter redimensionnable, **sans ombre portée**
(design plat), titres en `sentence case` (pas d'uppercase/letter-spacing).
Un rail d'icônes séparé sur le bord droit permet de montrer/masquer chaque
panneau — ce rail correspond exactement au `PRD-floating-panel-rail.md`
déjà cadré par une précédente interview mais jamais implémenté ; **il reste
hors scope de ce design**, traité séparément (voir § Hors scope).

Un wireframe (`docs/wireframes/docked-panels.html`, tokens shaderlab réels
inlinés) a validé la direction avec Antoine après plusieurs itérations, puis
un audit UX/UI (`design-reviewer`, lecture seule) a trouvé des défauts
d'accessibilité et de discipline de tokens **spécifiques au wireframe**
(glyphes Unicode bruts, éléments non focusables) — Antoine a choisi de ne
pas corriger le wireframe lui-même (jetable) mais d'imposer ces points comme
exigences dures de l'implémentation réelle (§ Exigences a11y/tokens
ci-dessous).

## Périmètre

**Dans le scope** : le CONTENEUR des panneaux (`FloatingPanel` remplacé par
un composant de carte empilée fixe), le calcul de layout (position, hauteur,
compensation canvas), la suppression du code de drag/magnétisme/nudge
devenu inutile, le style visuel du conteneur (radius, absence d'ombre,
typographie du titre).

**Hors scope** :
- Contenu interne de `LayerPanel`/`ParamPanel` — ces composants restent
  fonctionnellement inchangés. Le wireframe affichait une barre d'icônes
  (ajouter calque/ajustement/dupliquer/poubelle) et une ligne Fusion/Opacité
  dans l'en-tête de la carte Calques **pour fidélité visuelle à la
  référence uniquement** — shaderlab n'a pas de concept de "calque de
  réglage" à la Photoshop, `LayerPanel` garde son propre modèle de données
  et ses propres contrôles existants (opacité/mode de fusion déjà gérés
  ailleurs dans l'UI actuelle). Aucune nouvelle fonctionnalité de calque
  n'est ajoutée par ce design.
- Rail d'icônes montrer/masquer (`PRD-floating-panel-rail.md`) — PRD séparé
  déjà écrit, nécessite son propre brainstorming avant implémentation. Ce
  design n'ajoute PAS de mécanisme pour fermer/rouvrir un panneau au clic
  sur une icône ; les deux panneaux (Calques/Réglages) restent toujours
  visibles (repli/dépli du contenu interne reste possible via chevron,
  comme aujourd'hui).
- Panneau Masques (Tranche 4 du chantier calques/masquage) — arrivera plus
  tard dans la même colonne, pas dessiné ici.

## Architecture

### Composant

`FloatingPanel` (drag libre + magnétisme + fantôme + nudge clavier) est
remplacé par un nouveau composant `DockedPanelCard` (nom provisoire, à
trancher au plan) plus simple :
- Position et taille ne sont plus des props pilotées par l'état
  drag/magnétisme d'`App.tsx` — la colonne entière est positionnée UNE FOIS
  en CSS (`position: absolute; right: ...`), pas recalculée par JS à
  chaque frame ni au relâchement d'un geste.
- Chaque carte garde : titre, contenu (`children`), état replié/déplié
  (chevron, comportement instantané inchangé — pas de changement demandé
  sur ce point).
- **Splitter redimensionnable** entre Calques et Réglages (nouveau) : une
  poignée horizontale entre les deux cartes permet d'ajuster la hauteur de
  Calques (et donc l'espace restant pour Réglages) à la souris. Implémenté
  comme un simple drag vertical borné (min/max hauteur), sans magnétisme —
  mécanisme différent et plus simple que le drag 2D + snapping actuel.
- Suppression complète : `snapping.ts` (magnétisme entre panneaux flottants
  ET contre le bord canvas), `keyboardNudge.ts` (nudge clavier — plus de
  sens sans position libre), le state `ghost`/fantôme de drag dans
  `FloatingPanel.tsx`, `effectiveViewport.ts`'s `computeEffectiveViewportWidth`
  (remplacé par un calcul direct et EXACT, voir § Canvas).

### Position et taille

- Colonne fixe à droite : `right: var(--space-4)` (marge constante, pas de
  point de départ "librement déplaçable ensuite" comme l'ancien design —
  cette phrase du design.md FloatingPanel du 2026-07-20 est explicitement
  remplacée).
- Largeur : **320px** (valeur mesurée sur Photoshop web), au lieu de 288px
  actuels. Voir § Tokens pour la question de nommage.
- Hauteur de chaque carte : `min-content` jusqu'à un plafond (`max-height`)
  — jamais une hauteur fixe forcée qui laisserait un vide (bug corrigé en
  session sur l'ancien système, à ne pas réintroduire). Le plafond de
  Calques est ajustable par l'utilisateur via le splitter ; Réglages prend
  le reste de la hauteur disponible SEULEMENT si son propre contenu le
  justifie (pas de `flex:1` forcé quand le contenu est court — même
  principe que Calques, confirmé par Antoine lors de la revue du
  wireframe).

### Canvas — compensation de centrage

Avec une largeur de dock désormais FIXE et toujours connue (plus de
position libre à approximer), la compensation devient un calcul EXACT :
`padding-right: var(--inspector-width-default)` sur `.canvas-stage` (même
token que la largeur du dock, voir § Tokens — pas de second token
`--panel-dock-width` séparé), sans plus jamais de facteur `* 2` ni de
fonction JS séparée qui pourrait diverger (`computeEffectiveViewportWidth`
est supprimée, son seul rôle — approximer une largeur variable — n'a plus
de raison d'être).

## Style visuel (tokens)

| Aspect | Avant (`FloatingPanel`) | Après (`DockedPanelCard`) |
|---|---|---|
| Ombre portée | `--shadow-panel-resting` | Aucune (retirée) |
| Titre — casse | `text-transform: uppercase` | `sentence case` (aucune transformation) |
| Titre — letter-spacing | `var(--tracking-label)` (0.07em) | normal (0) |
| Titre — taille/poids | (à vérifier sur le composant actuel) | 16px / 600 (`--font-size-xl`/`--font-weight-semibold`, déjà existants) |
| Largeur | `--inspector-width-default` (288px) | 320px |
| Séparation entre panneaux | Magnétisme + `PANEL_GAP` (8px) | Gap fixe (`--space-4`, 16px) entre cartes empilées |

**Décision tokens** : `--inspector-width-default` passe de 288px à 320px
(un seul token, pas de doublon `--panel-dock-width` séparé qui divergerait
— corrige le finding "Moyenne" de l'audit UX/UI signalant ce risque). Son
usage existant ailleurs dans le codebase (si applicable) doit être vérifié
au moment du plan.

## Exigences accessibilité et discipline de code (imposées par l'audit UX/UI du wireframe)

Le wireframe utilisait des `<span>`/`<div>` et des glyphes Unicode bruts par
simplicité — **interdit dans l'implémentation réelle** :

- Tout élément interactif (bouton fermer, chevron replier/déplier, poignée
  de splitter) est un `<button>` natif ou porte `role="button"` +
  `tabindex="0"` + gestion clavier (Enter/Espace), jamais un `<span>`/`<div>`
  sans sémantique.
- `aria-label` explicite sur chaque bouton icône-seul.
- Cible cliquable ≥ 44×44px (padding invisible autour d'une icône visuelle
  plus petite) — pattern déjà nommé dans le socle design
  (`~/.claude/rules/ui.md` § États des composants).
- Icônes = `lucide-react` (déjà utilisé ailleurs dans le projet, ex.
  `FloatingPanel.tsx` actuel avec `ChevronDown`/`ChevronRight`), jamais de
  glyphe Unicode brut ou d'emoji — le mélange emoji-couleur/dingbat du
  wireframe a été un défaut Critical de l'audit, pas un choix à reproduire.
- Focus clavier visible via `--focus-color`/`--focus-width` déjà définis
  (le composant actuel les utilise déjà sur `.floating-panel__titlebar`,
  le nouveau composant doit les garder sur tous ses contrôles interactifs).
- La couleur de sélection d'un calque (dans `LayerPanel`, hors scope direct
  de ce design mais notée pour cohérence) ne doit pas réutiliser
  `--focus-color` pour éviter la confusion avec le focus clavier réel une
  fois les contrôles rendus focusables — utiliser `--border-selection`
  (déjà existant dans `semantic.css`) à la place.

## Ce qui NE change PAS

- Comportement replié/déplié : instantané, sans transition (déjà comme ça).
- `LayerPanel`/`ParamPanel` : contenu et logique inchangés, seul leur
  conteneur change.
- Le pattern d'historique (`handleParamChange`/`handleParamCommit`, une
  entrée par interaction) : sans rapport avec ce design, non touché.

## Tests / vérification

- Aucun test de rendu React dans ce repo (convention existante) — la
  logique de layout PURE (calcul de position/hauteur, clamp du splitter)
  doit être testée unitairement comme le reste (`computeSnappedPosition`
  avait ses tests, son remplaçant simplifié en a besoin aussi).
- Checkpoint visuel humain CDP obligatoire (canvas WebGPU réel, Playwright
  headless inadapté sur l'app — seul le wireframe isolé, DOM pur, tolère
  Playwright) — mêmes conditions que le reste du projet.
