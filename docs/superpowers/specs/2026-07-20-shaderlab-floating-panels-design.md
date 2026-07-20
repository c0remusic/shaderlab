# Design (COMMENT) — Système de panneaux flottants shaderlab

> Produit par `superpowers:brainstorming` avec Antoine, 2026-07-20. Parti d'une
> demande ponctuelle (« un bouton settings pour replier les params d'effet »)
> qui a ouvert une question d'architecture plus large : les panneaux Calques et
> Réglages doivent-ils rester dockés dans la barre latérale fixe actuelle
> (`Inspector.tsx`), ou devenir des modules flottants indépendants ? Décision :
> flottants. Ce document est le COMMENT ; aucun PRD séparé n'a été produit (le
> QUOI a émergé directement pendant le brainstorming, itéré via mockups visuels
> — voir § Méthode).

## Méthode — mockups visuels itératifs, pas de spec écrite d'abord

Antoine a explicitement demandé (règle permanente pour cette session, à
respecter pour tout futur changement UI/UX) : **toujours montrer un aperçu
visuel avant d'implémenter**. Ce design a donc été construit par une dizaine
d'itérations de mockups HTML (`mcp__visualize__show_widget`, tokens réels
`src/design/semantic.css`) plutôt que par des questions texte seules. Deux
corrections de méthode actées pendant la session, à retenir :

- **Un diagramme abstrait (boîtes-flèches) n'est PAS un mockup UI.** Demandé
  un chemin de navigation, montré un flowchart générique → rejeté explicitement
  (« fallait juste me montrer comment tu l'aurais implanté dans l'UI »). Le
  mockup doit toujours être la vraie UI approximée, pas une notation abstraite
  du flux.
