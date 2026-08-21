<!-- wayfinder:map -->
# Retour d'usage d'Antoine du 2026-08-20

## Destination

Le retour d'usage lâché devant l'app le 2026-08-20 (~23 remarques) est **résolu** :
chaque item est soit CORRIGÉ, soit TRANCHÉ en décision et implémenté, soit RANGÉ
hors scope avec sa raison. La destination est atteinte quand l'app passe le test
d'usage d'Antoine sur ce retour — geste, lisibilité et rendu — devant l'app,
pas au harnais (le harnais prouve qu'un effet agit, jamais qu'il est beau).

## Notes

- **Diagnostic complet fait le 2026-08-20/21** (Fable au pixel + 4 sous-agents).
  Résultat central : sur les ~8 « bugs francs » supposés, **UN SEUL** était un
  bug de câblage/logique (`warp`). Le reste est calibration, lisibilité ou
  esthétique — la matière de cette carte.
- **Méthode imposée par Antoine pour l'esthétique** : cross-référencer avec un
  MAX de références visuelles. Une apparence ne se déduit pas d'une spec
  (leçon payée sur le verre). Demander/récupérer des images avant de raffiner.
- **Protocole d'implémentation** : Fable planifie et relit, l'écriture passe par
  des sous-agents Opus (`model: opus`). Les micro-fixes restent inline.
- **App ouverte** (CDP 9222) pour vérif au pixel. Un changement de rendu régénère
  des références de pixels → relecture à l'œil OBLIGATOIRE (sous-agent headless
  ne juge pas le visuel — validation par Fable via capture CDP).
- Cartes sœurs à référencer, pas à dupliquer : `hybride-lightroom-photoshop/`
  (geste/lisibilité), `affinity/` (langage texture procédurale, ticket 02),
  `prochain-palier/` (soldée, arbitrages rendus). Esthétique verre = ROADMAP
  bloc 1 (refusé 3×).
- **Exécution portée DANS la carte** (override du « plan, don't do ») : un ticket
  de calibration/correction se résout en livrant le code + les gates, pas en
  décidant seulement. Les tickets de DÉCISION produit (fenêtre latérale, hover,
  aplat dessinable…) se grillent d'abord, puis se planifient.

## Reprise — prochaine session (noté le 2026-08-21, sur demande d'Antoine)

✅ **LES DEUX SUPPRESSIONS SONT FAITES le 2026-08-21** (registre 28 → 27 → 26) :

1. ✅ **`noise` (Bruit fractal) REVERTÉ** — « dégueulasse ton effet ».
   `git revert f336ac9` (commit `828c226`) : effet ET docs nettoyés d'un geste,
   registre remis à 27, les 2 refs `effet-noise*` parties avec leur scénario.
   Leçon de la session : un COMMENTAIRE d'usage d'Antoine (« on ne retrouve pas
   cet effet là », réf topo en main) a été transformé en CHANTIER (nouvel effet)
   alors qu'il avait donné une LISTE DE FIX. Il a dû recadrer. Rester sur les fix.

2. ✅ **`emboss` (ticket 03) SUPPRIMÉ** — retrait du registre + `catalog.ts`,
   module supprimé, 3 scénarios/refs render-check retirés, ADR-0019 écrit, garde
   de retrait dans `registry.test.ts`. `outlines` redevient seul lecteur
   d'`edgeGradient.ts` (son en-tête le disait déjà). Presets non cassés.

**Puis les fix, dans cet ordre :**
- **05 verrous** — 🔵 **WIREFRAME LIVRÉ le 2026-08-21**, envoyé à Antoine pour
  réaction (`docs/wireframes/verrous-lisibilite.html`). Collision `Brush`/`Brush`
  montrée (verrou de masque = glyphe de l'outil pinceau), + trois directions
  cumulables à trancher : A (glyphe du verrou de masque), B (feedback d'état
  actif — plein/creux comme le badge de ligne), C (affordance du masque vide :
  curseur qui refuse / bandeau / comportement Photoshop). **En attente de la
  réaction d'Antoine sur chaque direction, puis code.**
- **04 displacementMap** — marche en fait ; renommer (nom à demander à Antoine) +
  monter le défaut d'amplitude.
- **11 lensBlur** — 🔵 **ANALYSE DE COÛT FAITE le 2026-08-21** (lue au code, voir
  le ticket). Deux passes, collecte déjà en demi-def, taps `= clamp(π·rt²/3, 24,
  256)` saturant à ~31 px. Coût = DISPERSION des lectures à grand rayon, même
  signature que `glass`. Levier probable = pyramide de mips sur la source de
  collecte (mêmes caveats que glass : source ping-pong par frame). **La mesure de
  cadence PROD n'a pas pu tourner** : le sandbox de session refuse l'accès à
  `src-tauri/target/`, donc le binaire release ne se lance pas d'ici. Build release
  fait, photo synthétique 26 Mpx prête, protocole écrit dans le ticket — run en un
  geste dès que le sandbox l'autorise ou qu'Antoine le lance.
- **06 doublon encre/textures**, puis les grillings de layout **07+10** (réglages
  à côté / dans la section calque, à griller ensemble), **08** (hover), **09**
  (aplat en outil), et l'esthétique **01** (verre, refusé 4×, références + œil).

`isolines` (ticket 02, lissage 5×5 grain optionnel) est le seul fix LIVRÉ ET
GARDÉ de la session (commit `d3d7390`) — défaut de lissage 12 à confirmer à l'œil.

## Decisions so far

- **warp — courses mortes masquées + rugosité ouverte** (`6e44dd0`) : octaves/
  roughness/seed masqués hors mode Bruit fractal, centerY sur les 7 formes qui
  le lisent, roughness max 0.8→0.95 (le shader tolérait déjà). Applicabilité
  mesurée au canal près, test:render zéro écart.
- **sliceShift — fondu borné au tiers de l'épaisseur** (`b5f4c2b`) : à `sliceSize`
  le fondu couvrait toute la tranche (« floute tout ») ; `maxFrom` → `sliceSize/3`,
  le cœur reste net. Bornage de curseur, zéro écart.
- **outlines — défaut d'effacement du fond à 0** (`ad3e76c`) : le `wash` 0,2 par
  défaut posait un voile blanc (« blanchit tout l'écran », surtout en Échos). La
  nappe n'était NI le SDF ni les échos. Défaut → 0, zéro écart (scénarios fixent
  wash explicitement).
- **isolines — lissage gaussien 5×5, grain OPTIONNEL** (ticket 02) : mesuré au
  pixel, 4 taps ne domptaient le grain à AUCUN réglage (bruit /2). Sur le steer
  d'Antoine (« le bruit peut être sympa mais optionnel »), le curseur Lissage
  devient une grille 25 taps qu'il ÉCARTE : bas = grené intact, haut = carte
  nette. Défaut 3→12. `largeursDeTraits` vert (échelle du gradient intacte),
  refs régénérées (26/25), gates verts. Défaut à confirmer à l'œil par Antoine.
- **lensDistortion — déjà corrigé** : les 3 params inertes en longi/anamorphique
  sont masqués (vérifié en direct, 15→12 curseurs). Rien à faire.
- **icônes pinceau/transparence — PAS mortes** : ce sont des verrous (masque,
  transparence) câblés. Le défaut est de lisibilité, pas de code → ticket 05.

## Décisions du grilling — 2026-08-21 (Antoine, 16 questions)

Toutes tranchées, principe récurrent : **« comme photoshop/affinity »**.

- **05 verrous** — la vraie cause du « ça marche pas » = le SILENCE, pas le
  glyphe. A : garder `Brush` sur le verrou de masque ET l'outil (double-brosse,
  comme PS ; zéro swap). B : libellé **« Verrous : »** groupant les quatre +
  verrou actif en **bouton enfoncé** (plus la teinte seule). C : blocage gardé
  (correct — verrouiller transparence sur masque vide = rien à peindre, par
  définition) ; PAS de curseur spécial, PAS de grisage contextuel — l'état
  enfoncé (B) rend le verrou inratable, le silence cesse de surprendre. c3 du
  wireframe (« laisser le premier trait ») ÉCARTÉ : faux, pas PS.
- **11 lensBlur** — cible **60 img/s SOUPLE** : qualité d'abord (bokeh propre =
  raison d'être de l'effet), 60 seulement si le mipmap le donne gratis, sinon
  moins de 60 à grand rayon mais bokeh intact. **Mesurer AVANT de coder** (règle
  du ticket + leçon glass) : Antoine lance le probe préparé, code seulement si un
  levier se confirme.
