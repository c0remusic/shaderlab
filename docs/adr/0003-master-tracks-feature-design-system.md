---
id: ADR-0003
status: superseded
date: 2026-07-24
superseded_by: ADR-0005
---

> ⚠️ **RENVERSÉ par [ADR-0005](0005-master-est-la-branche-canonique.md) le
> 2026-08-16.** La relation décrite ci-dessous s'est inversée : mesuré ce
> jour-là, `master` avait **456 commits d'avance** sur `feature/design-system`,
> qui n'avait rien en retour et n'avait pas bougé depuis le 2026-07-26. `master`
> est désormais la branche canonique ET la branche par défaut du dépôt, et
> **aucune synchronisation manuelle n'est due** — c'est précisément le geste
> répété prescrit ici qui n'a pas tenu.

## Contexte

`origin/HEAD` sur GitHub pointait déjà vers `feature/design-system` (branche
par défaut réelle du repo depuis longtemps), mais `master` local/remote
était figé au snapshot MVP (`5f41d85`), 416 commits en retard, sans aucun
commit propre non présent sur `feature/design-system`. Deux noms de branche
existaient pour ce qui était en pratique une seule ligne de travail, avec
`master` lu par erreur comme "l'état stable" alors qu'il ne l'était plus
depuis des semaines.

## Décision

`master` est fast-forwardé sur `feature/design-system` (`git push origin
feature/design-system:master`) et les deux branches sont maintenues
synchronisées désormais. `feature/design-system` reste la branche de
travail nommée dans `CLAUDE.md` ; `master` en est un miroir, pas une
branche de stabilisation séparée.

## Conséquences

- Plus de dérive possible entre "ce qu'on croit être master" et l'état réel
  du projet — un seul point de vérité de fait.
- Tout futur push sur `feature/design-system` doit être répercuté sur
  `master` (`git push origin feature/design-system:master`) pour garder
  l'invariant ; pas d'automatisation mise en place, discipline manuelle
  pour l'instant.
- N'introduit aucune branche de release séparée — si un jour une distinction
  "stable publié" vs "travail en cours" redevient utile, elle demandera une
  nouvelle décision (pas une résurrection de l'ancien `master` figé).

## Alternatives écartées

- **Laisser `master` tel quel** : perpétue la confusion (deux branches,
  laquelle est "vraie" ?) sans bénéfice — aucun consommateur externe ne
  dépendait du `master` figé.
- **Supprimer `master`, ne garder que `feature/design-system`** : plus
  propre à terme, mais renommage de branche par défaut GitHub + mise à jour
  de tous les liens/CI externes hors scope de cette session ; reporté, pas
  écarté définitivement.
