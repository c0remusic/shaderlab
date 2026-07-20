# ADR 0001 — Buffers d'uniform du guided filter edge-aware : jetables par frame

**Date** : 2026-07-20
**Statut** : Tranché (confirmé par Antoine via grilling)

## Contexte

Le plan Tranche 3 masquage (`docs/superpowers/plans/2026-07-20-shaderlab-masking-tranche3.md`,
Task 1 Steps 11-16) doit câbler le guided filter edge-aware dans
`src/render/renderer.ts`. Le plan supposait `pendingDestroy` comme membre de
classe du `Renderer` pour gérer la destruction différée des buffers
d'uniform — faux, vérifié sur pièce : `pendingDestroy` est une variable
LOCALE à `render()` (`renderer.ts:319`), déjà correctement threadée en
paramètre à travers les fonctions de passe imbriquées, avec une justification
documentée (WebGPU valide la vivacité des ressources à `submit()`, pas à
l'enregistrement — un buffer/texture intermédiaire doit être détruit
seulement après le submit de la frame).

Deux approches possibles pour les nouveaux buffers d'uniform (radius/epsilon/
edgeStrength du guided filter) :
- **A. Jetables par frame** — créés/écrits/détruits à chaque `render()`,
  suivant le pattern déjà en place (`compositingBuffer`, `paramBuffer`,
  Tranche 1).
- **B. Persistants par calque** — créés une fois, réutilisés via
  `writeBuffer`, nécessitent une logique d'invalidation propre (quand
  réécrire si les params changent, quand détruire si le calque est
  supprimé).

## Décision

**Option A — buffers jetables par frame**, suivant exactement le pattern
existant (`compositingBuffer`, renderer.ts:565-573) : création + `writeBuffer`
+ push dans le `pendingDestroy` déjà threadé en paramètre à travers les
fonctions de passe.

## Raisons

- Pattern déjà en production depuis la Tranche 1, éprouvé, zéro nouvelle
  logique d'invalidation.
- `renderer.ts` est le chemin historiquement responsable du crash OOM 24MP
  du projet (résolu depuis, cause non liée aux buffers per-frame) — toute
  déviation de convention sur ce fichier doit être justifiée, pas la
  ligne de moindre résistance.
- Option B ajoute de la complexité (cache par calque, invalidation) sans
  bénéfice mesuré — le coût de recréation d'un petit buffer d'uniform par
  frame est négligeable comparé au coût des passes de texture du même
  pipeline.

## Conséquences

Reprendre l'implémentation à Task 1 Step 11 du plan Tranche 3
(`docs/superpowers/plans/2026-07-20-shaderlab-masking-tranche3.md`) sur cette
base — pas de refonte du modèle de cycle de vie des ressources GPU.
