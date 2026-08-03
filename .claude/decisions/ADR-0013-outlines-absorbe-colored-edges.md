---
id: ADR-0013
status: active
date: 2026-08-03
---

# ADR-0013 : `outlines` absorbe `coloredEdges` (mode d'encre)

## Contexte

Les deux effets partageaient déjà leur détecteur — `edgeGradient.ts`, extrait le
2026-08-03 précisément parce que deux copies du noyau de Scharr auraient dérivé
et fait dessiner les bords à des endroits différents. Restaient deux fichiers qui
déclaraient **cinq paramètres identiques** (`thickness`, `threshold`, `softness`,
`chroma`, `wash`), aux mêmes valeurs, avec les mêmes infobulles, et qui
calculaient la même magnitude avec les mêmes constantes.

Ils ont aussi partagé le même défaut, et c'est le signe le plus net : la bascule
`softness * 0.5`, une constante absolue plus large que tout le signal utile,
était écrite dans les deux et a dû être corrigée dans les deux le même jour.
Le verdict d'usage les visait d'ailleurs ensemble (« horrible, inutilisable »).

Ce qui les séparait tenait en **une décision** : que fait-on de la DIRECTION du
gradient ? L'un la jette et trace une encre unique ; l'autre la garde et en fait
une teinte.

## Décision

**Une décision n'est pas un effet, c'est un mode.** `coloredEdges` est absorbé
par `outlines` sous la forme d'un paramètre `inkMode` — *Encre unique* ou *Roue
d'orientation* (arbitrage d'Antoine, 2026-08-03).

Deux contraintes ont commandé la forme exacte de la fusion :

1. **Les neuf premiers index sont ceux d'`outlines`, inchangés.** L'index d'un
   paramètre est PERSISTÉ dans les presets. Tout ce qui vient de `coloredEdges`
   est ajouté à la suite, et `inkMode` a pour défaut l'encre unique — le rendu
   d'`outlines` est donc rigoureusement celui d'avant.
2. **La fusion devait être PROUVÉE sans perte, pas déclarée telle.** Les deux
   scénarios de rendu de `coloredEdges` ont été portés sur `outlines` en
   transposant leurs réglages (`saturation` → `wheelChroma`, `lightness` →
   `wheelLightness`, `inkMode` à 1), sous les noms `effet-outlines-roue` et
   `effet-outlines-roue-calque-pose`. **Les images sont ressorties identiques à
   l'octet** — mêmes empreintes MD5 qu'avant la fusion (`73c2d3a9…` et
   `a73dbbaa…`), et `effet-outlines.png` inchangé (`78f204e9…`).

Le fond blanc en dur d'`outlines` devient la couleur de fond de `coloredEdges`,
dont le défaut (teinte 0, saturation 0, luminosité 1) redonne exactement ce blanc
— d'où l'égalité au bit, et un fond noir ou coloré désormais atteignable.

## Conséquences

- **L'id `coloredEdges` disparaît** : un preset qui le cite perd ce calque avec
  un avertissement, jamais une exception (même mécanisme qu'ADR-0011 et 0012). Le
  rendu, lui, reste atteignable au pixel près — c'est ce que prouvent les deux
  références portées.
- **Les paramètres de la roue sont renommés `wheelChroma` / `wheelLightness`**,
  et non conservés sous `saturation` / `lightness`. Les anciens noms auraient
  cohabité avec `inkSaturation` / `inkLightness` sans qu'on puisse deviner lequel
  agit dans quel mode ; et comme les presets de `coloredEdges` ne survivent de
  toute façon pas au retrait de son id, les conserver n'aurait racheté personne.
- **Chaque paramètre de mode porte son applicabilité**, comme `hatching` le fait
  déjà (« Sans objet en Encre unique »). C'est le seul garde-fou de densité
  disponible tant que `ParamPanel` ne sait pas masquer un contrôle inerte —
  amélioration réelle, mais qui touche la couche UI et n'appartient pas à cette
  décision.
- **`fwidth` reste calculé AVANT la branche de mode.** Une dérivée écran exige un
  flux de contrôle uniforme ; le branchement sur `inkMode` l'est (il vient d'un
  uniforme), mais placer la dérivée dedans serait fragile à la première refonte.
  Un test le vérifie par la position des deux dans le source.
- **Le registre passe de vingt et un à vingt effets.**

## Ce qui N'EST PAS fait, et pourquoi

`echoOutlines` doit être absorbé de la même façon (même arbitrage d'Antoine, qui
demandait en plus un mode de détection par seuil de forme et un dégradé le long
des échos). **C'est bloqué sur une capacité du pipeline, pas sur du temps.**

`echoOutlines` porte **neuf passes de pyramide** ; `outlines` n'en a aucune. Et
`effectPassRunner.runInternalPasses` itère `effect.passes!` **sans condition** :
un effet fusionné ferait tourner la pyramide entière en mode Contours, pour n'en
rien lire. Sur 24 Mpx, la seule cible à l'échelle 0,5 pèse 24 Mo, et la VRAM est
un risque ouvert déclaré (`CLAUDE.md`, `MAX_CANVAS_PIXELS` calibré sur mesures).

La fusion attend donc des **passes conditionnelles** — un prédicat sur les
paramètres, évalué avant d'emprunter une cible au pool. C'est une capacité utile
au-delà de ce cas : tout effet multi-modes la voudra.

## Alternatives écartées

- **Garder les deux effets.** Deux entrées dans la liste, c'est deux intentions à
  choisir — l'argument est réel. Mais douze paramètres redondants maintenus en
  double se paient à chaque correction, et la bascule `softness * 0.5` a montré
  ce que ça coûte : le même défaut, écrit deux fois, corrigé deux fois.
- **Garder l'id `coloredEdges` et retirer `outlines`.** Symétrique, et rejeté sur
  un fait : `outlines` est le plus ancien et le plus cité, et ses deux références
  de pixels auraient dû être régénérées, donc reperdues comme preuve.
- **Fusionner les trois d'un coup.** Voir ci-dessus : la pyramide inconditionnelle
  aurait rendu le mode Contours dix fois plus coûteux, en silence.
