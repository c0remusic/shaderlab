# ADR 0004 — Image de guide du masque edge-aware : ce que le calque dessine

**Date** : 2026-07-29
**Statut** : Tranché

## Contexte

Le filtre guidé du masque edge-aware (`MaskTextureResolver.edgePipeline`) a
besoin d'une image de GUIDE : c'est sur ses arêtes que le masque vient se caler.
Jusqu'ici cette image était toujours `sourceView`, c'est-à-dire l'entrée
couleur du calque — le composite de tout ce qui se trouve en dessous
(`effectPassRunner.ts`, binding 3).

La tranche T1 (« le fond devient un calque ordinaire ») a vidé la toile : elle
est allouée, effacée une fois en `alpha = 0` et **plus jamais uploadée**
(`imageFrameResources.ts`). Pour le calque le PLUS BAS de la pile, le composite
en dessous est donc cette toile vide.

Conséquence non détectée par la tranche T1 : **un masque edge-aware posé sur le
calque photo de fond n'avait plus aucune arête à suivre.** Le filtre guidé
travaillait sur une image constante — variance nulle, donc `a ≈ 0` et
`b ≈ moyenne(masque)` : le filtre dégénérait en simple moyenne locale du
masque, un flou. Sans erreur, sans message.

**Mesure** (2026-07-29, sonde CDP sur GPU réel, fenêtre WebView2) : sur une
pile `[calque photo de fond (masque edge-aware), calque duotone (masque
edge-aware)]`, la texture servie comme guide était la texture de TOILE pour le
calque du bas, et le buffer de ping-pong (composite en dessous) pour celui
du dessus. L'uniformité de la toile est elle-même mesurée : le scénario
`toile-vide` du harnais de rendu compte **1 seule valeur RGBA distincte** sur
256×256.

Le même défaut, sur les masques PARAMÉTRIQUES, avait été vu et corrigé en
tranche T1 par `bottomPhotoSourceId(layers)` — mais le guide edge-aware n'a pas
été repointé avec eux.

## Décision

**Le guide d'un masque edge-aware est l'image que CE calque dessine** :

- calque portant `imageSource` (calque photo) → **sa propre photo résolue**
  (la sortie de la pré-passe `PhotoLayerInputResolver`, déjà calculée pour la
  couverture) ;
- tout autre calque (effet, effet écrêté) → **le composite en dessous**,
  c'est-à-dire `sourceView` — inchangé.

Une ligne, au seul endroit où le guide se décide
(`effectPassRunner.ts`, `runEffectPass`) :

```ts
const maskGuideView = imageSourceView ?? sourceView;
```

**Aucun cas particulier sur l'index.** C'est délibéré : « l'index 0 est
spécial » est précisément l'hypothèse que la tranche T1 a fait tomber, et
c'est elle qui avait déjà piégé la formule d'epoch de l'ADR-0002. Une règle
qui dépend de la position se re-casse au prochain réagencement de la pile.

### Comportement dans les quatre cas

| Pile | Guide | Verdict |
|---|---|---|
| Calque photo de FOND | sa photo | **corrigé** — c'était la toile vide |
| Calque photo au MILIEU | sa photo | changé, et pour une bonne raison : le composite en dessous est exactement l'ensemble des pixels que cette photo RECOUVRE — guider le masque d'une photo par ce qu'elle cache n'a pas de sens |
| Effet ÉCRÊTÉ sur une photo | composite en dessous | inchangé — l'écrêtage borne le poids de compositing, il ne change pas ce que le calque dessine ; le composite contient déjà la photo de base |
| Calque du bas NON photo | toile (vide) | inchangé, et honnête : ce calque compose réellement sur du vide, sa contribution est invisible, il n'y a effectivement aucune arête. Aucun repli inventé vers une photo située AU-DESSUS |

### L'epoch suit

Un guide qui change sans que son epoch bouge, c'est un cache qui sert du
périmé. `FramePipelineExecutor.computeGuideEpochs` sert donc désormais, à
chaque position :

- position occupée par un calque photo → une epoch dérivée de
  `photoGuideKey(layer)` = `sourceId | x | y | scale | rotation`, la
  description exacte de ce que la pré-passe rendra ;
- toute autre position → l'epoch de la chaîne en dessous, comme avant.

La chaîne continue d'être suivie pour TOUTES les positions (les calques au
dessus en dépendent, photo ou pas) : seule l'epoch **servie** change. Sans
cela, déplacer une photo n'aurait rien invalidé — la SAT du guide serait
restée celle de l'ancienne position.

`photoGuideKey` compare des VALEURS et non des identités d'objet : `imageSource`
et `transform` sont deux champs distincts, et une mise à jour immuable de l'un
laisse l'autre inchangé.

### Rapport à l'ADR-0002

L'invariant de l'ADR-0002 — les deux `masks.resolve()` d'un même calque dans
une frame portent la même epoch — est **intact** : les deux sites lisent
toujours la même case du tableau produit par `computeGuideEpochs`, et une
divergence entre eux reste non représentable. Seul le CONTENU des cases change.

Le site overlay continue de passer la toile ou le composite comme `colorView`,
et c'est correct : l'égalité d'epoch garantit que cet appel est un cache-hit,
donc que le contenu du guide vient de l'appel de la boucle principale — le
seul à disposer de la cible photo avant qu'un calque photo suivant ne la
re-`clear` (cible partagée, invariant d'ordre des passes).

## Conséquences

- Le rendu **bouge** pour tout calque photo portant un masque edge-aware.
  Mesuré sur le scénario de harnais `masque-edge-aware-calque-du-bas` (ajouté
  par cette tranche) : 20,8 % des pixels, écart max 32/255, structuré le long
  des arêtes du damier et du disque en hautes lumières de la mire. C'est
  exactement le signal que le masque suit maintenant l'image.
- Les huit scénarios de harnais antérieurs sont **inchangés au pixel près** :
  le seul qui portait un masque edge-aware le posait sur un calque d'effet en
  position 1, dont le guide était déjà le composite en dessous — il ne pouvait
  pas voir le défaut. C'est le trou que le nouveau scénario ferme.
- Aucune texture ni passe GPU supplémentaire : la photo résolue existait déjà
  pour la couverture.

## Alternatives écartées

- **Rejouer `bottomPhotoSourceId`** (le remède des masques paramétriques) :
  même diagnostic, mais mauvais remède ici. Il rend « la photo la plus basse de
  la pile », ce qui est le seul choix disponible pour un masque paramétrique
  (il n'a aucune notion d'image propre). Un calque photo, lui, a mieux à
  portée : SA photo, déjà résolue dans la frame. « La photo la plus basse »
  serait faux pour tout calque photo qui n'est pas celui du bas.
- **Cas particulier « index 0 »** (guide = photo seulement pour le calque du
  bas) : réintroduit l'hypothèse de position que T1 a démolie, et laisserait un
  calque photo au milieu guidé par les pixels qu'il recouvre.
- **Repli d'un calque du bas non-photo vers une photo située plus haut** :
  inventerait des arêtes que ce calque ne compose pas.
