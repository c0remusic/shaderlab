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
- **05 verrous** — le seul « ça marche pas » ressenti (« l'icône pinceau ne fait
  rien » = verrou de masque mal signalé). Fix de lisibilité, prototypable en
  storybook sans lancer l'app.
- **04 displacementMap** — marche en fait ; renommer (nom à demander à Antoine) +
  monter le défaut d'amplitude.
- **11 lensBlur** — mesure perf en build PRODUCTION d'abord (ferme l'app dev),
  puis levier.
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

## Not yet specified

- Le TEST D'USAGE FINAL d'Antoine devant l'app, une fois les tickets résolus —
  se spécifiera quand le lot esthétique + produit sera tranché.
- D'éventuels items du retour non encore reproduits au pixel (à balayer si un
  ticket en fait surgir).

## Out of scope

- (rien encore)
