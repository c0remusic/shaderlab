# Masque par BANDE DE FRÉQUENCE

Type: prototype
Status: open
Parent: ../map.md

## L'idée

`BandpassMaskRasterNode`, `LiveBandpassRangeMaskTitle` — Affinity sait masquer
par **bande de fréquence** : par la FINESSE DU DÉTAIL, pas par le ton ni par la
teinte.

Nos quatre sources masquent par : où on peint (`brush`), une rampe
(`gradient`), le TON (`luminosity`), la COULEUR (`colorRange`). Aucune ne masque
par l'échelle du détail.

## Le geste que ça débloque

Appliquer un effet aux seuls DÉTAILS FINS sans toucher aux grandes masses — ou
l'inverse. Du grain sur la peau et pas sur le ciel. Un contour qui ne prend que
la texture et pas la silhouette. Un flou qui épargne les cils.

⚠️ Et c'est de la même famille que la SÉPARATION DE FRÉQUENCE, qu'Affinity a
aussi comme outil (`FrequencySeparationTool`) — technique de retouche standard
que nous n'avons sous aucune forme.

## Pourquoi un prototype et pas une tâche

Trois choses ne se devinent pas :

1. **Le coût.** Une bande de fréquence demande au moins deux flous à rayons
   différents et une soustraction. `nettete` fait déjà exactement ça — deux
   BANDES dans un seul opérateur, avec le tour d'`EffectPass.enabled` qui donne
   la texture SOURCE en `prevPass` quand toutes les passes d'un mode sautent
   (`effectPassRunner.ts:247`). Le précédent existe donc côté EFFET.
2. **Où ça vit.** `MaskTextureResolver` évalue les sources de masque, et il ne
   fait aucune pyramide de flou aujourd'hui. Un masque n'est pas un effet : il
   n'a pas de chaîne de passes.
3. **Si c'est LISIBLE.** Un masque par fréquence est abstrait. Il faut le VOIR
   sur une photo avant de décider qu'il vaut une cinquième source — et notre
   règle dit qu'une apparence se regarde, elle ne se déduit pas.

## Ce qui prouve que le ticket est fini

Une réponse à « est-ce que ça se voit et est-ce que ça sert », pas du code
livré. Un prototype jetable, sur une vraie photo d'Antoine — pas sur une mire,
qui n'a pas de peau ni de ciel.