- **Un screenshot statique ne contient aucune information de mouvement.**
  Halluciné des caractéristiques d'animation Photoshop (« accrochage sec »,
  « sans latence ») à partir d'un screenshot fixe déjà discuté plus tôt dans la
  session (où on avait établi que leur UI est dessinée dans un `<canvas>`
  unique, donc rien d'inspectable). Corrigé après remarque d'Antoine : aucune
  affirmation sur le comportement d'une référence externe sans observation
  RÉELLE (Antoine a ensuite testé Photoshop lui-même et rapporté ce qu'il a vu).

## 1. Portée — trois modules flottants, une seule infrastructure

Trois panneaux deviennent des instances d'un même composant `FloatingPanel`
générique :

1. **Calques** (`LayerPanel`, existant) — liste des calques + browser d'effets
   (bouton « + Ajouter un effet »).
2. **Réglages** (`ParamPanel`, existant) — sliders de l'effet du calque
   sélectionné. Nouveau : titre dynamique `Réglages · <nom de l'effet>`.
3. **Masques** (Tranche 4 du chantier calques/masquage, déjà designé dans
   `2026-07-18-shaderlab-layers-masking-design.md` §6 avec les mêmes
   propriétés — déplaçable, magnétisme, escamotable — mais jamais implémenté).
   Ce design **construit l'infrastructure `FloatingPanel` que la Tranche 4
   réutilisera telle quelle**, décision explicite d'Antoine pour éviter de
   la reconstruire deux fois.

Hors scope de ce document : le contenu métier des panneaux (déjà existant
pour Calques/Réglages, déjà designé pour Masques) — seul le **conteneur**
(comment un panneau flotte, s'accroche, s'ouvre/replie) est nouveau ici.

## 2. Layout — canvas plein écran, panneaux par-dessus

**Aujourd'hui** (`App.tsx:354-388`, `App.css:1-13`) : `.app-shell` (colonne :
Toolbar puis `.workspace`) → `.workspace` (ligne flex : `<Canvas>` flex-1 +
`<Inspector>` aside largeur fixe). Le canvas partage l'espace horizontal avec
la barre latérale — il ne l'occupe jamais entièrement.

**Nouveau** : `.workspace` n'est plus un flex row Canvas+aside. Le `<Canvas>`
occupe **toute la fenêtre** sous la Toolbar (plein écran, `position: relative`
comme conteneur de positionnement pour les panneaux). Les `FloatingPanel`
sont rendus **par-dessus** en `position: absolute` (le canvas continue
derrière/sous eux — confirmé par observation réelle de Photoshop : l'image
déborde visiblement à droite d'un panneau quand on zoome).

**Position par défaut** : Calques et Réglages apparaissent ancrés près de la
Toolbar, côté droit (même zone que l'actuel `Inspector` docké) — mais ce n'est
qu'une position de DÉPART, pas une colonne dessinée ou contrainte en dur (pas
de conteneur visible qui les borde). L'utilisateur peut les détacher
librement n'importe où sur le canvas.

## 3. `FloatingPanel` — composant générique

**Fichier** : `src/components/FloatingPanel.tsx` (nouveau), CSS dédié.

**Props** : `title: string`, `position: {x, y}`, `collapsed: boolean`,
`onPositionChange`, `onCollapsedChange`, `children`. Position et état de
repli sont gérés par l'appelant (`App.tsx`), pas internes au composant — même
philosophie que le reste de l'app (state remonté, composants de présentation
purs, cf. `LayerPanel`/`ParamPanel` existants).

**Structure visuelle** : barre de titre (poignée de drag, `cursor: grab`,
même pattern que `.layer-panel__grip-handle`) + chevron de repli + contenu.
Cadre et ombre **propres à chaque panneau**, jamais fusionnés visuellement
avec un panneau voisin même accroché juste à côté (8px d'écart minimum) —
exigence explicite d'Antoine après une itération de mockup où deux panneaux
accrochés semblaient être un seul bloc continu.

## 4. Drag — pointer events, fantôme semi-transparent

**Pas de DnD HTML5 natif** — même décision et même raison que le
réordonnancement de calques (`LayerPanel.tsx`, commit `8459df8` cette
session) : dragstart HTML5 ne relaie pas fiablement dragover/drop dans ce
WebView2 (preuve obtenue par sonde CDP sur un geste humain réel). Pointer
events (`pointerdown` + `setPointerCapture` sur la poignée de titre,
`pointermove`/`pointerup` avec filtrage par `pointerId`), même infrastructure
que `LayerPanel`.

**Pendant le drag** (observé par Antoine sur Photoshop réel, pas inventé) :
- Le panneau reste visible à sa position d'origine, **estompé** (opacité
  réduite), jusqu'au relâchement.
- Un **fantôme semi-transparent** du panneau suit le curseur en temps réel
  (`transform: translate()`, pas `top`/`left`, pour rester fluide).
- Au relâchement : le panneau prend sa position finale (libre, ou accrochée
  si dans la zone de magnétisme d'un autre panneau/bord).

**Alternative clavier — requise (finding revue adverse codex-crosscheck : la
v1 ne spécifiait que le pointeur, violant la convention d'accessibilité du
projet, `docs/design-system/patterns.md`/`governance.md` — drag-and-drop DOIT
avoir une alternative clavier)** : la poignée de titre est un élément
focusable (`tabIndex=0`, rôle explicite). Une fois focusée, les flèches
directionnelles déplacent le panneau par pas fixe (`KEYBOARD_NUDGE_STEP`,
valeur à calibrer — commencer à 16px, `Shift`+flèche = pas large façon les
autres contrôles calibrés du projet, cf. `rules/ui.md` § Espacement). Le
magnétisme (§5) s'applique aussi à la position atteinte au clavier, pas
seulement en fin de drag pointeur. Le bouton de repli (chevron) est un
`<button>` natif — focusable/activable au clavier sans effort supplémentaire,
aucune alternative à concevoir.

## 5. Magnétisme — deux axes, entre modules ET bords du canvas

Observé par Antoine sur Photoshop réel : les modules s'accrochent **à la
fois verticalement et horizontalement** entre eux (pas seulement empilage
vertical comme un premier mockup le montrait à tort), en plus de l'accrochage
aux bords/coins du canvas déjà spécifié pour le futur panneau Masques
(`2026-07-18-shaderlab-layers-masking-design.md` §6).

**Algorithme** (au relâchement du drag, pas pendant — évite un recalcul par
frame) : pour chaque bord du panneau relâché (haut/bas/gauche/droite),
chercher le bord le plus proche parmi (a) les bords des autres panneaux
visibles, (b) les bords du canvas, dans un rayon de tolérance (`SNAP_DISTANCE`,
valeur à calibrer à l'implémentation — commencer à ~12px, ajuster au
checkpoint visuel). Si plusieurs candidats sont sous le seuil, retenir le
plus proche (distance minimale) ; égalité exacte → le premier trouvé dans
l'ordre de rendu des panneaux (déterministe, pas un choix arbitraire à
l'exécution).

**Distance snappée — corrigé (contradiction relevée en revue adverse
codex-crosscheck)** : accrocher un bord à un panneau voisin (cas a) aligne
avec un **écart de `PANEL_GAP` (8px, la même valeur que le § 3)**, jamais un
contact bord-à-bord à 0px — sinon la contradiction « chaque panneau garde son
propre cadre, 8px d'écart minimum » (§3) contre « aligner ce bord exactement »
(ici) produirait un écart nul en pratique. Accrocher à un bord du **canvas**
(cas b) aligne avec un écart de `CANVAS_EDGE_MARGIN` (16px) — **corrigé après
test réel (retour Antoine, 2026-07-20)** : le flush 0px initialement spécifié
ici lit comme cassé une fois rendu (panneau collé au bord de fenêtre sans
respiration, contrairement à la référence Photoshop qui garde toujours une
marge visible même en bord d'écran). Sinon (aucun candidat sous le seuil) le
panneau reste à la position brute du relâchement.

**Pas de recalcul dynamique après coup** — décision explicite d'Antoine :
si un panneau ancre bouge plus tard, les panneaux qui s'étaient accrochés à
lui NE LE SUIVENT PAS automatiquement. Le magnétisme n'agit qu'au moment du
drag, jamais en réaction à un changement de position d'un autre panneau.

## 6. Repli/dépli — instantané, sans animation

Observé par Antoine sur Photoshop réel : le repli (`collapsed`) est la SEULE
interaction sans transition — instantané. Tout le reste (apparition d'un
panneau, résolution du drag) garde une transition. Implémentation : le
contenu du panneau est simplement démonté/remonté (`collapsed && null`) sans
`transition`/`max-height` animée — contrairement à l'instinct initial
(hauteur animée), corrigé après l'observation réelle.

## 7. Navigation — chemin Browser/Calques → Module de calque → Module de réglages

Confirmé par mockup UI concret (pas un diagramme abstrait, cf. § Méthode).
**Portée tranchée : DEUX panneaux flottants** (Calques, Réglages), pas un
panneau par calque — le « module de calque » de l'arborescence ci-dessous est
satisfait par la sélection de calque **déjà existante** dans `LayerPanel`
(cliquer une ligne la sélectionne, visuellement mise en avant via
`layer-panel__row--selected`), pas par une 3e famille de `FloatingPanel`
instanciée par calque. Un panneau flottant par calque multiplierait le
nombre d'instances actives sans bénéfice demandé — hors scope, YAGNI.

1. **Calques** (toujours visible par défaut) : browser d'effets (bouton
   « + Ajouter un effet », existant) + liste des calques.
2. Cliquer un calque → **le sélectionne** (comportement existant, inchangé) —
   opacité et mode de fusion restent affichés inline dans sa ligne
   (`LayerPanel`, comportement actuel non modifié par ce document).
3. Icône settings sur la ligne du calque sélectionné → ouvre/amène au premier
   plan le **module de réglages** (`FloatingPanel` unique, contenu = calque
   sélectionné, `ParamPanel` existant) — c'est la demande d'origine (option C
   retenue après mockup comparatif de 3 variantes).

## 8. Centrage du canvas — compensation statique

Le centrage de l'image doit tenir compte de la largeur par défaut du dock
virtuel (Calques + Réglages empilés, zone occupée par défaut) pour ne pas
centrer visuellement la photo sous les panneaux. Décision explicite : **une
compensation statique, calculée une fois** sur la largeur par défaut estimée
du dock (constante `DEFAULT_PANEL_COLUMN_WIDTH`, valeur à calibrer à
l'implémentation) — PAS un recalcul réactif à la position réelle des
panneaux si l'utilisateur les déplace ensuite.

**Interface avec le PRD pan/zoom** (`2026-07-18-shaderlab-canvas-pan-zoom-prd.md`,
non implémenté à ce jour) : sa logique de fit-to-screen/centrage (actuellement
spécifiée comme dépendant du viewport `.canvas-stage`) devra consommer ce
même décalage statique — le viewport effectif pour le calcul de fit-to-screen
est `fenêtre − DEFAULT_PANEL_COLUMN_WIDTH`, pas `window.innerWidth` brut.
**Séquencement non tranché ici** : lequel des deux chantiers (panneaux
flottants vs pan/zoom) part en premier détermine qui pose cette constante en
premier — à décider à la planification, pas dans ce design.

## 9. Preuve / vérification

Aucune des interactions de ce document (drag, magnétisme, fantôme, repli
instantané, positionnement du canvas plein écran) n'est unitairement
testable (GPU + interaction pointeur réelle dans la vraie fenêtre WebView2,
même contrainte que le reste du pipeline pointer-events de `LayerPanel` cette
session). **Moyen de preuve** : checkpoint visuel humain via CDP dans la
vraie fenêtre (cf. CLAUDE.md § Méthode), pas Playwright headless (canvas
WebGPU rend noir en headless). Ce qui reste unitairement testable et DOIT
l'être : la fonction pure de calcul de magnétisme et la fonction de calcul
du viewport effectif (fenêtre − largeur de dock) — même famille que
`computeInsertIndex` (`LayerPanel.tsx`, testé cette session sans dépendance
DOM/GPU).

**Cas requis pour la fonction de magnétisme (finding revue adverse
codex-crosscheck : la v1 ne listait qu'« un bord sous un seuil », insuffisant
face au contrat réel du §5)** :
- accrochage sur l'axe horizontal seul, vertical seul, et **les deux
  simultanément** (un coin de panneau proche d'un coin d'un autre) ;
- plusieurs candidats sous le seuil ⟹ le plus proche retenu, égalité exacte
  ⟹ résolue par l'ordre de rendu (déterministe, cf. §5) ;
- accrochage panneau↔panneau respecte l'écart `PANEL_GAP` (8px, jamais 0) ;
- accrochage panneau↔bord du canvas respecte l'écart `CANVAS_EDGE_MARGIN`
  (16px — corrigé de « flush 0px » après test réel, cf. plus haut) ;
- aucun candidat sous le seuil ⟹ position brute inchangée ;
- un panneau qui sortirait des limites du canvas au relâchement reste
  contraint dans le viewport (pas de position hors-écran inatteignable).

## Différé (hors scope de ce document)

- **Contenu du panneau Masques** (Tranche 4) — ce document ne fait
  qu'assurer que `FloatingPanel` sera réutilisable pour lui.
- **Redimensionnement des panneaux** (pas seulement déplacement) — non
  demandé, non observé comme un point discuté cette session.
- **Persistance de la position des panneaux entre sessions** (localStorage ou
  équivalent) — non demandé explicitement, à clarifier si besoin réel.
