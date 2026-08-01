---
id: ADR-0009
status: active
date: 2026-08-01
---

# Le déplacement de la vue est libre à tous les zooms ; l'ajustement est une position de départ, pas une contrainte

## Contexte

`clampOffset` (`src/ui/viewport.ts`) bornait le déplacement de la vue avec **deux
régimes**, et le second n'était pas un clamp mais un **centrage** : dès que le
contenu affiché tenait dans la vue sur un axe, l'offset de cet axe était écrasé
par le centre. Le commentaire d'origine l'assumait — « il n'y a rien à explorer
sur cet axe ».

Conséquence non anticipée : **au zoom d'ajustement, qui est le zoom par défaut
d'un document qu'on vient d'ouvrir, le geste de déplacement ne pouvait
strictement rien faire.** Il n'échouait pas, il ne disait rien : le pointeur
bougeait, l'image restait clouée. Signalé à l'usage le 2026-07-31 — « j'ai pas
l'impression qu'on se déplace dans le canvas, ça ne marche que quand on est
zoomé ».

Deux défauts distincts se cachaient derrière cette seule phrase, et il a fallu
les séparer avant de pouvoir trancher :

1. Le curseur de préhension ne s'affichait pas **sur l'image** — `.pasteboard__canvas`
   posait son propre `cursor: default`, qui l'emportait sur le `grab` hérité de
   la vue. La main n'apparaissait que dans la marge autour de l'image. Simple
   bug, corrigé indépendamment de cet ADR.
2. Le régime de centrage lui-même. Celui-là est une décision, pas un bug : il
   tenait un MUST du PRD pan/zoom
   (`docs/superpowers/specs/2026-07-18-shaderlab-canvas-pan-zoom-prd.md`),
   « impossible de faire sortir l'image entièrement de la vue ».

Arbitrage d'Antoine, 2026-08-01 : **« Ajuster à l'écran, c'est pour la position
par défaut, pas pour un geste délibéré de déplacement/recadrement. »**

## Décision

### 1. Un seul régime : l'image se pose où on veut

`clampOffset` n'a plus de branche. Sur chaque axe, l'offset est borné pour
qu'il reste au moins `minVisible` pixels d'image dans la vue, et rien d'autre :

```
offset ∈ [keep − displayed, viewExtent − keep]
```

Les deux inégalités sont le même garde-fou lu par ses deux bords — le bord droit
de l'image au moins à `keep` du bord gauche de la vue, et symétriquement.

### 2. `MIN_VISIBLE_FRACTION = 0.25`, avec deux bornes pour les cas dégénérés

```
keep = min(displayed, max(FIT_MARGIN, 0.25 × min(displayed, viewExtent)))
```

- jamais **plus** que l'image elle-même : une image plus petite que le minimum
  deviendrait immobile, le clamp exigeant l'impossible ;
- jamais **moins** que `FIT_MARGIN` : au dézoom fort, un quart d'une image
  minuscule est une lichette de quelques pixels — visible en théorie,
  irrattrapable à la souris en pratique.

### 3. Le MUST du PRD est TENU, pas renversé

« Impossible de faire sortir l'image entièrement de la vue » reste vrai à la
lettre : il en reste toujours au moins un quart. C'est le clamp qui allait
**au-delà** de ce que le PRD demandait, en confondant « ne jamais la perdre »
avec « ne jamais la bouger ». Aucun MUST n'est abandonné ici ; un seul est
ramené à son énoncé.

### 4. Le centrage descend dans `fitViewport`

Il y était déjà, mais par effet de bord : `fitViewport` passait `offset 0,0` à
`clampOffset` et **comptait sur le régime de centrage** pour obtenir un résultat
centré. Le centrage est maintenant calculé explicitement dans `fitViewport`, qui
est l'endroit dont c'est le métier — la position de départ du document.

C'est la partie du changement qui portait le vrai risque : retirer le régime
sans rapatrier le centrage aurait posé toute image ajustée en haut à gauche.

### 5. `isPannable` est retiré

Sa seule question — « y a-t-il quelque chose à explorer au déplacement ? » —
n'a plus de réponse négative. Aucun appelant de production : le curseur de
préhension est posé en CSS par `Canvas.tsx` sur la seule foi du geste. Garder un
prédicat qui ment coûte plus cher que l'écrire à nouveau si le besoin revient.

## Conséquences

- **Le dézoom ne recentre plus.** `zoomAt` tenait déjà son ancrage au-dessus de
  l'ajustement ; il le tient maintenant **jusqu'au plancher**. Le témoin qui
  affirmait l'inverse (« l'image y est CENTRÉE et non ancrée ») a été retourné :
  il décrivait le code, pas une intention.
- **Un témoin protégeait activement le défaut** : `it("ne bouge pas sur un axe où
  le contenu tient dans la vue")` était vert, précis, et verrouillait exactement
  le comportement signalé comme cassé. Réécrit en « bouge AUSSI ». À garder en
  tête : un nom de test qui énonce une **absence** de comportement mérite qu'on
  demande *pourquoi c'est souhaitable*, pas seulement *si c'est vrai*.
- Après un dézoom ou un redimensionnement de fenêtre, l'image **reste où on l'a
  laissée** au lieu de se recentrer toute seule. C'est le prix explicite du
  choix ; `reconcileViewport` continue de conserver le point regardé au centre,
  et `viewportAutoFitRef` (`App.tsx`) continue de suivre l'ajustement tant que
  l'utilisateur n'a pas zoomé lui-même — les deux mécanismes qui rattrapent le
  cas d'une mise en page pas encore stabilisée sont intacts.
- Mesuré sur la vraie fenêtre WebView2 (CDP, touches et souris réelles) :
  ajustement centré (marges 648/648 et 24/24) ; `Espace`+glisser de −120,−60 au
  zoom d'ajustement ⇒ offset 648→528 et 24→−36, soit le geste au pixel ; poussé
  à −2400,−1200 ⇒ 424×318 px d'image encore visibles sur 1696×1272, soit 25,0 %
  exactement.

## Alternatives écartées

- **Garder le comportement, en se reposant sur le curseur `grab` désormais
  visible pour que l'immobilité se lise comme une limite et non comme une
  panne.** Écartée par Antoine : l'ajustement est une position de départ, pas
  une laisse. Un geste délibéré doit répondre.
- **Débordement totalement libre, sans minimum visible.** Écartée : elle
  abandonne réellement le MUST du PRD, et laisse une vue vide sans aucun indice
  de la direction où l'image est partie. Le quart visible garde une prise à la
  souris en toute circonstance.
- **Une marge de débordement en pixels absolus** (« on peut pousser de 200 px
  au-delà du bord »). Écartée : elle ne veut pas dire la même chose à 12 % et à
  3200 % de zoom. Une fraction de l'étendue affichée est invariante d'échelle,
  ce que le geste est aussi.

## Croyances révisées

- Croyance : « au zoom d'ajustement il n'y a rien à explorer, donc le
  déplacement n'a rien à faire — c'est ce que dit `clampOffset` et c'est ce que
  fait Photoshop par défaut. »
  Réfutée par : l'usage réel, 2026-07-31. La prémisse confond « rien de
  **caché** à révéler » et « rien à **faire** ». Recadrer une image dans sa vue,
  la pousser contre un bord pour travailler l'autre, dégager la place occupée
  par le dock : autant de raisons de bouger une image entièrement visible.
  Ce que ça change : la borne du déplacement ne se déduit plus de « le contenu
  déborde-t-il ? » mais de « en reste-t-il assez pour le rattraper ? ».
