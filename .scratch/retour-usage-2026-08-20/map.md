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

## Not yet specified

- Le TEST D'USAGE FINAL d'Antoine devant l'app, une fois les tickets résolus —
  se spécifiera quand le lot esthétique + produit sera tranché.
- D'éventuels items du retour non encore reproduits au pixel (à balayer si un
  ticket en fait surgir).

## Out of scope

- (rien encore)
