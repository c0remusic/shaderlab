# ADR 0002 — Guide overlay masque : mirroré sur l'index du calque, pas de cache double

**Date** : 2026-07-24
**Statut** : Tranché (confirmé par Antoine, deux passes de revue de branche)

## Contexte

Le contour de seuil animé de l'overlay de masque (`2026-07-23-shaderlab-mask-threshold-contour-design.md`)
invalidait en continu le cache SAT du filtre edge-aware (`MaskTextureResolver`)
dès que l'overlay était actif pendant l'édition d'un calque masqué : deux
appels `masks.resolve()` par calque (rendu normal + overlay) écrivaient dans
le même slot `lastGuideEpochByLayer` avec des guides de statut incohérents,
annulant le gain du chantier Fast Guided Filter.

Deux approches possibles :
- **A. Cache double par calque** — un `EdgeWork` par identité de guide
  (source vs composite), au prix d'une VRAM supplémentaire pour tout calque
  avec overlay actif.
- **B. Guide unique mirroré** — l'overlay reprend exactement le même
  `guideEpoch` numérique que le rendu normal du même calque pour la même
  frame, quel que soit son index dans la pile.

## Décision

**Option B.** `MaskTextureResolver` ne compare que l'égalité NUMÉRIQUE de
`guideEpoch` pour décider d'invalider (`maskTextureResolver.ts:243-247`),
jamais l'identité de texture — l'invariant à préserver est donc "les deux
appels d'un même calque, même frame, portent le même epoch", pas "quel
guide fixe utiliser". L'overlay calcule `overlayIndex =
enabledLayers.findIndex(...)` et applique la même formule que la boucle de
rendu principale (`index === 0 ? 0 : this.runGeneration`,
`framePipelineExecutor.ts:219`) sur cet index réel.

Preuve à l'appui du choix `sourceTexture` pour le cas calque-du-bas (index
0) : spike visuel live (CDP sur l'app en dev, sans rebuild) comparant guide=
source vs guide=composite sur deux effets poussés à l'extrême (Glow bloom
fort, Warp 8% d'amplitude) — aucune différence perceptible. Le filtre
edge-aware ne fait qu'un ajustement local fin, pas un repositionnement
grossier.

## Raisons

- Option A coûte de la VRAM supplémentaire pour un bénéfice de fidélité
  visuelle non démontré par le spike.
- Option B ne touche pas `MaskTextureResolver` (déjà correct) — seul
  l'appelant (`FramePipelineExecutor`) envoyait des guides incohérents.
- Un premier passage (implémentation initiale, epoch fixe à `0` pour
  l'overlay) a semblé correct au spike (qui ne testait qu'un calque
  unique = toujours index 0) mais aggravait le cas calque-non-premier —
  trouvé par la revue finale de branche, pas par le spike. Voir
  [[overlay-guide-epoch-fix-merged-2026-07-24]] (mémoire projet) pour la
  leçon de méthode : vérifier l'invariant RÉEL comparé par un cache
  (ici : égalité d'epoch) avant de valider un fix sur un seul point d'appel.

## Conséquences

`docs/superpowers/specs/2026-07-24-shaderlab-overlay-guide-source-design.md`
porte le détail complet (architecture cible, testing, checkpoint visuel
multi-calques confirmé le 2026-07-24). Mergé `feature/design-system@2bc8e6d`.

**Amendement 2026-07-29 (tranche T3, design 2026-07-28 §2.6).** La DÉCISION est
inchangée — l'invariant reste l'égalité numérique des epochs des deux appels
d'un même calque dans une même frame. Ce qui change est la FORMULE qu'elle
mirrorait : `index === 0 ? 0 : runGeneration` reposait sur « l'index 0 est le
document, son guide est stable », hypothèse tombée avec la tranche T1 (l'index 0
est désormais le calque photo de fond). L'epoch est maintenant dérivée de ce
dont le guide dépend réellement — identité de la toile, puis de chaque
`LayerState` en dessous (`FramePipelineExecutor.computeGuideEpochs`). Effet de
bord sur l'invariant : il n'est plus tenu par la RÉPÉTITION d'une formule sur
deux sites, mais par la lecture de la MÊME case du tableau d'epochs de la frame
— une divergence entre les deux sites n'est plus représentable.