- **04 displacementMap** — reste en **Déformation** (déjà là où PS/Affinity
  mettent *Displace* ; « à côté de Texture » était FAUX). Nom gardé (« Carte de
  déplacement », plus clair que « Dispersion » du PS FR). Vrai fix = **amplitude
  défaut 24 → 100** (l'invisible au défaut le faisait lire comme cassé).
- **07 + 10 réglages d'effet** — **panneau à CÔTÉ** de la pile (deuxième colonne,
  comme PS *Properties* / Lightroom), pas au-dessus. Accordéon sous la ligne (10)
  **écarté** : pas PS, et 37 params de `curves` casseraient ADR-0001. → wireframe
  layout deux-colonnes.
- **08 hover** — modes de fusion en **aperçu live** sur la toile (cheap, PS scrub
  la liste) + effets en **vignette de galerie** basse-déf (coût des 27 passes à
  mesurer). Séquence : fusion d'abord.
- **09 aplat** — devient **outil Forme** de la barre, dessiné directement (comme
  PS shape layer), **quitte la liste d'effets**, et unifie le TROU de sélection
  géométrique (`mask/sources` n'a aucune source géométrique). Changement de
  modèle → **prototype/wayfinder séparé**, pas un fix.
- **06 encre/textures** — l'encre-par-texture (`inkTexture` + `encreRang`, tous
  deux pré-baked) est refusée : **encre PROCÉDURALE** (shader) à la place, dans la
  famille Impression. Chantier séparé (lien `affinity/` ticket 02). L'effet
  `Texture` (plaquer un scan) **RESTE**, et **s'enrichit** — « plus de textures »
  (pack intégré et/ou procédural). Deux chantiers séparés.
- **01 verre** — front **spéculaire Poli d'abord** (l'analyse le désigne : reflet
  1000× sous perception, le plus lisse porte le reflet le plus mort). Recherche
  large glass shading + références lancée AFK. Jugé devant photo avec Antoine —
  ne se grille pas jusqu'au bout, c'est de l'apparence.

## Not yet specified

- Le TEST D'USAGE FINAL d'Antoine devant l'app, une fois les tickets résolus —
  se spécifiera quand le lot esthétique + produit sera tranché.
- D'éventuels items du retour non encore reproduits au pixel (à balayer si un
  ticket en fait surgir).

## Out of scope

- (rien encore)
