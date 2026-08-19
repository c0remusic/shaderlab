# Pinceau d'effet — peindre un effet en UN geste au lieu de deux

Type: prototype
Status: open
Parent: ../map.md

## Ce qu'Affinity fait

`RasterFilterBrushTool` et `RasterAdjustmentBrushTool` : peindre un FILTRE ou un
AJUSTEMENT directement, au lieu de peindre une couleur. Leurs paramètres le
disent — `FilterTypeToAdd`, `FilterBlendMode`, `FilterTonalRange`,
`AdjustmentTypeToAdd`.

Douze pinceaux chez eux, un chez nous.

## Ce que nous faisons déjà, et pourquoi ce n'est pas rien

**Notre modèle le fait DÉJÀ**, en deux gestes au lieu d'un : ajouter un calque
d'effet, puis peindre son masque. Et il le fait MIEUX sur trois points — l'effet
reste modifiable après coup, il s'annule seul, et il se voit dans la pile.

Leur pinceau est plus DIRECT : on choisit l'effet dans la barre d'options et on
peint. Pas de calque à créer, pas de masque à comprendre.

## La vraie question, et ce n'est pas « faut-il copier »

> Est-ce que « ajouter un calque puis peindre son masque » est un obstacle
> RÉEL, ou une étape qui paraît lourde quand on la décrit mais qui ne coûte rien
> à l'usage ?

⚠️ **Ça se mesure sur le GESTE, pas en le décrivant.** C'est la leçon de l'outil
Forme (2026-08-17) : comparer un outil à sa référence se fait sur DEUX axes — ce
qu'il RÈGLE, et ce qu'on FAIT pour s'en servir. Le second est celui sur lequel
un utilisateur juge en premier, et il ne se lit dans aucune liste de paramètres.

## Une piste qui coûterait beaucoup moins

Un raccourci qui enchaîne les deux gestes — « ajouter cet effet avec un masque
VIDE et passer au pinceau » — au lieu d'un genre d'outil nouveau. Tout existe
déjà : l'ajout de calque, le masque vide, la bascule en mode pinceau
(`ui/tools.ts`, `setCanvasMode`).

À chiffrer contre le pinceau d'effet complet **avant** de choisir, parce que le
raccourci donne peut-être 90 % du gain pour 5 % du travail.

## Ce qui prouve que le ticket est fini

Un verdict d'Antoine sur le geste, devant les deux façons de faire, sur une
vraie photo.
