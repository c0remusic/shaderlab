---
id: ADR-0005
status: active
date: 2026-08-16
supersedes: ADR-0003
---

# `master` est la branche canonique

## Contexte

[ADR-0003](0003-master-tracks-feature-design-system.md) (2026-07-24) posait
l'inverse : `feature/design-system` était la ligne de travail, `master` en était
un **miroir**, et « tout futur push sur `feature/design-system` doit être
répercuté sur `master` ».

**Mesuré le 2026-08-16, la relation s'est inversée** — et personne ne l'a
constaté pendant trois semaines :

| | ADR-0003 déclare | Mesuré le 2026-08-16 |
| --- | --- | --- |
| Ligne de travail | `feature/design-system` | `master` |
| Écart | `master` miroir | **`master` +456 commits**, 0 en retour |
| Dernier commit de `feature/design-system` | — | **2026-07-26** |
| Branche par défaut GitHub | `feature/design-system` | `feature/design-system` |

La branche que GitHub présentait par défaut était donc un instantané de trois
semaines, pendant que tout le travail — dont la première CI verte depuis le
2026-08-01 — vivait sur `master`.

**Pourquoi la dérive n'a pas été vue** : ADR-0003 confiait la synchronisation à
un geste manuel à répéter à chaque push. Un invariant qui repose sur la
discipline d'un geste répété n'en est pas un ; celui-ci a tenu deux jours. La
décision produit du 2026-07-26 (« merge vers master à chaque branche ») l'avait
déjà contredit dans les faits, sans que l'ADR soit amendé.

## Décision

1. **`master` est la branche canonique**, et la branche par défaut du dépôt sur
   GitHub. Basculée le 2026-08-16.
2. `feature/design-system` a été fast-forwardée sur `master` (sans perte : elle
   n'avait **aucun** commit unique) et n'est plus une ligne de travail.
3. **Aucune synchronisation manuelle n'est due.** C'est la différence de fond
   avec ADR-0003 : il n'y a plus deux noms à tenir alignés, il y en a un.

## Conséquences

- Un visiteur du dépôt voit l'état réel du projet, pas un instantané.
- La règle de travail est celle qui était déjà appliquée : chaque branche merge
  vers `master`.
- `feature/design-system` reste en place, synchronisée, jusqu'à décision de la
  supprimer. Sa suppression est une corvée, pas une décision — elle ne porte
  rien d'unique.
- La CI n'est pas affectée : `.github/workflows/test.yml` se déclenche sur
  `push:` sans filtre de branche.

## Ce que cet ADR corrige d'autre

`docs/ROADMAP.md` § *Out of scope* signalait déjà que « `docs/adr/0003` décrit
l'inverse de la réalité mesurée » et rangeait la correction en corvée de
documentation. Elle n'en était pas une : tant que l'ADR restait `active`, il
prescrivait un geste de synchronisation que personne ne faisait, et la branche
par défaut continuait de mentir.

⚠️ **Leçon opposable** : un ADR qui confie un invariant à un geste manuel
répété décrit une intention, pas une propriété. Quand la mesure et l'ADR
divergent, c'est l'ADR qu'on amende — le laisser `active` en sachant qu'il est
faux fait de lui un piège pour le prochain lecteur.
