# `LayerPanel.stories` est rouge en CI et vert en local — depuis 60 runs

Type: research
Status: ready-for-agent
Parent: ../map.md

## Le fait, mesuré le 2026-08-16

La CI de `master` échoue **sur les 60 derniers runs récupérables**, sans un seul
succès depuis au moins le **2026-08-01** (run `30686003560`). Un seul fichier
est en cause, le même du premier au dernier :

```
FAIL  storybook (chromium)  src/components/LayerPanel.stories.tsx
Test Files  1 failed | 31 passed (32)
```

Le même `npm run test-storybook` est **vert en local** : 32 fichiers, 306 tests,
45 s (Windows, chromium Playwright). `npm run test` est vert des deux côtés
(128 fichiers en CI, run `31895619303`).

## Pourquoi ce ticket existe alors que rien n'est cassé chez nous

Trois raisons, dans l'ordre de gravité :

1. **Une CI rouge en permanence ne se lit plus.** Elle a laissé passer deux
   semaines sans que personne l'ouvre — et pendant ce temps, elle a été
   attribuée à la mauvaise cause (voir plus bas).
2. **Elle rend `gh run` inutilisable comme gate de merge.** Toute branche hérite
   du rouge, donc le rouge ne discrimine plus rien.
3. **Vert en local + rouge en CI = un défaut d'environnement non instruit.** On
   ne sait pas lequel des deux dit la vérité sur le composant.

## Ce que l'erreur dit, et ce qu'elle ne dit pas

Sur le run le plus récent (`31895619303`) :

```
TypeError: Cannot read properties of null (reading 'useMemo')
  ❯ LayerPanel src/components/LayerPanel.tsx:521:27
  ❯ renderWithHooks react-dom-client.development.js:7662:21
```

Un dispatcher React **nul** au moment du rendu : c'est la signature d'un hook
appelé hors d'un rendu React, ou de **deux copies de React** dans le même
graphe de modules — pas d'un défaut de logique du composant.

⚠️ **Mais l'erreur n'a pas toujours été celle-là.** Au 2026-08-01, le même
fichier échouait avec trois erreurs DIFFÉRENTES sur trois stories
(`AssertionError`, `TypeError`, `TestingLibraryElementError`). Il peut donc y
avoir **deux défauts successifs** dans la même case rouge, le second ayant
masqué le premier. Ne pas supposer une cause unique parce que le fichier est
unique.

## Partie AFK

1. **Dater le premier rouge pour de vrai.** L'API n'a rendu que 60 runs ;
   remonter au-delà (`gh api` avec pagination) pour trouver le dernier succès et
   le commit qui l'a suivi.
2. **Séparer les deux erreurs.** L'erreur du 2026-08-01 et celle d'aujourd'hui
   sont-elles le même défaut ? Bissecter sur les runs, pas sur le code : la CI a
   l'historique, il suffit de le lire.
3. **Reproduire localement les conditions CI** — ubuntu, chromium Playwright
   installé par `npx playwright install --with-deps`, `npm ci` et non
   `npm install`. La piste la plus économique est `npm ci` : un arbre de
   dépendances résolu différemment est le mécanisme classique de la double copie
   de React.
4. **Vérifier s'il y a deux React.** `npm ls react react-dom` en local et dans
   un conteneur ubuntu ; comparer.

## Ce qui rendrait ce ticket raté

Marquer le fichier `skip` pour retrouver du vert. `LayerPanel` porte la pile de
calques — la pièce d'interface la plus centrale du projet, et ses 30+ stories
sont la seule couverture automatique qu'elle ait. Un vert obtenu en éteignant
sa couverture serait pire que le rouge actuel, qui au moins ne ment pas.

## La leçon déjà payée

Ce rouge a été attribué, dans `CLAUDE.md` et dans le ticket
[21](21-le-gate-wgsl-est-rouge-en-ci.md), au gate WGSL arrivé le **2026-08-14** —
alors que la CI était rouge depuis le **2026-08-01 au moins**, treize jours plus
tôt. La chronologie seule suffisait à réfuter l'attribution, et personne ne l'a
regardée : le gate venait d'arriver, il faisait un coupable plausible.

**Attribuer un rouge se fait par son log** (`gh run view --log-failed`), jamais
par proximité temporelle avec le dernier changement.
