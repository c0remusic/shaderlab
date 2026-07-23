# Visibilité de l'overlay masque + lisibilité du panneau Masque

## Contexte

En testant le contour de seuil animé (chantier `2026-07-23-shaderlab-mask-threshold-contour`), trois frictions distinctes sont remontées sur le panneau Masque :

1. **Pas de moyen de masquer l'overlay** pour juger le rendu réel de l'effet pendant qu'on ajuste un masque — l'overlay (rouge + contour animé) reste affiché en continu dès qu'un masque actif existe sur le calque sélectionné (`showOverlay = maskPaintMode || hasActiveMask`, `App.tsx`), sans façon de l'éteindre ponctuellement.
2. **Aucun indicateur clair de la source active** dans le panneau : quand plusieurs sources (pinceau, dégradé, luminosité, plage de couleur) sont combinées sur un même masque, seuls les sliders d'UNE source à la fois sont affichés (`activeSource`, `MaskPanel.tsx:96-99`), sans en-tête ni distinction visuelle forte de laquelle est actuellement éditée — seul un fond `--surface-selected` (10% d'opacité) la distingue.
3. **Densité visuelle** : les toggles "Actif" par source et "Masque actif" sont des checkboxes avec label, plus verbeux qu'une icône pour une action de visibilité répétée sur chaque ligne de source.

Un 4e point identifié pendant le diagnostic (le pinceau court-circuite les autres sources pendant une frappe active — `maskTextureResolver.ts:131-136`) est **explicitement hors scope** de cette spec : c'est un compromis performance déjà documenté (évite le crash OOM du 2026-07-15), qui demanderait sa propre investigation technique GPU/perf, pas un fix UI. Confirmé avec l'utilisateur.

Cette spec ne touche pas au moteur de rendu (déjà livré : Tasks 1-5 du chantier contour de seuil) — uniquement `App.tsx` (logique de déclenchement) et `MaskPanel.tsx` (présentation).

## Comportement — visibilité de l'overlay

### Règle par défaut (auto)

L'overlay est visible tant que le panneau Masque du calque sélectionné est **ouvert** (`!maskCollapsed`, état déjà existant `App.tsx:66`, câblé au `DockedPanelCard` id `"mask"` `App.tsx:556`) ET qu'il y a un masque actif à montrer (`hasActiveMask`, déjà calculé). `maskPaintMode` reste OR'd dans la condition (garde-fou : couvre le cas bord où une frappe de pinceau serait en cours alors que le panneau vient d'être refermé par un autre geste).

Quand le panneau Masque se ferme (ou qu'un autre calque est sélectionné, ou que le calque sélectionné n'a plus de masque actif), l'overlay ne s'éteint pas instantanément : un **délai de grâce de 750ms** s'écoule d'abord (`setTimeout` dans un `useEffect`, annulé si le panneau redevient actif avant l'échéance) — laisse le temps de voir le résultat se stabiliser avant la transition, plutôt qu'une coupure brutale.

### Forçage manuel

Un bouton icône (`Eye`/`EyeOff`, `lucide-react`, cohérent avec le reste du panneau) dans l'en-tête de la section "Masque" force l'overlay **masqué** même quand le panneau est ouvert et actif — pour juger le rendu final sans quitter le panneau ni attendre le délai de grâce. État booléen `overlayForceHidden` dans `App.tsx`, initialisé à `false`, togglé par le bouton, sans reset automatique au changement de calque (persiste tant que l'utilisateur ne le désactive pas — c'est un outil de confort, pas un état par-calque).

Formule finale : `showOverlay = !overlayForceHidden && (panelActiveOrGrace) && hasActiveMask`.

## Comportement — panneau Masque

### Icônes de visibilité (remplace les checkboxes "Actif")

- **"Masque actif"** (`MaskPanel.tsx:120-124`) et **"Actif" par source** (`:154-158`) passent d'une `Checkbox` à un `IconButton` icône `Eye`/`EyeOff` (état pressé = icône pleine, coloré `--text-primary` ; état relâché = `--text-tertiary`) — vraie sémantique de visibilité, gain de place sur les lignes de source répétées.
- **"Inverser"** (`:125-129`) et **"Accroché aux contours (edge-aware)"** (`:254-261`) restent en `Checkbox` + label — ce sont des réglages de comportement, pas des toggles de visibilité, sans métaphore d'icône évidente. Les convertir en icône irait à l'encontre de l'objectif même de cette spec (lisibilité).

### Indicateur de source active renforcé

- La ligne de la source active garde son fond `--surface-selected`, avec en plus le nom en `font-weight: 500` (au lieu du poids normal) et un petit libellé `EN COURS` (`font-size: 10px`, `--text-tertiary`, `letter-spacing: .05em`) aligné à droite de la ligne.
- Un en-tête `Réglages · <nom de la source>` (même convention que `paramsPanelTitle`, `App.tsx:474`) s'affiche juste au-dessus des sliders de paramètres, remplaçant la séparation silencieuse actuelle (`param-panel__source-params`, bordure du haut seule).

## Composants et fichiers touchés

- `src/App.tsx` : ajout état `overlayForceHidden` + timer de grâce 750ms sur la transition panel-ouvert → panel-fermé ; nouvelle dérivation de `showOverlay` (remplace l'actuelle `maskPaintMode || hasActiveMask`) ; nouveau prop `overlayForceHidden`/`onToggleOverlayForceHidden` passé à `MaskPanel`.
- `src/components/MaskPanel.tsx` : remplacement de 2 des 4 `Checkbox` par `IconButton` (Eye/EyeOff) ; ajout bouton icône "Masquer l'overlay" en en-tête de section ; ajout en-tête `Réglages · <source>` + libellé `EN COURS` sur la ligne active.
- Pas de nouveau composant : `IconButton` existant suffit (juste une variation de `className`/icône selon l'état pressé, pas de nouvelle primitive).

## Tests / preuve

Même convention que le reste du projet : pas de test de composant React (`CLAUDE.md` racine). Preuve = `tsc --noEmit` + `npm run test` (non-régression sur le reste de la suite) + **checkpoint visuel humain** (le comportement temporel — délai de grâce, transitions — n'est vérifiable qu'à l'œil, pas par un test automatisé). Suit le même protocole CDP que le chantier contour de seuil (fenêtre WebView2 réelle, pas de Playwright headless — canvas WebGPU).

## Hors scope (rappel)

- Le court-circuit pinceau/autres-sources pendant une frappe active (`maskTextureResolver.ts:131-136`) — perf/GPU, chantier séparé.
- L'outil de sélection géométrique façon Photoshop (rect/ellipse/lasso, jamais implémenté, `CONTEXT.md:47,58-59`) — écarté, le modèle actuel (édition live directe des sources) répond déjà au besoin exprimé ("je veux voir l'effet changer en direct selon la sélection que j'applique").
- Extension du remplacement checkbox→icône au-delà de `MaskPanel.tsx` — `Checkbox` n'est utilisé nulle part ailleurs dans l'app, donc sans objet.
